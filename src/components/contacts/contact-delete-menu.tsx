"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** What the right-click landed on, plus where to draw the menu. */
export interface ContactDeleteTarget {
  x: number;
  y: number;
  contactId: string;
  name: string;
  isGroup: boolean;
}

interface ContactDeleteMenuProps {
  target: ContactDeleteTarget | null;
  onClose: () => void;
  /** Called after the contact (and its conversations) are gone. */
  onDeleted: (contactId: string) => void;
}

const MENU_WIDTH = 190;
const MENU_HEIGHT = 44;

/**
 * Right-click "Excluir contato" menu with a confirmation step. Deleting a
 * contact removes its conversations and messages (FK cascade). Deleting a
 * WhatsApp group makes the number LEAVE the group first (server route),
 * like deleting a group in WhatsApp itself.
 *
 * The caller opens it from an `onContextMenu` handler and passes the
 * cursor position; give it a `key` tied to the target so each right-click
 * starts fresh.
 */
export function ContactDeleteMenu({ target, onClose, onDeleted }: ContactDeleteMenuProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!target || confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, confirming, onClose]);

  if (!target) return null;

  const noun = target.isGroup ? "grupo" : "contato";

  async function confirmDelete() {
    if (!target) return;
    setDeleting(true);
    try {
      if (target.isGroup) {
        const res = await fetch("/api/whatsapp/groups/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_id: target.contactId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || "Não foi possível sair do grupo.");
          return;
        }
        toast.success("O número saiu do grupo e ele foi excluído.");
      } else {
        // `.select('id')` so a delete the policy silently refuses (viewer
        // role) shows up as zero rows instead of looking like a success.
        const { data, error } = await createClient()
          .from("contacts")
          .delete()
          .eq("id", target.contactId)
          .select("id");
        if (error) {
          toast.error("Não foi possível excluir o contato.");
          return;
        }
        if (!data || data.length === 0) {
          toast.error("Você não tem permissão para excluir este contato.");
          return;
        }
        toast.success("Contato excluído.");
      }
      onDeleted(target.contactId);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {!confirming && (
        <>
          {/* Click or right-click anywhere else dismisses the menu. */}
          <div
            className="fixed inset-0 z-50"
            onClick={onClose}
            onContextMenu={(e) => {
              e.preventDefault();
              onClose();
            }}
          />
          <div
            role="menu"
            className="fixed z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{
              left: Math.max(8, Math.min(target.x, window.innerWidth - MENU_WIDTH - 8)),
              top: Math.max(8, Math.min(target.y, window.innerHeight - MENU_HEIGHT - 8)),
              width: MENU_WIDTH,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-500 hover:bg-muted"
            >
              <Trash2 className="size-4" />
              Excluir {noun}
            </button>
          </div>
        </>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !open && !deleting && onClose()}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Excluir {noun}?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {target.isGroup
                ? `O número vai sair do grupo "${target.name}" no WhatsApp e o histórico dele será apagado do CRM. Você não receberá mais mensagens dele. Para voltar, alguém precisa adicionar o número ao grupo de novo.`
                : `"${target.name}" será apagado junto com as conversas e o histórico de mensagens. Isso não pode ser desfeito.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-border bg-popover">
            <Button variant="outline" onClick={onClose} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {target.isGroup ? "Sair e excluir" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
