import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { CSAT_MAX_COMMENT, isValidScore } from '@/lib/csat'

/**
 * Public endpoints behind the rating link /csat/<token>. No session:
 * the unguessable token is the credential, validated against the DB with
 * the service role. Rate limited per IP.
 *
 *   GET   → { found, answered, company }
 *   POST  { score: 1..5, comment? } → records the answer once
 */

function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown'
}

type Row = { id: string; account_id: string; answered_at: string | null }

async function findByToken(token: string): Promise<Row | null> {
  if (!token || token.length < 16 || token.length > 128) return null
  const { data } = await supabaseAdmin()
    .from('csat_responses')
    .select('id, account_id, answered_at')
    .eq('token', token)
    .maybeSingle<Row>()
  return data ?? null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limit = checkRateLimit(`csat-get:${clientIp(request)}`, RATE_LIMITS.invitationPeek)
  if (!limit.success) return rateLimitResponse(limit)

  const { token } = await params
  const row = await findByToken(token)
  if (!row) return NextResponse.json({ found: false }, { status: 404 })

  const { data: account } = await supabaseAdmin()
    .from('accounts')
    .select('name')
    .eq('id', row.account_id)
    .maybeSingle<{ name: string | null }>()

  return NextResponse.json({
    found: true,
    answered: Boolean(row.answered_at),
    company: account?.name ?? '',
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limit = checkRateLimit(`csat-post:${clientIp(request)}`, RATE_LIMITS.invitationRedeem)
  if (!limit.success) return rateLimitResponse(limit)

  const { token } = await params
  const body = (await request.json().catch(() => null)) as {
    score?: unknown
    comment?: unknown
  } | null
  if (!body || !isValidScore(body.score)) {
    return NextResponse.json({ error: 'Escolha uma nota de 1 a 5.' }, { status: 400 })
  }
  const comment =
    typeof body.comment === 'string' && body.comment.trim()
      ? body.comment.trim().slice(0, CSAT_MAX_COMMENT)
      : null

  const row = await findByToken(token)
  if (!row) return NextResponse.json({ error: 'Pesquisa não encontrada ou expirada.' }, { status: 404 })

  // Atomic "answer once": only updates while still unanswered.
  const { data: updated, error } = await supabaseAdmin()
    .from('csat_responses')
    .update({ score: body.score, comment, answered_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('answered_at', null)
    .select('id')
  if (error) {
    console.error('[csat] answer failed:', error.message)
    return NextResponse.json({ error: 'Não foi possível registrar a avaliação.' }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Esta pesquisa já foi respondida.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
