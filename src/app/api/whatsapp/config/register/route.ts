import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { registerPhoneNumber } from '@/lib/whatsapp/meta-api'
import { PaymentRequiredError, toErrorResponse } from '@/lib/auth/account'
import { isAccountWriteLocked } from '@/lib/billing/write-lock'

/**
 * POST /api/whatsapp/config/register
 *
 * Completes Cloud API registration for an already-saved number using
 * a 6-digit 2FA PIN. Needed for numbers Embedded Signup did NOT
 * pre-register — true Coexistence migrations of an existing
 * WhatsApp Business App number are pre-registered by the signup flow
 * itself, but a brand-new number picked/created inside the flow (e.g.
 * a Meta test number) has no prior registration and still needs this
 * call, exactly like the old manual-entry path did. Meta rejects
 * sends with (#133010) "Account not registered" until this succeeds.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Seu perfil não está vinculado a uma conta.' },
        { status: 403 },
      )
    }

    if (await isAccountWriteLocked(supabase, accountId)) {
      return toErrorResponse(new PaymentRequiredError())
    }

    const body = await request.json()
    const { pin } = body
    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'O PIN deve ter exatamente 6 dígitos.' }, { status: 400 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config) {
      return NextResponse.json(
        { error: 'Nenhuma configuração do WhatsApp salva ainda.' },
        { status: 404 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json(
        {
          error:
            "Stored access token can't be decrypted — likely ENCRYPTION_KEY changed. Reset the configuration and reconnect.",
        },
        { status: 409 },
      )
    }

    try {
      await registerPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
        pin,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido da API da Meta'
      await supabase
        .from('whatsapp_config')
        .update({ last_registration_error: message, updated_at: new Date().toISOString() })
        .eq('account_id', accountId)
      return NextResponse.json({ error: `Erro da API da Meta: ${message}` }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update({
        registered_at: new Date().toISOString(),
        last_registration_error: null,
        status: 'connected',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)

    if (updateError) {
      console.error('Error updating whatsapp_config after register:', updateError)
      return NextResponse.json({ error: 'Registrado na Meta, mas não foi possível salvar o status.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config register POST:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
