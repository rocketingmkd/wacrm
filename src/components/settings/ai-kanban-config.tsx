'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, GitBranch, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Binds AI attendance to a pipeline: while an AI agent is answering a
 * conversation the contact's card sits in one stage; when the thread
 * goes to a human it moves to another. Optionally a third stage for
 * closed conversations. A no-op for the whole account until it's set.
 */

interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
}
interface PipelineRow {
  id: string;
  name: string;
}

const NONE = '__none__';

export function AiKanbanConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [configured, setConfigured] = useState(false);

  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);

  const [pipelineId, setPipelineId] = useState('');
  const [stageIaId, setStageIaId] = useState('');
  const [stageHumanId, setStageHumanId] = useState('');
  const [stageDoneId, setStageDoneId] = useState('');
  const [enabled, setEnabled] = useState(true);

  const loadedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: pl }, { data: st }, cfgRes] = await Promise.all([
        supabase.from('pipelines').select('id, name').order('created_at', { ascending: true }),
        supabase
          .from('pipeline_stages')
          .select('id, pipeline_id, name, position')
          .order('position', { ascending: true }),
        fetch('/api/ai/kanban'),
      ]);
      setPipelines((pl as PipelineRow[]) ?? []);
      setStages((st as StageRow[]) ?? []);

      const cfg = await cfgRes.json().catch(() => ({}));
      if (cfgRes.ok && cfg.configured) {
        setConfigured(true);
        setPipelineId(cfg.pipeline_id ?? '');
        setStageIaId(cfg.stage_ia_id ?? '');
        setStageHumanId(cfg.stage_human_id ?? '');
        setStageDoneId(cfg.stage_done_id ?? '');
        setEnabled(cfg.enabled ?? true);
      }
    } catch {
      toast.error('Não foi possível carregar a configuração.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedRef.current === accountId) return;
    loadedRef.current = accountId;
    void load();
  }, [accountId, load]);

  const pipelineStages = stages
    .filter((s) => s.pipeline_id === pipelineId)
    .sort((a, b) => a.position - b.position);

  // Drop stage picks that don't belong to the newly chosen pipeline.
  const onPipelineChange = (value: string) => {
    setPipelineId(value);
    const valid = new Set(
      stages.filter((s) => s.pipeline_id === value).map((s) => s.id),
    );
    if (!valid.has(stageIaId)) setStageIaId('');
    if (!valid.has(stageHumanId)) setStageHumanId('');
    if (!valid.has(stageDoneId)) setStageDoneId('');
  };

  const handleSave = async () => {
    if (!pipelineId) {
      toast.error('Escolha um funil.');
      return;
    }
    if (!stageIaId || !stageHumanId) {
      toast.error('Escolha as etapas de IA e de atendimento humano.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipeline_id: pipelineId,
          stage_ia_id: stageIaId,
          stage_human_id: stageHumanId,
          stage_done_id: stageDoneId || null,
          enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('Configuração salva.');
        setConfigured(true);
      } else {
        toast.error(data.error ?? 'Não foi possível salvar.');
      }
    } catch {
      toast.error('Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (
      !window.confirm(
        'Remover a ligação com o funil? A IA para de mover cards, mas os negócios existentes ficam onde estão.',
      )
    )
      return;
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/kanban', { method: 'DELETE' });
      if (res.ok) {
        toast.success('Ligação removida.');
        setConfigured(false);
        setPipelineId('');
        setStageIaId('');
        setStageHumanId('');
        setStageDoneId('');
        setEnabled(true);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Não foi possível remover.');
      }
    } catch {
      toast.error('Não foi possível remover.');
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title="Kanban do atendimento"
        description="Quando um agente de IA assume a conversa, o card do contato vai para uma etapa. Quando a conversa passa para uma pessoa, o card vai para outra."
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Apenas administradores podem configurar isto.
        </p>
      )}

      {pipelines.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Crie um funil primeiro, em Funis, e volte aqui para ligar o
            atendimento de IA a ele.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitBranch className="h-4 w-4 text-primary" /> Funil e etapas
              </CardTitle>
              <CardDescription>
                A IA cria um negócio nesse funil se o contato ainda não tiver um,
                e move o card conforme quem está atendendo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Funil</Label>
                <Select
                  value={pipelineId}
                  onValueChange={(v) => onPipelineChange(v ?? '')}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha um funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Etapa enquanto a IA atende</Label>
                <Select
                  value={stageIaId}
                  onValueChange={(v) => setStageIaId(v ?? '')}
                  disabled={disabled || !pipelineId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha uma etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelineStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Etapa quando passa para atendimento humano</Label>
                <Select
                  value={stageHumanId}
                  onValueChange={(v) => setStageHumanId(v ?? '')}
                  disabled={disabled || !pipelineId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha uma etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelineStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>
                  Etapa quando a conversa é encerrada{' '}
                  <span className="font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Select
                  value={stageDoneId || NONE}
                  onValueChange={(v) => setStageDoneId(v && v !== NONE ? v : '')}
                  disabled={disabled || !pipelineId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nenhuma" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhuma</SelectItem>
                    {pipelineStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Ligação ativa</p>
                  <p className="text-xs text-muted-foreground">
                    Enquanto desativada, a configuração fica salva mas a IA não
                    mexe no funil.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} disabled={disabled} />
              </div>
            </CardContent>
          </Card>

          <div className="mt-4 flex items-center justify-between">
            {configured ? (
              <Button
                variant="ghost"
                onClick={handleRemove}
                disabled={!canEdit || removing}
                className="text-destructive hover:text-destructive"
              >
                {removing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Remover
              </Button>
            ) : (
              <span />
            )}

            <Button onClick={handleSave} disabled={disabled}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
