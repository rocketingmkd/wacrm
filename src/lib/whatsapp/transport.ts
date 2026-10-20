// ============================================================
// Outbound transport abstraction.
//
// `send-message.ts` used to call the Meta Cloud API helpers
// directly. It now goes through a `WhatsAppTransport`, so a second
// provider (the unofficial Evolution session, see the CRM plan of
// 2026-10-15) can be plugged in without touching the send core.
//
// Credentials are bound when the transport is created, so callers
// only pass the message itself. Today there is a single
// implementation, `createOfficialTransport`, a thin wrapper over
// `meta-api.ts` with no behaviour change.
// ============================================================

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MetaSendResult,
  type SendTextMessageArgs,
  type SendTemplateMessageArgs,
  type SendMediaMessageArgs,
  type SendInteractiveButtonsArgs,
  type SendInteractiveListArgs,
} from '@/lib/whatsapp/meta-api';
import {
  sendText as evolutionSendText,
  sendMedia as evolutionSendMedia,
} from '@/lib/whatsapp/evolution-api';

export type TransportProvider = 'official' | 'evolution';

type WithoutCredentials<T> = Omit<T, 'phoneNumberId' | 'accessToken'>;

export interface WhatsAppTransport {
  readonly provider: TransportProvider;
  sendText(args: WithoutCredentials<SendTextMessageArgs>): Promise<MetaSendResult>;
  sendTemplate(
    args: WithoutCredentials<SendTemplateMessageArgs>
  ): Promise<MetaSendResult>;
  sendMedia(args: WithoutCredentials<SendMediaMessageArgs>): Promise<MetaSendResult>;
  sendInteractiveButtons(
    args: WithoutCredentials<SendInteractiveButtonsArgs>
  ): Promise<MetaSendResult>;
  sendInteractiveList(
    args: WithoutCredentials<SendInteractiveListArgs>
  ): Promise<MetaSendResult>;
}

/** Meta Cloud API transport: the only one in use until the Evolution phase lands. */
export function createOfficialTransport(creds: {
  phoneNumberId: string;
  accessToken: string;
}): WhatsAppTransport {
  return {
    provider: 'official',
    sendText: (args) => sendTextMessage({ ...creds, ...args }),
    sendTemplate: (args) => sendTemplateMessage({ ...creds, ...args }),
    sendMedia: (args) => sendMediaMessage({ ...creds, ...args }),
    sendInteractiveButtons: (args) => sendInteractiveButtons({ ...creds, ...args }),
    sendInteractiveList: (args) => sendInteractiveList({ ...creds, ...args }),
  };
}

/**
 * Evolution (unofficial) transport. Only free-form text and media:
 * templates and interactive messages are Cloud-API-only concepts, so
 * they throw. Contacts known only by BSUID (no phone) can't be reached
 * either. Not wired into the send core yet (Phase 3).
 */
export function createEvolutionTransport(creds: { instanceName: string }): WhatsAppTransport {
  const unsupported = (what: string) => async (): Promise<MetaSendResult> => {
    throw new Error(`${what} is not supported over the unofficial transport`);
  };
  const requirePhone = (to: string, recipientUserId?: string): string => {
    if (recipientUserId && !to) {
      throw new Error('Unofficial transport needs a phone number (BSUID-only contact)');
    }
    return to;
  };
  return {
    provider: 'evolution',
    sendText: (args) =>
      evolutionSendText({
        instanceName: creds.instanceName,
        to: requirePhone(args.to, args.recipientUserId),
        text: args.text,
      }),
    sendMedia: (args) =>
      evolutionSendMedia({
        instanceName: creds.instanceName,
        to: requirePhone(args.to, args.recipientUserId),
        kind: args.kind,
        link: args.link,
        caption: args.caption,
        filename: args.filename,
      }),
    sendTemplate: unsupported('Template messages'),
    sendInteractiveButtons: unsupported('Interactive messages'),
    sendInteractiveList: unsupported('Interactive messages'),
  };
}
