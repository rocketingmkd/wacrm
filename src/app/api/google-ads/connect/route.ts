import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { STATE_COOKIE, buildAuthUrl, createState, redirectUri } from '@/lib/google-ads/oauth'

/**
 * GET /api/google-ads/connect: sends the admin to Google's consent screen
 * using the OAuth client saved for this account. The signed `state` and the
 * httpOnly nonce cookie are checked again in /api/google-ads/callback.
 */
export async function GET(request: Request) {
  try {
    const { accountId, userId } = await requireWrite('admin')

    const { data } = await supabaseAdmin()
      .from('google_ads_connections')
      .select('client_id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!data?.client_id) {
      return NextResponse.json({ error: 'Salve o Client ID e o Client Secret antes de conectar.' }, { status: 400 })
    }

    const { state, nonce } = createState(accountId, userId)
    const url = buildAuthUrl({
      clientId: data.client_id as string,
      redirectUri: redirectUri(request),
      state,
    })

    const response = NextResponse.redirect(url)
    response.cookies.set(STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
      sameSite: 'lax',
      path: '/api/google-ads',
      maxAge: 10 * 60,
    })
    return response
  } catch (err) {
    return toErrorResponse(err)
  }
}
