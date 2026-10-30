"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Rule {
  id: string;
  phrase: string;
  label: string;
  active: boolean;
}

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

/**
 * "Como o lead chega": só identifica a ORIGEM do lead. Enviar a conversão
 * para a Meta e o Google é outra etapa (botão "Enviar conversões").
 *
 *  - Meta: pela UTM, com o código no site. O clique direto no anúncio que
 *    abre o WhatsApp a própria Meta informa.
 *  - Google Ads: pela frase. O WhatsApp não repassa a UTM do Google, então
 *    o site deixa uma frase escrita e o CRM reconhece na 1ª mensagem.
 */
export function OriginSetup() {
  return (
    <div className="min-w-0 space-y-8 text-sm break-words">
      <MetaSection />
      <div className="border-t border-border" />
      <GoogleSection />
    </div>
  );
}

function MetaSection() {
  const [data, setData] = useState<{ snippet: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tracking/settings", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body?.error ?? "Não foi possível carregar o código.");
        else setData(body);
      })
      .catch(() => {
        if (!cancelled) setError("Falha de conexão.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code stays selectable on screen */
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h4 className="text-base font-semibold">Meta Ads: pela UTM</h4>
        <p className="mt-1 text-muted-foreground">
          O visitante chega na sua página pelo anúncio com a UTM no link. O código abaixo guarda a UTM e, ao clicar no
          botão do WhatsApp, inclui um código curto no fim da mensagem. O CRM lê esse código e registra a campanha.
        </p>
      </div>

      <div>
        <p className="font-medium">1. Cole este código no &lt;head&gt; da página</p>
        {error ? (
          <p className="mt-2 text-destructive">{error}</p>
        ) : !data ? (
          <div className="mt-2 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Gerando o código...
          </div>
        ) : (
          <div className="mt-2 flex min-w-0 flex-wrap items-start gap-2 sm:flex-nowrap">
            <pre className="min-w-0 flex-1 basis-full whitespace-pre-wrap break-all rounded-xl border border-border bg-muted/50 p-3 text-xs sm:basis-0">
              {data.snippet}
            </pre>
            <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        )}
      </div>

      <div>
        <p className="font-medium">2. No campo Parâmetros de URL do anúncio, use</p>
        <code className="mt-2 block break-all rounded-lg bg-muted px-3 py-2 text-xs">
          {"utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}"}
        </code>
      </div>

      <p className="text-xs text-muted-foreground">
        Anúncio que abre direto o WhatsApp (clique no WhatsApp): não precisa de nada. A Meta informa o anúncio na
        primeira mensagem e o CRM registra sozinho. O script usa o armazenamento do navegador só nos botões de WhatsApp
        e só age em quem chegou por um link com campanha. Se a sua página tem aviso de cookies, inclua o script na
        categoria de marketing.
      </p>
    </section>
  );
}

function GoogleSection() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tracking/phrase-rules", { cache: "no-store" });
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
      const res = await fetch("/api/tracking/phrase-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase, label }),
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
    const res = await fetch(`/api/tracking/phrase-rules/${rule.id}`, {
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
    const res = await fetch(`/api/tracking/phrase-rules/${rule.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Não foi possível apagar a regra.");
      return;
    }
    await load();
  };

  return (
    <section className="space-y-4">
      <div>
        <h4 className="text-base font-semibold">Google Ads: pela frase do site</h4>
        <p className="mt-1 text-muted-foreground">
          O WhatsApp não repassa a UTM do Google. Por isso o botão do seu site deve abrir o WhatsApp com uma frase já
          escrita, diferente para cada campanha (por exemplo, “Olá, vim pelo site, quero saber mais”). Quando o contato
          manda essa frase na primeira mensagem, o CRM registra como Google Ads e usa o nome da campanha que você
          informar aqui. Não diferencia maiúsculas nem acentos.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{error}</div>
      )}

      {rules === null && !error ? (
        <p className="text-xs text-muted-foreground">Carregando regras...</p>
      ) : rules && rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma frase cadastrada ainda.</p>
      ) : (
        <ul className="space-y-2">
          {rules?.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3">
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-medium", rule.active ? "text-foreground" : "text-muted-foreground")}>
                  &ldquo;{rule.phrase}&rdquo;
                </p>
                <p className="text-xs text-muted-foreground">Google Ads · campanha {rule.label}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={rule.active} onChange={() => void toggle(rule)} />
                {rule.active ? "Ligada" : "Desligada"}
              </label>
              <Button variant="ghost" size="sm" onClick={() => void remove(rule)} title="Apagar regra">
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="grid gap-2 sm:grid-cols-[2fr_1.4fr_auto]">
        <input
          className={INPUT_CLASS}
          placeholder="Frase do site (ex: vim pelo site)"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          maxLength={200}
          required
          aria-label="Frase do site"
        />
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
          Adicionar
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        A regra vale para quem inicia uma conversa nova a partir de agora. Quem já conversou antes e ficou sem origem
        você marca pela busca manual, no botão ao lado. A frase só é lida na primeira mensagem do contato, e quem já
        tem origem não muda.
      </p>
    </section>
  );
}
