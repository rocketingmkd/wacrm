/**
 * Display names of the conversion events a rule can send. Kept out of
 * `conversions.ts` (which pulls in server-only crypto and the Meta client)
 * so client components can import it.
 */
export const EVENT_LABELS: Record<string, string> = {
  Lead: 'Lead',
  Contact: 'Contato',
  Schedule: 'Agendamento',
  CompleteRegistration: 'Cadastro completo',
  InitiateCheckout: 'Início de compra',
  Purchase: 'Compra',
}
