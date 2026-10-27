import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isEvolutionConfigured } from '@/lib/whatsapp/evolution-api'
import { syncContactAvatars } from '@/lib/contacts/sync-avatars'

/**
 * POST /api/contacts/avatars/sync
 *
 * Called by the Inbox after it loads: pulls WhatsApp profile photos for a
 * small batch of contacts that have none, through the account's Evolution
 * session. Accounts without a connected session (official API only) get
 * `{ avatars: [] }` and keep the coloured initial. Contacts are processed
 * in batches, so existing contacts fill in over a few Inbox loads.
 */
const BATCH = 12

export async function POST() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    if (!isEvolutionConfigured()) return NextResponse.json({ avatars: [] })

    const { data: session } = await supabase
      .from('whatsapp_unofficial_sessions')
      .select('instance_name, status, enabled')
      .eq('account_id', accountId)
      .maybeSingle<{ instance_name: string; status: string; enabled: boolean }>()
    if (!session?.enabled || session.status !== 'connected') {
      return NextResponse.json({ avatars: [] })
    }

    const avatars = await syncContactAvatars(supabaseAdmin(), {
      accountId,
      instanceName: session.instance_name,
      limit: BATCH,
    })
    return NextResponse.json({ avatars })
  } catch (err) {
    return toErrorResponse(err)
  }
}
