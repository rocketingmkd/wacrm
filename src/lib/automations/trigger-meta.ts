import type { AutomationTriggerType } from '@/types'

/**
 * Tailwind classes for the trigger-type pill on the automations list row.
 * The label text itself comes from the `Automations.builder.triggers.*`
 * catalog (see automation-builder.tsx) instead of living here too — one
 * source of truth for the copy, so the list badge and the builder's own
 * trigger picker can't drift out of sync with each other.
 */
const TRIGGER_PILL_CLASS: Record<AutomationTriggerType, string> = {
  new_message_received: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  first_inbound_message: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  keyword_match: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  new_contact_created: 'border-primary/30 bg-primary/10 text-primary',
  conversation_assigned: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  tag_added: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  time_based: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  interactive_reply: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
  deal_stage_changed: 'border-green-500/30 bg-green-500/10 text-green-300',
}

const FALLBACK_PILL_CLASS = 'border-slate-500/30 bg-slate-500/10 text-muted-foreground'

export function triggerPillClass(t: AutomationTriggerType | string): string {
  return TRIGGER_PILL_CLASS[t as AutomationTriggerType] ?? FALLBACK_PILL_CLASS
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'nunca'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'agora mesmo'
  if (diffSec < 3600) return `há ${Math.floor(diffSec / 60)}min`
  if (diffSec < 86400) return `há ${Math.floor(diffSec / 3600)}h`
  if (diffSec < 2_592_000) return `há ${Math.floor(diffSec / 86400)}d`
  return new Date(iso).toLocaleDateString('pt-BR')
}
