import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import {
  CSAT_RESEND_AFTER_MS,
  csatLink,
  csatMessageText,
  resolvePublicOrigin,
} from '@/lib/csat'

const WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * POST /api/csat/send  { conversation_id }
 *
 * "Enviar avaliação": creates a CSAT row with an unguessable token and
 * sends the customer a WhatsApp message with the public rating link.
 * Free text, so it needs the 24h service window to be open; outside it
 * the agent has to reopen the conversation first. One unanswered link
 * per conversation per hour, to avoid spamming the customer.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('agent')

    const limit = checkRateLimit(`csat-send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { conversation_id?: string } | null
    const conversationId = body?.conversation_id
    if (!conversationId) {
      return NextResponse.json({ error: 'Informe a conversa.' }, { status: 400 })
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle<{ id: string; contact_id: string | null }>()
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
    }

    // Free text only inside the 24h window.
    const { data: lastCustomer } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>()
    if (!lastCustomer || Date.now() - new Date(lastCustomer.created_at).getTime() >= WINDOW_MS) {
      return NextResponse.json(
        {
          error:
            'A janela de 24h está fechada. Reabra a conversa (template ou sessão não oficial) e envie a avaliação depois que o cliente responder.',
        },
        { status: 409 },
      )
    }

    // One open link at a time.
    const since = new Date(Date.now() - CSAT_RESEND_AFTER_MS).toISOString()
    const { data: pending } = await supabase
      .from('csat_responses')
      .select('id')
      .eq('conversation_id', conversationId)
      .is('answered_at', null)
      .gt('sent_at', since)
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (pending) {
      return NextResponse.json(
        { error: 'Já enviamos um pedido de avaliação há pouco. Aguarde a resposta do cliente.' },
        { status: 409 },
      )
    }

    const { data: row, error: insertError } = await supabase
      .from('csat_responses')
      .insert({
        account_id: accountId,
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        sent_by: userId,
      })
      .select('id, token')
      .single<{ id: string; token: string }>()
    if (insertError || !row) {
      console.error('[csat/send] insert failed:', insertError?.message)
      return NextResponse.json({ error: 'Não foi possível registrar a avaliação.' }, { status: 500 })
    }

    try {
      const link = csatLink(resolvePublicOrigin(request), row.token)
      await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: 'text',
        contentText: csatMessageText(link),
      })
    } catch (err) {
      // The message never left: drop the row so it does not block a retry.
      await supabase.from('csat_responses').delete().eq('id', row.id)
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    return NextResponse.json({ ok: true, id: row.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
