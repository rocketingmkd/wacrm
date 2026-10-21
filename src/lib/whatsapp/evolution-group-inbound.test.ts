import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/api/v1/contacts', () => ({
  resolveAuditUserId: vi.fn(async () => 'owner-1'),
}));

import {
  isValidWebhookSecret,
  parseGroupUpsert,
  storeGroupMessage,
  webhookSecretFor,
  type ParsedGroupMessage,
} from './evolution-group-inbound';

const GROUP = '120363025246125486@g.us';

const upsert = (data: unknown, extra: Record<string, unknown> = {}) => ({
  event: 'messages.upsert',
  instance: 'crm-1',
  data,
  ...extra,
});

describe('webhook secret', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'k'.repeat(64);
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('is stable per instance and differs between instances', () => {
    expect(webhookSecretFor('crm-1')).toBe(webhookSecretFor('crm-1'));
    expect(webhookSecretFor('crm-1')).not.toBe(webhookSecretFor('crm-2'));
  });

  it('accepts only the exact secret', () => {
    const secret = webhookSecretFor('crm-1');
    expect(isValidWebhookSecret('crm-1', secret)).toBe(true);
    expect(isValidWebhookSecret('crm-1', secret.slice(0, -1) + '0')).toBe(false);
    expect(isValidWebhookSecret('crm-2', secret)).toBe(false);
    expect(isValidWebhookSecret('crm-1', null)).toBe(false);
    expect(isValidWebhookSecret('crm-1', '')).toBe(false);
  });

  it('fails closed when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(isValidWebhookSecret('crm-1', 'anything')).toBe(false);
  });
});

