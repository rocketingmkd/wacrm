import { isRecipientNotAllowedError, phoneVariants } from '@/lib/whatsapp/phone-utils';

/**
 * Try the ways a message can be addressed to one recipient until Meta
 * accepts one.
 *
 * A number can be registered with or without a trunk 0 or the ninth
 * digit, and in the sandbox only some forms are on the allowed list, so
 * Meta answers "recipient not allowed" for the wrong form. Sending is
 * therefore retried across `phoneVariants`. Every send path (inbox,
 * automations, broadcasts) goes through here so they all agree on when
 * to try the next candidate.
 */

export interface SendCandidate {
  kind: string;
  value: string;
}

export interface SendCandidatesOptions<C extends SendCandidate> {
  /**
   * Whether a rejected candidate should fall through to the next one.
   * Default: only Meta's "recipient not allowed" error, since any other
   * failure (bad template, expired token) would fail every candidate and
   * a wrong guess must not reach a stranger. Return `true` to keep
   * going on a failure that is specific to this candidate.
   */
  fallThrough?: (candidate: C, message: string) => boolean;
  /** Called for each candidate that was rejected and skipped. */
  onSkipped?: (candidate: C, message: string) => void;
}

/**
 * Run `attempt` over `candidates` in order. Returns the first success
 * together with the candidate that worked. Rethrows immediately on a
 * failure that must not fall through, and throws the last error when
 * every candidate was rejected.
 */
export async function sendToFirstWorkingCandidate<C extends SendCandidate, T>(
  candidates: readonly C[],
  attempt: (candidate: C) => Promise<T>,
  options: SendCandidatesOptions<C> = {}
): Promise<{ result: T; candidate: C }> {
  const fallThrough =
    options.fallThrough ?? ((_candidate: C, message: string) => isRecipientNotAllowedError(message));

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return { result: await attempt(candidate), candidate };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!fallThrough(candidate, message)) throw err;
      lastError = err;
      options.onSkipped?.(candidate, message);
    }
  }

  throw lastError ?? new Error('No recipient address to send to');
}

/**
 * The common case: one phone number, tried through its variants. Returns
 * the result and the variant that worked (callers use it to correct a
 * stored number that Meta only accepts in another form).
 */
export async function sendToFirstWorkingPhone<T>(
  phone: string,
  attempt: (variant: string) => Promise<T>
): Promise<{ result: T; phone: string }> {
  const candidates = phoneVariants(phone).map((value) => ({ kind: 'phone', value }));
  const { result, candidate } = await sendToFirstWorkingCandidate(candidates, (c) => attempt(c.value));
  return { result, phone: candidate.value };
}
