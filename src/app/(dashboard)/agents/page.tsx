'use client';

import { useEffect, useState } from 'react';
import { Bot, Sparkles, KeyRound, Users, BarChart3 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiProviderConfig } from '@/components/settings/ai-provider-config';
import { AiAgentsManager } from '@/components/settings/ai-agents-manager';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'playground' | 'key' | 'agents' | 'usage';

export default function AgentsPage() {
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('playground');
  const [decided, setDecided] = useState(false);

  // Land first-time users where they actually need to go: no key yet →
  // "Chave de API"; key set but no agent yet → "Agentes"; otherwise the
  // Playground, for returning users who already have something to test.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [providerRes, agentsRes] = await Promise.all([
          fetch('/api/ai/provider'),
          fetch('/api/ai/agents'),
        ]);
        const providerData = await providerRes.json().catch(() => ({}));
        const agentsData = await agentsRes.json().catch(() => ({}));
        const hasKey = Boolean(providerData?.configured);
        const hasAgents = Array.isArray(agentsData?.agents) && agentsData.agents.length > 0;
        if (!cancelled) {
          setTab(!hasKey ? 'key' : !hasAgents ? 'agents' : 'playground');
        }
      } catch {
        if (!cancelled) setTab('key');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Agentes de IA
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure sua chave de API uma vez, construa quantos agentes quiser em cima dela, e teste
        no playground antes de eles responderem aos clientes na caixa de entrada.
      </p>

      {decided && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="mt-6"
        >
          <TabsList>
            <TabsTrigger value="playground">
              <Sparkles className="mr-1.5 h-4 w-4" /> Playground
            </TabsTrigger>
            <TabsTrigger value="key">
              <KeyRound className="mr-1.5 h-4 w-4" /> Chave de API
            </TabsTrigger>
            <TabsTrigger value="agents">
              <Users className="mr-1.5 h-4 w-4" /> Agentes
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger value="usage">
                <BarChart3 className="mr-1.5 h-4 w-4" /> Uso
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="playground" className="mt-4">
            <AiPlayground onGoToSetup={() => setTab('agents')} />
          </TabsContent>

          <TabsContent value="key" className="mt-4">
            <AiProviderConfig onSaved={() => setTab('agents')} />
          </TabsContent>

          <TabsContent value="agents" className="mt-4">
            <AiAgentsManager onNeedProviderConfig={() => setTab('key')} />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="usage" className="mt-4">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
