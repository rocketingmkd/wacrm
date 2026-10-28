import type { BillingStatus } from '@/lib/billing/state';

export const STATUS_LABEL: Record<BillingStatus, string> = {
  trialing: 'Em teste',
  active: 'Ativo',
  past_due: 'Pagamento pendente',
  expired: 'Trial expirado',
  canceled: 'Cancelado',
};

export const STATUS_TONE: Record<BillingStatus, string> = {
  trialing: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dm:text-blue-300',
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dm:text-emerald-300',
  past_due: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dm:text-orange-300',
  expired: 'border-red-500/30 bg-red-500/10 text-red-700 dm:text-red-300',
  canceled: 'border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dm:text-neutral-400',
};

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * `utc` for date-only values that Rocketing Pay sends (e.g. the next
 * charge): stored as midnight UTC, so the local zone would show the day
 * before in Brazil.
 */
export function formatDate(iso: string | null | undefined, utc = false): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(utc ? { timeZone: 'UTC' } : {}),
  });
}

/** Rocketing Pay sends the method as free text; show the usual ones in Portuguese. */
export function formatPaymentMethod(method: string | null | undefined): string {
  if (!method) return '—';
  const m = method.toLowerCase();
  if (m.includes('pix')) return 'Pix';
  if (m.includes('credit') || m.includes('cart')) return 'Cartão';
  if (m.includes('boleto')) return 'Boleto';
  return method;
}
