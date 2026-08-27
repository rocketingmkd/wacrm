// Registered as a Valid OAuth Redirect URI in the Meta App dashboard.
// The WhatsApp Embedded Signup flow now runs entirely through the FB
// JS SDK's `FB.login()` (see src/components/settings/whatsapp-config.tsx),
// which owns its own redirect_uri and never navigates the browser here,
// so this route intentionally has no real logic. Kept as a harmless
// landing page in case the URI is still hit directly.

import Link from "next/link";

export default function WabaSignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <h1 className="text-xl font-semibold">Rocketing CRM</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Conexão do WhatsApp concluída pelo aplicativo. Você pode fechar esta janela.
      </p>
      <Link href="/settings" className="text-sm text-primary hover:text-primary/80">
        Voltar para as configurações
      </Link>
    </div>
  );
}
