import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  applyPhraseMatches,
  findPhraseMatches,
  LABEL_MAX,
  PHRASE_MAX,
  PHRASE_MIN,
} from '@/lib/tracking/phrase-rules'

// TEMPORÁRIO: marcação manual de origem Google por frase, para a conta
// do dono. Quando todos os clientes tiverem o CRM, remova esta rota, o
// diálogo components/tracking/manual-origin-dialog.tsx e o botão em
// app/(dashboard)/traffic/page.tsx.

const MAX_LIST = 500
const MAX_APPLY = 500

/**
 * POST /api/tracking/manual-origin
 *   { action: 'search', phrase }
 *   { action: 'apply', phrase, label, contactIds }
 *
 * search: contatos da conta SEM origem cujas mensagens têm a frase.
 * apply: grava origem Google nos contatos escolhidos. Os ids vindos do
 * navegador só valem se também aparecerem na busca da frase nesta conta,
 * então não dá para marcar contato de outra conta nem sem a frase.
 * Admin. A conta vem da sessão, nunca do corpo.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const userLimit = checkRateLimit(`manual-origin:${userId}`, RATE_LIMITS.phraseScan)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(`manual-origin-acct:${accountId}`, RATE_LIMITS.phraseScanAccount)
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const phrase = typeof body?.phrase === 'string' ? body.phrase.replace(/\s+/g, ' ').trim() : ''
    if (phrase.length < PHRASE_MIN || phrase.length > PHRASE_MAX) {
      return NextResponse.json(
        { error: `A frase precisa ter entre ${PHRASE_MIN} e ${PHRASE_MAX} caracteres.` },
        { status: 400 },
      )
    }

    const db = supabaseAdmin()
    const { matches, truncated } = await findPhraseMatches(db, accountId, phrase)

    if (body?.action === 'search') {
      return NextResponse.json({
        total: matches.length,
        truncated,
        contacts: matches.slice(0, MAX_LIST).map((m) => ({
          contactId: m.contactId,
          conversationId: m.conversationId,
          name: m.name,
          phone: m.phone,
          excerpt: m.excerpt,
          matchedAt: m.matchedAt,
        })),
      })
    }

    if (body?.action === 'apply') {
      const label = typeof body.label === 'string' ? body.label.replace(/\s+/g, ' ').trim() : ''
      if (label.length < 1 || label.length > LABEL_MAX) {
        return NextResponse.json({ error: 'Informe o nome da campanha.' }, { status: 400 })
      }
      const ids = Array.isArray(body.contactIds)
        ? [...new Set(body.contactIds.filter((v): v is string => typeof v === 'string'))]
        : []
      if (ids.length === 0) return NextResponse.json({ error: 'Selecione ao menos um contato.' }, { status: 400 })
      if (ids.length > MAX_APPLY) {
        return NextResponse.json({ error: `Marque no máximo ${MAX_APPLY} contatos por vez.` }, { status: 400 })
      }

      const chosen = new Set(ids)
      const selected = matches.filter((m) => chosen.has(m.contactId))
      const written = await applyPhraseMatches(db, accountId, { source: 'google', label }, selected)
      return NextResponse.json({ requested: ids.length, matched: selected.length, written })
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (err) {
    console.error('[manual-origin] failed:', err)
    return toErrorResponse(err)
  }
}
