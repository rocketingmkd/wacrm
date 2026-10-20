"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { Conversation } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (conversation: Conversation) => void;
}

/**
 * "Nova conversa": type a number (like the WhatsApp Business app) and
 * open its thread. Nothing is sent here; the first message goes through
 * the composer (approved template, or free text via the unofficial
 * session when the account enabled opening new numbers).
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  onStarted,
}: NewConversationDialogProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!phone.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Não foi possível abrir a conversa.");
        return;
      }
      setPhone("");
      setName("");
      onOpenChange(false);
      onStarted(data.conversation as Conversation);
    } catch {
      toast.error("Falha de rede ao abrir a conversa.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Nova conversa</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="new-conv-phone">
              Número do WhatsApp
            </label>
            <Input
              id="new-conv-phone"
              autoFocus
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="(43) 99194-3029"
              className="border-border bg-muted text-foreground"
            />
            <p className="text-[11px] text-muted-foreground">
              Com o DDD. Sem o código do país, usamos +55 (Brasil).
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="new-conv-name">
              Nome (opcional)
            </label>
            <Input
              id="new-conv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Só para o contato novo"
              className="border-border bg-muted text-foreground"
            />
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
            Para um número novo, a API oficial só aceita um template aprovado como primeira
            mensagem. Se a sessão não oficial estiver ativa com a opção de números novos
            ligada, você também poderá enviar texto livre.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={!phone.trim() || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Abrir conversa
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
