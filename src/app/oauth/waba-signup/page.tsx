"use client";

// ============================================================
// /oauth/waba-signup — real OAuth redirect target for WhatsApp
// Embedded Signup, registered as a Valid OAuth Redirect URI in the
// Meta App dashboard.
//
// WhatsApp-config.tsx no longer uses `FB.login()` for the connect
// flow — that call lets the JS SDK pick an opaque, Meta-internal
// redirect_uri we don't control, which the token exchange then
// rejects for the Coexistence (whatsapp_business_app_onboarding)
// path ("Please make sure your redirect_uri is identical to the one
// you used in the OAuth dialog request" — confirmed by capturing the
// exact dialog URL Meta's own App Dashboard tester uses). Instead,
// whatsapp-config.tsx opens Meta's OAuth dialog itself with THIS
// page's URL as `redirect_uri`/`fallback_redirect_uri`, so the same
// URL is used on both ends of the exchange.
//
// Flow: popup window navigates here with `?code=...` (or `?error=...`)
// once the user finishes the dialog. This page hands the code back to
// the opener via postMessage and closes itself — the opener
// (whatsapp-config.tsx) does the actual token exchange.
// ============================================================

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function WabaSignupInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (window.opener) {
      if (code) {
        window.opener.postMessage(
          JSON.stringify({ type: "RCC_OAUTH_REDIRECT", code }),
          window.location.origin,
        );
      } else if (error) {
        window.opener.postMessage(
          JSON.stringify({
            type: "RCC_OAUTH_REDIRECT",
            error: errorDescription || error,
          }),
          window.location.origin,
        );
      }
      window.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <h1 className="text-xl font-semibold">Conexão do WhatsApp</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Concluindo a conexão, essa janela vai fechar sozinha...
      </p>
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
