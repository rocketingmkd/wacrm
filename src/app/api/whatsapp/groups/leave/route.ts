import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { fetchGroupSubject, isEvolutionConfigured, leaveGroup } from '@/lib/whatsapp/evolution-api'

/**
 * POST /api/whatsapp/groups/leave   { contact_id }
 *
 * Deleting a WhatsApp group in the CRM: the paired number LEAVES the
 * group on WhatsApp first (so nothing more arrives, like deleting a group
 * in WhatsApp itself), then the group's contact, conversations and
 * messages are removed. Admin only: it acts on the real WhatsApp number.
 *
 * If leaving fails, nothing is deleted, so the CRM never shows a group as
 * gone while the number is still in it. The one exception is a number
 * that is already out of the group (kicked, or the group was deleted):
 * Evolution then fails both the leave and a lookup of the group, and the
 * conversation is removed anyway so it can't get stuck.
 */

const isHttpError = (err: unknown) => err instanceof Error && err.message.startsWith('Evolution API error')

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    const body = (await request.json().catch(() => null)) as { contact_id?: unknown } | null
    if (!body || typeof body.contact_id !== 'string') {
      return NextResponse.json({ error: 'Informe contact_id.' }, { status: 400 })
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, is_group, group_jid')
      .eq('id', body.contact_id)
      .eq('account_id', accountId)
      .maybeSingle<{ id: string; is_group: boolean; group_jid: string | null }>()
    if (!contact) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 })
    if (!contact.is_group || !contact.group_jid) {
      return NextResponse.json({ error: 'Este contato não é um grupo.' }, { status: 400 })
    }

    const { data: session } = await supabase
      .from('whatsapp_unofficial_sessions')
      .select('instance_name, status')
      .eq('account_id', accountId)
      .maybeSingle<{ instance_name: string; status: string }>()
    if (!isEvolutionConfigured() || !session || session.status !== 'connected') {
      return NextResponse.json(
        { error: 'A sessão não oficial está desconectada. Conecte-a para o número poder sair do grupo.' },
        { status: 409 },
      )
    }

    const target = { instanceName: session.instance_name, groupJid: contact.group_jid }
    try {
      await leaveGroup(target)
    } catch (leaveErr) {
      // Already out of the group? Then Evolution can't describe it either.
      let alreadyOut = false
      if (isHttpError(leaveErr)) {
        try {
          await fetchGroupSubject(target)
        } catch (lookupErr) {
          alreadyOut = isHttpError(lookupErr)
        }
      }
      if (!alreadyOut) {
        console.error('[groups/leave] leaveGroup failed:', leaveErr instanceof Error ? leaveErr.message : leaveErr)
        return NextResponse.json(
          { error: 'Não foi possível sair do grupo no WhatsApp. Nada foi apagado.' },
          { status: 502 },
        )
      }
    }

    const { data: deleted, error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contact.id)
      .eq('account_id', accountId)
      .select('id')
    if (error) throw error
    return NextResponse.json({ ok: true, deleted: deleted?.length ?? 0 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
