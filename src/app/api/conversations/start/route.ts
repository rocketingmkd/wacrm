import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { normalizeTypedPhone } from '@/lib/whatsapp/phone-utils'
import { findOrCreateConversation } from '@/lib/whatsapp/send-message'
import { CONVERSATION_SELECT, normalizeConversation } from '@/lib/inbox/conversations'

/**
 * POST /api/conversations/start  { phone, name? }
 *
 * "Nova conversa": type a number like in the WhatsApp Business app.
 * Finds the contact by phone (or creates it), finds or creates its
 * conversation, and returns the conversation ready for the Inbox. It
 * sends nothing: the first message goes through the normal composer,
 * either as an approved template (official) or, when the account
 * enabled it, as free text through the unofficial session.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('agent')

    const body = (await request.json().catch(() => null)) as {
      phone?: string
      name?: string
    } | null
    const phone = normalizeTypedPhone(body?.phone ?? '')
    if (!phone) {
      return NextResponse.json(
        { error: 'Número inválido. Informe o DDD e o número, por exemplo (43) 99194-3029.' },
        { status: 400 },
      )
    }

    let contact = await findExistingContact(supabase, accountId, phone)
    const createdContact = !contact
    if (!contact) {
      const name = body?.name?.trim() || null
      const { data, error } = await supabase
        .from('contacts')
        .insert({ account_id: accountId, user_id: userId, phone, name })
        .select('*')
        .single()
      if (error || !data) {
        console.error('[conversations/start] contact insert failed:', error?.message)
        return NextResponse.json({ error: 'Não foi possível criar o contato.' }, { status: 500 })
      }
      contact = data
    }

    const conversationId = await findOrCreateConversation(
      supabase,
      accountId,
      userId,
      contact!.id,
    )
    if (!conversationId) {
      return NextResponse.json({ error: 'Não foi possível abrir a conversa.' }, { status: 500 })
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .single()
    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 500 })
    }

    return NextResponse.json({
      conversation: normalizeConversation(conversation as never),
      contact_created: createdContact,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
