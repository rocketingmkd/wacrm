import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { loadConnection } from '@/lib/google-ads/conversions'
import { GoogleApiError, ingestEvents, onlyDigits } from '@/lib/google-ads/data-manager'
import { refreshAccessToken } from '@/lib/google-ads/oauth'

/**
 * POST /api/google-ads/test: checks the connection without importing
 * anything. Renews the access token, then asks the Data Manager API to
 * validate (validateOnly) one made-up conversion for the account and
 * conversion action saved in the rules.
 *
 * A "gclid" complaint from Google still means the credentials, the scope and
 * the access to the Google Ads account are fine; only the sample click id is
 * fake. Auth or permission errors are reported as such.
 */
export async function POST() {
  try {
    const { accountId } = await requireWrite('admin')
    const db = supabaseAdmin()

    const connection = await loadConnection(db, accountId)
    if (!connection) {
      return NextResponse.json({ ok: false, error: 'Google Ads não está conectado.' }, { status: 400 })
    }
    const customerId = onlyDigits(connection.customerId)
    if (!customerId) {
      return NextResponse.json({ ok: false, error: 'Informe o ID da conta do Google Ads e salve.' }, { status: 400 })
    }

    const { data: rule } = await db
      .from('conversion_rules')
      .select('google_action_id')
      .eq('account_id', accountId)
      .not('google_action_id', 'is', null)
      .limit(1)
      .maybeSingle()
    const actionId = onlyDigits(rule?.google_action_id as string | null)
    if (!actionId) {
      return NextResponse.json(
        { ok: false, error: 'Preencha o ID da ação de conversão do Google em alguma regra e salve.' },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = await refreshAccessToken({
        refreshToken: connection.refreshToken,
        clientId: connection.clientId,
        clientSecret: connection.clientSecret,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro'
      return NextResponse.json({
        ok: false,
        error: `O Google recusou a renovação do acesso (${message}). Conecte de novo.`,
      })
    }

    const loginId = onlyDigits(connection.loginCustomerId)
    const destination: Record<string, unknown> = {
      reference: 'gads',
      operatingAccount: { accountId: customerId, accountType: 'GOOGLE_ADS' },
      productDestinationId: actionId,
    }
    if (loginId) destination.loginAccount = { accountId: loginId, accountType: 'GOOGLE_ADS' }

    try {
      await ingestEvents(accessToken, {
        destinations: [destination],
        events: [
          {
            destinationReferences: ['gads'],
            eventTimestamp: new Date().toISOString(),
            transactionId: `teste-${Date.now()}`,
            adIdentifiers: { gclid: 'TESTE_GCLID_FALSO' },
            eventSource: 'OTHER',
          },
        ],
        validateOnly: true,
      })
      return NextResponse.json({ ok: true, message: 'Tudo certo: o Google aceitou a conexão e a conta.' })
    } catch (err) {
      if (err instanceof GoogleApiError) {
        if (err.status === 401 || err.status === 403) {
          return NextResponse.json({
            ok: false,
            error: `Sem permissão no Google (${err.message}). Confira se a API Data Manager está ativada no projeto, se o escopo datamanager foi adicionado e se a conta que autorizou tem acesso à conta de anúncios.`,
          })
        }
        if (/gclid|click|identifier/i.test(err.message)) {
          return NextResponse.json({
            ok: true,
            message: `Conexão e conta OK. O Google só recusou o gclid de exemplo: ${err.message}`,
          })
        }
        return NextResponse.json({ ok: false, error: `O Google respondeu: ${err.message}` })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
