import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Shared-secret gate for the cron endpoints (`x-cron-secret` header must
 * match `AUTOMATION_CRON_SECRET`). Returns the error response to send
 * back, or `null` when the caller is authorised:
 *
 *   const denied = requireCronSecret(request)
 *   if (denied) return denied
 *
 * The compare is constant-time so the secret can't be recovered
 * byte-by-byte from response-time deltas. The length check is required
 * by `timingSafeEqual` (it throws on unequal lengths) and leaks only the
 * length, which isn't sensitive.
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
