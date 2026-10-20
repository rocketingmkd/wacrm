"use client";

import { WhatsAppConfig } from "@/components/settings/whatsapp-config";

/**
 * Conexão: the WhatsApp connection in its own page (it used to be a card
 * inside Settings). Official number (Meta Cloud API, Coexistence) plus the
 * optional unofficial session for reopening conversations.
 */
export default function ConnectionPage() {
  return <WhatsAppConfig />;
}
