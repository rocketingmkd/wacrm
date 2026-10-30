// Análise de UMA conversa: a mesma ficha do relatório de atendimento
// (resumo, intenção, resultado, nota, objeções, falhas, próxima ação) mais
// as métricas de tempo calculadas em código. Somente leitura: nunca envia
// mensagem. Serve de base para um agente de follow up que responde de
// acordo com a conversa.

import type { SupabaseClient } from '@supabase/supabase-js'

import { loadCopilotConfig } from './config'
import { generateReply } from './generate'
import { logAiUsage } from './usage'
import { AiError } from './types'
import {
  buildAnalysisSystemPrompt,
  computeMetrics,
  parseAnalysis,
  REPORT,
  toChatMessages,
  type ConversationAnalysis,
  type RawMessage,
} from './reports'

export interface SingleAnalysis {
  analysis: ConversationAnalysis
  metrics: ReturnType<typeof computeMetrics>
  messagesRead: number
}

export type SingleAnalysisResult =
  | { ok: true; value: SingleAnalysis }
  | { ok: false; status: 404 | 422 | 502 | 503; error: string }

/**
 * `db` precisa ser o cliente de serviço; quem chama já confirmou que a
 * conversa é da conta (a rota checa antes pelo cliente da sessão). Aqui a
 * conta ainda filtra a leitura, por garantia.
 */
export async function analyzeConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  now: Date = new Date(),
): Promise<SingleAnalysisResult> {
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!conv) return { ok: false, status: 404, error: 'Conversa não encontrada.' }

  const config = await loadCopilotConfig(db, accountId).catch(() => null)
  if (!config) {
    return {
      ok: false,
      status: 503,
      error: 'Configure a chave do provedor de IA (OpenAI ou Anthropic) antes de analisar conversas.',
    }
  }

  const { data: msgs } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .order('created_at', { ascending: true })
    .limit(REPORT.fetchMessages)
  const rows = (msgs ?? []) as RawMessage[]
  const readable = rows.filter((m) => m.content_text?.trim())
  if (readable.length < REPORT.minMessages) {
    return { ok: false, status: 422, error: 'Poucas mensagens de texto para analisar.' }
  }

  try {
    const { text, usage } = await generateReply({
      config,
      systemPrompt: buildAnalysisSystemPrompt(),
      messages: toChatMessages(rows),
    })
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'copilot',
      provider: config.provider,
      model: config.model,
      agentId: null,
      usage,
    })
    const analysis = parseAnalysis(text)
    if (!analysis) return { ok: false, status: 502, error: 'A IA respondeu fora do formato. Tente de novo.' }
    return { ok: true, value: { analysis, metrics: computeMetrics(rows, now), messagesRead: readable.length } }
  } catch (err) {
    if (err instanceof AiError) {
      console.error('[conversation-analysis] AI call failed:', err.code, err.message)
      return { ok: false, status: 502, error: `A leitura por IA falhou: ${err.message.slice(0, 200)}` }
    }
    throw err
  }
}
