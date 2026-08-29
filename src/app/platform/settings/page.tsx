'use client';

// /platform/settings — the one global knob: default_trial_days,
// applied to every new signup by handle_new_user (migration 041).

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PlatformSettingsPage() {
  const [days, setDays] = useState('7');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/settings');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Falha ao carregar configurações (${res.status})`);
      }
      const body = await res.json();
      setDays(String(body.settings?.default_trial_days ?? 7));
      setUpdatedAt(body.settings?.updated_at ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar configurações');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/platform/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_trial_days: Number(days) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Falha ao salvar');
      setUpdatedAt(body.settings?.updated_at ?? null);
      toast.success('Configuração salva.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações da plataforma</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vale só para cadastros novos — contas já existentes não mudam.
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Trial gratuito padrão</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex h-16 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-sm text-red-500">{error}</p>
              <Button variant="outline" size="sm" onClick={load}>Tentar de novo</Button>
            </div>
          ) : (
            <>
              <Label className="text-xs text-muted-foreground">Dias de trial</Label>
              <Input
                type="number"
                min={0}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="max-w-32"
              />
              <div className="flex items-center gap-3">
                <Button size="sm" disabled={saving} onClick={save}>
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Salvar'}
                </Button>
                {updatedAt && (
                  <span className="text-xs text-muted-foreground">
                    Última atualização: {new Date(updatedAt).toLocaleString('pt-BR')}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
