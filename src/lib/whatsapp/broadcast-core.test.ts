import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { sendTemplateMessage } = vi.hoisted(() => ({ sendTemplateMessage: vi.fn() }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage }));

import {
  createBroadcast,
  deliverBroadcast,
  BroadcastError,
  type BroadcastPlan,
} from './broadcast-core';

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

type Scripted = { data?: unknown; error?: unknown };

/**
 * Recording stand-in for the tables `deliverBroadcast` touches. Every
 * chained call returns the builder; `limit` answers the conversation
 * lookup, `single` the conversation insert, and an awaited builder
 * resolves to the table's write result.
 */
function deliveryDb(opts: {
  conversationLookup?: Scripted[];
  messageInsert?: Scripted;
  conversationInsert?: Scripted;
} = {}) {
  const lookups = [...(opts.conversationLookup ?? [])];
  const log = {
    recipientUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
    broadcastUpdates: [] as Record<string, unknown>[],
    messageInserts: [] as Record<string, unknown>[],
    conversationInserts: [] as Record<string, unknown>[],
    conversationUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
  };

  const db = {
    from(table: string) {
      let write: 'insert' | 'update' | null = null;
      let patch: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (_col: string, value: unknown) => {
        if (write === 'update' && table === 'broadcast_recipients') {
          log.recipientUpdates.push({ patch, id: value });
        }
        if (write === 'update' && table === 'conversations') {
          log.conversationUpdates.push({ patch, id: value });
        }
        if (write === 'update' && table === 'broadcasts') log.broadcastUpdates.push(patch);
        return b;
      };
      b.insert = (row: Record<string, unknown>) => {
        write = 'insert';
        if (table === 'messages') log.messageInserts.push(row);
        if (table === 'conversations') log.conversationInserts.push(row);
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        write = 'update';
        patch = p;
        return b;
      };
      b.limit = () => Promise.resolve(lookups.shift() ?? { data: [], error: null });
      b.single = () =>
        Promise.resolve(opts.conversationInsert ?? { data: { id: 'conv-new' }, error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve(
          table === 'messages'
            ? (opts.messageInsert ?? { error: null })
            : { data: null, error: null }
        );
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, log };
}

function makePlan(overrides: Partial<BroadcastPlan> = {}): BroadcastPlan {
  return {
    accountId: 'acc',
    ownerUserId: 'owner',
    broadcastId: 'b1',
    templateName: 'promo',
    templateLanguage: 'pt_BR',
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
    templateRow: null,
    rejected: 0,
    planned: [
      { recipientRowId: 'r1', contactId: 'ct1', phone: '+5511999990001', params: ['Ana'] },
      { recipientRowId: 'r2', contactId: 'ct2', phone: '+5511999990002', params: ['Bia'] },
    ],
    ...overrides,
  };
}

describe('deliverBroadcast', () => {
  beforeEach(() => {
    sendTemplateMessage.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends each recipient its own params and stamps the recipient rows', async () => {
    sendTemplateMessage
      .mockResolvedValueOnce({ messageId: 'wamid.1' })
      .mockResolvedValueOnce({ messageId: 'wamid.2' });
    const { db, log } = deliveryDb({
      conversationLookup: [{ data: [{ id: 'conv-1' }] }, { data: [{ id: 'conv-2' }] }],
    });

    await deliverBroadcast(db, makePlan());

    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
    expect(sendTemplateMessage.mock.calls[0][0]).toMatchObject({
      phoneNumberId: 'pn-1',
      to: '+5511999990001',
      templateName: 'promo',
      language: 'pt_BR',
      params: ['Ana'],
    });
    expect(log.recipientUpdates.map((u) => u.id)).toEqual(['r1', 'r2']);
    expect(log.recipientUpdates[0].patch).toMatchObject({
      status: 'sent',
      whatsapp_message_id: 'wamid.1',
      error_message: null,
    });
    expect(log.broadcastUpdates[0]).toMatchObject({ status: 'sent' });
  });

  it('records each sent template in the contact conversation as a bot message', async () => {
    sendTemplateMessage
      .mockResolvedValueOnce({ messageId: 'wamid.1' })
      .mockResolvedValueOnce({ messageId: 'wamid.2' });
    const { db, log } = deliveryDb({
      conversationLookup: [{ data: [{ id: 'conv-1' }] }, { data: [{ id: 'conv-2' }] }],
    });

    await deliverBroadcast(db, makePlan());

    expect(log.messageInserts).toEqual([
      {
        conversation_id: 'conv-1',
        sender_type: 'bot',
        content_type: 'template',
        template_name: 'promo',
        message_id: 'wamid.1',
        transport: 'official',
        status: 'sent',
      },
      {
        conversation_id: 'conv-2',
        sender_type: 'bot',
        content_type: 'template',
        template_name: 'promo',
        message_id: 'wamid.2',
        transport: 'official',
        status: 'sent',
      },
    ]);
    expect(log.conversationUpdates.map((u) => u.id)).toEqual(['conv-1', 'conv-2']);
    expect(log.conversationUpdates[0].patch).toMatchObject({
      last_message_text: '[template:promo]',
    });
    expect(log.conversationUpdates[0].patch).toHaveProperty('last_message_at');
  });

  it('creates the conversation, owned by the audit user, when the contact has none', async () => {
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });
    const { db, log } = deliveryDb({ conversationLookup: [{ data: [] }] });

    await deliverBroadcast(db, makePlan({ planned: [makePlan().planned[0]] }));

    expect(log.conversationInserts).toEqual([
      { account_id: 'acc', user_id: 'owner', contact_id: 'ct1' },
    ]);
    expect(log.messageInserts[0]).toMatchObject({ conversation_id: 'conv-new' });
  });

  it('records nothing in the inbox for a recipient whose send failed', async () => {
    sendTemplateMessage
      .mockRejectedValueOnce(new Error('Invalid parameter'))
      .mockResolvedValueOnce({ messageId: 'wamid.2' });
    const { db, log } = deliveryDb({ conversationLookup: [{ data: [{ id: 'conv-2' }] }] });

    await deliverBroadcast(db, makePlan());

    expect(log.recipientUpdates[0].patch).toMatchObject({
      status: 'failed',
      error_message: 'Invalid parameter',
    });
    expect(log.messageInserts).toHaveLength(1);
    expect(log.messageInserts[0]).toMatchObject({ message_id: 'wamid.2' });
    expect(log.broadcastUpdates[0]).toMatchObject({ status: 'sent' });
  });

  it('marks the broadcast failed when nothing was sent', async () => {
    sendTemplateMessage.mockRejectedValue(new Error('Invalid parameter'));
    const { db, log } = deliveryDb();

    await deliverBroadcast(db, makePlan());

    expect(log.messageInserts).toEqual([]);
    expect(log.broadcastUpdates[0]).toMatchObject({ status: 'failed' });
  });

  it('keeps the recipient sent and carries on when the inbox write fails', async () => {
    sendTemplateMessage
      .mockResolvedValueOnce({ messageId: 'wamid.1' })
      .mockResolvedValueOnce({ messageId: 'wamid.2' });
    const { db, log } = deliveryDb({
      conversationLookup: [{ error: { message: 'db down' } }, { data: [{ id: 'conv-2' }] }],
    });

    await deliverBroadcast(db, makePlan());

    expect(log.recipientUpdates.map((u) => u.patch.status)).toEqual(['sent', 'sent']);
    expect(log.messageInserts).toHaveLength(1);
    expect(log.messageInserts[0]).toMatchObject({ message_id: 'wamid.2' });
    expect(log.broadcastUpdates[0]).toMatchObject({ status: 'sent' });
  });

  it('does not let a failed message insert undo the send', async () => {
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });
    const { db, log } = deliveryDb({
      conversationLookup: [{ data: [{ id: 'conv-1' }] }],
      messageInsert: { error: { message: 'check violation' } },
    });

    await deliverBroadcast(db, makePlan({ planned: [makePlan().planned[0]] }));

    expect(log.recipientUpdates[0].patch).toMatchObject({ status: 'sent' });
    expect(log.conversationUpdates).toEqual([]);
    expect(log.broadcastUpdates[0]).toMatchObject({ status: 'sent' });
  });
});
