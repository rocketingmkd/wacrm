/**
 * Public origin (scheme + host, no trailing slash) the app should publish
 * in links it hands to people: invite links, CSAT links, the tracking
 * script endpoint, the Google OAuth redirect, new-account links.
 *
 * Resolution order, first match wins:
 *
 *   1. `NEXT_PUBLIC_SITE_URL`: the operator's explicit config. Trumps
 *      everything.
 *   2. `X-Forwarded-Host` (+ `X-Forwarded-Proto`), set by every reverse
 *      proxy in front of the app (Traefik, Vercel, Cloudflare, nginx).
 *      Behind a proxy `request.url` shows the container's bind address,
 *      so this is the only way to learn the real host.
 *   3. `Host` header, with the protocol the request arrived on. Bare
 *      deployments without a proxy.
 *   4. The origin of `request.url`, when the request carries no host
 *      header at all (tests, local scripts).
 *
 * `ALLOWED_INVITE_HOSTS` (comma-separated hostnames) is a defense against
 * a spoofed `Host` header on a deployment exposed directly to the
 * internet. When it is set, a host from #2 or #3 that is not on the list
 * is rejected with a console.warn and the result is `FALLBACK_PUBLIC_ORIGIN`.
 * When unset, request-derived hosts are trusted. The variable keeps its
 * original name because operators already set it; it now guards every
 * link built here, not only invites.
 *
 * Callers that must NOT trust request headers at all (the login callback,
 * the Evolution webhook URL) read `NEXT_PUBLIC_SITE_URL` directly instead.
 */

export const FALLBACK_PUBLIC_ORIGIN = 'https://rocket-crm.autosolution.pro'

function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim()
  if (!raw) return null
  const list = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 ? list : null
}

function isHostAllowed(host: string, allowList: readonly string[] | null): boolean {
  if (!allowList) return true
  return allowList.includes(host.toLowerCase())
}

function firstHeaderValue(request: Request, name: string): string | undefined {
  return request.headers.get(name)?.split(',')[0]?.trim() || undefined
}

export function resolvePublicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const allowList = parseAllowedHosts()
  const forwardedHost = firstHeaderValue(request, 'x-forwarded-host')
  const forwardedProto = firstHeaderValue(request, 'x-forwarded-proto')
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || 'https'}://${forwardedHost}`
  }

  const host = request.headers.get('host')?.trim()
  if (host && isHostAllowed(host, allowList)) {
    const requestProto = new URL(request.url).protocol.replace(':', '')
    return `${forwardedProto || requestProto}://${host}`
  }

  if (allowList && (forwardedHost || host)) {
    console.warn('[public-origin] rejected non-allow-listed host:', {
      forwardedHost,
      host,
      allowList,
    })
    return FALLBACK_PUBLIC_ORIGIN
  }

  return new URL(request.url).origin
}
