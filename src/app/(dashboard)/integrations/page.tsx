"use client";

import { KeyRound, Webhook } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasMinRole } from "@/lib/auth/roles";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeysSettings } from "@/components/settings/api-keys-settings";
import { WebhooksPanel } from "@/components/integrations/webhooks-panel";

export default function IntegrationsPage() {
  const { accountRole } = useAuth();

  if (accountRole && !hasMinRole(accountRole, "admin")) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        As integrações estão disponíveis para administradores da conta.
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">
          Conecte o CRM a outros sistemas com webhooks de saída e a API pública.
        </p>
      </header>

      <Tabs defaultValue="webhooks">
        <TabsList>
          <TabsTrigger value="webhooks">
            <Webhook className="size-4" />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="api">
            <KeyRound className="size-4" />
            API pública
          </TabsTrigger>
        </TabsList>

        <TabsContent value="webhooks" className="mt-5">
          <WebhooksPanel />
        </TabsContent>
        <TabsContent value="api" className="mt-5">
          <ApiKeysSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
