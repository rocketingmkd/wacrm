// ============================================================
// Rocketing Pay billing webhook — pure logic, no I/O.
//
// Payload shape and event vocabulary verified against DSC's working
// `webhook-checkout` Supabase Edge Function (the same Rocketing Pay
// checkout, already live with real sales). This module only decides
// WHAT should happen to `account_billing`; the route
// (src/app/api/billing/webhook/route.ts) does the actual DB I/O so
// this stays unit-testable without mocking Supabase.
// ============================================================

import type { BillingStatus } from './state';

// --------------------------------------------------------------
// Product → plan mapping
//
// Fill this in with the real Rocketing Pay `produto_id` values once
// the CRM's paid products are set up there — same shape as DSC's
// PRODUCT_PLAN_MAP. Keys are strings because produto_id can arrive
// as either a number or a numeric string depending on the payload
// shape; normalizeRocketingPayPayload() always stringifies it.
// --------------------------------------------------------------
export const PRODUCT_PLAN_MAP: Record<string, string> = {
  // '123': 'starter',
  // '124': 'pro',
};

export function planForProduct(productId: string | null): string | null {
  if (!productId) return null;
  return PRODUCT_PLAN_MAP[productId] ?? null;
}

// --------------------------------------------------------------
// Normalization
// --------------------------------------------------------------

export type ResolvedBillingEventStatus =
  | 'trial'
  | 'approved'
  | 'renewal'
  | 'charge'
  | 'expired'
  | 'refunded'
  | 'declined'
  | 'unknown';

export interface NormalizedBillingEvent {
  rawEvent: string;
  resolvedStatus: ResolvedBillingEventStatus;
  /** Lower-cased, trimmed. `null` when absent — callers must reject before acting. */
  email: string | null;
  name: string;
  phone: string;
  /** transacao_id ?? venda_id ?? assinatura_id — whichever the payload has. */
  transactionId: string;
  productId: string | null;
  productName: string;
  amount: number;
  paymentMethod: string;
  /** ISO-ish string from the payload, passed through as-is. */
  proximaCobranca: string | null;
  diasAtraso: number;
  /** 'lembrete' | 'cobranca' | 'atraso' | null — only set for `subscription_charge`. */
  tipo: string | null;
  /** Raw `trial_days` from the payload, before clamping. */
  trialDaysRaw: number | null;
}

const EVENT_STATUS_MAP: Record<string, string> = {
  subscription_renewal: 'renewal',
  subscription_charge: 'charge',
  subscription_expired: 'expired',
  trial: 'trial',
  trial_1m: 'trial',
  trial_3m: 'trial',
};

function toResolvedStatus(status: string): ResolvedBillingEventStatus {
  switch (status) {
    case 'trial':
    case 'approved':
    case 'renewal':
    case 'charge':
    case 'expired':
    case 'declined':
      return status;
    case 'refunded':
    case 'chargeback':
      return 'refunded';
    default:
      return 'unknown';
  }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a Rocketing Pay webhook body into a normalized event.
 * Returns `null` when the payload has no `data` field at all — the
 * route treats that as `{ ok: true, action: 'ignored' }` with a 200,
 * same as DSC does for probe/malformed requests.
 *
 * Tolerates the payload being wrapped (`{ body: { data: {...} } }`)
 * or bare (`{ data: {...} }`), matching what Rocketing Pay actually
 * sends (confirmed from the working DSC integration).
 */
export function normalizeRocketingPayPayload(
  payload: unknown,
): NormalizedBillingEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const body = (root.body && typeof root.body === 'object' ? root.body : root) as Record<
    string,
    unknown
  >;
  const data = body.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const comprador = (d.comprador && typeof d.comprador === 'object'
    ? d.comprador
    : {}) as Record<string, unknown>;

  const email =
    str(comprador.email, str(d.comprador_email)).toLowerCase().trim() || null;

  const rawEvent = str(body.event, str(d.event));
  const statusPagamento = str(d.status_pagamento);
  const resolvedRaw = EVENT_STATUS_MAP[rawEvent] || statusPagamento || rawEvent;

  const productIdRaw = body.produto_id ?? d.produto_id ?? null;
  const productId =
    productIdRaw === null || productIdRaw === undefined
      ? null
      : String(productIdRaw);

  const trialDaysRawVal = body.trial_days ?? d.trial_days;
  const trialDaysRaw =
    trialDaysRawVal === undefined || trialDaysRawVal === null
      ? null
      : num(trialDaysRawVal, NaN);

  return {
    rawEvent,
    resolvedStatus: toResolvedStatus(resolvedRaw),
    email,
    name: str(comprador.nome, str(d.comprador_nome)),
    phone: str(comprador.telefone, str(d.comprador_telefone)),
    transactionId: str(d.transacao_id, str(d.venda_id, str(d.assinatura_id))),
    productId,
    productName: str(d.produto_nome),
    amount: num(d.valor, 0),
    paymentMethod: str(d.metodo_pagamento),
    proximaCobranca: (str(d.proxima_cobranca) || null) as string | null,
    diasAtraso: num(d.dias_atraso, 0),
    tipo: (str(d.tipo) || null) as string | null,
    trialDaysRaw: trialDaysRaw !== null && Number.isFinite(trialDaysRaw) ? trialDaysRaw : null,
  };
}

// --------------------------------------------------------------
// Trial length resolution
// --------------------------------------------------------------

const TRIAL_DAYS_BY_EVENT: Record<string, number> = {
  trial_1m: 30,
  trial_3m: 90,
};

/**
 * Resolve how many days a `trial` event grants: explicit
 * `trial_days` on the payload wins, then the `trial_1m`/`trial_3m`
 * event-name convention, then the platform's global default.
 * Clamped to [1, 365] the same way DSC's webhook does.
 */
