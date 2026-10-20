import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolvePublicOrigin } from '@/lib/csat'

/**
 * GET /api/tracking/settings: the account's public tracking key and the
 * ready-to-paste landing page snippet. Creates the key on first use.
 * Admin only.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    let { data } = await supabase
      .from('tracking_settings')
      .select('public_key')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!data) {
      const { data: created, error } = await supabase
        .from('tracking_settings')
        .insert({ account_id: accountId })
        .select('public_key')
        .single()
      if (error) {
        // A parallel request may have created it first.
        const { data: again } = await supabase
          .from('tracking_settings')
          .select('public_key')
          .eq('account_id', accountId)
          .maybeSingle()
        if (!again) {
          console.error('[tracking/settings] create failed:', error.message)
          return NextResponse.json({ error: 'Não foi possível preparar o rastreamento.' }, { status: 500 })
        }
        data = again
      } else {
        data = created
      }
    }

    const origin = resolvePublicOrigin(request)
    const publicKey = data!.public_key as string
    return NextResponse.json({
      public_key: publicKey,
      script_url: `${origin}/api/tracking/script?key=${publicKey}`,
      snippet: `<script src="${origin}/api/tracking/script?key=${publicKey}" async></script>`,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
