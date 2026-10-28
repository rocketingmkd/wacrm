import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing/landing-page";

// The app shell is noindex (root layout); the sales page is the one public
// page that should be found.
export const metadata: Metadata = {
  title: {
    absolute: "Rocketing CRM: IA atende seu WhatsApp 24h e organiza o CRM",
  },
  description:
    "WhatsApp, funil e IA no mesmo lugar. O Rocketing CRM responde, qualifica e acompanha cada lead, e o Copiloto IA mostra quem está esperando. 7 dias grátis para testar.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Rocketing CRM: WhatsApp + IA + CRM no automático",
    description:
      "Conecte seu WhatsApp, treine o agente e acompanhe cada lead no funil. 7 dias grátis.",
    type: "website",
    locale: "pt_BR",
  },
};

export default async function RootPage() {
  // Signed-in users keep landing on the dashboard, as before.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return <LandingPage />;
}
