"use client";

import { UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Stable per-name colour so avatars without a photo look like WhatsApp's.
const AVATAR_COLORS = [
  "#00a884", "#5e47de", "#c0392b", "#d68910", "#2874a6",
  "#8e44ad", "#16a085", "#cb4335", "#7d6608", "#2e4053",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface ContactAvatarProps {
  name: string;
  url?: string | null;
  isGroup?: boolean;
  /** Size classes, e.g. "h-10 w-10". */
  className?: string;
}

/**
 * Contact picture used by the conversation list and the thread header:
 * the WhatsApp photo when we have one, a group icon for groups, otherwise
 * the initial on a colour that is stable per name.
 */
export function ContactAvatar({ name, url, isGroup = false, className }: ContactAvatarProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold",
        !url && !isGroup && "text-white",
        className,
      )}
      style={
        url
          ? undefined
          : isGroup
            ? { backgroundColor: "var(--primary-soft)", color: "var(--primary)" }
            : { backgroundColor: avatarColor(name) }
      }
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : isGroup ? (
        <UsersRound className="h-5 w-5" aria-label="Grupo" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );
}
