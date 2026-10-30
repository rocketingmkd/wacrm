"use client";

// TEMPORÁRIO: marcação manual de origem Google por frase, para a conta do
// dono. Remova este arquivo, a rota api/tracking/manual-origin e o botão
// em app/(dashboard)/traffic/page.tsx quando todos os clientes tiverem o CRM.

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, Loader2, MessageSquare, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConversationAnalysis } from "@/components/copilot/conversation-analysis";

interface Found {
  contactId: string;
  conversationId: string;
  name: string | null;
  phone: string | null;
  excerpt: string;
  matchedAt: string;
}

interface SearchResult {
  total: number;
  truncated: boolean;
  contacts: Found[];
}

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function ManualOriginPanel({ onApplied }: { onApplied?: () => void }) {
  const [phrase, setPhrase] = useState("");
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"search" | "apply" | null>(null);

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/tracking/manual-origin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  };

  const search = async () => {
    setBusy("search");
    try {
      const { ok, json } = await call({ action: "search", phrase });
      if (!ok) {
        toast.error(json.error ?? "Não foi possível buscar.");
        return;
      }
      setResult(json as SearchResult);
      setPicked(new Set());
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = !!result && result.contacts.length > 0 && picked.size === result.contacts.length;
  const toggleAll = () =>
    setPicked(allSelected || !result ? new Set() : new Set(result.contacts.map((c) => c.contactId)));

  const apply = async () => {
    const n = picked.size;
    const ok = window.confirm(
      `Marcar ${n} ${plural(n, "contato", "contatos")} como Google Ads, campanha "${label.trim()}"?\n\nSó entram contatos que ainda não têm origem.`,
    );
    if (!ok) return;
    setBusy("apply");
    try {
      const { ok: done, json } = await call({
        action: "apply",
        phrase,
        label,
        contactIds: [...picked],
      });
      if (!done) {
        toast.error(json.error ?? "Não foi possível marcar.");
        return;
      }
      toast.success(`${json.written} ${plural(json.written, "contato marcado", "contatos marcados")}.`);
      onApplied?.();
      // Atualiza a lista: quem acabou de receber origem sai dela.
      const again = await call({ action: "search", phrase });
      if (again.ok) {
        setResult(again.json as SearchResult);
        setPicked(new Set());
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-w-0 space-y-4 text-sm">
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        Ferramenta temporária. Busca quem escreveu a frase e ainda não tem origem; você escolhe quem marcar como
        Google Ads. Será removida quando todos os clientes tiverem acesso ao CRM.
      </p>

      <div className="flex gap-2">
        <input
          className={INPUT_CLASS}
          placeholder="Frase que o site deixa escrita (ex: vim pelo site)"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && phrase.trim().length >= 3 && busy === null) void search();
          }}
          maxLength={200}
          aria-label="Frase"
        />
        <Button onClick={() => void search()} disabled={phrase.trim().length < 3 || busy !== null} className="shrink-0">
          {busy === "search" ? <Loader2 className="animate-spin" /> : <Search />}
          Buscar
        </Button>
      </div>

      {result &&
        (result.total === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum contato sem origem escreveu essa frase.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-foreground">
                {result.total} {plural(result.total, "contato sem origem escreveu", "contatos sem origem escreveram")}{" "}
                essa frase.
                {result.total > result.contacts.length && (
                  <span className="text-xs text-amber-300"> Mostrando os {result.contacts.length} primeiros.</span>
                )}
                {result.truncated && (
                  <span className="text-xs text-amber-300"> A busca atingiu o limite de mensagens, pode haver mais.</span>
                )}
              </p>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                Marcar todos
              </label>
            </div>

            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {result.contacts.map((c) => (
                <li key={c.contactId} className="space-y-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={picked.has(c.contactId)}
                      onChange={() => toggle(c.contactId)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{c.name || c.phone || "Contato"}</span>
                      {c.name && c.phone ? ` · ${c.phone}` : ""}
                      {" · "}
                      {format(new Date(c.matchedAt), "dd/MM/yyyy HH:mm")}
                      <br />
                      <span className="break-words">{c.excerpt}</span>
                    </span>
                  </label>
                  <div className="flex flex-wrap items-start gap-2 pl-6">
                    <a
                      href={`/inbox?c=${c.conversationId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      <MessageSquare />
                      Abrir conversa
                    </a>
                    <ConversationAnalysis conversationId={c.conversationId} />
                  </div>
                </li>
              ))}
            </ul>

            <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_auto]">
              <input
                className={INPUT_CLASS}
                placeholder="Nome da campanha do Google Ads"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={255}
                aria-label="Nome da campanha"
              />
              <Button onClick={() => void apply()} disabled={picked.size === 0 || !label.trim() || busy !== null}>
                {busy === "apply" ? <Loader2 className="animate-spin" /> : <Check />}
                Marcar {picked.size} como Google
              </Button>
            </div>
          </div>
        ))}
    </div>
  );
}
