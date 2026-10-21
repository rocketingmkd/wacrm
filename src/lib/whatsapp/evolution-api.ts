/**
 * Evolution API (unofficial WhatsApp) client, v2.
 *
 * Server URL and global key come from the app env, never from the
 * tenant: EVOLUTION_API_URL / EVOLUTION_API_KEY. Every call is scoped
 * to one per-account instance name.
 *
 * Same convention as meta-api.ts: one options object per function.
 */

export type EvolutionState = 'open' | 'connecting' | 'close';

export interface EvolutionEnv {
  baseUrl: string;
  apiKey: string;
}

export class EvolutionNotConfiguredError extends Error {
  constructor() {
    super('Evolution API is not configured on this server (EVOLUTION_API_URL / EVOLUTION_API_KEY).');
    this.name = 'EvolutionNotConfiguredError';
  }
}

export function getEvolutionEnv(): EvolutionEnv {
  const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) throw new EvolutionNotConfiguredError();
  return { baseUrl, apiKey };
}

export function isEvolutionConfigured(): boolean {
  return Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);
}

/** Deterministic, URL-safe instance name for an account. */
export function instanceNameForAccount(accountId: string): string {
  return `crm-${accountId.replace(/-/g, '').slice(0, 16)}`;
}

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const { baseUrl, apiKey } = getEvolutionEnv();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Evolution API error ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await response.json()) as T;
}

export interface EvolutionQr {
  /** data:image/png;base64,... ready for an <img>. */
  base64: string | null;
  pairingCode: string | null;
}

function normalizeQr(raw: {
  base64?: string;
  pairingCode?: string | null;
  qrcode?: { base64?: string; pairingCode?: string | null };
}): EvolutionQr {
  const src = raw.qrcode ?? raw;
  return {
    base64: src.base64 ?? null,
    pairingCode: src.pairingCode ?? null,
  };
}

/** Create the instance (Baileys) and return its first QR code. */
export async function createInstance(args: { instanceName: string }): Promise<EvolutionQr> {
  const raw = await call<Parameters<typeof normalizeQr>[0]>('POST', '/instance/create', {
    instanceName: args.instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
  });
  return normalizeQr(raw);
}

/** Fetch a fresh QR code for an existing, not-yet-connected instance. */
export async function getQrCode(args: { instanceName: string }): Promise<EvolutionQr> {
  const raw = await call<Parameters<typeof normalizeQr>[0]>(
    'GET',
    `/instance/connect/${encodeURIComponent(args.instanceName)}`,
  );
  return normalizeQr(raw);
}

export async function getConnectionState(args: {
  instanceName: string;
}): Promise<EvolutionState> {
  const raw = await call<{ instance?: { state?: string } }>(
    'GET',
    `/instance/connectionState/${encodeURIComponent(args.instanceName)}`,
  );
  const state = raw.instance?.state;
  return state === 'open' || state === 'connecting' ? state : 'close';
}

/** Phone (digits only) the instance is paired with, if connected. */
export async function getInstancePhone(args: { instanceName: string }): Promise<string | null> {
  const raw = await call<Array<{ ownerJid?: string; number?: string }> | { ownerJid?: string; number?: string }>(
    'GET',
    `/instance/fetchInstances?instanceName=${encodeURIComponent(args.instanceName)}`,
  );
  const item = Array.isArray(raw) ? raw[0] : raw;
  const jid = item?.ownerJid ?? item?.number ?? '';
  const digits = jid.split('@')[0].replace(/\D/g, '');
  return digits || null;
}

/** Subject (name) of one group, or null when Evolution can't tell. */
export async function fetchGroupSubject(args: {
  instanceName: string;
  groupJid: string;
}): Promise<string | null> {
  const raw = await call<{ subject?: string }>(
    'GET',
    `/group/findGroupInfos/${encodeURIComponent(args.instanceName)}?groupJid=${encodeURIComponent(args.groupJid)}`,
  );
  return raw.subject?.trim() || null;
}

export interface EvolutionCreatedGroup {
  /** Group JID, e.g. 120363025246125486@g.us */
  id: string;
  subject: string;
  /** Participants WhatsApp reports in the new group (JIDs; may include @lid). */
  participants: string[];
}

/**
 * Create a group with the paired number as owner. `participants` are phone
 * numbers with country code (digits only). WhatsApp adds the ones it can:
 * a person whose privacy settings block being added by strangers is simply
 * missing from the answer, and the group still exists.
 */
