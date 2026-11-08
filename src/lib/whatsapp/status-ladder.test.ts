import { describe, expect, it } from 'vitest';

import {
  MESSAGE_STATUS_LADDER,
  RECIPIENT_STATUS_LADDER,
  isValidStatusTransition,
  statusesBefore,
} from './status-ladder';

const M = MESSAGE_STATUS_LADDER;
const R = RECIPIENT_STATUS_LADDER;

describe('isValidStatusTransition', () => {
  it('only moves forward along the ladder', () => {
    expect(isValidStatusTransition(M, 'sending', 'sent')).toBe(true);
    expect(isValidStatusTransition(M, 'sent', 'delivered')).toBe(true);
    expect(isValidStatusTransition(M, 'sent', 'read')).toBe(true); // skipping a rung is fine
    expect(isValidStatusTransition(M, 'read', 'delivered')).toBe(false);
    expect(isValidStatusTransition(M, 'delivered', 'sent')).toBe(false);
  });

  it('ignores a replay of the status the row already has', () => {
    expect(isValidStatusTransition(M, 'sent', 'sent')).toBe(false);
    expect(isValidStatusTransition(R, 'read', 'read')).toBe(false);
  });

  it('accepts failed only from the first two rungs', () => {
    expect(isValidStatusTransition(M, 'sending', 'failed')).toBe(true);
    expect(isValidStatusTransition(M, 'sent', 'failed')).toBe(true);
    expect(isValidStatusTransition(M, 'delivered', 'failed')).toBe(false);
    expect(isValidStatusTransition(M, 'read', 'failed')).toBe(false);
    expect(isValidStatusTransition(R, 'pending', 'failed')).toBe(true);
    expect(isValidStatusTransition(R, 'replied', 'failed')).toBe(false);
  });

  it('treats failed as terminal', () => {
    expect(isValidStatusTransition(M, 'failed', 'sent')).toBe(false);
    expect(isValidStatusTransition(M, 'failed', 'read')).toBe(false);
  });

  it('rejects a status the ladder does not know and accepts any known one over an unknown current', () => {
    expect(isValidStatusTransition(M, 'sent', 'deleted')).toBe(false);
    expect(isValidStatusTransition(M, 'weird', 'read')).toBe(true);
    expect(isValidStatusTransition(R, 'weird', 'delivered')).toBe(true);
  });

  it('matches the recipient behavior the webhook already had', () => {
    expect(isValidStatusTransition(R, 'pending', 'sent')).toBe(true);
    expect(isValidStatusTransition(R, 'read', 'delivered')).toBe(false);
    expect(isValidStatusTransition(R, 'delivered', 'replied')).toBe(true);
  });
});

describe('statusesBefore', () => {
  it('lists the statuses a message may be at for each incoming event', () => {
    expect(statusesBefore(M, 'sent')).toEqual(['sending']);
    expect(statusesBefore(M, 'delivered')).toEqual(['sending', 'sent']);
    expect(statusesBefore(M, 'read')).toEqual(['sending', 'sent', 'delivered']);
    expect(statusesBefore(M, 'failed')).toEqual(['sending', 'sent']);
  });

  it('is empty for a status the ladder does not know, so no update is attempted', () => {
    expect(statusesBefore(M, 'deleted')).toEqual([]);
    expect(statusesBefore(M, 'sending')).toEqual([]);
  });

  it('agrees with isValidStatusTransition for every pair on both ladders', () => {
    for (const ladder of [M, R]) {
      for (const incoming of [...ladder, 'failed']) {
        const allowed = statusesBefore(ladder, incoming);
        for (const current of [...ladder, 'failed']) {
          expect(allowed.includes(current)).toBe(isValidStatusTransition(ladder, current, incoming));
        }
      }
    }
  });
});
