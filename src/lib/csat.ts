// ============================================================
// CSAT (satisfaction rating) helpers shared by the send route, the
// public answer route and the UI.
// ============================================================

export const CSAT_MAX_COMMENT = 1000;

/** The customer can only rate once the link was sent; one open link per
 *  conversation at a time (see the send route). */
export const CSAT_RESEND_AFTER_MS = 60 * 60 * 1000;

export const CSAT_SCORE_LABELS = ['', 'Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'] as const;

export function csatLink(origin: string, token: string): string {
  return `${origin}/csat/${token}`;
}

export function csatMessageText(link: string): string {
  return `Olá! Como foi o seu atendimento? Avalie em menos de 1 minuto: ${link}`;
}

export function isValidScore(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
}
