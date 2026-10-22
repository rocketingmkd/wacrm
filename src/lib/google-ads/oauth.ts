import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/datamanager'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const STATE_MAX_AGE_MS = 10 * 60_000

export const STATE_COOKIE = 'gads_oauth_nonce'
export const CALLBACK_PATH = '/api/google-ads/callback'

/**
 * Where Google sends the user back. Must match, character for character, the
 * "URI de redirecionamento autorizado" of the OAuth client in Google Cloud.
 * GOOGLE_ADS_REDIRECT_URI wins; otherwise the public site URL plus the path.
 */
export function redirectUri(request: Request): string {
  const explicit = process.env.GOOGLE_ADS_REDIRECT_URI?.trim()
  if (explicit) return explicit
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (site) return `${site.replace(/\/+$/, '')}${CALLBACK_PATH}`
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')?.trim() ||
    new URL(request.url).host
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    new URL(request.url).protocol.replace(':', '')
  return `${proto}://${host}${CALLBACK_PATH}`
}

function stateKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not set')
  return Buffer.from(key, 'hex')
}

function sign(payload: string): string {
  return createHmac('sha256', stateKey()).update(payload).digest('base64url')
}

export interface OAuthState {
  accountId: string
  userId: string
  nonce: string
}

/**
 * `state` for the authorization request: signed so it cannot be forged, and
 * tied to a nonce that is also kept in an httpOnly cookie, so a callback
 * started by someone else cannot attach their Google account to this CRM
 * account.
 */
export function createState(accountId: string, userId: string, now = Date.now()): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex')
  const payload = Buffer.from(JSON.stringify({ a: accountId, u: userId, n: nonce, t: now })).toString('base64url')
  return { state: `${payload}.${sign(payload)}`, nonce }
}

export function verifyState(state: string | null, now = Date.now()): OAuthState | null {
  if (!state) return null
  const [payload, signature] = state.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      a?: string
      u?: string
      n?: string
      t?: number
    }
    if (!data.a || !data.u || !data.n || typeof data.t !== 'number') return null
    if (now - data.t > STATE_MAX_AGE_MS || data.t > now + 60_000) return null
    return { accountId: data.a, userId: data.u, nonce: data.n }
  } catch {
    return null
  }
}

export function buildAuthUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    // offline + consent: Google only returns a refresh token this way.
    access_type: 'offline',
    prompt: 'consent',
    state: args.state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function postToken(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  const body = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || body.error) {
    throw new Error(body.error_description || body.error || `Google OAuth ${res.status}`)
  }
  return body
}

export async function exchangeCode(args: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<{ refreshToken: string }> {
  const body = await postToken({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  })
  if (!body.refresh_token) {
    throw new Error('O Google não devolveu o refresh token. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.')
  }
  return { refreshToken: body.refresh_token }
}

export async function refreshAccessToken(args: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<string> {
  const body = await postToken({
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: 'refresh_token',
  })
  if (!body.access_token) throw new Error('O Google não devolveu o access token.')
  return body.access_token
}

/** Best effort: tells Google to drop the grant. Never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch {
    // the local copy is deleted either way
  }
}
