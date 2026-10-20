import { NextResponse } from 'next/server'
import { requireRole, requireWrite, toErrorResponse } from '@/lib/auth/account'
import {
  createInstance,
  deleteInstance,
  getConnectionState,
  getInstancePhone,
  getQrCode,
  instanceNameForAccount,
  isEvolutionConfigured,
  type EvolutionQr,
} from '@/lib/whatsapp/evolution-api'

/**
 * /api/whatsapp/unofficial: the account's Evolution (unofficial)
 * WhatsApp session, used only to reopen conversations and for groups.
 * Admin only. The Evolution URL/key are server env, never exposed.
 *
 *   GET     status (reconciled against Evolution) + QR while pairing
 *   POST    { action: 'connect' }                   create/refresh QR
 *   PATCH   { enabled: boolean, accept_risk?: true } opt-in switch
 *   DELETE  remove the instance and the row
 */

const TABLE = 'whatsapp_unofficial_sessions'

type SessionRow = {
  account_id: string
  instance_name: string
  status: 'disconnected' | 'connecting' | 'connected'
  phone: string | null
  enabled: boolean
  allow_cold_open: boolean
  risk_accepted_at: string | null
  max_per_lead: number
  daily_limit: number
  connected_at: string | null
}

function publicShape(row: SessionRow | null, qr?: EvolutionQr | null) {
  return {
    available: isEvolutionConfigured(),
    session: row
      ? {
          status: row.status,
          phone: row.phone,
          enabled: row.enabled,
          allow_cold_open: row.allow_cold_open,
          risk_accepted_at: row.risk_accepted_at,
          max_per_lead: row.max_per_lead,
          daily_limit: row.daily_limit,
          connected_at: row.connected_at,
        }
      : null,
    qr: qr ?? null,
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data: row } = await supabase
      .from(TABLE)
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle<SessionRow>()

    if (!row || !isEvolutionConfigured()) {
      return NextResponse.json(publicShape(row ?? null))
    }

    // Reconcile with the real state: the phone can be unpaired from the
    // handset at any time. A failing Evolution call must not break the
    // page, so fall back to the stored row.
    try {
      const state = await getConnectionState({ instanceName: row.instance_name })
      const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      if (status !== row.status) {
        const patch: Partial<SessionRow> & { enabled?: boolean } = { status }
        if (status === 'connected') {
          patch.phone = await getInstancePhone({ instanceName: row.instance_name })
          patch.connected_at = new Date().toISOString()
        }
        const { data: updated } = await supabase
          .from(TABLE)
          .update(patch)
          .eq('account_id', accountId)
          .select('*')
          .maybeSingle<SessionRow>()
        return NextResponse.json(publicShape(updated ?? { ...row, ...patch }))
      }
    } catch (err) {
      console.warn('[unofficial] state reconcile failed:', err instanceof Error ? err.message : err)
    }
    return NextResponse.json(publicShape(row))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST() {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    if (!isEvolutionConfigured()) {
      return NextResponse.json(
        { error: 'A Evolution API não está configurada neste servidor.' },
        { status: 503 },
      )
    }

    const { data: existing } = await supabase
      .from(TABLE)
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle<SessionRow>()

    const instanceName = existing?.instance_name ?? instanceNameForAccount(accountId)

    let qr: EvolutionQr
    if (existing) {
      const state = await getConnectionState({ instanceName }).catch(() => 'close' as const)
      if (state === 'open') {
        return NextResponse.json(publicShape(existing))
      }
      qr = await getQrCode({ instanceName })
    } else {
      qr = await createInstance({ instanceName })
    }

    const { data: row, error } = await supabase
      .from(TABLE)
      .upsert(
        { account_id: accountId, instance_name: instanceName, status: 'connecting' },
        { onConflict: 'account_id' },
      )
      .select('*')
      .single<SessionRow>()
    if (error) throw error

    return NextResponse.json(publicShape(row, qr))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')
    const body = (await request.json().catch(() => null)) as {
      enabled?: boolean
      accept_risk?: boolean
      allow_cold_open?: boolean
    } | null
    if (!body || (typeof body.enabled !== 'boolean' && typeof body.allow_cold_open !== 'boolean')) {
      return NextResponse.json(
        { error: 'Informe enabled ou allow_cold_open (booleano).' },
        { status: 400 },
      )
    }

    const { data: existing } = await supabase
      .from(TABLE)
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle<SessionRow>()
    if (!existing) {
      return NextResponse.json({ error: 'Não há sessão não oficial. Conecte primeiro.' }, { status: 404 })
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.allow_cold_open === 'boolean') {
      if (body.allow_cold_open && !existing.risk_accepted_at) {
        return NextResponse.json(
          { error: 'Aceite o aviso de risco e ative a sessão primeiro.' },
          { status: 400 },
        )
      }
      patch.allow_cold_open = body.allow_cold_open
    }
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (body.enabled) {
      if (existing.status !== 'connected') {
        return NextResponse.json(
          { error: 'Conecte a sessão (leia o QR code) antes de ativá-la.' },
          { status: 409 },
        )
      }
      if (!existing.risk_accepted_at) {
        if (!body.accept_risk) {
          return NextResponse.json(
            { error: 'É preciso aceitar o aviso de risco para ativar a sessão não oficial.' },
            { status: 400 },
          )
        }
        patch.risk_accepted_at = new Date().toISOString()
        patch.risk_accepted_by = userId
      }
    }

    const { data: row, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq('account_id', accountId)
      .select('*')
      .single<SessionRow>()
    if (error) throw error
    return NextResponse.json(publicShape(row))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    const { data: existing } = await supabase
      .from(TABLE)
      .select('instance_name')
      .eq('account_id', accountId)
      .maybeSingle<{ instance_name: string }>()
    if (!existing) return NextResponse.json(publicShape(null))

    if (isEvolutionConfigured()) {
      // Best effort: the instance may already be gone on the server.
      await deleteInstance({ instanceName: existing.instance_name }).catch((err) =>
        console.warn('[unofficial] deleteInstance failed:', err instanceof Error ? err.message : err),
      )
    }
    const { error } = await supabase.from(TABLE).delete().eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json(publicShape(null))
  } catch (err) {
    return toErrorResponse(err)
  }
}
