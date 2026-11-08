import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContactRecord, findOrCreateContact, ContactError } from './service';

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });
});

type Scripted = { data?: unknown; error?: unknown };

/**
 * Scripted stand-in for the contacts table. `list` answers a phone lookup
 * (an awaited select), `maybe` a BSUID lookup (`maybeSingle`), `single`
 * the insert's `single()`. Updates are recorded and always succeed.
 */
function contactsDb(script: { list?: Scripted[]; maybe?: Scripted[]; single?: Scripted[] }) {
  const lists = [...(script.list ?? [])];
  const maybes = [...(script.maybe ?? [])];
  const singles = [...(script.single ?? [])];
  const log = { inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] };

  const makeBuilder = () => {
    let mode: 'select' | 'update' = 'select';
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'like']) b[m] = () => b;
    b.insert = (row: Record<string, unknown>) => {
      log.inserts.push(row);
      return b;
    };
    b.update = (patch: Record<string, unknown>) => {
      mode = 'update';
      log.updates.push(patch);
      return b;
    };
    b.maybeSingle = () => Promise.resolve(maybes.shift() ?? { data: null, error: null });
    b.single = () => Promise.resolve(singles.shift() ?? { data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(mode === 'update' ? { error: null } : (lists.shift() ?? { data: [], error: null }));
    return b;
  };

  const db = { from: () => makeBuilder() } as unknown as SupabaseClient;
  return { db, log };
}

const BASE = { accountId: 'acc', ownerUserId: 'owner' };
const stored = { id: 'c1', phone: '+5511999990000', name: 'Ana', wa_user_id: null, wa_username: null };
const uniqueViolation = { code: '23505', message: 'duplicate key' };

