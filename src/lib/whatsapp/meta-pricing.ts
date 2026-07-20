import type { MessageTemplate } from '@/types'

/**
 * Meta's per-message price range in BRL, by template category — Brazil,
 * 2026 pricing model (per-message, not the older 24h-conversation model).
 * Source: public Meta Business Platform pricing; update if Meta changes
 * these tiers. Purely informational — the actual charge lands on the
 * account's own WhatsApp Business bill, not this CRM's invoice.
 */
export const META_PRICE_BRL: Record<MessageTemplate['category'], [number, number]> = {
  Marketing: [0.31, 0.38],
  Utility: [0.04, 0.05],
  Authentication: [0.15, 0.19],
}

export function estimateMetaCost(
  category: MessageTemplate['category'],
  recipients: number,
): { min: number; max: number } {
  const [min, max] = META_PRICE_BRL[category]
  return { min: min * recipients, max: max * recipients }
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
