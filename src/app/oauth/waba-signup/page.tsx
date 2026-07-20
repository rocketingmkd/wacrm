"use client";

// ============================================================
// /oauth/waba-signup — OAuth redirect target for WhatsApp
// Embedded Signup (registered as a Valid OAuth Redirect URI in the
// Meta App dashboard, Tech Provider setup).
//
// NOT YET WIRED to the real signup flow. Today's WhatsApp connection
// is still the manual form in Settings → WhatsApp (paste
// phone_number_id/waba_id/token). This page exists so the redirect
// URI can be registered with Meta now, without blocking the Tech
// Provider application.
//
// When Embedded Signup is implemented for real, this page becomes
// the landing point after the Facebook Login for Business popup:
//   1. Read `code` (and `state`, if we pass one) from the query string.
//   2. POST it to a server route that exchanges `code` for a token via
//      Meta's /oauth/access_token (using META_APP_ID + META_APP_SECRET).
//   3. Combine that with the waba_id / phone_number_id the JS SDK's
//      message event delivers client-side, and feed both into the
//      same save path POST /api/whatsapp/config already used by the
//      manual form (registerPhoneNumber + subscribeWabaToApp).
// ============================================================

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

function WabaSignupInner() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <h1 className="text-xl font-semibold">Conexão do WhatsApp</h1>
      {error ? (
        <p className="max-w-sm text-sm text-muted-foreground">
          A Meta retornou um erro: {error}
        </p>
      ) : code ? (
        <p className="max-w-sm text-sm text-muted-foreground">
          Código recebido. A conexão automática ainda está em construção
          &mdash; por enquanto, conecte seu WhatsApp em Configurações.
        </p>
      ) : (
        <p className="max-w-sm text-sm text-muted-foreground">
          Essa página recebe o retorno do processo de conexão do
          WhatsApp. Ainda não há nada pra ver aqui diretamente.
        </p>
      )}
      <Link href="/settings" className="text-sm text-primary hover:text-primary/80">
        Ir para Configurações
      </Link>
    </div>
  );
}

export default function WabaSignupPage() {
  return (
    <Suspense fallback={null}>
      <WabaSignupInner />
    </Suspense>
  );
}
