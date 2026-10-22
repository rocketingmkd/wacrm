import { NextResponse } from 'next/server'
import { requireRole, requireWrite, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { redirectUri, revokeToken } from '@/lib/google-ads/oauth'
import { parseCredentialsInput } from '@/lib/google-ads/credentials'

/**
 * GET    /api/google-ads/connection: what the screen needs to draw itself.
 *        Never returns the secret or the token, only whether they exist.
 * PUT    /api/google-ads/connection: saves the OAuth client and the Google
 *        Ads account ids. A blank secret keeps the stored one; a different
 *        client id drops the old token (it belongs to the old client).
 * DELETE /api/google-ads/connection: disconnects and forgets everything.
 *
 * Admin only. The table has RLS with no policies, so it is read and written
 * with the service role after the role check.
 */
export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const { data } = await supabaseAdmin()
      .from('google_ads_connections')
      .select('client_id, refresh_token_enc, customer_id, login_customer_id, connected_at')
      .eq('account_id', accountId)
      .maybeSingle()

    return NextResponse.json({
      redirect_uri: redirectUri(request),
      configured: Boolean(data?.client_id),
      connected: Boolean(data?.refresh_token_enc),
      client_id: (data?.client_id as string | null) ?? '',
      customer_id: (data?.customer_id as string | null) ?? '',
      login_customer_id: (data?.login_customer_id as string | null) ?? '',
      connected_at: (data?.connected_at as string | null) ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await requireWrite('admin')
    const parsed = parseCredentialsInput(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    const db = supabaseAdmin()
    const { data: current } = await db
      .from('google_ads_connections')
      .select('client_id, client_secret_enc, refresh_token_enc')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!current && !input.client_secret) {
      return NextResponse.json({ error: 'Informe o Client Secret.' }, { status: 400 })
    }

    const clientChanged = Boolean(current) && current!.client_id !== input.client_id
    if (clientChanged && !input.client_secret) {
      return NextResponse.json({ error: 'Você trocou o Client ID, então informe também o Client Secret.' }, { status: 400 })
    }

    const { error } = await db.from('google_ads_connections').upsert(
      {
        account_id: accountId,
        client_id: input.client_id,
        client_secret_enc: input.client_secret ? encrypt(input.client_secret) : current!.client_secret_enc,
        refresh_token_enc: clientChanged ? null : (current?.refresh_token_enc ?? null),
        customer_id: input.customer_id,
        login_customer_id: input.login_customer_id,
        ...(clientChanged ? { connected_at: null } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    if (error) {
      console.error('[google-ads/connection] save failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireWrite('admin')
    const db = supabaseAdmin()
    const { data } = await db
      .from('google_ads_connections')
      .select('refresh_token_enc')
      .eq('account_id', accountId)
      .maybeSingle()

    if (data?.refresh_token_enc) {
      try {
        await revokeToken(decrypt(data.refresh_token_enc as string))
      } catch {
        // undecryptable token: nothing to revoke
      }
    }
    await db.from('google_ads_connections').delete().eq('account_id', accountId)
    // Keep the rules, but stop sending until it is connected again.
    await db.from('conversion_settings').update({ google_enabled: false }).eq('account_id', accountId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
