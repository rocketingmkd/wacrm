"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Montserrat } from "next/font/google";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  KanbanSquare,
  LineChart,
  MessageSquareText,
  Minus,
  Moon,
  Plus,
  Radar,
  Radio,
  Sparkles,
  Sun,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { RocketIcon } from "@/components/brand/rocket-icon";

// The public pages use Montserrat at heavier weights than the app shell
// (which only loads 600 to 800 for headings), so the landing brings its own.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-lp",
});

const GREEN_GRADIENT = "linear-gradient(135deg,#25D366,#16a34a)";

/**
 * Public sales page ("/" for visitors without a session). Adapted from the
 * RocketingZAP landing: same look, copy rewritten to what the Rocketing CRM
 * actually offers (two plans, 7-day trial, BYO AI key).
 */
export function LandingPage() {
  useScrollReveal();
  const { mode, toggleMode } = useTheme();
  const isDark = mode === "dark";

  return (
    <div
      className={`lp-root ${montserrat.variable} ${isDark ? "is-dark" : "is-light"} min-h-screen w-full overflow-x-hidden antialiased`}
    >
      {/* radial glows: absolute (not fixed) and lighter on mobile */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[1400px] overflow-hidden">
        <div
          className="lp-glow-a absolute -left-40 -top-40 hidden h-[600px] w-[600px] rounded-full blur-3xl md:block"
          style={{ background: "radial-gradient(circle, #25D366 0%, transparent 60%)" }}
        />
        <div
          className="lp-glow-b absolute -right-40 top-[20%] hidden h-[700px] w-[700px] rounded-full blur-3xl md:block"
          style={{ background: "radial-gradient(circle, #06b6d4 0%, transparent 65%)" }}
        />
        <div
          className="lp-glow-c absolute -top-32 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-2xl md:hidden"
          style={{ background: "radial-gradient(circle, #25D366 0%, transparent 60%)" }}
        />
      </div>

      <div className="relative z-10">
        <Header isDark={isDark} onToggleTheme={toggleMode} />
        <Hero />
        <Stats />
        <Pain />
        <HowItWorks />
        <Features />
        <Pricing />
        <Faq />
        <FinalCta />
        <Footer />
      </div>

      <style>{LP_CSS}</style>
    </div>
  );
}

/* ===================== HEADER ===================== */
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-brand leading-none ${className ?? ""}`}>
      <span className="text-white">Rocketing</span>
      <span className="text-[#22C55E]">CRM</span>
    </span>
  );
}

function Header({ isDark, onToggleTheme }: { isDark: boolean; onToggleTheme: () => void }) {
  return (
    <header className="lp-header sticky top-0 z-50 backdrop-blur-xl">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-3 px-4 sm:px-5 md:h-20 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <RocketIcon size={40} className="shrink-0" />
          <Wordmark className="text-[1.2rem] sm:text-[1.5rem] md:text-[1.7rem]" />
        </Link>
        <nav className="hidden items-center gap-8 text-[15px] font-semibold text-white/70 md:flex">
          <a href="#como" className="transition hover:text-white">Como funciona</a>
          <a href="#recursos" className="transition hover:text-white">Recursos</a>
          <a href="#planos" className="transition hover:text-white">Planos</a>
          <a href="#faq" className="transition hover:text-white">Dúvidas</a>
        </nav>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Alternar tema"
            title={isDark ? "Tema claro" : "Tema escuro"}
            className="glass grid size-10 place-items-center rounded-xl text-white/80 transition hover:text-white"
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Link
            href="/login"
            className="hidden rounded-xl px-4 py-2.5 text-[15px] font-semibold text-white/80 hover:text-white sm:inline"
          >
            Entrar
          </Link>
          <a
            href="#planos"
            className="btn-glow whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-bold text-black sm:px-5 sm:py-3 sm:text-[15px]"
            style={{ background: GREEN_GRADIENT }}
          >
            Ver planos
          </a>
        </div>
      </div>
    </header>
  );
}

/* ===================== HERO ===================== */
function Hero() {
  return (
    <section className="relative px-4 pb-16 pt-12 sm:px-6 md:px-8 md:pb-24 md:pt-28">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-10 md:gap-16 lg:grid-cols-2">
        <div className="text-center lg:text-left">
          <div className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px]">
            <span className="dot-pulse relative inline-block size-2 rounded-full bg-[#25D366]" />
            <span className="font-semibold text-white/80">WhatsApp + IA + CRM no automático</span>
          </div>

          <h1 className="font-display mt-6 text-[clamp(2.6rem,6.4vw,5.25rem)] font-black leading-[0.92] tracking-tight">
            Sua IA atende o WhatsApp <span className="text-grad">24h</span> e organiza o CRM{" "}
            <span className="text-grad">sozinha</span>.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/70 sm:text-xl lg:mx-0">
            Conecte seu número, treine o agente em uma tela e veja cada lead ser respondido na hora,
            qualificado e acompanhado no funil, sem você levantar o dedo.
          </p>

          <div className="mt-8 flex flex-col flex-wrap justify-center gap-3 sm:flex-row lg:justify-start">
            <Link
              href="/signup"
              className="group btn-glow inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-4 text-[16px] font-bold text-black"
              style={{ background: GREEN_GRADIENT }}
            >
              Começar 7 dias grátis
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#como"
              className="glass-strong inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-7 py-4 text-[16px] font-semibold text-white/90 transition hover:bg-white/10"
            >
              <ChevronDown className="size-4" /> Ver como funciona
            </a>
          </div>

          <ul className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-medium text-white/65 lg:justify-start">
            <li className="flex items-center gap-1.5"><Check className="size-4 text-[#25D366]" /> 7 dias grátis</li>
            <li className="flex items-center gap-1.5"><Check className="size-4 text-[#25D366]" /> Conexão guiada</li>
            <li className="flex items-center gap-1.5"><Check className="size-4 text-[#25D366]" /> Cancele quando quiser</li>
          </ul>
        </div>

        <div className="relative flex justify-center lg:justify-end">
          <PhoneMock />
        </div>
      </div>
    </section>
  );
}

function PhoneMock() {
  return (
    <div className="animate-float relative">
      <div
        className="absolute -inset-10 rounded-[3rem] opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, #25D366 0%, transparent 60%)" }}
      />
      <div
        className="relative h-[560px] w-[270px] rounded-[2.5rem] p-3 shadow-2xl sm:h-[620px] sm:w-[320px] md:h-[640px] md:w-[340px]"
        style={{ background: "var(--lp-phone-shell)", border: "1px solid var(--lp-phone-shell-bd)" }}
      >
        <div
          className="relative flex h-full w-full flex-col overflow-hidden rounded-[2rem]"
          style={{ background: "var(--lp-phone-screen)" }}
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-3 text-[10px] text-white/60">
            <span>9:41</span>
            <span>●●● 5G</span>
          </div>
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ background: "var(--lp-chat-header-bg)", borderBottom: "1px solid var(--lp-chat-header-bd)" }}
          >
            <div className="grid size-9 place-items-center rounded-full font-bold text-black" style={{ background: GREEN_GRADIENT }}>
              A
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">Rocketing CRM • IA</div>
              <div className="flex items-center gap-1.5 text-[10px] text-[#25D366]">
                <span className="size-1.5 rounded-full bg-[#25D366]" /> online agora
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-hidden px-3 py-4">
            <Bubble side="left" delay="0s">Oi! Vi o anúncio do site. Vocês ainda têm vaga pra essa semana?</Bubble>
            <Bubble side="right" delay=".4s">Oi Marina, tudo bem? 👋 Temos sim! Pra qual serviço você tá pensando?</Bubble>
            <Bubble side="left" delay=".8s">Quero fazer design de sobrancelha + cílios</Bubble>
            <Bubble side="right" delay="1.2s">Perfeito 🤌 Tenho quinta 15h ou sexta 10h. Qual prefere?</Bubble>
            <div className="reveal flex items-center gap-2 pl-2 text-[10px] text-white/50" style={{ animationDelay: "1.6s" }}>
              <Sparkles className="size-3 text-[#25D366]" />
              respondido pela IA na hora
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-3" style={{ background: "var(--lp-chat-header-bg)" }}>
            <div
              className="grid h-9 flex-1 content-center place-items-start rounded-full px-4 text-xs text-white/40"
              style={{ background: "var(--lp-input-pill)" }}
            >
              Mensagem
            </div>
            <div className="grid size-9 place-items-center rounded-full" style={{ background: "#25D366" }}>
              <ArrowRight className="size-4 text-black" />
            </div>
          </div>
        </div>
      </div>

      <div
        className="glass-strong animate-float absolute -left-10 bottom-20 hidden w-[220px] rounded-2xl p-3.5 shadow-2xl sm:-left-16 sm:block"
        style={{ animationDelay: "1.5s" }}
      >
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          <KanbanSquare className="size-3 text-[#25D366]" />
          Funil atualizado
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-full font-bold text-black" style={{ background: "#a3e635" }}>M</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Marina</div>
            <div className="truncate text-[11px] text-white/55">movida para Negociando</div>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-2/3" style={{ background: "linear-gradient(90deg,#25D366,#a3e635)" }} />
        </div>
      </div>

      <div
        className="glass-strong animate-float absolute -right-6 top-12 hidden items-center gap-2 rounded-xl px-3 py-2 shadow-2xl sm:-right-10 sm:flex"
        style={{ animationDelay: "3s" }}
      >
        <span className="dot-pulse relative size-2 rounded-full bg-[#25D366]" />
        <span className="text-xs font-medium">Lead respondido</span>
      </div>
    </div>
  );
}

function Bubble({ children, side, delay }: { children: ReactNode; side: "left" | "right"; delay: string }) {
  const isRight = side === "right";
  return (
    <div
      className={`reveal flex ${isRight ? "justify-end" : "justify-start"}`}
      style={{ transitionDelay: delay, animationDelay: delay }}
      data-reveal
    >
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${isRight ? "rounded-br-sm text-black" : "rounded-bl-sm"}`}
        style={
          isRight
            ? { background: GREEN_GRADIENT, boxShadow: "0 8px 24px -8px rgba(37,211,102,0.5)" }
            : { background: "var(--lp-bubble-left-bg)", border: "1px solid var(--lp-bubble-left-bd)", color: "var(--lp-bubble-left-fg)" }
        }
      >
        {children}
      </div>
    </div>
  );
}

