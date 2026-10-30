// Relatório de atendimento em HTML único (sem dependências externas além
// das fontes), com a identidade da Rocketing: Playfair Display nos
// títulos, Inter no corpo, ouro só como destaque, tema claro e escuro,
// impressão limpa. Todo texto vindo de cliente ou da IA passa por esc().

import type { ReportAggregate, Narrative, Outcome } from './reports'

export interface ReportHtmlRow {
  conversationId: string
  name: string | null
  phone: string | null
  source: string
  campaign: string | null
  outcome: Outcome | null
  quality: number | null
  firstResponseMin: number | null
  unanswered: boolean
  summary: string
  nextAction: string
}

export interface ReportHtmlInput {
  mode: 'full' | 'keyword'
  keyword: string | null
  sourceFilter: string | null
  dateFrom: string | null
  dateTo: string | null
  createdAt: string
  finishedAt: string | null
  model: string | null
  aggregate: ReportAggregate
  narrative: Narrative | null
  rows: ReportHtmlRow[]
  /** Endereço do CRM, para os links "Abrir conversa". */
  baseUrl: string
}

const SOURCE_LABEL: Record<string, string> = {
  meta_ctwa: 'Meta (clique no anúncio)',
  meta_site: 'Meta (site)',
  google: 'Google',
  other: 'Outra origem',
  sem_origem: 'Sem origem',
}

const OUTCOME_LABEL: Record<string, string> = {
  fechado: 'Fechado',
  em_andamento: 'Em andamento',
  perdido: 'Perdido',
  sem_resposta_da_equipe: 'Sem resposta da equipe',
  sem_interesse: 'Sem interesse',
  outro: 'Outro',
}

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const num = (n: number | null | undefined) => (n == null ? '—' : nf.format(n))

