import { NextResponse } from 'next/server'
import { requireRole, requireWrite, toErrorResponse } from '@/lib/auth/account'
import {
  fetchAllGroups,
  isEvolutionConfigured,
  setWebhook,
  type EvolutionGroup,
} from '@/lib/whatsapp/evolution-api'
import { webhookSecretFor } from '@/lib/whatsapp/evolution-group-inbound'

/**
 * /api/whatsapp/unofficial/groups: which WhatsApp groups of the paired
 * number the CRM follows. Admin only.
 *
 *   GET   groups the number is in, each flagged `tracked`
 *   PUT   { jids: string[] }  replace the followed set; points the
 *         Evolution webhook at the CRM when at least one group is chosen
 *
 * Unfollowing a group removes it from the list only: its conversation and
 * history stay in the inbox.
 */

const SESSION_TABLE = 'whatsapp_unofficial_sessions'

type SessionRow = { instance_name: string; status: string; enabled: boolean }

function webhookUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('NEXT_PUBLIC_SITE_URL is not set')
  return `${base}/api/whatsapp/evolution/webhook`
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    if (!isEvolutionConfigured()) {
      return NextResponse.json({ error: 'A Evolution API não está configurada neste servidor.' }, { status: 503 })
    }
    const { data: session } = await supabase
      .from(SESSION_TABLE)
      .select('instance_name, status, enabled')
      .eq('account_id', accountId)
      .maybeSingle<SessionRow>()
    if (!session || session.status !== 'connected') {
      return NextResponse.json({ error: 'Conecte a sessão (leia o QR code) antes de escolher grupos.' }, { status: 409 })
    }

    const [remote, tracked] = await Promise.all([
      fetchAllGroups({ instanceName: session.instance_name }),
      supabase.from('whatsapp_groups').select('group_jid').eq('account_id', accountId),
    ])
    const trackedSet = new Set((tracked.data ?? []).map((g: { group_jid: string }) => g.group_jid))
    const groups = remote
      .map((g) => ({ jid: g.id, name: g.subject, tracked: trackedSet.has(g.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return NextResponse.json({ groups })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    const body = (await request.json().catch(() => null)) as { jids?: unknown } | null
    if (!body || !Array.isArray(body.jids) || body.jids.some((j) => typeof j !== 'string')) {
      return NextResponse.json({ error: 'Informe jids (lista de textos).' }, { status: 400 })
    }
    const jids = Array.from(new Set(body.jids as string[]))
    if (!isEvolutionConfigured()) {
      return NextResponse.json({ error: 'A Evolution API não está configurada neste servidor.' }, { status: 503 })
    }

    const { data: session } = await supabase
      .from(SESSION_TABLE)
      .select('instance_name, status, enabled')
      .eq('account_id', accountId)
      .maybeSingle<SessionRow>()
    if (!session || session.status !== 'connected') {
      return NextResponse.json({ error: 'Conecte a sessão (leia o QR code) antes de escolher grupos.' }, { status: 409 })
    }
    if (jids.length > 0 && !session.enabled) {
      return NextResponse.json({ error: 'Ative a sessão não oficial antes de acompanhar grupos.' }, { status: 409 })
    }

    // Only groups the paired number really is in; the names come from
    // Evolution, never from the client.
    const remote = await fetchAllGroups({ instanceName: session.instance_name })
    const byJid = new Map<string, EvolutionGroup>(remote.map((g) => [g.id, g]))
    const unknown = jids.filter((j) => !byJid.has(j))
    if (unknown.length > 0) {
      return NextResponse.json({ error: 'Há grupos que o número não participa.', unknown }, { status: 400 })
    }

    if (jids.length > 0) {
      const { error: upsertError } = await supabase.from('whatsapp_groups').upsert(
        jids.map((jid) => ({ account_id: accountId, group_jid: jid, name: byJid.get(jid)!.subject })),
        { onConflict: 'account_id,group_jid' },
      )
      if (upsertError) throw upsertError
    }
    const del = supabase.from('whatsapp_groups').delete().eq('account_id', accountId)
    const { error: deleteError } = jids.length > 0
      ? await del.not('group_jid', 'in', `(${jids.map((j) => `"${j}"`).join(',')})`)
      : await del
    if (deleteError) throw deleteError

    if (jids.length > 0) {
      await setWebhook({
        instanceName: session.instance_name,
        url: webhookUrl(),
        headers: { 'x-evolution-secret': webhookSecretFor(session.instance_name) },
      })
    }
    return NextResponse.json({ ok: true, tracked: jids.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}
