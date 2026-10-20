import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolvePublicOrigin } from '@/lib/csat'
import { buildTrackingScript } from '@/lib/tracking/script'

/**
 * GET /api/tracking/script?key=<public key>: the JavaScript snippet the
 * customer pastes into their landing page. Public; the key only names the
 * account and carries no privilege.
 */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key') ?? ''
  if (key.length < 16 || key.length > 64) {
    return new NextResponse('/* chave inválida */', {
      status: 400,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  }

  const { data } = await supabaseAdmin()
    .from('tracking_settings')
    .select('account_id')
    .eq('public_key', key)
    .maybeSingle()
  if (!data) {
    return new NextResponse('/* chave não encontrada */', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  }

  const endpoint = `${resolvePublicOrigin(request)}/api/tracking/session`
  return new NextResponse(buildTrackingScript({ key, endpoint }), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
