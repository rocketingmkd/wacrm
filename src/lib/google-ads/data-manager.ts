import type { QueuedEvent } from '@/lib/tracking/conversions'

const INGEST_URL = 'https://datamanager.googleapis.com/v1/events:ingest'

/** Google accepts click conversions up to 90 days after the click. */
export const MAX_GOOGLE_EVENT_AGE_SECS = 89 * 24 * 3600

const ACCOUNT_TYPE = 'GOOGLE_ADS'

export interface GoogleOrigin {
  gclid: string | null
}

export interface GoogleTarget {
  /** Google Ads account that receives the conversion (digits only). */
  customerId: string
  /** Manager account used to reach customerId, when there is one. */
  loginCustomerId: string | null
  /** Conversion action id (digits only). */
  actionId: string
}

export type GoogleBuildResult = { skip: string } | { body: Record<string, unknown> }

/** Digits only, as the Google Ads UI shows ids with dashes (123-456-7890). */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * Turns a queued deal event plus the lead's gclid into the body of one
 * Data Manager API events:ingest request, or a reason to skip it.
 */
export function buildGoogleRequest(
  event: QueuedEvent,
  origin: GoogleOrigin | null,
  target: GoogleTarget,
  nowSecs: number,
  validateOnly: boolean,
): GoogleBuildResult {
  if (!origin?.gclid) return { skip: 'Contato sem gclid do Google Ads' }

  const eventTime = Math.floor(new Date(event.occurred_at).getTime() / 1000)
  if (nowSecs - eventTime > MAX_GOOGLE_EVENT_AGE_SECS) {
    return { skip: 'Evento com mais de 90 dias (o Google recusa)' }
  }

  const destination: Record<string, unknown> = {
    reference: 'gads',
    operatingAccount: { accountId: target.customerId, accountType: ACCOUNT_TYPE },
    productDestinationId: target.actionId,
  }
  if (target.loginCustomerId) {
    destination.loginAccount = { accountId: target.loginCustomerId, accountType: ACCOUNT_TYPE }
  }

  const googleEvent: Record<string, unknown> = {
    destinationReferences: ['gads'],
    eventTimestamp: new Date(eventTime * 1000).toISOString(),
    // The queue row id: Google ignores a second upload of the same id.
    transactionId: event.id,
    adIdentifiers: { gclid: origin.gclid },
    eventSource: 'OTHER',
  }
  if (event.value != null && Number(event.value) > 0) {
    googleEvent.conversionValue = Number(event.value)
    googleEvent.currency = event.currency || 'BRL'
  }

  return {
    body: {
      destinations: [destination],
      events: [googleEvent],
      validateOnly,
    },
  }
}

export interface IngestResult {
  requestId: string | null
  warnings: string[]
}

/** Error from Google with the HTTP status, so callers can tell auth from data. */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export async function ingestEvents(accessToken: string, body: Record<string, unknown>): Promise<IngestResult> {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as {
    requestId?: string
    fieldWarnings?: { fieldPath?: string; reason?: string }[]
    error?: { message?: string; status?: string }
  }
  if (!res.ok) {
    throw new GoogleApiError(json.error?.message || json.error?.status || `Google ${res.status}`, res.status)
  }
  return {
    requestId: json.requestId ?? null,
    warnings: (json.fieldWarnings ?? []).map((w) => `${w.fieldPath ?? '?'}: ${w.reason ?? ''}`.trim()),
  }
}
