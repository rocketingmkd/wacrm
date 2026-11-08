/**
 * Best-effort client IP, used to key per-IP rate limits.
 *
 * `x-forwarded-for` is what every reverse proxy (Vercel, Hostinger,
 * Cloudflare) sets when forwarding a request; the leftmost entry is the
 * original client. `x-real-ip` is the fallback for proxies that only set
 * that one.
 *
 * Returns a constant when no proxy is in front (e.g. `localhost` in
 * development) so rate-limit keys still exist; the limit then applies
 * "globally", which is fine for dev.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}
