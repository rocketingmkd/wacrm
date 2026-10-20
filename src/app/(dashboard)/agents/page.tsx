'use client';

import { useState } from 'react';
import { Bot, Sparkles, KeyRound, Users, BarChart3, GitBranch } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiProviderConfig } from '@/components/settings/ai-provider-config';
import { AiAgentsManager } from '@/components/settings/ai-agents-manager';
import { AiKanbanConfig } from '@/components/settings/ai-kanban-config';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'agents' | 'playground' | 'kanban' | 'usage' | 'key';

// Pill-style tab strip, centered. The `group-data-horizontal/tabs:` prefix
// matches the base component's own height rule so ours replaces it.
const LIST_CLASS =
  'max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] rounded-full border border-border bg-card p-1 gap-1 shadow-[var(--shadow-card)] group-data-horizontal/tabs:h-11';
const TRIGGER_CLASS =
  'rounded-full px-4 group-data-horizontal/tabs:h-9 data-active:bg-primary-soft data-active:text-primary data-active:shadow-[inset_0_0_0_1px_var(--primary-soft-2)]';

export default function AgentsPage() {
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  // The agent cards are the first thing you see. When there is no API key
  // yet, that tab shows a banner that sends you to "Chave de API".
  const [tab, setTab] = useState<Tab>('agents');

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="text-center">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Bot className="size-6" />
        </span>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">
          Agentes de IA
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
          Configure sua chave de API uma vez, construa quantos agentes quiser em cima dela, e teste
          no playground antes de eles responderem aos clientes na caixa de entrada.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-6">
        <div className="flex justify-center">
          <TabsList className={LIST_CLASS}>
            <TabsTrigger value="agents" className={TRIGGER_CLASS}>
              <Users className="h-4 w-4" /> Agentes
            </TabsTrigger>
            <TabsTrigger value="playground" className={TRIGGER_CLASS}>
              <Sparkles className="h-4 w-4" /> Playground
            </TabsTrigger>
            <TabsTrigger value="kanban" className={TRIGGER_CLASS}>
              <GitBranch className="h-4 w-4" /> Kanban
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger value="usage" className={TRIGGER_CLASS}>
                <BarChart3 className="h-4 w-4" /> Uso
              </TabsTrigger>
            )}
            <TabsTrigger value="key" className={TRIGGER_CLASS}>
              <KeyRound className="h-4 w-4" /> Chave de API
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="agents" className="mt-8">
          <AiAgentsManager onNeedProviderConfig={() => setTab('key')} />
        </TabsContent>

        <TabsContent value="playground" className="mt-8">
          <div className="mx-auto max-w-4xl">
            <AiPlayground onGoToSetup={() => setTab('agents')} />
          </div>
        </TabsContent>

        <TabsContent value="kanban" className="mt-8">
          <div className="mx-auto max-w-3xl">
            <AiKanbanConfig />
          </div>
        </TabsContent>

        {canViewUsage && (
          <TabsContent value="usage" className="mt-8">
            <AiUsageCard />
          </TabsContent>
        )}

        <TabsContent value="key" className="mt-8">
          <div className="mx-auto max-w-3xl">
            <AiProviderConfig onSaved={() => setTab('agents')} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