export function resolveTrialDays(
  ev: NormalizedBillingEvent,
  defaultDays: number,
): number {
  const raw = ev.trialDaysRaw ?? TRIAL_DAYS_BY_EVENT[ev.rawEvent] ?? defaultDays;
  return Math.max(1, Math.min(365, Math.round(raw)));
}

// --------------------------------------------------------------
// Idempotency key
// --------------------------------------------------------------

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Build the key that makes a webhook delivery idempotent — the
 * unique partial index on `billing_webhook_logs.idempotency_key` is
 * the actual lock (see the migration + the webhook route).
 *
 * Returns `null` for events that never change persisted state
 * (payment reminders) — those are logged every time and never
 * deduped, which is safe because they have no patch to (re)apply.
 *
 * A renewal repeats monthly on the same `external_subscription_id`,
 * so the UTC calendar day is folded into the key: two renewals in
 * different months get different keys, but a retried delivery of the
 * SAME renewal (same subscription, same day) still dedupes.
 */
export function buildIdempotencyKey(
  ev: NormalizedBillingEvent,
  now: Date = new Date(),
): string | null {
  if (!ev.transactionId) return null;

  switch (ev.resolvedStatus) {
    case 'trial':
      return `trial:${ev.transactionId}`;
    case 'approved':
      return `approved:${ev.transactionId}`;
    case 'renewal':
      return `renewal:${ev.transactionId}:${utcDateKey(now)}`;
    case 'expired':
      return `expired:${ev.transactionId}`;
    case 'refunded':
      return `refunded:${ev.transactionId}`;
    case 'declined':
      return `declined:${ev.transactionId}`;
    case 'charge':
      // Only the "now past_due" transition is state-changing; plain
      // reminders (lembrete/cobranca, no arrears) are log-only.
      if (ev.tipo === 'atraso' || ev.diasAtraso > 0) {
        return `charge-atraso:${ev.transactionId}:${utcDateKey(now)}`;
      }
      return null;
    default:
      return null;
  }
}

// --------------------------------------------------------------
// Decision
// --------------------------------------------------------------

/** The subset of `account_billing` the decision function needs to read. */
export interface CurrentBillingRow {
  status: BillingStatus;
  plan: string | null;
  external_subscription_id: string | null;
  external_product_id: string | null;
  past_due_since: string | null;
}

/** The subset of `account_billing` a decision may write. `null` fields are explicit clears. */
export interface BillingPatch {
  status?: BillingStatus;
  plan?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  external_product_id?: string | null;
  external_subscription_id?: string | null;
  external_customer_email?: string;
  last_payment_at?: string;
  last_payment_amount?: number;
  last_payment_method?: string;
  past_due_since?: string | null;
}

export type BillingAction =
  | 'trial_set'
  | 'activated'
  | 'renewed'
  | 'charge_logged'
  | 'past_due'
  | 'locked'
  | 'canceled'
  | 'ignored';

export interface BillingDecision {
  action: BillingAction;
  /** `null` means "log only, no write to account_billing". */
  patch: BillingPatch | null;
}

/**
 * Pure decision: given a normalized event and the account's current
 * billing row (or `null` if this account has none yet — shouldn't
 * happen post-041, but handled defensively), decide what to write.
 * No I/O — the route applies `patch` via the service-role client.
 */
export function decideBillingAction(
  ev: NormalizedBillingEvent,
  current: CurrentBillingRow | null,
  opts: { defaultTrialDays: number; now?: Date },
): BillingDecision {
  const now = opts.now ?? new Date();
  const plan = planForProduct(ev.productId) ?? current?.plan ?? null;

  switch (ev.resolvedStatus) {
    case 'trial': {
      const days = resolveTrialDays(ev, opts.defaultTrialDays);
      const trialEndsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      return {
        action: 'trial_set',
        patch: {
          status: 'trialing',
          plan,
          trial_ends_at: trialEndsAt,
          past_due_since: null,
          external_product_id: ev.productId ?? current?.external_product_id ?? null,
        },
      };
    }

    case 'approved':
    case 'renewal': {
      return {
        action: ev.resolvedStatus === 'approved' ? 'activated' : 'renewed',
        patch: {
          status: 'active',
          plan,
          current_period_end: ev.proximaCobranca,
          external_subscription_id:
            ev.transactionId || current?.external_subscription_id || null,
          external_product_id: ev.productId ?? current?.external_product_id ?? null,
          last_payment_at: now.toISOString(),
          last_payment_amount: ev.amount,
          last_payment_method: ev.paymentMethod,
          trial_ends_at: null,
          past_due_since: null,
        },
      };
    }

    case 'charge': {
      const isOverdue = ev.tipo === 'atraso' || ev.diasAtraso > 0;
      if (!isOverdue) {
        // Reminder / upcoming-charge notice — nothing to change yet.
        return { action: 'charge_logged', patch: null };
      }
      return {
        action: 'past_due',
        patch: {
          status: 'past_due',
          past_due_since: current?.past_due_since ?? now.toISOString(),
        },
      };
    }

    case 'expired': {
      return { action: 'locked', patch: { status: 'expired' } };
    }

    case 'refunded': {
      return { action: 'canceled', patch: { status: 'canceled' } };
    }

    case 'declined': {
      // Deliberately NOT a lock (unlike DSC, which suspends on one
      // declined charge). Rocketing Pay already sends
      // `subscription_expired` after its own grace window — one
      // failed card shouldn't lock a paying customer out immediately.
      return {
        action: 'past_due',
        patch: {
          status: 'past_due',
          past_due_since: current?.past_due_since ?? now.toISOString(),
        },
      };
    }

    default:
      return { action: 'ignored', patch: null };
  }
}
