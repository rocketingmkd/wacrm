"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Loader2, Plus, Search, Trash2, Tag, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Source = "meta_ctwa" | "meta_site" | "google" | "other";

interface Rule {
  id: string;
  phrase: string;
  source: Source;
  label: string;
  active: boolean;
}

interface Preview {
  count: number;
  truncated: boolean;
  sample: { name: string | null; phone: string | null; excerpt: string; matchedAt: string }[];
}

const SOURCE_LABEL: Record<Source, string> = {
  meta_ctwa: "Meta (clique no anúncio)",
  meta_site: "Meta (site)",
  google: "Google",
  other: "Outra origem",
};

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function PhraseRulesCard() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [source, setSource] = useState<Source>("meta_site");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/phrase-rules");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Não foi possível carregar as regras.");
        return;
      }
      setError(null);
      setRules(body.rules as Rule[]);
    } catch {
      setError("Não foi possível carregar as regras.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/ai/phrase-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase, source, label }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível criar a regra.");
        return;
      }
      toast.success("Regra criada.");
      setPhrase("");
      setLabel("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rule: Rule) => {
    setRules((rs) => rs?.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)) ?? rs);
    const res = await fetch(`/api/ai/phrase-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !rule.active }),
    });
    if (!res.ok) {
      toast.error("Não foi possível alterar a regra.");
      void load();
    }
  };

  const remove = async (rule: Rule) => {
    if (!window.confirm(`Apagar a regra "${rule.phrase}"? Os contatos já marcados continuam com a origem.`)) return;
    const res = await fetch(`/api/ai/phrase-rules/${rule.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Não foi possível apagar a regra.");
      return;
    }
    setPreviews((p) => {
      const next = { ...p };
      delete next[rule.id];
      return next;
    });
    await load();
  };

  const search = async (rule: Rule) => {
    setBusy(`s:${rule.id}`);
    try {
      const res = await fetch("/api/ai/phrase-rules/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível buscar os contatos.");
        return;
      }
      setPreviews((p) => ({ ...p, [rule.id]: body as Preview }));
    } finally {
      setBusy(null);
    }
  };

  const apply = async (rule: Rule, count: number) => {
    const ok = window.confirm(
      `Marcar ${count} ${plural(count, "contato", "contatos")} como "${SOURCE_LABEL[rule.source]}", campanha "${rule.label}"?\n\nSó entram contatos que ainda não têm origem. Quem já tem origem não muda.`,
    );
    if (!ok) return;
    setBusy(`a:${rule.id}`);
    try {
      const res = await fetch("/api/ai/phrase-rules/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível aplicar a regra.");
        return;
      }
      toast.success(`${body.written} ${plural(body.written, "contato marcado", "contatos marcados")}.`);
      setPreviews((p) => {
        const next = { ...p };
        delete next[rule.id];
        return next;
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Tag className="h-4 w-4 text-primary" />
          Origem por frase
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Quando a primeira mensagem do cliente traz uma frase (por exemplo a que o seu site já deixa escrita), o
          contato recebe a origem e a campanha da regra. Não diferencia maiúsculas nem acentos. Quem já tem origem não
          muda.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {rules === null && !error ? (
        <p className="text-xs text-muted-foreground">Carregando regras...</p>
      ) : rules && rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma regra ainda. Crie a primeira abaixo.</p>
      ) : (
        <ul className="space-y-3">
          {rules?.map((rule) => {
            const preview = previews[rule.id];
            return (
              <li key={rule.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", rule.active ? "text-foreground" : "text-muted-foreground")}>
                      &ldquo;{rule.phrase}&rdquo;
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[rule.source]} · campanha {rule.label}
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={rule.active} onChange={() => void toggle(rule)} />
                    {rule.active ? "Ligada" : "Desligada"}
                  </label>
                  <Button variant="outline" size="sm" onClick={() => void search(rule)} disabled={busy !== null}>
                    {busy === `s:${rule.id}` ? <Loader2 className="animate-spin" /> : <Search />}
                    Buscar contatos
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(rule)} title="Apagar regra">
                    <Trash2 />
                  </Button>
                </div>

                {preview && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {preview.count === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum contato sem origem tem essa frase.</p>
                    ) : (
                      <>
                        <p className="text-sm text-foreground">
                          {preview.count} {plural(preview.count, "contato sem origem tem", "contatos sem origem têm")}{" "}
                          essa frase.
                          {preview.truncated && (
                            <span className="text-xs text-amber-300"> A busca atingiu o limite de mensagens, pode haver mais.</span>
                          )}
                        </p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {preview.sample.map((s, i) => (
                            <li key={i} className="rounded-md bg-muted/50 px-2 py-1.5">
                              <span className="font-medium text-foreground">{s.name || s.phone || "Contato"}</span>
                              {s.name && s.phone ? ` · ${s.phone}` : ""}
                              {" · "}
                              {format(new Date(s.matchedAt), "dd/MM/yyyy HH:mm")}
                              <br />
                              {s.excerpt}
                            </li>
                          ))}
                        </ul>
                        {preview.count > preview.sample.length && (
                          <p className="text-[11px] text-muted-foreground">
                            Mostrando {preview.sample.length} de {preview.count}.
                          </p>
                        )}
                        <Button size="sm" onClick={() => void apply(rule, preview.count)} disabled={busy !== null}>
                          {busy === `a:${rule.id}` ? <Loader2 className="animate-spin" /> : <Check />}
                          Aplicar a {preview.count} {plural(preview.count, "contato", "contatos")}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={create} className="grid gap-2 border-t border-border pt-4 sm:grid-cols-[2fr_1.2fr_1.2fr_auto]">
        <input
          className={INPUT_CLASS}
          placeholder="Frase (ex: vim pelo site)"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          maxLength={200}
          required
          aria-label="Frase"
        />
        <select
          className={INPUT_CLASS}
          value={source}
          onChange={(e) => setSource(e.target.value as Source)}
          aria-label="Origem"
        >
          {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          className={INPUT_CLASS}
          placeholder="Nome da campanha"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={255}
          required
          aria-label="Nome da campanha"
        />
        <Button type="submit" disabled={saving || phrase.trim().length < 3 || !label.trim()}>
          {saving ? <Loader2 className="animate-spin" /> : <Plus />}
          Criar regra
        </Button>
      </form>
    </section>
  );
}
