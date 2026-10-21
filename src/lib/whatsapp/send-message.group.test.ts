import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// The Evolution client and the service-role client are the only outside
// world the group path touches.
const evo = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendMedia: vi.fn(),
}));
vi.mock('@/lib/whatsapp/evolution-api', () => evo);
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
    }),
  }),
}));

import { sendMessageToConversation, SendMessageError } from './send-message';

const GROUP = '120363025246125486@g.us';

type Row = Record<string, unknown>;

interface World {
  contact: Row;
  session: Row | null;
  /** tables the code is NOT allowed to read in these tests */
  forbidden?: string[];
}

/** A tiny in-memory Supabase: just the queries the send core runs. */
function fakeDb(world: World) {
  const inserted: Row[] = [];
  const convUpdates: Row[] = [];
  const touched: string[] = [];
  const contactUpdates: Row[] = [];

  const from = (table: string) => {
    touched.push(table);
    if (world.forbidden?.includes(table)) throw new Error(`table "${table}" must not be read`);
    const b: Record<string, unknown> = {};
    const chain = () => b;
    Object.assign(b, {
      select: chain,
      eq: chain,
      insert: (row: Row) => {
        if (table === 'messages') inserted.push(row);
        return b;
      },
      update: (row: Row) => {
        if (table === 'conversations') convUpdates.push(row);
        if (table === 'contacts') contactUpdates.push(row);
        return b;
      },
      single: async () => {
        if (table === 'conversations') {
          return { data: { id: 'cv-1', account_id: 'acct-1', contact: world.contact }, error: null };
        }
        if (table === 'messages') return { data: { id: 'msg-1', ...inserted[inserted.length - 1] }, error: null };
        return { data: null, error: { message: 'not found' } };
      },
      maybeSingle: async () => {
        if (table === 'whatsapp_unofficial_sessions') return { data: world.session, error: null };
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    });
    return b;
  };

  return { db: { from } as unknown as SupabaseClient, inserted, convUpdates, touched, contactUpdates };
}

const groupContact = {
  id: 'ct-1',
  // numeric part of the group id: not a valid E.164 phone on purpose
  phone: '120363025246125486',
  name: 'Grupo teste',
  is_group: true,
  group_jid: GROUP,
};
const session = (over: Row = {}) => ({
  instance_name: 'crm-abc',
  status: 'connected',
  enabled: true,
  allow_cold_open: false,
  max_per_lead: 2,
  daily_limit: 30,
  ...over,
});

beforeEach(() => {
  evo.sendText.mockReset().mockResolvedValue({ messageId: '3EB0AAA' });
  evo.sendMedia.mockReset().mockResolvedValue({ messageId: '3EB0BBB' });
});

describe('sending to a WhatsApp group', () => {
  it('sends text to the group id through the unofficial session, with no official config and no 24h window', async () => {
    const w = fakeDb({ contact: groupContact, session: session(), forbidden: ['whatsapp_config'] });
    const r = await sendMessageToConversation(w.db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Bom dia, pessoal',
    });

    expect(evo.sendText).toHaveBeenCalledWith({ instanceName: 'crm-abc', to: GROUP, text: 'Bom dia, pessoal' });
    expect(r.whatsappMessageId).toBe('3EB0AAA');
    expect(w.inserted[0]).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'agent',
      content_text: 'Bom dia, pessoal',
      message_id: '3EB0AAA',
      transport: 'evolution',
      status: 'sent',
    });
    expect(w.convUpdates[0]).toMatchObject({ last_message_text: 'Bom dia, pessoal' });
  });

  it('never rewrites the contact phone with the group id', async () => {
    const w = fakeDb({ contact: groupContact, session: session() });
    await sendMessageToConversation(w.db, 'acct-1', { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' });
    expect(w.contactUpdates).toEqual([]);
  });

  it('ignores a "transport: official" request: a group can only go out unofficially', async () => {
    const w = fakeDb({ contact: groupContact, session: session() });
    await sendMessageToConversation(w.db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
      transport: 'official',
    });
    expect(evo.sendText).toHaveBeenCalledTimes(1);
  });

  it('sends media with its caption', async () => {
    const w = fakeDb({ contact: groupContact, session: session() });
    await sendMessageToConversation(w.db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'image',
      mediaUrl: 'https://cdn.test/foto.jpg',
      contentText: 'Planta da obra',
    });
    expect(evo.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: 'crm-abc', to: GROUP, kind: 'image', link: 'https://cdn.test/foto.jpg', caption: 'Planta da obra' }),
    );
    expect(w.inserted[0]).toMatchObject({ content_type: 'image', media_url: 'https://cdn.test/foto.jpg' });
  });

  it.each([
    ['template', { templateName: 'promo' }],
    ['interactive', { interactivePayload: { kind: 'buttons', body: 'Escolha', buttons: [{ id: 'a', title: 'A' }] } }],
  ])('refuses %s messages: groups take text and media only', async (messageType, extra) => {
    const w = fakeDb({ contact: groupContact, session: session() });
    const err = await sendMessageToConversation(w.db, 'acct-1', {
      conversationId: 'cv-1',
      messageType,
      ...(extra as object),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SendMessageError);
    expect(err.code).toBe('unofficial_unsupported_type');
    expect(err.status).toBe(400);
    expect(evo.sendText).not.toHaveBeenCalled();
  });

  it('needs the unofficial session switched on', async () => {
    for (const s of [null, session({ enabled: false })]) {
      const w = fakeDb({ contact: groupContact, session: s });
      const err = await sendMessageToConversation(w.db, 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'oi',
      }).catch((e) => e);
      expect(err.code).toBe('unofficial_disabled');
      expect(err.status).toBe(409);
    }
    expect(evo.sendText).not.toHaveBeenCalled();
  });

  it('needs the session paired (connected)', async () => {
    const w = fakeDb({ contact: groupContact, session: session({ status: 'disconnected' }) });
    const err = await sendMessageToConversation(w.db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
    }).catch((e) => e);
    expect(err.code).toBe('unofficial_not_connected');
    expect(evo.sendText).not.toHaveBeenCalled();
  });

  it('is not held back by the per-lead and daily limits of reopening a 1:1 chat', async () => {
    const w = fakeDb({ contact: groupContact, session: session({ max_per_lead: 1, daily_limit: 1 }) });
    for (let i = 0; i < 3; i++) {
      await sendMessageToConversation(w.db, 'acct-1', { conversationId: 'cv-1', messageType: 'text', contentText: `msg ${i}` });
    }
    expect(evo.sendText).toHaveBeenCalledTimes(3);
  });

  it('refuses a group contact that has no group id', async () => {
    const w = fakeDb({ contact: { ...groupContact, group_jid: null }, session: session() });
    const err = await sendMessageToConversation(w.db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
    }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(evo.sendText).not.toHaveBeenCalled();
  });

  it('turns an Evolution failure into a clear 502 and saves nothing', async () => {
    evo.sendText.mockRejectedValueOnce(new Error('Evolution API error 400: not-authorized'));
    const w = fakeDb({ contact: groupContact, session: session() });
    const err = await sendMessageToConversation(w.db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
    }).catch((e) => e);
    expect(err.code).toBe('unofficial_error');
    expect(err.status).toBe(502);
    expect(w.inserted).toEqual([]);
  });
});