/* ===================== STATS ===================== */
function Stats() {
  const items = [
    { n: "7 dias", l: "para testar grátis" },
    { n: "24/7", l: "IA respondendo" },
    { n: "2h", l: "sem resposta vira alerta" },
    { n: "1", l: "caixa de entrada para o time todo" },
  ];
  return (
    <section className="px-5 py-12 md:px-8 md:py-16">
      <div
        className="glass reveal mx-auto grid max-w-6xl grid-cols-2 divide-y divide-white/10 rounded-3xl md:grid-cols-4 md:divide-x md:divide-y-0"
        data-reveal
      >
        {items.map((it) => (
          <div key={it.l} className="px-6 py-8 text-center">
            <div className="font-display text-grad text-4xl md:text-5xl">{it.n}</div>
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">{it.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ===================== PAIN ===================== */
function Pain() {
  return (
    <section className="px-5 py-24 md:px-8 md:py-28">
      <div className="reveal mx-auto max-w-3xl text-center" data-reveal>
        <h2 className="font-display text-4xl leading-[1.02] tracking-tight md:text-6xl">
          Lead que espera, lead que <span className="text-grad">compra do concorrente</span>.
        </h2>
        <p className="mt-6 text-lg leading-relaxed text-white/65 md:text-xl">
          A primeira empresa a responder vende. Enquanto você está dirigindo, atendendo na loja ou
          dormindo, os leads do anúncio que você pagou estão sumindo na fila. O Rocketing CRM
          responde na hora, mostra quem ficou esperando e te entrega o lead pronto pra fechar.
        </p>
      </div>
    </section>
  );
}

/* ===================== HOW IT WORKS ===================== */
function HowItWorks() {
  const steps = [
    {
      n: "1",
      t: "Conecte o WhatsApp",
      d: "Conecte seu número de WhatsApp Business em poucos cliques. As conversas passam a cair na caixa de entrada do time.",
    },
    {
      n: "2",
      t: "Treine sua IA",
      d: "Uma tela com a personalidade da empresa, os produtos e as regras, usando a sua chave de IA. Salvou e ativou? Já está atendendo.",
    },
    {
      n: "3",
      t: "A IA atende e você acompanha",
      d: "Ela responde no automático, move o card no funil, e o Copiloto avisa onde tem cliente esperando ou venda para fechar. Você só fecha.",
    },
  ];
  return (
    <section id="como" className="px-5 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionTitle eyebrow="Como funciona" title={<>Em 3 passos. <span className="text-grad">Sério.</span></>} />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="glass border-sheen reveal rounded-2xl p-6" data-reveal>
              <div
                className="font-display grid size-11 place-items-center rounded-xl text-lg"
                style={{ background: "rgba(37,211,102,0.15)", color: "#25D366" }}
              >
                {s.n}
              </div>
              <h3 className="mt-5 text-xl font-bold">{s.t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-white/65">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ===================== FEATURES ===================== */
function Features() {
  const items = [
    {
      t: "Caixa de entrada compartilhada",
      d: "Todas as conversas em um só lugar, com histórico por contato, etiquetas, respostas rápidas e áudios como no WhatsApp.",
      icon: <MessageSquareText className="size-5" />,
    },
    {
      t: "IA que responde como você",
      d: "Treinada com o tom da sua empresa e uma base de conhecimento. Passa a conversa para uma pessoa quando precisa.",
      icon: <Bot className="size-5" />,
    },
    {
      t: "Funil Kanban",
      d: "Acompanhe cada negócio por etapa. A IA pode mover o card conforme a conversa evolui.",
      icon: <KanbanSquare className="size-5" />,
    },
    {
      t: "Copiloto IA",
      d: "Aponta conversa parada, cliente insatisfeito e oportunidade de venda. Ele não responde pelo cliente.",
      icon: <Radar className="size-5" />,
    },
    {
      t: "Disparos e automações",
      d: "Modelos aprovados pela Meta, disparos por lista ou planilha, agendamento e automações por gatilho.",
      icon: <Radio className="size-5" />,
    },
    {
      t: "Relatórios e agenda",
      d: "Tempo de resposta, conversas, negócios e avaliações do atendimento, mais agendamento com lembretes.",
      icon: <LineChart className="size-5" />,
    },
  ];
  return (
    <section id="recursos" className="px-5 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionTitle
          eyebrow="Recursos"
          title={<>Tudo que você precisa pra <span className="text-grad">parar de perder venda</span>.</>}
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.t} className="glass border-sheen reveal rounded-2xl p-6" data-reveal>
              <div
                className="grid size-11 place-items-center rounded-xl"
                style={{ background: "rgba(37,211,102,0.15)", color: "#25D366" }}
              >
                {it.icon}
              </div>
              <h3 className="mt-5 text-lg font-bold">{it.t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-white/65">{it.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ===================== PRICING ===================== */
function Pricing() {
  const plans = [
    {
      n: "Starter",
      p: "R$ 97",
      d: "Para começar a organizar o atendimento.",
      f: [
        "1 número de WhatsApp",
        "Caixa de entrada compartilhada",
        "Funil Kanban e contatos",
        "Disparos, modelos e automações",
        "Agenda e relatórios",
        "1 agente de IA, com a sua chave",
      ],
      cta: "Começar 7 dias grátis",
      highlight: false,
    },
    {
      n: "Pro",
      p: "R$ 197",
      d: "Para automatizar e escalar. O mais completo.",
      f: [
        "Tudo do Starter",
        "Fluxos: construtor visual de chatbot",
        "Copiloto IA: gargalos e oportunidades",
        "Vários agentes de IA, com transferência",
        "API, chaves e webhooks",
      ],
      cta: "Quero o Pro, 7 dias grátis",
      highlight: true,
    },
  ];
  return (
    <section id="planos" className="px-5 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-5xl">
        <SectionTitle
          eyebrow="Planos"
          title={<>Comece grátis. <span className="text-grad">Cresça</span> quando precisar.</>}
        />
        <p className="mx-auto mt-4 max-w-2xl text-center text-[15px] text-white/55">
          Todos os planos começam com 7 dias grátis e todos os recursos liberados.
        </p>
        <div className="mt-12 grid items-stretch gap-5 md:grid-cols-2">
          {plans.map((pl) => (
            <div
              key={pl.n}
              className={`reveal relative flex flex-col rounded-2xl p-7 ${pl.highlight ? "glass-strong" : "glass"}`}
              data-reveal
              style={
                pl.highlight
                  ? { boxShadow: "0 20px 60px -20px rgba(37,211,102,0.5), 0 0 0 1px rgba(37,211,102,0.4) inset" }
                  : undefined
              }
            >
              {pl.highlight && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black"
                  style={{ background: "linear-gradient(135deg,#25D366,#a3e635)" }}
                >
                  Mais completo
                </div>
              )}
              <div className="text-sm font-semibold uppercase tracking-wider text-white/60">{pl.n}</div>
              <div className="font-display mt-2 text-4xl">
                {pl.p}
                <span className="text-base font-normal text-white/50">/mês</span>
              </div>
              <p className="mt-2 min-h-[40px] text-sm text-white/60">{pl.d}</p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {pl.f.map((x) => (
                  <li key={x} className="flex gap-2.5">
                    <span
                      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full"
                      style={{ background: "rgba(37,211,102,0.2)" }}
                    >
                      <Check className="size-2.5 text-[#25D366]" strokeWidth={3} />
                    </span>
                    <span className="text-white/80">{x}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`mt-7 block w-full rounded-xl px-4 py-3 text-center font-semibold transition ${
                  pl.highlight ? "btn-glow text-black" : "glass-strong text-white hover:bg-white/10"
                }`}
                style={pl.highlight ? { background: GREEN_GRADIENT } : undefined}
              >
                {pl.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-white/40">
          A IA usa a sua própria chave (OpenAI ou Anthropic), e o custo de uso é cobrado direto pelo provedor.
        </p>
      </div>
    </section>
  );
}

/* ===================== FAQ ===================== */
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const items = [
    {
      q: "Preciso saber programar?",
      a: "Não. Você conecta o WhatsApp, preenche uma tela contando sobre sua empresa, ativa o agente e a IA já atende. Quem sabe usar WhatsApp consegue.",
    },
    {
      q: "Funciona com vários atendentes?",
      a: "Funciona. Você convida sua equipe por e-mail, cada pessoa com um papel (proprietário, administrador, agente ou visualizador). A IA atende o que dá, e o time assume o resto.",
    },
    {
      q: "Preciso de uma chave de IA?",
      a: "Sim. Você usa a sua própria chave da OpenAI ou da Anthropic, e o custo de uso é cobrado direto pelo provedor.",
    },
    {
      q: "A IA responde igual um robô?",
      a: "Ela segue o tom e as regras que você define, com mensagens curtas e uma pergunta por vez, e você escolhe quando ela deve passar a conversa para uma pessoa.",
    },
    {
      q: "Meu número fica seguro?",
      a: "Cada conta tem os dados isolados das demais e as credenciais ficam criptografadas. Você pode desconectar o número a qualquer momento.",
    },
    {
      q: "E depois dos 7 dias?",
      a: "Você escolhe o plano para continuar. Enquanto isso não acontecer, a conta fica somente para leitura.",
    },
  ];
  return (
    <section id="faq" className="px-5 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-3xl">
        <SectionTitle eyebrow="Dúvidas" title={<>Antes de você perguntar.</>} />
        <div className="mt-10 space-y-3">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div key={it.q} className="glass border-sheen reveal overflow-hidden rounded-2xl" data-reveal>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="font-semibold">{it.q}</span>
                  {isOpen ? (
                    <Minus className="size-4 shrink-0 text-[#25D366]" />
                  ) : (
                    <Plus className="size-4 shrink-0 text-[#25D366]" />
                  )}
                </button>
                {isOpen && <p className="px-5 pb-5 leading-relaxed text-white/65">{it.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ===================== FINAL CTA ===================== */
function FinalCta() {
  return (
    <section className="px-4 py-20 sm:px-5 md:px-8 md:py-28">
      <div
        className="reveal relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] p-8 text-center sm:p-12 md:p-20"
        data-reveal
        style={{
          background: "var(--lp-final-bg)",
          border: "1px solid var(--lp-final-bd)",
          boxShadow: "var(--lp-final-shadow)",
        }}
      >
        <div
          className="absolute -top-32 left-1/2 size-[500px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle,#25D366,transparent 60%)" }}
        />
        <div className="relative">
          <h2 className="font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl md:text-7xl">
            Pare de perder venda no <span className="text-grad">“oi, sumiu”</span>.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg text-white/70 sm:text-xl">
            7 dias grátis para ver a IA atendendo seu WhatsApp e o funil organizado. Escolha o plano só se gostar.
          </p>
          <div className="mt-10 flex flex-col flex-wrap justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="btn-glow inline-flex items-center justify-center gap-2 rounded-2xl px-8 py-4 text-base font-bold text-black sm:text-lg"
              style={{ background: GREEN_GRADIENT }}
            >
              Começar agora, de graça <ArrowRight className="size-5" />
            </Link>
            <Link
              href="/login"
              className="glass-strong inline-flex items-center justify-center gap-2 rounded-2xl px-8 py-4 text-base font-medium text-white hover:bg-white/10 sm:text-lg"
            >
              Já tenho conta
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===================== FOOTER ===================== */
function Footer() {
  return (
    <footer className="border-t border-white/5 px-5 pb-10 pt-16 md:px-8 md:pt-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-8">
          <div>
            <div className="flex items-center gap-3">
              <RocketIcon size={40} />
              <Wordmark className="text-[1.4rem]" />
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              IA que atende seu WhatsApp 24h, qualifica e organiza o CRM. Você só fecha.
            </p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Produto</div>
            <ul className="mt-4 space-y-2.5 text-sm text-white/65">
              <li><a href="#recursos" className="hover:text-white">Recursos</a></li>
              <li><a href="#como" className="hover:text-white">Como funciona</a></li>
              <li><a href="#planos" className="hover:text-white">Planos</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Acesso</div>
            <ul className="mt-4 space-y-2.5 text-sm text-white/65">
              <li><Link href="/login" className="hover:text-white">Entrar</Link></li>
              <li><Link href="/signup" className="hover:text-white">Criar conta</Link></li>
              <li><a href="#faq" className="hover:text-white">Dúvidas</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Legal</div>
            <ul className="mt-4 space-y-2.5 text-sm text-white/65">
              <li><Link href="/terms" className="hover:text-white">Termos</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Privacidade</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-white/40 md:flex-row">
          <span>© {new Date().getFullYear()} Rocketing CRM. Todos os direitos reservados.</span>
          <span>Feito no Brasil com ☕ e WhatsApp.</span>
        </div>
      </div>
    </footer>
  );
}

/* ===================== HELPERS ===================== */
function SectionTitle({ eyebrow, title }: { eyebrow: string; title: ReactNode }) {
  return (
    <div className="reveal text-center" data-reveal>
      <div className="inline-flex items-center justify-center gap-3 text-[11px] font-bold uppercase tracking-[0.28em] text-[#25D366]">
        <span className="h-px w-10 bg-[#25D366]/60" />
        {eyebrow}
        <span className="h-px w-10 bg-[#25D366]/60" />
      </div>
      <h2 className="font-display mx-auto mt-5 max-w-4xl text-5xl font-black leading-[0.98] tracking-tight md:text-7xl">
        {title}
      </h2>
    </div>
  );
}

function useScrollReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -10% 0px" },
    );
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      el.classList.add("reveal");
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);
}

/* Everything is scoped under .lp-root so it cannot leak into the app. */
const LP_CSS = `
  html { scroll-behavior: smooth; }
  .lp-root { font-family: var(--font-lp), system-ui, sans-serif; }
  .lp-root .font-display { font-family: var(--font-lp), system-ui, sans-serif; font-weight: 800; letter-spacing: -0.025em; }
  .lp-root .font-brand { font-family: var(--font-lp), system-ui, sans-serif; font-weight: 900; letter-spacing: -0.04em; }
  .lp-root .text-grad {
    background: linear-gradient(95deg, #25D366 0%, #a3e635 45%, #22d3ee 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .lp-root .btn-glow {
    box-shadow: 0 10px 30px -12px rgba(37,211,102,0.55), 0 0 0 1px rgba(37,211,102,0.35) inset;
  }

  .lp-root.is-dark {
    --lp-bg: #04100A;
    --lp-fg-rgb: 255,255,255;
    --lp-fg-strong-rgb: 255,255,255;
    --lp-glass-bg: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
    --lp-glass-bd: rgba(255,255,255,0.10);
    --lp-glass-strong-bg: linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03));
    --lp-glass-strong-bd: rgba(255,255,255,0.14);
    --lp-header-bg: rgba(4,16,10,0.55);
    --lp-header-bd: rgba(255,255,255,0.06);
    --lp-grid: rgba(255,255,255,0.04);
    --lp-bubble-left-bg: #1b2926;
    --lp-bubble-left-bd: rgba(255,255,255,0.05);
    --lp-bubble-left-fg: #FFFFFF;
    --lp-phone-shell: linear-gradient(180deg,#1a1f1d,#0b0f0d);
    --lp-phone-shell-bd: rgba(255,255,255,0.08);
    --lp-phone-screen: #0b1410;
    --lp-chat-header-bg: #111d18;
    --lp-chat-header-bd: rgba(255,255,255,0.05);
    --lp-input-pill: #0b1410;
    --lp-final-bg: linear-gradient(135deg,#0c3a23,#0a1a13);
    --lp-final-bd: rgba(37,211,102,0.30);
    --lp-final-shadow: 0 40px 120px -40px rgba(37,211,102,0.6);
  }
  .lp-root.is-light {
    --lp-bg: #F5F8F6;
    --lp-fg-rgb: 6,16,11;
    --lp-fg-strong-rgb: 0,0,0;
    --lp-glass-bg: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.78));
    --lp-glass-bd: rgba(10,21,16,0.12);
    --lp-glass-strong-bg: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.88));
    --lp-glass-strong-bd: rgba(10,21,16,0.16);
    --lp-header-bg: rgba(255,255,255,0.82);
    --lp-header-bd: rgba(10,21,16,0.10);
    --lp-grid: rgba(10,21,16,0.06);
    --lp-bubble-left-bg: #EEF3EF;
    --lp-bubble-left-bd: rgba(10,21,16,0.08);
    --lp-bubble-left-fg: #050D09;
    --lp-phone-shell: linear-gradient(180deg,#E2E8E4,#BFCAC3);
    --lp-phone-shell-bd: rgba(10,21,16,0.12);
    --lp-phone-screen: #F2F6F3;
    --lp-chat-header-bg: #FFFFFF;
    --lp-chat-header-bd: rgba(10,21,16,0.08);
    --lp-input-pill: #EEF3EF;
    --lp-final-bg: linear-gradient(135deg,#E8F6EE,#FFFFFF);
    --lp-final-bd: rgba(22,163,74,0.30);
    --lp-final-shadow: 0 40px 120px -40px rgba(22,163,74,0.35);
  }

  .lp-root { background: var(--lp-bg); color: rgb(var(--lp-fg-strong-rgb)); }
  .lp-root .glass { background: var(--lp-glass-bg); border: 1px solid var(--lp-glass-bd); transition: border-color .35s ease, box-shadow .35s ease, transform .35s ease; }
  .lp-root .glass:hover { border-color: rgba(37,211,102,0.45); box-shadow: 0 14px 40px -18px rgba(37,211,102,0.35); }
  .lp-root .glass-strong { background: var(--lp-glass-strong-bg); border: 1px solid var(--lp-glass-strong-bd); transition: border-color .35s ease, box-shadow .35s ease, transform .35s ease; }
  .lp-root .glass-strong:hover { border-color: rgba(37,211,102,0.55); box-shadow: 0 18px 50px -18px rgba(37,211,102,0.45); }
  @media (min-width: 768px) {
    .lp-root .glass { backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .lp-root .glass-strong { backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  }
  .lp-root .grid-bg {
    background-image:
      linear-gradient(var(--lp-grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--lp-grid) 1px, transparent 1px);
    background-size: 48px 48px;
  }
  .lp-root .lp-header { background: var(--lp-header-bg); border-bottom: 1px solid var(--lp-header-bd); }

  /* The markup uses white-on-dark utilities; in light mode they map to dark ink. */
  .lp-root .text-white { color: rgb(var(--lp-fg-strong-rgb)) !important; }
  .lp-root .text-white\\/90 { color: rgba(var(--lp-fg-rgb),0.95) !important; }
  .lp-root .text-white\\/85 { color: rgba(var(--lp-fg-rgb),0.92) !important; }
  .lp-root .text-white\\/80 { color: rgba(var(--lp-fg-rgb),0.88) !important; }
  .lp-root .text-white\\/70 { color: rgba(var(--lp-fg-rgb),0.78) !important; }
  .lp-root .text-white\\/65 { color: rgba(var(--lp-fg-rgb),0.74) !important; }
  .lp-root .text-white\\/60 { color: rgba(var(--lp-fg-rgb),0.70) !important; }
  .lp-root .text-white\\/55 { color: rgba(var(--lp-fg-rgb),0.65) !important; }
  .lp-root .text-white\\/50 { color: rgba(var(--lp-fg-rgb),0.60) !important; }
  .lp-root .text-white\\/45 { color: rgba(var(--lp-fg-rgb),0.55) !important; }
  .lp-root .text-white\\/40 { color: rgba(var(--lp-fg-rgb),0.50) !important; }
  .lp-root .bg-white\\/10 { background-color: rgba(var(--lp-fg-rgb),0.10) !important; }
  .lp-root .hover\\:bg-white\\/10:hover { background-color: rgba(var(--lp-fg-rgb),0.10) !important; }
  .lp-root .hover\\:text-white:hover { color: rgb(var(--lp-fg-strong-rgb)) !important; }
  .lp-root .border-white\\/5 { border-color: rgba(var(--lp-fg-rgb),0.10) !important; }
  .lp-root .border-white\\/10 { border-color: rgba(var(--lp-fg-rgb),0.12) !important; }
  .lp-root .divide-white\\/10 > :where(*) { border-color: rgba(var(--lp-fg-rgb),0.12) !important; }
  /* Text that sits on the green buttons must stay dark in both modes. */
  .lp-root .btn-glow, .lp-root .btn-glow * { color: #04140B !important; }
  .lp-root.is-light .lp-glow-a { opacity: .22; }
  .lp-root.is-light .lp-glow-b { opacity: .10; }
  .lp-root.is-light .lp-glow-c { opacity: .16; }
  .lp-root.is-dark .lp-glow-a { opacity: .40; }
  .lp-root.is-dark .lp-glow-b { opacity: .25; }
  .lp-root.is-dark .lp-glow-c { opacity: .30; }

  .lp-root button, .lp-root a { position: relative; z-index: 1; cursor: pointer; }

  .lp-root .dot-pulse { position: relative; }
  .lp-root .dot-pulse::after {
    content: '';
    position: absolute; inset: 0;
    border-radius: 9999px;
    background: #25D366;
    animation: lp-dot-pulse 1.8s ease-out infinite;
    opacity: 0.6;
  }
  @keyframes lp-dot-pulse {
    0% { transform: scale(1); opacity: 0.6; }
    80%, 100% { transform: scale(2.4); opacity: 0; }
  }
  @keyframes lp-float-y {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }
  .lp-root .animate-float { animation: lp-float-y 6s ease-in-out infinite; will-change: transform; }
  @media (max-width: 640px) { .lp-root .animate-float { animation: none; } }
  .lp-root .reveal { opacity: 0; transform: translateY(18px); transition: opacity .7s ease, transform .7s ease; will-change: opacity, transform; }
  .lp-root .reveal.in { opacity: 1; transform: translateY(0); }
  @keyframes lp-border-sheen {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  .lp-root .border-sheen { position: relative; }
  .lp-root .border-sheen::before {
    content: '';
    position: absolute; inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(120deg, transparent 30%, rgba(37,211,102,0.6) 50%, transparent 70%);
    background-size: 200% 100%;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
            mask-composite: exclude;
    animation: lp-border-sheen 6s linear infinite;
    pointer-events: none;
    opacity: 0;
    transition: opacity .35s ease;
  }
  .lp-root .border-sheen:hover::before { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .lp-root .reveal { opacity: 1; transform: none; transition: none; }
    .lp-root .animate-float { animation: none; }
    .lp-root .border-sheen::before { animation: none; }
  }
`;
