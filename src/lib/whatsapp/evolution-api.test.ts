import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInstance,
  fetchGroupSubject,
  getConnectionState,
  getInstancePhone,
  instanceNameForAccount,
  isEvolutionConfigured,
  leaveGroup,
  sendMedia,
  sendText,
  setWebhook,
  EvolutionNotConfiguredError,
} from './evolution-api';
import { createEvolutionTransport } from './transport';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('evolution-api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'https://evo.test/';
    process.env.EVOLUTION_API_KEY = 'global-key';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
  });

  it('derives a stable, URL-safe instance name per account', () => {
    const id = '0b6f1c2e-1111-4222-8333-444455556666';
    expect(instanceNameForAccount(id)).toBe('crm-0b6f1c2e11114222');
    expect(instanceNameForAccount(id)).toBe(instanceNameForAccount(id));
  });

  it('reports not configured and throws when env is missing', async () => {
    delete process.env.EVOLUTION_API_KEY;
    expect(isEvolutionConfigured()).toBe(false);
    await expect(getConnectionState({ instanceName: 'x' })).rejects.toBeInstanceOf(
      EvolutionNotConfiguredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a Baileys instance with the global apikey and trims the base URL', async () => {
    fetchMock.mockReturnValueOnce(json({ qrcode: { base64: 'data:image/png;base64,AAA', pairingCode: 'ABCD' } }));
    const qr = await createInstance({ instanceName: 'crm-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.test/instance/create');
    expect(init.headers.apikey).toBe('global-key');
    expect(JSON.parse(init.body)).toMatchObject({
      instanceName: 'crm-1',
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    });
    expect(qr).toEqual({ base64: 'data:image/png;base64,AAA', pairingCode: 'ABCD' });
  });

  it('maps connection states, defaulting unknown ones to close', async () => {
    fetchMock.mockReturnValueOnce(json({ instance: { state: 'open' } }));
    expect(await getConnectionState({ instanceName: 'a' })).toBe('open');
    fetchMock.mockReturnValueOnce(json({ instance: { state: 'weird' } }));
    expect(await getConnectionState({ instanceName: 'a' })).toBe('close');
  });

  it('extracts the paired phone as digits only', async () => {
    fetchMock.mockReturnValueOnce(json([{ ownerJid: '5543999990000@s.whatsapp.net' }]));
    expect(await getInstancePhone({ instanceName: 'a' })).toBe('5543999990000');
  });

  it('sends text and returns the message id', async () => {
    fetchMock.mockReturnValueOnce(json({ key: { id: 'ABC123' } }));
    const res = await sendText({ instanceName: 'crm-1', to: '5543999990000', text: 'oi' });
    expect(res).toEqual({ messageId: 'ABC123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.test/message/sendText/crm-1');
    expect(JSON.parse(init.body)).toEqual({ number: '5543999990000', text: 'oi' });
  });

  it('routes audio to sendWhatsAppAudio and other media to sendMedia', async () => {
    fetchMock.mockImplementation(() => json({ key: { id: 'M1' } }));
    await sendMedia({ instanceName: 'i', to: '55', kind: 'audio', link: 'https://x/a.ogg' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://evo.test/message/sendWhatsAppAudio/i');
    await sendMedia({ instanceName: 'i', to: '55', kind: 'image', link: 'https://x/a.png', caption: 'c' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://evo.test/message/sendMedia/i');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      mediatype: 'image',
      media: 'https://x/a.png',
      caption: 'c',
    });
  });

  it('throws with status and body on a non-2xx response', async () => {
    fetchMock.mockReturnValueOnce(json({ message: 'nope' }, 401));
    await expect(sendText({ instanceName: 'i', to: '55', text: 'x' })).rejects.toThrow(
      /Evolution API error 401.*nope/,
    );
  });

  it('throws when the send response carries no message id', async () => {
    fetchMock.mockReturnValueOnce(json({}));
    await expect(sendText({ instanceName: 'i', to: '55', text: 'x' })).rejects.toThrow(/message id/);
  });
});

describe('createEvolutionTransport', () => {
  it('rejects templates and interactive messages, which are Cloud-API-only', async () => {
    const t = createEvolutionTransport({ instanceName: 'i' });
    expect(t.provider).toBe('evolution');
    await expect(t.sendTemplate({} as never)).rejects.toThrow(/not supported/);
    await expect(t.sendInteractiveButtons({} as never)).rejects.toThrow(/not supported/);
    await expect(t.sendInteractiveList({} as never)).rejects.toThrow(/not supported/);
  });

  it('refuses BSUID-only recipients (no phone)', () => {
    const t = createEvolutionTransport({ instanceName: 'i' });
    expect(() => t.sendText({ to: '', recipientUserId: 'bsuid', text: 'x' })).toThrow(/phone number/);
  });
});

describe('evolution-api groups', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'https://evo.test';
    process.env.EVOLUTION_API_KEY = 'global-key';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
  });

  it('makes the number leave a group with DELETE and the group jid in the query', async () => {
    fetchMock.mockReturnValueOnce(json({ status: 'SUCCESS' }));
    await leaveGroup({ instanceName: 'crm-1', groupJid: '120363025246125486@g.us' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(url).toBe('https://evo.test/group/leaveGroup/crm-1?groupJid=120363025246125486%40g.us');
  });

  it('surfaces a failed leave as an Evolution API error', async () => {
    fetchMock.mockReturnValueOnce(json({ message: 'not-authorized' }, 400));
    await expect(leaveGroup({ instanceName: 'crm-1', groupJid: 'x@g.us' })).rejects.toThrow(
      /^Evolution API error 400/,
    );
  });

  it('reads a group subject, trimmed, or null when it has none', async () => {
    fetchMock.mockReturnValueOnce(json({ id: 'a@g.us', subject: '  Obra Centro ' }));
    expect(await fetchGroupSubject({ instanceName: 'crm-1', groupJid: 'a@g.us' })).toBe('Obra Centro');
    fetchMock.mockReturnValueOnce(json({ id: 'a@g.us' }));
    expect(await fetchGroupSubject({ instanceName: 'crm-1', groupJid: 'a@g.us' })).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('https://evo.test/group/findGroupInfos/crm-1?groupJid=a%40g.us');
  });

  it('registers the webhook for messages and group events with the secret header', async () => {
    fetchMock.mockReturnValueOnce(json({}));
    await setWebhook({ instanceName: 'crm-1', url: 'https://crm.test/api/whatsapp/evolution/webhook', headers: { 'x-evolution-secret': 's' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.test/webhook/set/crm-1');
    expect(JSON.parse(init.body).webhook).toMatchObject({
      enabled: true,
      url: 'https://crm.test/api/whatsapp/evolution/webhook',
      headers: { 'x-evolution-secret': 's' },
      events: ['MESSAGES_UPSERT', 'GROUPS_UPSERT', 'GROUP_PARTICIPANTS_UPDATE'],
    });
  });
});
