import { NextResponse, type NextRequest } from 'next/server'
import { requireWrite } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { STATE_COOKIE, exchangeCode, redirectUri, verifyState } from '@/lib/google-ads/oauth'

/**
 * GET /api/google-ads/callback: Google sends the admin back here with `code`.
 * The URL of this route is the "URI de redirecionamento autorizado" in the
 * Google Cloud OAuth client. Every outcome ends in a redirect to /traffic
 * with ?google=ok or ?google=erro so the screen can say what happened.
 */
function back(request: NextRequest, status: 'ok' | 'erro', reason?: string) {
  const url = new URL('/traffic', request.url)
  url.searchParams.set('google', status)
  if (reason) url.searchParams.set('motivo', reason.slice(0, 200))
  const response = NextResponse.redirect(url)
  response.cookies.delete({ name: STATE_COOKIE, path: '/api/google-ads' })
  return response
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  const googleError = params.get('error')
  if (googleError) {
    return back(request, 'erro', googleError === 'access_denied' ? 'Você cancelou a autorização no Google.' : googleError)
  }

  const state = verifyState(params.get('state'))
  const nonce = request.cookies.get(STATE_COOKIE)?.value
  if (!state || !nonce || nonce !== state.nonce) {
    return back(request, 'erro', 'A autorização expirou ou não foi iniciada por este navegador. Tente conectar de novo.')
  }

  const code = params.get('code')
  if (!code) return back(request, 'erro', 'O Google não enviou o código de autorização.')

  try {
    const { accountId, userId } = await requireWrite('admin')
    if (accountId !== state.accountId || userId !== state.userId) {
      return back(request, 'erro', 'A sessão mudou durante a autorização. Tente conectar de novo.')
    }

    const db = supabaseAdmin()
    const { data } = await db
      .from('google_ads_connections')
      .select('client_id, client_secret_enc')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!data) return back(request, 'erro', 'Salve o Client ID e o Client Secret antes de conectar.')

    const { refreshToken } = await exchangeCode({
      code,
      clientId: data.client_id as string,
      clientSecret: decrypt(data.client_secret_enc as string),
      redirectUri: redirectUri(request),
    })

    const { error } = await db
      .from('google_ads_connections')
      .update({
        refresh_token_enc: encrypt(refreshToken),
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
    if (error) {
      console.error('[google-ads/callback] save failed:', error.message)
      return back(request, 'erro', 'Não foi possível guardar a conexão.')
    }
    return back(request, 'ok')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao conectar.'
    console.error('[google-ads/callback] failed:', message)
    return back(request, 'erro', message)
  }
}
