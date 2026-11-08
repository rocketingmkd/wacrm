import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import {
  ConversationError,
  findConversation,
  findOrCreateConversation,
} from './find-or-create'

type Result = { data?: unknown; error?: unknown }

/**
 * Scripted stand-in for the Supabase query builder. Every chained call
 * returns the builder; the two terminals (`limit` for lookups, `single`
 * for the insert) consume the next scripted result, in order.
 */
function fakeDb(script: Result[]) {
  const log = { selects: [] as string[], inserts: [] as unknown[], orders: [] as unknown[] };
  let i = 0;
  const next = () => Promise.resolve(script[i++] ?? { data: null, error: null });

  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.select = (cols: string) => {
    log.selects.push(cols);
    return builder;
  };
  builder.eq = () => builder;
  builder.order = (...a: unknown[]) => {
    log.orders.push(a);
    return builder;
  };
  builder.insert = (row: unknown) => {
    log.inserts.push(row);
    return builder;
  };
  builder.limit = next;
  builder.single = next;
  return { db: builder as unknown as SupabaseClient, log, calls: () => i };
}

const ARGS = { accountId: 'acc', contactId: 'ct', ownerUserId: 'owner' };
const uniqueViolation = { code: '23505', message: 'duplicate key' };

describe('findConversation', () => {
  it('returns the oldest row, ordered by created_at ascending', async () => {
    const { db, log } = fakeDb([{ data: [{ id: 'c1' }, { id: 'c2' }] }]);
    expect(await findConversation(db, 'acc', 'ct')).toEqual({ id: 'c1' });
    expect(log.orders).toEqual([['created_at', { ascending: true }]]);
  });

  it('returns null when the contact has none', async () => {
    const { db } = fakeDb([{ data: [] }]);
    expect(await findConversation(db, 'acc', 'ct')).toBeNull();
  });

  it('throws a lookup ConversationError instead of reading a failure as "none"', async () => {
    const { db } = fakeDb([{ error: { message: 'boom' } }]);
    await expect(findConversation(db, 'acc', 'ct')).rejects.toMatchObject({
      name: 'ConversationError',
      stage: 'lookup',
    });
  });
});

describe('findOrCreateConversation', () => {
  it('returns the existing conversation without inserting', async () => {
    const { db, log } = fakeDb([{ data: [{ id: 'c1' }] }]);
    const res = await findOrCreateConversation(db, ARGS);
    expect(res).toEqual({ conversation: { id: 'c1' }, created: false });
    expect(log.inserts).toEqual([]);
  });

  it('creates one, stamping tenancy and the audit owner', async () => {
    const { db, log } = fakeDb([{ data: [] }, { data: { id: 'new' } }]);
    const res = await findOrCreateConversation(db, ARGS);
    expect(res).toEqual({ conversation: { id: 'new' }, created: true });
    expect(log.inserts).toEqual([{ account_id: 'acc', user_id: 'owner', contact_id: 'ct' }]);
  });

  it('asks for the requested columns on both the lookup and the insert', async () => {
    const { db, log } = fakeDb([{ data: [] }, { data: { id: 'new', unread_count: 0 } }]);
    await findOrCreateConversation(db, { ...ARGS, select: 'id, unread_count' });
    expect(log.selects).toEqual(['id, unread_count', 'id, unread_count']);
  });

  it('re-resolves the winning row when it loses a create race (23505)', async () => {
    const { db } = fakeDb([
      { data: [] },
      { data: null, error: uniqueViolation },
      { data: [{ id: 'winner' }] },
    ]);
    const res = await findOrCreateConversation(db, ARGS);
    expect(res).toEqual({ conversation: { id: 'winner' }, created: false });
  });

  it('throws a create ConversationError when the race re-lookup finds nothing', async () => {
    const { db } = fakeDb([
      { data: [] },
      { data: null, error: uniqueViolation },
      { data: [] },
    ]);
    await expect(findOrCreateConversation(db, ARGS)).rejects.toMatchObject({ stage: 'create' });
  });

  it('throws a create ConversationError for any other insert error, without a second lookup', async () => {
    const { db, calls } = fakeDb([{ data: [] }, { data: null, error: { code: '42501' } }]);
    const err = await findOrCreateConversation(db, ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(ConversationError);
    expect(err.stage).toBe('create');
    expect(calls()).toBe(2);
  });

  it('does not insert when the lookup fails', async () => {
    const { db, log } = fakeDb([{ error: { message: 'boom' } }]);
    await expect(findOrCreateConversation(db, ARGS)).rejects.toMatchObject({ stage: 'lookup' });
    expect(log.inserts).toEqual([]);
  });
});
