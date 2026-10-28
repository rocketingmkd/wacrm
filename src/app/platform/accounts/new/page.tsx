'use client';

// /platform/accounts/new — "Nova conta": creates a customer account for
// an owner who has not signed up. The owner's login is created, and we
// hand back a one-off link so the OWNER sets their own password (no
// password is generated or shown). See lib/platform/create-account.ts.

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Loader2, ShieldAlert, UserPlus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Created {
  account_id: string;
  owner_email: string;
  setup_link: string | null;
}

export default function PlatformNewAccountPage() {
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/platform/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          ownerName,
          ownerEmail,
          trialDays: trialDays.trim() === '' ? undefined : Number(trialDays),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Falha ao criar a conta (${res.status})`);
        return;
      }
      setCreated(body as Created);
      toast.success('Conta criada.');
    } catch {
      setError('Falha ao criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  function reset() {
    setCreated(null);
    setCompanyName('');
    setOwnerName('');
    setOwnerEmail('');
    setTrialDays('');
  }

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Nova conta</h1>
        <p className="text-xs text-muted-foreground">
          Cria o acesso do dono e libera o período de teste. O dono define a própria senha.
        </p>
      </header>

      {created ? (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-2 text-emerald-600 dm:text-emerald-400">
            <CheckCircle2 className="size-5" />
            <h2 className="font-display text-base font-semibold">Conta criada</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            O acesso de <span className="font-medium text-foreground">{created.owner_email}</span> está
            pronto, com o teste grátis liberado.
          </p>

          {created.setup_link ? (
            <div className="space-y-2">
              <Label htmlFor="setup-link">Link para o dono definir a senha</Label>
              <div className="flex gap-2">
                <Input id="setup-link" readOnly value={created.setup_link} onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" onClick={() => copyLink(created.setup_link!)}>
                  <Copy /> Copiar
                </Button>
              </div>
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dm:text-amber-300">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  Este link dá acesso à conta, então trate-o como uma senha: envie só ao dono (por
                  exemplo, no WhatsApp) e não o guarde. Ele é de uso único e tem validade limitada. Se
                  expirar, o dono pode usar &quot;Esqueci minha senha&quot; na tela de login.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dm:text-amber-300">
              Não foi possível gerar o link agora. A conta existe: peça ao dono para usar &quot;Esqueci
              minha senha&quot; na tela de login com este e-mail.
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={`/platform/accounts/${created.account_id}`} className={buttonVariants({ variant: 'outline' })}>
              Abrir a conta
            </Link>
            <Button type="button" variant="ghost" onClick={reset}>
              Criar outra
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="company">Nome da empresa</Label>
            <Input
              id="company"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Ex.: Padaria do Bairro"
              maxLength={80}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="owner-name">Nome do dono (opcional)</Label>
              <Input
                id="owner-name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Ex.: Maria Souza"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-email">E-mail do dono</Label>
              <Input
                id="owner-email"
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="dono@empresa.com"
              />
            </div>
          </div>

          <div className="space-y-1.5 sm:max-w-[220px]">
            <Label htmlFor="trial">Dias de teste (opcional)</Label>
            <Input
              id="trial"
              type="number"
              min={1}
              max={365}
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              placeholder="Padrão da plataforma"
            />
          </div>

          <div className="pt-1">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
              {busy ? 'Criando...' : 'Criar conta'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
