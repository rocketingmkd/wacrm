"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, Unplug } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface Connection {
  redirect_uri: string;
  configured: boolean;
  connected: boolean;
  client_id: string;
  customer_id: string;
  login_customer_id: string;
  connected_at: string | null;
}

interface Props {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  validateOnly: boolean;
  onValidateOnlyChange: (value: boolean) => void;
}

type Notice = { ok: boolean; text: string } | null;

/**
 * Google Ads block of the conversions panel: the OAuth client saved by the
 * account admin, the Connect button, the account ids and the on/off switches.
 * The secret is write only: it is sent to the server and never comes back.
 * The on/off switches are saved with the rules by the panel's Salvar button.
 */
export function GoogleAdsCard({ enabled, onEnabledChange, validateOnly, onValidateOnlyChange }: Props) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [loginId, setLoginId] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "disconnect" | null>(null);
  // Coming back from Google: /traffic?google=ok or ?google=erro&motivo=...
  // The card only mounts after the panel loaded on the client, never during SSR.
  const [notice, setNotice] = useState<Notice>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (result === "ok") return { ok: true, text: "Google Ads conectado." };
    if (result === "erro") return { ok: false, text: params.get("motivo") || "Não foi possível conectar ao Google." };
    return null;
  });
  const [copied, setCopied] = useState(false);

  function apply(c: Connection) {
    setConn(c);
    setClientId(c.client_id);
    setCustomerId(c.customer_id);
    setLoginId(c.login_customer_id);
    setClientSecret("");
  }

  async function load() {
    try {
      const res = await fetch("/api/google-ads/connection", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setLoadError(body?.error ?? "Não foi possível carregar o Google Ads.");
      else apply(body as Connection);
    } catch {
      setLoadError("Falha de conexão.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/google-ads/connection", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(body?.error ?? "Não foi possível carregar o Google Ads.");
        else apply(body as Connection);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Falha de conexão.");
      });

    const params = new URLSearchParams(window.location.search);
    if (params.has("google")) {
      params.delete("google");
      params.delete("motivo");
      const query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveCredentials() {
    setBusy("save");
    setNotice(null);
    try {
      const res = await fetch("/api/google-ads/connection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          customer_id: customerId,
          login_customer_id: loginId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, text: body?.error ?? "Não foi possível salvar." });
        return;
      }
      await load();
      setNotice({ ok: true, text: "Dados do Google salvos." });
    } catch {
      setNotice({ ok: false, text: "Falha de conexão ao salvar." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setNotice(null);
    try {
      const res = await fetch("/api/google-ads/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setNotice(
        body?.ok
          ? { ok: true, text: body.message }
          : { ok: false, text: body?.error ?? "O teste falhou." },
      );
    } catch {
      setNotice({ ok: false, text: "Falha de conexão no teste." });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setNotice(null);
    try {
      const res = await fetch("/api/google-ads/connection", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice({ ok: false, text: body?.error ?? "Não foi possível desconectar." });
        return;
      }
      onEnabledChange(false);
      await load();
      setNotice({ ok: true, text: "Google Ads desconectado." });
    } catch {
      setNotice({ ok: false, text: "Falha de conexão." });
    } finally {
      setBusy(null);
    }
  }

  async function copyRedirect() {
    if (!conn) return;
    try {
      await navigator.clipboard.writeText(conn.redirect_uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the URL stays selectable on screen */
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>;
  if (!conn) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Enviar conversões para o Google Ads</p>
          <p className="text-xs text-muted-foreground">
            Vale para leads que vieram de anúncios do Google (o CRM guarda o gclid). Desligado, nada é enviado.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={!conn.connected}
          aria-label="Enviar conversões para o Google Ads"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Client ID</span>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456-abc.apps.googleusercontent.com"
            autoComplete="off"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Client Secret</span>
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={conn.configured ? "Guardado. Preencha só para trocar." : "Cole o segredo do Google Cloud"}
            autoComplete="new-password"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">ID da conta do Google Ads</span>
          <Input
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="123-456-7890"
            inputMode="numeric"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">ID da conta gerente, MCC (opcional)</span>
          <Input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="123-456-7890"
            inputMode="numeric"
          />
        </label>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>No Google Cloud, cadastre esta URL como URI de redirecionamento autorizado do cliente OAuth:</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1.5 text-foreground">
            {conn.redirect_uri}
          </code>
          <Button variant="outline" size="sm" onClick={copyRedirect}>
            <Copy className="size-4" />
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={saveCredentials} disabled={busy !== null}>
          {busy === "save" && <Loader2 className="size-4 animate-spin" />}
          Salvar dados do Google
        </Button>
        {conn.configured && (
          <a href="/api/google-ads/connect" className={buttonVariants({ size: "sm" })}>
            {conn.connected ? "Conectar de novo" : "Conectar Google Ads"}
          </a>
        )}
        {conn.connected && (
          <>
            <Button variant="outline" size="sm" onClick={test} disabled={busy !== null}>
              {busy === "test" && <Loader2 className="size-4 animate-spin" />}
              Testar conexão
            </Button>
            <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null}>
              {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
              Desconectar
            </Button>
          </>
        )}
        {conn.connected && (
          <span className="flex items-center gap-1 text-xs text-primary">
            <CheckCircle2 className="size-4" /> Conectado
            {conn.connected_at && ` em ${new Date(conn.connected_at).toLocaleDateString("pt-BR")}`}
          </span>
        )}
      </div>

      {notice && <p className={notice.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{notice.text}</p>}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-sm font-medium">Modo teste</p>
          <p className="text-xs text-muted-foreground">
            Ligado, o Google só valida cada envio e não importa nada. Desligue quando os testes estiverem certos.
          </p>
        </div>
        <Switch checked={validateOnly} onCheckedChange={onValidateOnlyChange} aria-label="Modo teste do Google Ads" />
      </div>
      <p className="text-xs text-muted-foreground">
        Os botões Ligar e Modo teste valem depois de clicar em Salvar, mais abaixo. Em cada regra, informe o ID da ação
        de conversão do Google (Metas, Conversões, Resumo, abra a ação e veja o número na barra de endereço).
      </p>
    </div>
  );
}