describe('parseGroupUpsert', () => {
  it('parses a plain text group message with its sender', () => {
    const [m] = parseGroupUpsert(
      upsert({
        key: { remoteJid: GROUP, fromMe: false, id: 'A1', participant: '5543999990000@s.whatsapp.net' },
        pushName: 'Maria',
        message: { conversation: 'oi pessoal' },
        messageTimestamp: 1_760_000_000,
      }),
    );
    expect(m).toMatchObject({
      instance: 'crm-1',
      groupJid: GROUP,
      messageId: 'A1',
      fromMe: false,
      senderName: 'Maria',
      senderPhone: '5543999990000',
      contentType: 'text',
      text: 'oi pessoal',
    });
    expect(m.timestamp.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it('reads extended text and falls back to participantAlt when the participant is a LID', () => {
    const [m] = parseGroupUpsert(
      upsert({
        key: {
          remoteJid: GROUP,
          id: 'A2',
          participant: '99887766@lid',
          participantAlt: '5511988887777@s.whatsapp.net',
        },
        message: { extendedTextMessage: { text: 'link https://x.com' } },
      }),
    );
    expect(m.text).toBe('link https://x.com');
    expect(m.senderPhone).toBe('5511988887777');
  });

  it('keeps captions and marks media without one', () => {
    const msgs = parseGroupUpsert(
      upsert([
        { key: { remoteJid: GROUP, id: 'I1' }, message: { imageMessage: { caption: 'foto da obra' } } },
        { key: { remoteJid: GROUP, id: 'I2' }, message: { imageMessage: {} } },
        { key: { remoteJid: GROUP, id: 'D1' }, message: { documentMessage: { fileName: 'proposta.pdf' } } },
        { key: { remoteJid: GROUP, id: 'AU' }, message: { audioMessage: {} } },
      ]),
    );
    expect(msgs.map((m) => m.text)).toEqual(['foto da obra', '[imagem]', '[documento] proposta.pdf', '[áudio]']);
  });

  it('marks messages sent from the paired phone and drops the sender', () => {
    const [m] = parseGroupUpsert(
      upsert({
        key: { remoteJid: GROUP, fromMe: true, id: 'M1', participant: '5543900000000@s.whatsapp.net' },
        pushName: 'Eu',
        message: { conversation: 'ok' },
      }),
    );
    expect(m).toMatchObject({ fromMe: true, senderName: null, senderPhone: null });
  });

  it('accepts the uppercase event name', () => {
    const out = parseGroupUpsert(
      upsert({ key: { remoteJid: GROUP, id: 'U1' }, message: { conversation: 'x' } }, { event: 'MESSAGES_UPSERT' }),
    );
    expect(out).toHaveLength(1);
  });

  it('ignores 1:1 chats, other events, reactions and malformed bodies', () => {
    expect(
      parseGroupUpsert(
        upsert({ key: { remoteJid: '5543999990000@s.whatsapp.net', id: 'P1' }, message: { conversation: 'oi' } }),
      ),
    ).toEqual([]);
    expect(
      parseGroupUpsert(
        upsert({ key: { remoteJid: GROUP, id: 'R1' }, message: { reactionMessage: { text: '👍' } } }),
      ),
    ).toEqual([]);
    expect(parseGroupUpsert({ event: 'connection.update', instance: 'crm-1', data: {} })).toEqual([]);
    expect(parseGroupUpsert({ event: 'messages.upsert', data: {} })).toEqual([]);
    expect(parseGroupUpsert(null)).toEqual([]);
    expect(parseGroupUpsert('x')).toEqual([]);
  });
});

// ---- storeGroupMessage against a tiny in-memory Supabase ------------

type Row = Record<string, unknown>;

function fakeDb() {
  const tables: Record<string, Row[]> = {
    contacts: [],
    conversations: [],
    messages: [],
  };
  let seq = 0;

  const from = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    let patch: Row | null = null;
    let insertRow: Row | null = null;
    let single = false;

    const matching = () => tables[name].filter((r) => filters.every(([k, v]) => r[k] === v));

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      update: (p: Row) => {
        patch = p;
        return builder;
      },
      insert: (row: Row) => {
        insertRow = { id: `${name}-${++seq}`, ...row };
        return builder;
      },
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      single: async () => {
        single = true;
        if (insertRow) {
          tables[name].push(insertRow);
          return { data: insertRow, error: null };
        }
        return { data: matching()[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (patch) {
          matching().forEach((r) => Object.assign(r, patch));
          return resolve({ data: null, error: null });
        }
        if (insertRow) {
          tables[name].push(insertRow);
          return resolve({ data: null, error: null });
        }
        void single;
        return resolve({ data: matching(), error: null });
      },
    };
    return builder;
  };

  return { db: { from } as unknown as SupabaseClient, tables };
}

const base: ParsedGroupMessage = {
  instance: 'crm-1',
  groupJid: GROUP,
  messageId: 'MSG-1',
  fromMe: false,
  senderName: 'Maria',
  senderPhone: '5543999990000',
  contentType: 'text',
  text: 'bom dia',
  timestamp: new Date('2026-10-21T12:00:00Z'),
};

describe('storeGroupMessage', () => {
  const named = (name: string | null) => vi.fn(async () => name);

  it('creates the group contact + conversation on first sight and stores who spoke', async () => {
    const { db, tables } = fakeDb();
    expect(await storeGroupMessage(db, 'acc-1', base, named('Clientes VIP'))).toBe('stored');

    expect(tables.contacts).toHaveLength(1);
    expect(tables.contacts[0]).toMatchObject({
      account_id: 'acc-1',
      is_group: true,
      group_jid: GROUP,
      phone: '120363025246125486',
      name: 'Clientes VIP',
    });
    expect(tables.messages[0]).toMatchObject({
      sender_type: 'customer',
      content_text: 'bom dia',
      message_id: 'MSG-1',
      sender_name: 'Maria',
      sender_phone: '5543999990000',
      origin: 'evolution',
      status: 'delivered',
    });
    // inbound group traffic must not count toward the unofficial send quota
    expect(tables.messages[0].transport).toBeUndefined();
    expect(tables.conversations[0]).toMatchObject({
      last_message_text: 'Maria: bom dia',
      unread_count: 1,
    });
  });

  it('asks Evolution for the subject only when the group is first seen', async () => {
    const { db } = fakeDb();
    const lookup = named('Clientes VIP');
    await storeGroupMessage(db, 'acc-1', base, lookup);
    await storeGroupMessage(db, 'acc-1', { ...base, messageId: 'MSG-2' }, lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('falls back to a placeholder name and fixes it once the subject is known', async () => {
    const { db, tables } = fakeDb();
    await storeGroupMessage(db, 'acc-1', base, named(null));
    expect(tables.contacts[0].name).toBe('Grupo 120363025246125486');

    await storeGroupMessage(db, 'acc-1', { ...base, messageId: 'MSG-2' }, named('Clientes VIP'));
    expect(tables.contacts).toHaveLength(1);
    expect(tables.contacts[0].name).toBe('Clientes VIP');
  });

  it('works without a name lookup at all', async () => {
    const { db, tables } = fakeDb();
    expect(await storeGroupMessage(db, 'acc-1', base)).toBe('stored');
    expect(tables.contacts[0].name).toBe('Grupo 120363025246125486');
  });

  it('skips a message id already stored (retry or echo of our own send)', async () => {
    const { db, tables } = fakeDb();
    await storeGroupMessage(db, 'acc-1', base, named('Clientes VIP'));
    expect(await storeGroupMessage(db, 'acc-1', base, named('Clientes VIP'))).toBe('duplicate');
    expect(tables.messages).toHaveLength(1);
    expect(tables.conversations[0].unread_count).toBe(1);
  });

  it('stores a message sent from the phone as an agent message without raising unread', async () => {
    const { db, tables } = fakeDb();
    await storeGroupMessage(db, 'acc-1', base, named('Clientes VIP'));
    await storeGroupMessage(
      db,
      'acc-1',
      { ...base, messageId: 'MSG-2', fromMe: true, senderName: null, senderPhone: null, text: 'combinado' },
      named('Clientes VIP'),
    );
    expect(tables.messages[1]).toMatchObject({ sender_type: 'agent', origin: 'whatsapp_app', status: 'sent' });
    expect(tables.conversations[0]).toMatchObject({ last_message_text: 'combinado', unread_count: 1 });
  });
});