/** 75 vira "1h 15min"; abaixo de 1 hora fica em minutos. */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return '—'
  if (min < 60) return `${nf.format(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

const dateBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''

const CSS = `
:root{--gold:#B8902A;--gold-soft:#D4AF70;--bg:#FFFFFF;--card:#FAF8F4;--strong:#1A1A1A;--text:#333333;--muted:#5C5C5C;--line:#E3DDD0}
:root[data-theme=dark]{--gold:#C9A84C;--gold-soft:#E8C96A;--bg:#0E0E0E;--card:#1A1A18;--strong:#F0F0F0;--text:#CFCFCA;--muted:#A8A8A2;--line:#2C2C29}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--gold:#C9A84C;--gold-soft:#E8C96A;--bg:#0E0E0E;--card:#1A1A18;--strong:#F0F0F0;--text:#CFCFCA;--muted:#A8A8A2;--line:#2C2C29}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 Inter,system-ui,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:56px 40px 80px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:14px;border-bottom:2px solid var(--strong)}
.brand{font:600 20px 'Playfair Display',Georgia,serif;color:var(--strong);letter-spacing:.2px}
.brand span{color:var(--gold)}
.meta{text-align:right;font-size:12px;color:var(--muted)}
.theme{margin-top:6px;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--strong);cursor:pointer}
h1{font:600 34px/1.2 'Playfair Display',Georgia,serif;color:var(--strong);margin:28px 0 4px}
h2.sub{font:400 16px Inter,sans-serif;color:var(--muted);margin:0 0 16px}
h3{font:600 20px 'Playfair Display',Georgia,serif;color:var(--strong);margin:40px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);border-bottom:2px solid var(--gold);display:inline-block;padding-bottom:2px;margin-bottom:10px}
.note{background:var(--card);border-left:3px solid var(--gold);padding:14px 18px;margin:18px 0}
.note b{color:var(--strong)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);padding:16px 14px}
.card .v{font:600 28px 'Playfair Display',Georgia,serif;color:var(--strong);font-variant-numeric:tabular-nums}
.card .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0}
th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--strong);padding:9px 10px}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:1px solid var(--strong)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
ul.plain{margin:6px 0;padding-left:20px}
ul.plain li{margin:6px 0}
a{color:var(--gold);text-decoration:none;font-weight:600}
a:hover{text-decoration:underline}
.bar{height:8px;background:var(--gold);opacity:.78;min-width:2px}
.foot{margin-top:56px;padding-top:14px;border-top:2px solid var(--strong);font-size:11px;color:var(--muted);text-align:center;line-height:1.7}
.small{font-size:12px;color:var(--muted)}
@media (max-width:720px){.wrap{padding:32px 18px 60px}.cards{grid-template-columns:repeat(2,1fr)}.top{flex-direction:column}.meta{text-align:left}}
@media print{.theme{display:none}.wrap{padding:0}h3{page-break-after:avoid}tr{page-break-inside:avoid}body{background:#fff;color:#222}}
`

const THEME_JS = `(function(){var k='rocketing-report-theme',r=document.documentElement;try{var s=localStorage.getItem(k);if(s)r.setAttribute('data-theme',s)}catch(e){}
document.getElementById('theme').addEventListener('click',function(){var d=r.getAttribute('data-theme')==='dark'||(!r.getAttribute('data-theme')&&matchMedia('(prefers-color-scheme:dark)').matches);var n=d?'light':'dark';r.setAttribute('data-theme',n);try{localStorage.setItem(k,n)}catch(e){}})})();`

function card(value: string, label: string): string {
  return `<div class="card"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`
}

function list(items: string[]): string {
  return items.length ? `<ul class="plain">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="small">Nada a registrar.</p>'
}

export function buildReportHtml(r: ReportHtmlInput): string {
  const a = r.aggregate
  const title = r.mode === 'keyword' ? `Atendimento dos leads que escreveram “${r.keyword ?? ''}”` : 'Atendimento: histórico completo'

  const filters = [
    r.mode === 'keyword' ? `Palavra-chave: “${r.keyword}”` : 'Todos os atendimentos',
    r.sourceFilter ? `Origem: ${SOURCE_LABEL[r.sourceFilter] ?? r.sourceFilter}` : null,
    r.dateFrom || r.dateTo ? `Período: ${dateBR(r.dateFrom) || 'início'} a ${dateBR(r.dateTo) || 'hoje'}` : null,
  ].filter(Boolean) as string[]

  const maxOutcome = Math.max(1, ...Object.values(a.outcomes))
  const outcomeRows = Object.entries(a.outcomes)
    .sort((x, y) => y[1] - x[1])
    .map(
      ([k, n]) =>
        `<tr><td>${esc(OUTCOME_LABEL[k] ?? k)}</td><td class="n">${n}</td><td class="n">${num((n / Math.max(1, a.analyzed)) * 100)}%</td><td style="width:34%"><div class="bar" style="width:${Math.round((n / maxOutcome) * 100)}%"></div></td></tr>`,
    )
    .join('')

  const sourceRows = Object.entries(a.bySource)
    .sort((x, y) => y[1].conversations - x[1].conversations)
    .map(
      ([k, b]) =>
        `<tr><td>${esc(SOURCE_LABEL[k] ?? k)}</td><td class="n">${b.conversations}</td><td class="n">${formatMinutes(b.avgFirstResponseMin)}</td><td class="n">${b.unansweredByTeam}</td><td class="n">${b.closed}</td><td class="n">${b.lost}</td><td class="n">${num(b.avgQuality)}</td></tr>`,
    )
    .join('')

  const countRows = (xs: { text: string; count: number }[]) =>
    xs.length
      ? `<table><thead><tr><th>Item</th><th class="n">Conversas</th></tr></thead><tbody>${xs.map((x) => `<tr><td>${esc(x.text)}</td><td class="n">${x.count}</td></tr>`).join('')}</tbody></table>`
      : '<p class="small">Nada a registrar.</p>'

  const link = (id: string) => `<a href="${esc(r.baseUrl.replace(/\/$/, ''))}/inbox?c=${esc(id)}" target="_blank" rel="noopener">Abrir conversa</a>`
  const who = (row: ReportHtmlRow) => esc(row.name || row.phone || 'Contato')

  const byId = new Map(r.rows.map((x) => [x.conversationId, x]))
  const attentionRows = a.attention
    .map((x) => {
      const row = byId.get(x.conversationId)
      return `<tr><td>${row ? who(row) : '—'}</td><td>${esc(x.summary)}<br><span class="small">Próximo passo: ${esc(x.nextAction)}</span></td><td>${link(x.conversationId)}</td></tr>`
    })
    .join('')

  const detailRows = r.rows
    .map(
      (row) =>
        `<tr><td>${who(row)}<br><span class="small">${esc(SOURCE_LABEL[row.source] ?? row.source)}${row.campaign ? ` · ${esc(row.campaign)}` : ''}</span></td><td>${esc(row.outcome ? OUTCOME_LABEL[row.outcome] : 'Não analisada')}</td><td class="n">${row.quality ?? '—'}</td><td class="n">${row.unanswered ? 'Sem resposta' : formatMinutes(row.firstResponseMin)}</td><td>${esc(row.summary)}</td><td>${link(row.conversationId)}</td></tr>`,
    )
    .join('')

  const n = r.narrative

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Rocketing IA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@600&display=swap">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<div class="top">
  <div class="brand">Rocketing <span>IA</span></div>
  <div class="meta">Emitido em ${esc(dateBR(r.finishedAt ?? r.createdAt))}<br>Copiloto IA · Relatório de atendimento<br><button class="theme" id="theme" type="button" title="Alternar tema" aria-label="Alternar tema">◐</button></div>
</div>
<h1>${esc(title)}</h1>
<h2 class="sub">${esc(filters.join(' · '))}</h2>

${
  n
    ? `<div class="note"><b>${esc(n.headline)}</b></div>`
    : '<div class="note">O resumo escrito pela IA não foi gerado. Os números abaixo foram calculados normalmente.</div>'
}

<div class="cards">
  ${card(String(a.conversations), 'Conversas')}
  ${card(String(a.analyzed), 'Analisadas pela IA')}
  ${card(formatMinutes(a.avgFirstResponseMin), '1ª resposta (média)')}
  ${card(formatMinutes(a.medianFirstResponseMin), '1ª resposta (mediana)')}
  ${card(`${num(a.unansweredPct)}%`, 'Sem resposta da equipe')}
  ${card(`${num(a.closedPct)}%`, 'Fechadas')}
  ${card(num(a.avgQuality), 'Nota do atendimento (1 a 5)')}
  ${card(String(a.skipped), 'Não analisadas')}
</div>

${
  n
    ? `<h3>O que os números mostram</h3>${list(n.findings)}<h3>O que fazer</h3>${list(n.recommendations)}`
    : ''
}

<h3>Resultado dos atendimentos</h3>
<table><thead><tr><th>Resultado</th><th class="n">Conversas</th><th class="n">%</th><th></th></tr></thead><tbody>${outcomeRows || '<tr><td colspan="4">Nenhuma conversa analisada.</td></tr>'}</tbody></table>

<h3>Por origem do lead</h3>
<table><thead><tr><th>Origem</th><th class="n">Conversas</th><th class="n">1ª resposta</th><th class="n">Sem resposta</th><th class="n">Fechadas</th><th class="n">Perdidas</th><th class="n">Nota</th></tr></thead><tbody>${sourceRows}</tbody></table>

<h3>Objeções mais frequentes</h3>
${countRows(a.topObjections)}

<h3>Falhas de atendimento mais frequentes</h3>
${countRows(a.topFailures)}

<h3>Leads pedindo ação</h3>
${attentionRows ? `<table><thead><tr><th>Contato</th><th>Situação</th><th></th></tr></thead><tbody>${attentionRows}</tbody></table>` : '<p class="small">Nenhum lead parado com ação sugerida.</p>'}

<h3>Todas as conversas</h3>
<table><thead><tr><th>Contato</th><th>Resultado</th><th class="n">Nota</th><th class="n">1ª resposta</th><th>Resumo</th><th></th></tr></thead><tbody>${detailRows}</tbody></table>

<div class="foot">
  Rocketing IA · Copiloto IA, relatório de atendimento · gerado em ${esc(dateBR(r.finishedAt ?? r.createdAt))}<br>
  Tempos, contagens e comparativos são calculados pelo sistema a partir das mensagens do CRM. Resumos, notas, objeções e falhas são leitura da IA${r.model ? ` (${esc(r.model)})` : ''} e podem conter erros.<br>
  Grupos de WhatsApp foram excluídos. Conversas com menos de 2 mensagens de texto não são analisadas.
</div>
</div>
<script>${THEME_JS}</script>
</body>
</html>`
}
