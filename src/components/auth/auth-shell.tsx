"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  KanbanSquare,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RocketIcon } from "@/components/brand/rocket-icon";

interface AuthShellProps {
  /** Shows the "Criar conta / Entrar" switch above the form. */
  mode?: "login" | "signup";
  /** Invite token carried across login <-> signup (see /join/[token]). */
  inviteToken?: string | null;
  children: ReactNode;
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-extrabold leading-none tracking-tight", className)}>
      Rocketing<span className="text-primary">CRM</span>
    </span>
  );
}

function Feature({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3.5 backdrop-blur-sm">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold leading-tight">{title}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

/**
 * Two-column frame shared by login, signup and password recovery: brand
 * panel on the left (desktop), form card on the right. The pages keep
 * their own logic and only render their form as `children`.
 */
export function AuthShell({ mode, inviteToken, children }: AuthShellProps) {
  const suffix = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : "";
  const isSignup = mode === "signup";

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--primary) 0%, transparent 60%)" }}
        />
        <div
          className="absolute -right-40 top-[30%] h-[700px] w-[700px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #06b6d4 0%, transparent 65%)" }}
        />
        <div
          className="absolute bottom-[-200px] left-1/3 h-[500px] w-[500px] rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--primary) 0%, transparent 60%)" }}
        />
      </div>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        <aside className="hidden flex-col justify-between border-r border-border bg-primary/[0.04] p-10 lg:flex xl:p-14">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            voltar ao site
          </Link>

          <div className="max-w-lg space-y-8">
            <div className="flex items-center gap-3">
              <RocketIcon size={48} />
              <div>
                <Wordmark className="text-2xl" />
                <div className="mt-1 text-[12px] text-muted-foreground">
                  WhatsApp, funil e IA no mesmo lugar
                </div>
              </div>
            </div>

            <h2 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight xl:text-5xl">
              Sua IA atende o
              <br />
              <span className="text-primary">WhatsApp 24h</span> e
              <br />
              organiza o CRM sozinha.
            </h2>

            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Conecte seu número, treine o agente e acompanhe cada lead no funil. As respostas,
              a qualificação e os alertas de conversa parada ficam por conta da IA.
            </p>

            <div className="grid gap-3">
              <Feature
                icon={<Bot className="size-4" />}
                title="IA treinada no seu negócio"
                desc="Responde no seu tom, com a sua própria chave de IA."
              />
              <Feature
                icon={<KanbanSquare className="size-4" />}
                title="Funil Kanban e Copiloto IA"
                desc="Veja quem está esperando resposta e onde há venda a fechar."
              />
              <Feature
                icon={<Zap className="size-4" />}
                title="Tudo em um só lugar"
                desc="Caixa de entrada, disparos, agenda e relatórios."
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-primary" /> Dados isolados por conta
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-primary" /> 7 dias grátis
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-primary" /> Cancele quando quiser
              </span>
            </div>
          </div>

          <div className="text-[12px] text-muted-foreground">
            © {new Date().getFullYear()} Rocketing CRM. Todos os direitos reservados.
          </div>
        </aside>

        <main className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
          <div className="mb-6 flex w-full max-w-md items-center justify-between lg:hidden">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> voltar
            </Link>
            <div className="flex items-center gap-2">
              <RocketIcon size={34} />
              <Wordmark className="text-[15px]" />
            </div>
          </div>

          <div className="w-full max-w-md">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)] sm:p-8">
              <div
                aria-hidden
                className="absolute -right-24 -top-24 size-56 rounded-full opacity-40 blur-3xl"
                style={{ background: "radial-gradient(circle, var(--primary) 0%, transparent 70%)" }}
              />
              <div className="relative">
                {mode && (
                  <div className="mb-5 inline-flex items-center gap-1 rounded-full border border-border bg-muted p-1">
                    <Link
                      href={`/signup${suffix}`}
                      aria-current={isSignup ? "page" : undefined}
                      className={cn(
                        "rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
                        isSignup
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Criar conta
                    </Link>
                    <Link
                      href={`/login${suffix}`}
                      aria-current={!isSignup ? "page" : undefined}
                      className={cn(
                        "rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
                        !isSignup
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Entrar
                    </Link>
                  </div>
                )}
                {children}
              </div>
            </div>

            <p className="mt-5 text-center text-[11.5px] text-muted-foreground">
              Ao continuar, você concorda com os{" "}
              <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
                Termos de Uso
              </Link>{" "}
              e a{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                Política de Privacidade
              </Link>
              .
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
