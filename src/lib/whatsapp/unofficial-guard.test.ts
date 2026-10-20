import { describe, expect, it } from 'vitest';
import { assertUnofficialSendAllowed, type UnofficialSession } from './unofficial-guard';
import { SendMessageError } from './send-message';

const NOW = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const session: UnofficialSession = {
  instance_name: 'crm-1',
  status: 'connected',
  enabled: true,
  max_per_lead: 2,
  daily_limit: 30,
};

const ok = {
  messageType: 'text',
  hasPhone: true,
  session,
  lastCustomerMessageAt: hoursAgo(30),
  unofficialSinceLastReply: 0,
  unofficialLast24h: 0,
  now: NOW,
};

function codeOf(input: Parameters<typeof assertUnofficialSendAllowed>[0]): string | null {
  try {
    assertUnofficialSendAllowed(input);
    return null;
  } catch (err) {
    if (err instanceof SendMessageError) return err.code;
    throw err;
  }
}

describe('assertUnofficialSendAllowed', () => {
  it('allows a text reopen: closed window, history, under both limits', () => {
    expect(codeOf(ok)).toBeNull();
  });

  it('allows media too', () => {
    expect(codeOf({ ...ok, messageType: 'image' })).toBeNull();
  });

  it.each(['template', 'interactive'])('rejects %s (Cloud-API only)', (messageType) => {
    expect(codeOf({ ...ok, messageType })).toBe('unofficial_unsupported_type');
  });

  it('rejects when there is no session or it is switched off', () => {
    expect(codeOf({ ...ok, session: null })).toBe('unofficial_disabled');
    expect(codeOf({ ...ok, session: { ...session, enabled: false } })).toBe('unofficial_disabled');
  });

  it('rejects when the session is not connected', () => {
    expect(codeOf({ ...ok, session: { ...session, status: 'connecting' } })).toBe(
      'unofficial_not_connected',
    );
  });

  it('rejects contacts without a phone (BSUID-only)', () => {
    expect(codeOf({ ...ok, hasPhone: false })).toBe('unofficial_needs_phone');
  });

  it('rejects contacts that never wrote to us', () => {
    expect(codeOf({ ...ok, lastCustomerMessageAt: null })).toBe('unofficial_no_history');
  });

  it('rejects while the 24h window is still open', () => {
    expect(codeOf({ ...ok, lastCustomerMessageAt: hoursAgo(23) })).toBe('unofficial_window_open');
  });

  it('treats exactly 24h as closed', () => {
    expect(codeOf({ ...ok, lastCustomerMessageAt: hoursAgo(24) })).toBeNull();
  });

  it('enforces the per-lead limit until the lead replies', () => {
    expect(codeOf({ ...ok, unofficialSinceLastReply: 1 })).toBeNull();
    expect(codeOf({ ...ok, unofficialSinceLastReply: 2 })).toBe('unofficial_lead_limit');
  });

  it('enforces the account daily limit', () => {
    expect(codeOf({ ...ok, unofficialLast24h: 29 })).toBeNull();
    expect(codeOf({ ...ok, unofficialLast24h: 30 })).toBe('unofficial_daily_limit');
  });

  it('reports the more fundamental failure first (disabled beats limits)', () => {
    expect(
      codeOf({ ...ok, session: { ...session, enabled: false }, unofficialLast24h: 99 }),
    ).toBe('unofficial_disabled');
  });
});
