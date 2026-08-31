'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bot, RotateCcw, Send, Loader2, UserCircle2, ArrowRight, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
  /** assistant-only: the agent asked to transfer to another agent's slug
   *  (not simulated here — just surfaced, see the multi-agent plan). */
  transferTo?: string | null;
}

interface AgentOption {
  id: string;
  name: string;
  slug: string;
  is_receptionist: boolean;
}

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/agents');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list = (data.agents as AgentOption[]) ?? [];
        setAgents(list);
        const receptionist = list.find((a) => a.is_receptionist);
        setAgentId(receptionist?.id ?? list[0]?.id ?? '');
      } catch {
        // Best-effort — the playground still works against the
        // receptionist by default even if the picker fails to load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const changeAgent = (id: string | null) => {
    if (!id) return;
    setAgentId(id);
    setTurns([]); // switching agent mid-transcript would be misleading
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId || undefined,
          // Send only role+content — the server ignores anything else.
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('Nenhum agente configurado ainda. Conclua a configuração primeiro.');
        } else {
          toast.error(data.error ?? 'Não foi possível obter uma resposta.');
        }
        // Roll the unsent user turn back so the transcript stays clean.
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
          transferTo: typeof data.transfer_to === 'string' ? data.transfer_to : null,
        },
      ]);
    } catch {
      toast.error('Não foi possível acessar o agente.');
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 text-sm font-medium text-foreground">Playground</span>
          {agents.length > 1 && (
            <Select value={agentId} onValueChange={changeAgent} disabled={sending}>
              <SelectTrigger className="h-7 w-auto min-w-[9rem] gap-1 px-2 text-xs">
                {/* Base UI's Select.Value renders the raw value (an id) unless
                    we map it to a label here — the picker must show the name. */}
                <SelectValue placeholder="Agente">
                  {(id) => agents.find((a) => a.id === id)?.name ?? 'Agente'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTurns([])}
          disabled={turns.length === 0 || sending}
          className="shrink-0 text-muted-foreground"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Limpar
        </Button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Bot className="mb-2 h-8 w-8 text-muted-foreground/60" />
            <p>Envie uma mensagem para ver como seu agente responderia.</p>
            <p className="mt-1 text-xs">
              Ele usa sua base de conhecimento e se comporta exatamente como o
              bot de resposta automática, inclusive na transferência para humano.
            </p>
            {onGoToSetup && (
              <Button
                variant="link"
                size="sm"
                onClick={onGoToSetup}
                className="mt-1 h-auto p-0 text-xs"
              >
                Ainda não configurou? Ir para a configuração <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              t.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {t.role === 'assistant' && (
              <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                t.role === 'user'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted text-foreground',
              )}
            >
              {t.content && <p className="whitespace-pre-wrap">{t.content}</p>}
              {t.role === 'assistant' && t.handoff && (
                <p
                  className={cn(
                    'flex items-center gap-1 text-xs text-amber-500',
                    t.content && 'mt-1.5 border-t border-border/50 pt-1.5',
                  )}
                >
                  <UserCircle2 className="h-3.5 w-3.5" />
                  Transferiria para um humano aqui
                </p>
              )}
              {t.role === 'assistant' && t.transferTo && (
                <p
                  className={cn(
                    'flex items-center gap-1 text-xs text-sky-500',
                    t.content && 'mt-1.5 border-t border-border/50 pt-1.5',
                  )}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Transferiria para o agente &quot;{t.transferTo}&quot; aqui
                </p>
              )}
            </div>
            {t.role === 'user' && (
              <UserCircle2 className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-5 w-5 text-primary" />
            <Loader2 className="h-4 w-4 animate-spin" /> Pensando…
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite uma mensagem de cliente…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
        />
        <Button
          size="sm"
          onClick={send}
          disabled={!input.trim() || sending}
          className="h-9 w-9 shrink-0 p-0"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