export async function createGroup(args: {
  instanceName: string;
  subject: string;
  description?: string;
  participants: string[];
}): Promise<EvolutionCreatedGroup> {
  const raw = await call<{
    id?: string;
    subject?: string;
    participants?: Array<string | { id?: string; phoneNumber?: string }>;
  }>('POST', `/group/create/${encodeURIComponent(args.instanceName)}`, {
    subject: args.subject,
    ...(args.description ? { description: args.description } : {}),
    participants: args.participants,
  });
  if (!raw.id || !raw.id.endsWith('@g.us')) {
    throw new Error('Evolution API did not return the new group id');
  }
  const participants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((p) => (typeof p === 'string' ? p : p?.phoneNumber ?? p?.id ?? ''))
    .filter(Boolean);
  return { id: raw.id, subject: raw.subject?.trim() || args.subject, participants };
}

/** Invite link of a group the paired number administers, or null. */
export async function fetchInviteLink(args: {
  instanceName: string;
  groupJid: string;
}): Promise<string | null> {
  const raw = await call<{ inviteUrl?: string; inviteCode?: string; code?: string }>(
    'GET',
    `/group/inviteCode/${encodeURIComponent(args.instanceName)}?groupJid=${encodeURIComponent(args.groupJid)}`,
  );
  if (raw.inviteUrl) return raw.inviteUrl;
  const code = raw.inviteCode ?? raw.code;
  return code ? `https://chat.whatsapp.com/${code}` : null;
}

/** The paired number leaves the group on WhatsApp. */
export async function leaveGroup(args: { instanceName: string; groupJid: string }): Promise<void> {
  await call(
    'DELETE',
    `/group/leaveGroup/${encodeURIComponent(args.instanceName)}?groupJid=${encodeURIComponent(args.groupJid)}`,
  );
}

/**
 * Point the instance's inbound events at the CRM. Idempotent: Evolution
 * replaces the instance's webhook config on every call.
 */
export async function setWebhook(args: {
  instanceName: string;
  url: string;
  headers: Record<string, string>;
}): Promise<void> {
  await call('POST', `/webhook/set/${encodeURIComponent(args.instanceName)}`, {
    webhook: {
      enabled: true,
      url: args.url,
      headers: args.headers,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT', 'GROUPS_UPSERT', 'GROUP_PARTICIPANTS_UPDATE'],
    },
  });
}

export async function logoutInstance(args: { instanceName: string }): Promise<void> {
  await call('DELETE', `/instance/logout/${encodeURIComponent(args.instanceName)}`);
}

export async function deleteInstance(args: { instanceName: string }): Promise<void> {
  await call('DELETE', `/instance/delete/${encodeURIComponent(args.instanceName)}`);
}

export interface EvolutionSendResult {
  messageId: string;
}

function extractMessageId(raw: { key?: { id?: string } }): string {
  const id = raw.key?.id;
  if (!id) throw new Error('Evolution API did not return a message id');
  return id;
}

export async function sendText(args: {
  instanceName: string;
  to: string;
  text: string;
}): Promise<EvolutionSendResult> {
  const raw = await call<{ key?: { id?: string } }>(
    'POST',
    `/message/sendText/${encodeURIComponent(args.instanceName)}`,
    { number: args.to, text: args.text },
  );
  return { messageId: extractMessageId(raw) };
}

export async function sendMedia(args: {
  instanceName: string;
  to: string;
  kind: 'image' | 'video' | 'document' | 'audio';
  link: string;
  caption?: string;
  filename?: string;
}): Promise<EvolutionSendResult> {
  if (args.kind === 'audio') {
    const raw = await call<{ key?: { id?: string } }>(
      'POST',
      `/message/sendWhatsAppAudio/${encodeURIComponent(args.instanceName)}`,
      { number: args.to, audio: args.link },
    );
    return { messageId: extractMessageId(raw) };
  }
  const raw = await call<{ key?: { id?: string } }>(
    'POST',
    `/message/sendMedia/${encodeURIComponent(args.instanceName)}`,
    {
      number: args.to,
      mediatype: args.kind,
      media: args.link,
      caption: args.caption,
      fileName: args.filename,
    },
  );
  return { messageId: extractMessageId(raw) };
}
