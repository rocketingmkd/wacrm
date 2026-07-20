// Registered as a Valid OAuth Redirect URI in the Meta App dashboard
// (Tech Provider setup bundles Facebook/Instagram/Messenger/WABA
// signup redirects together). Rocketing CRM only integrates with
// WhatsApp — see /oauth/waba-signup — so this route intentionally
// has no real logic and never will.

import Link from "next/link";

export default function InstagramSignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
      <h1 className="text-xl font-semibold">Rocketing CRM</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Este produto não utiliza integração com Instagram.
      </p>
      <Link href="/login" className="text-sm text-primary hover:text-primary/80">
        Ir para o login
      </Link>
    </div>
  );
}
