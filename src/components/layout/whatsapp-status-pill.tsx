"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Status = "connected" | "disconnected" | null;

/**
 * Small header pill with the official WhatsApp connection state. Reads
 * the saved `whatsapp_config.status` (RLS-scoped, no call to Meta), so it
 * is cheap enough to live on every page. Links to the connection
 * settings. Renders nothing until the first read settles, to avoid a
 * flash of the wrong state.
 */
export function WhatsappStatusPill({ className }: { className?: string }) {
  const t = useTranslations("Header");
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("whatsapp_config")
      .select("status")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setStatus(data?.status === "connected" ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  const connected = status === "connected";

  return (
    <Link
      href="/settings?tab=whatsapp"
      className={cn(
        "hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-card-2 sm:inline-flex",
        connected ? "text-primary" : "text-destructive",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          connected
            ? "bg-primary shadow-[0_0_10px_var(--primary)]"
            : "bg-destructive shadow-[0_0_10px_var(--destructive)]",
        )}
      />
      {connected ? t("whatsappConnected") : t("whatsappDisconnected")}
    </Link>
  );
}