describe('findOrCreateContactRecord', () => {
  it('returns an existing contact by phone without writing when backfill is off', async () => {
    const { db, log } = contactsDb({ list: [{ data: [stored] }] });
    const res = await findOrCreateContactRecord(db, {
      ...BASE,
      contact: { phone: '+5511999990000', name: 'Someone else' },
      backfill: false,
    });
    expect(res).toEqual({ contact: stored, created: false });
    expect(log.updates).toEqual([]);
    expect(log.inserts).toEqual([]);
  });

  it('backfills a changed name and the identities the stored row lacks', async () => {
    const { db, log } = contactsDb({ list: [{ data: [stored] }] });
    const res = await findOrCreateContactRecord(db, {
      ...BASE,
      contact: { phone: '+5511999990000', name: 'Ana Souza', waUserId: 'bsuid-1', waUsername: 'ana' },
      backfill: true,
    });
    expect(res.created).toBe(false);
    expect(res.contact).toBe(stored);
    expect(log.updates).toHaveLength(1);
    expect(log.updates[0]).toMatchObject({ name: 'Ana Souza', wa_user_id: 'bsuid-1', wa_username: 'ana' });
    expect(log.updates[0]).toHaveProperty('updated_at');
    expect(log.updates[0]).not.toHaveProperty('phone');
  });

  it('does not write when backfill learns nothing new, and never nulls a stored value', async () => {
    const { db, log } = contactsDb({ list: [{ data: [stored] }] });
    await findOrCreateContactRecord(db, {
      ...BASE,
      contact: { phone: '+5511999990000', name: 'Ana' },
      backfill: true,
    });
    expect(log.updates).toEqual([]);

    const { db: db2, log: log2 } = contactsDb({ list: [{ data: [stored] }] });
    await findOrCreateContactRecord(db2, {
      ...BASE,
      contact: { phone: '+5511999990000', name: null },
      backfill: true,
    });
    expect(log2.updates).toEqual([]);
  });

  it('creates a contact with no name as null, not as the phone number', async () => {
    const { db, log } = contactsDb({ list: [{ data: [] }], single: [{ data: { id: 'new' } }] });
    const res = await findOrCreateContactRecord(db, {
      ...BASE,
      contact: { phone: '+5511999990000' },
      backfill: true,
    });
    expect(res).toEqual({ contact: { id: 'new' }, created: true });
    expect(log.inserts).toEqual([
      {
        account_id: 'acc',
        user_id: 'owner',
        phone: '+5511999990000',
        wa_user_id: null,
        wa_username: null,
        name: null,
        email: null,
        company: null,
      },
    ]);
  });

  it('stores the name, email and company it was given', async () => {
    const { db, log } = contactsDb({ list: [{ data: [] }], single: [{ data: { id: 'new' } }] });
    await findOrCreateContactRecord(db, {
      ...BASE,
      contact: { phone: '+5511999990000', name: 'Ana', email: 'a@x.com', company: 'Acme' },
      backfill: false,
    });
    expect(log.inserts[0]).toMatchObject({ name: 'Ana', email: 'a@x.com', company: 'Acme' });
  });

  it('finds a username-only sender by BSUID and creates one without a phone', async () => {
    const found = contactsDb({ maybe: [{ data: { id: 'c9', phone: null, wa_user_id: 'bsuid-1' } }] });
    const res = await findOrCreateContactRecord(found.db, {
      ...BASE,
      contact: { phone: null, waUserId: 'bsuid-1' },
      backfill: true,
    });
    expect(res.contact.id).toBe('c9');
    expect(res.created).toBe(false);

    const fresh = contactsDb({ maybe: [{ data: null }], single: [{ data: { id: 'new' } }] });
    await findOrCreateContactRecord(fresh.db, {
      ...BASE,
      contact: { phone: null, waUserId: 'bsuid-2', waUsername: 'ana' },
      backfill: true,
    });
    expect(fresh.log.inserts[0]).toMatchObject({
      phone: null,
      wa_user_id: 'bsuid-2',
      wa_username: 'ana',
      name: null,
    });
  });

  it('re-resolves the winning row when it loses a create race', async () => {
    const { db } = contactsDb({
      list: [{ data: [] }, { data: [stored] }],
      single: [{ data: null, error: uniqueViolation }],
    });
    const res = await findOrCreateContactRecord(db, {
      ...BASE,
      contact: { phone: '+5511999990000' },
      backfill: false,
    });
    expect(res).toEqual({ contact: stored, created: false });
  });

  it('throws a 500 ContactError for any other insert error', async () => {
    const { db } = contactsDb({
      list: [{ data: [] }],
      single: [{ data: null, error: { code: '42501', message: 'rls' } }],
    });
    await expect(
      findOrCreateContactRecord(db, { ...BASE, contact: { phone: '+5511999990000' }, backfill: false })
    ).rejects.toMatchObject({ name: 'ContactError', status: 500 });
  });

  it('throws a 400 ContactError when there is neither a phone nor a BSUID', async () => {
    const { db, log } = contactsDb({});
    await expect(
      findOrCreateContactRecord(db, { ...BASE, contact: { phone: null }, backfill: false })
    ).rejects.toMatchObject({ name: 'ContactError', status: 400 });
    expect(log.inserts).toEqual([]);
  });
});

describe('findOrCreateContact (API)', () => {
  it('leaves an existing contact alone and creates a new one without a default name', async () => {
    const existing = contactsDb({ list: [{ data: [stored] }] });
    expect(
      await findOrCreateContact(existing.db, 'acc', 'user', { phone: '+5511999990000', name: 'X' })
    ).toEqual({ id: 'c1', created: false });
    expect(existing.log.updates).toEqual([]);

    const fresh = contactsDb({ list: [{ data: [] }], single: [{ data: { id: 'new' } }] });
    expect(await findOrCreateContact(fresh.db, 'acc', 'user', { phone: '+5511999990000' })).toEqual({
      id: 'new',
      created: true,
    });
    expect(fresh.log.inserts[0]).toMatchObject({ name: null });
  });
});
