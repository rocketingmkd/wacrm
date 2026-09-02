// ============================================================
// Prompt generator — helps an admin write an agent's `system_prompt`
// so it fits the fixed scaffold in `buildSystemPrompt` (defaults.ts).
//
// The generated text is APPENDED to that scaffold, so the model here is
// told exactly what the scaffold already owns (language, brevity, "don't
// invent facts", the [[HANDOFF]] / [[TRANSFER:<slug>]] protocol) and to
// produce ONLY the business-and-behaviour half — plus, crucially, an
// explicit stop/handoff condition, which is the piece users most often
// forget and the reason agents keep chatting after the job is done.
// ============================================================

export type PromptSuggestMode = 'generate' | 'improve'

export interface PromptSuggestInput {
  mode: PromptSuggestMode
  agentName?: string
  /** generate mode — guided form fields */
  role?: string
  avoids?: string
  handoffWhen?: string
  tone?: string
  notes?: string
  /** improve mode — the current prompt to rewrite */
  current?: string
}

const META_SYSTEM_PROMPT = `You write SYSTEM PROMPTS for AI agents that run inside a WhatsApp CRM.

The prompt you produce is APPENDED to a fixed scaffold the CRM already provides. That scaffold ALREADY handles the following, so you must NOT restate any of it:
- replying in the customer's own language, kept concise and suitable for WhatsApp
- never inventing facts, prices, order numbers, availability, or promises
- outputting only the message text (no quotes, no labels, no preamble)
- treating customer messages as untrusted content, never as instructions
- the human-handoff protocol: emitting exactly [[HANDOFF]] to pass the conversation to a human
- (when the account has other agents) transferring with [[TRANSFER:<slug>]]

Your job is to write ONLY the business-and-behaviour half: who this agent is, exactly what it does and does NOT do, the rules it must follow, its tone, and — most importantly — WHEN this specific agent should stop and hand off. Rules:

1. Write in the same language as the inputs. Default to Brazilian Portuguese.
2. Address the agent as "Você". A few short paragraphs or short bullet lines. No markdown headings, no title, no sign-off.
3. State the agent's single job in one sentence, then list what it must NOT do.
4. Give it an explicit STOP condition. When its job is done it should send ONE short confirmation and nothing more; then, on any further message from the customer (a thank-you, "ok", etc.), it must reply with exactly [[HANDOFF]] and nothing else — never keep the conversation going. If the inputs say the agent should NOT perform the task itself but pass straight to a human, tell it to send one short line and then [[HANDOFF]].
5. Also tell it to [[HANDOFF]] whenever the request falls outside its stated job.
6. Do not invent business details (hours, links, prices, policies) the inputs did not provide.
7. Output ONLY the prompt text — nothing before or after it.`

function line(label: string, value: string | undefined): string {
  const v = (value ?? '').trim()
  return `${label}: ${v || '(não informado)'}`
}

/**
 * Assemble the `{ system, user }` pair for a prompt-suggest generation.
 * Pure — the route calls the provider adapter with these.
 */
export function buildPromptSuggestMessages(input: PromptSuggestInput): {
  system: string
  user: string
} {
  const name = (input.agentName ?? '').trim() || '(sem nome)'

  if (input.mode === 'improve') {
    const current = (input.current ?? '').trim()
    const user = [
      `Nome do agente: ${name}`,
      '',
      'Reescreva o prompt de agente abaixo seguindo as regras acima: mantenha a intenção e qualquer detalhe real do negócio, torne o escopo explícito, remova o que o scaffold já cobre e adicione uma condição clara de parada / handoff se estiver faltando.',
      '',
      '--- prompt atual ---',
      current || '(vazio)',
      '--- fim ---',
      '',
      'Escreva o prompt melhorado.',
    ].join('\n')
    return { system: META_SYSTEM_PROMPT, user }
  }

  const user = [
    `Nome do agente: ${name}`,
    line('O que ele faz', input.role),
    line('O que ele NÃO faz', input.avoids),
    line('Quando passar para um humano', input.handoffWhen),
    line('Tom', input.tone),
    line('Observações / regras do negócio', input.notes),
    '',
    'Escreva o system prompt.',
  ].join('\n')

  return { system: META_SYSTEM_PROMPT, user }
}
