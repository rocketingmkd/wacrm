import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGroupConversation } from './resolve-conversation';
import { SendMessageError } from './send-message';

const CONV = '11111111-2222-4333-8444-555555555555';

/** One conversation row (or none), exactly as the account-scoped query returns it. */
function fakeDb(row: Record<string, unknown> | null) {
  const filters: [string, unknown][] = [];
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (k: string, v: unknown) => {
      filters.push([k, v]);
      return b;
    },
    maybeSingle: async () => ({ data: row, error: null }),
  });
  return { db: { from: () => b } as unknown as SupabaseClient, filters };
}

describe('resolveGroupConversation (public API: send to a group by conversation_id)', () => {
  it('resolves a group conversation of the account', async () => {
    const { db, filters } = fakeDb({ id: CONV, contact_id: 'ct-1', contact: { is_group: true } });
    const r = await resolveGroupConversation(db, 'acct-1', CONV);
    expect(r).toEqual({ conversationId: CONV, contactId: 'ct-1', contactCreated: false });
    // the lookup is always scoped to the key's account
    expect(filters).toContainEqual(['account_id', 'acct-1']);
  });

  it('accepts the embedded contact as a one-item array too', async () => {
    const { db } = fakeDb({ id: CONV, contact_id: 'ct-1', contact: [{ is_group: true }] });
    await expect(resolveGroupConversation(db, 'acct-1', CONV)).resolves.toMatchObject({ conversationId: CONV });
  });

  it('refuses a 1:1 conversation: a contact is reached by phone, never by a guessed conversation id', async () => {
    const { db } = fakeDb({ id: CONV, contact_id: 'ct-1', contact: { is_group: false } });
    const err = await resolveGroupConversation(db, 'acct-1', CONV).catch((e) => e);
    expect(err).toBeInstanceOf(SendMessageError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/only works for WhatsApp groups/);
  });

  it('404s a conversation that is not in the account', async () => {
    const { db } = fakeDb(null);
    const err = await resolveGroupConversation(db, 'acct-1', CONV).catch((e) => e);
    expect(err).toBeInstanceOf(SendMessageError);
    expect(err.status).toBe(404);
  });

  it('rejects an id that is not a uuid without touching the database', async () => {
    const db = {
      from() {
        throw new Error('db must not be queried');
      },
    } as unknown as SupabaseClient;
    for (const bad of ['', 'abc', CONV + ',or=(1=1)', '../x']) {
      const err = await resolveGroupConversation(db, 'acct-1', bad).catch((e) => e);
      expect(err).toBeInstanceOf(SendMessageError);
      expect(err.status).toBe(400);
    }
  });
});
