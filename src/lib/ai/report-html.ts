// Relatório de atendimento em HTML único (sem dependências externas além
// das fontes), com a identidade da Rocketing: logo em SVG inline, Playfair
// Display nos títulos, Inter no corpo, ouro só como destaque, tema claro e
// escuro, abas navegáveis (teclado e link direto por hash) e impressão
// limpa. Todo texto vindo de cliente ou da IA passa por esc().

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
.wrap{max-width:1100px;margin:0 auto;padding:48px 40px 80px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:14px;border-bottom:2px solid var(--strong)}
.brand{display:flex;align-items:center;gap:10px;font:600 20px 'Playfair Display',Georgia,serif;color:var(--strong)}
.brand .gold{color:var(--gold)}
.meta{display:flex;align-items:center;gap:12px;text-align:right;font-size:12px;color:var(--muted)}
.theme{width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--strong);cursor:pointer;flex:0 0 auto}
h1{font:600 34px/1.2 'Playfair Display',Georgia,serif;color:var(--strong);margin:28px 0 4px}
h2.sub{font:400 16px Inter,sans-serif;color:var(--muted);margin:0 0 20px}
h3{font:600 20px 'Playfair Display',Georgia,serif;color:var(--strong);margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:thin;border-bottom:1px solid var(--line);margin:8px 0 24px;position:sticky;top:0;background:var(--bg);z-index:5}
.tab-btn{flex:0 0 auto;white-space:nowrap;background:none;border:0;border-bottom:2px solid transparent;padding:12px 16px;margin-bottom:-1px;font:500 14px Inter,sans-serif;color:var(--muted);cursor:pointer}
.tab-btn:hover{color:var(--strong)}
.tab-btn[aria-selected=true]{color:var(--strong);border-bottom-color:var(--gold)}
.tab-btn:focus-visible{outline:2px solid var(--gold);outline-offset:-2px}
.tab-panel[hidden]{display:none}
.count{display:inline-block;margin-left:6px;padding:0 7px;border-radius:10px;background:var(--card);border:1px solid var(--line);font-size:11px;color:var(--muted)}
.note{background:var(--card);border-left:3px solid var(--gold);padding:14px 18px;margin:0 0 18px}
.note b{color:var(--strong)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
.card{background:var(--card);border:1px solid var(--line);padding:16px 14px}
.card .v{font:600 28px 'Playfair Display',Georgia,serif;color:var(--strong);font-variant-numeric:tabular-nums}
.card .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0}
th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--strong);padding:9px 10px;white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:1px solid var(--strong)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
ul.plain{margin:6px 0;padding-left:20px}
ul.plain li{margin:6px 0}
.bar{height:8px;background:var(--gold);opacity:.78;min-width:2px}
.search{width:100%;max-width:340px;height:36px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--strong);padding:0 12px;font:14px Inter,sans-serif;margin:4px 0 10px}
.foot{margin-top:48px;padding-top:14px;border-top:2px solid var(--strong);font-size:11px;color:var(--muted);text-align:center;line-height:1.7}
.foot .sig{display:inline-flex;align-items:center;gap:6px;margin-bottom:6px;color:var(--strong);font:600 13px 'Playfair Display',Georgia,serif}
.small{font-size:12px;color:var(--muted)}
@media (max-width:720px){.wrap{padding:28px 16px 60px}.cards{grid-template-columns:repeat(2,1fr)}.tab-btn{padding:10px 12px}h1{font-size:26px}table{font-size:12px}.meta .txt{display:none}}
@media print{
:root,:root[data-theme=dark]{--gold:#B8902A;--bg:#FFFFFF;--card:#FAF8F4;--strong:#1A1A1A;--text:#333333;--muted:#5C5C5C;--line:#E3DDD0}
.theme,.tabs,.search{display:none}
.wrap{padding:0}
.tab-panel[hidden]{display:block!important}
.tab-panel{page-break-before:always}
.tab-panel:first-of-type{page-break-before:auto}
tr{page-break-inside:avoid}
body{background:#fff}
}
`

const TABS_JS = `(function(){
var key='rocketing-report-theme',root=document.documentElement;
try{var saved=localStorage.getItem(key);if(saved)root.setAttribute('data-theme',saved)}catch(e){}
document.getElementById('theme').addEventListener('click',function(){
var dark=root.getAttribute('data-theme')==='dark'||(!root.getAttribute('data-theme')&&matchMedia('(prefers-color-scheme:dark)').matches);
var next=dark?'light':'dark';root.setAttribute('data-theme',next);try{localStorage.setItem(key,next)}catch(e){}});
var tabs=Array.prototype.slice.call(document.querySelectorAll('[role=tab]'));
function show(id,focus){
tabs.forEach(function(t){var on=t.getAttribute('aria-controls')===id;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;
var p=document.getElementById(t.getAttribute('aria-controls'));if(p)p.hidden=!on;
if(on){try{t.scrollIntoView({inline:'center',block:'nearest'})}catch(e){}if(focus)t.focus()}});}
tabs.forEach(function(t,i){
t.addEventListener('click',function(){var id=t.getAttribute('aria-controls');show(id);history.replaceState(null,'','#'+id)});
t.addEventListener('keydown',function(e){var n=null;
if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;
else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;
if(n!==null){e.preventDefault();var id=tabs[n].getAttribute('aria-controls');show(id,true);history.replaceState(null,'','#'+id)}})});
var h=(location.hash||'').slice(1);var ids=tabs.map(function(t){return t.getAttribute('aria-controls')});
show(ids.indexOf(h)>=0?h:ids[0]);
window.addEventListener('hashchange',function(){var x=(location.hash||'').slice(1);if(ids.indexOf(x)>=0)show(x)});
var q=document.getElementById('q');
if(q)q.addEventListener('input',function(){var v=q.value.toLowerCase();
document.querySelectorAll('#conv-body tr').forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(v)>=0?'':'none'})});
})();`

/** Logo da Rocketing (SVG inline, sem arquivo externo). `gid` evita id repetido. */
function logo(size: number, gid: string): string {
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" role="img" aria-label="Rocketing IA"><rect width="100" height="100" rx="22" fill="url(#${gid})"/><g transform="translate(50, 50) scale(1.5) translate(-26, -28)"><path d="M26 5 L36 24 L26 20 L16 24 Z" fill="#080808"/><path d="M16 24 L11 35 L20 30 Z" fill="#1A1A1A"/><path d="M36 24 L41 35 L32 30 Z" fill="#1A1A1A"/><path d="M20 30 L26 20 L32 30 L26 46 Z" fill="#242424"/><path d="M23 43 L26 50 L29 43 L26 40 Z" fill="#080808" opacity="0.7"/><circle cx="26" cy="19" r="3" fill="#D4AF70"/><circle cx="26" cy="19" r="1.5" fill="#EDD9A3"/></g><defs><linearGradient id="${gid}" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#D4AF70"/><stop offset="100%" stop-color="#B8902A"/></linearGradient></defs></svg>`
}

function card(value: string, label: string): string {
  return `<div class="card"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`
}

function list(items: string[]): string {
  return items.length ? `<ul class="plain">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="small">Nada a registrar.</p>'
}

export function buildReportHtml(r: ReportHtmlInput): string {
  const a = r.aggregate
  const title = r.mode === 'keyword' ? `Atendimento dos leads que escreveram “${r.keyword ?? ''}”` : 'Atendimento: histórico completo'
  const issued = dateBR(r.finishedAt ?? r.createdAt)

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

  const countTable = (xs: { text: string; count: number }[]) =>
    xs.length
      ? `<table><thead><tr><th>Item</th><th class="n">Conversas</th></tr></thead><tbody>${xs.map((x) => `<tr><td>${esc(x.text)}</td><td class="n">${x.count}</td></tr>`).join('')}</tbody></table>`
      : '<p class="small">Nada a registrar.</p>'

  const who = (row: ReportHtmlRow) => esc(row.name || row.phone || 'Contato')
  const phoneLine = (row: ReportHtmlRow) => (row.name && row.phone ? `<br><span class="small">${esc(row.phone)}</span>` : '')
  const byId = new Map(r.rows.map((x) => [x.conversationId, x]))

  const attentionRows = a.attention
    .map((x) => {
      const row = byId.get(x.conversationId)
      return `<tr><td>${row ? who(row) + phoneLine(row) : '—'}</td><td>${esc(OUTCOME_LABEL[x.outcome] ?? x.outcome)}</td><td>${esc(x.summary)}</td><td>${esc(x.nextAction)}</td></tr>`
    })
    .join('')

  const detailRows = r.rows
    .map(
      (row) =>
        `<tr><td>${who(row)}${phoneLine(row)}<br><span class="small">${esc(SOURCE_LABEL[row.source] ?? row.source)}${row.campaign ? ` · ${esc(row.campaign)}` : ''}</span></td><td>${esc(row.outcome ? OUTCOME_LABEL[row.outcome] : 'Não analisada')}</td><td class="n">${row.quality ?? '—'}</td><td class="n">${row.unanswered ? 'Sem resposta' : formatMinutes(row.firstResponseMin)}</td><td>${esc(row.summary)}</td></tr>`,
    )
    .join('')

  const n = r.narrative

  const panels: { id: string; label: string; html: string }[] = [
    {
      id: 'tab-resumo',
      label: 'Resumo',
      html: `${
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
${n ? `<h3>O que os números mostram</h3>${list(n.findings)}<h3>O que fazer</h3>${list(n.recommendations)}` : ''}`,
    },
    {
      id: 'tab-resultado',
      label: 'Resultado',
      html: `<h3>Resultado dos atendimentos</h3>
<div class="scroll"><table><thead><tr><th>Resultado</th><th class="n">Conversas</th><th class="n">%</th><th></th></tr></thead><tbody>${outcomeRows || '<tr><td colspan="4">Nenhuma conversa analisada.</td></tr>'}</tbody></table></div>`,
    },
    {
      id: 'tab-origem',
      label: 'Por origem',
      html: `<h3>Comparação por origem do lead</h3>
<div class="scroll"><table><thead><tr><th>Origem</th><th class="n">Conversas</th><th class="n">1ª resposta</th><th class="n">Sem resposta</th><th class="n">Fechadas</th><th class="n">Perdidas</th><th class="n">Nota</th></tr></thead><tbody>${sourceRows}</tbody></table></div>`,
    },
    {
      id: 'tab-objecoes',
      label: 'Objeções e falhas',
      html: `<h3>Objeções mais frequentes</h3>${countTable(a.topObjections)}<h3>Falhas de atendimento mais frequentes</h3>${countTable(a.topFailures)}`,
    },
    {
      id: 'tab-acao',
      label: `Leads pedindo ação<span class="count">${a.attention.length}</span>`,
      html: `<h3>Leads pedindo ação</h3>${
        attentionRows
          ? `<div class="scroll"><table><thead><tr><th>Contato</th><th>Resultado</th><th>Situação</th><th>Próximo passo</th></tr></thead><tbody>${attentionRows}</tbody></table></div>`
          : '<p class="small">Nenhum lead parado com ação sugerida.</p>'
      }`,
    },
    {
      id: 'tab-conversas',
      label: `Todas as conversas<span class="count">${r.rows.length}</span>`,
      html: `<h3>Todas as conversas</h3>
<input id="q" class="search" type="search" placeholder="Buscar por nome, telefone ou resumo" aria-label="Buscar nas conversas">
<div class="scroll"><table><thead><tr><th>Contato</th><th>Resultado</th><th class="n">Nota</th><th class="n">1ª resposta</th><th>Resumo</th></tr></thead><tbody id="conv-body">${detailRows}</tbody></table></div>`,
    },
  ]

  const tabButtons = panels
    .map(
      (p, i) =>
        `<button class="tab-btn" role="tab" id="btn-${p.id}" aria-controls="${p.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" type="button">${p.label}</button>`,
    )
    .join('')
  const panelHtml = panels
    .map((p, i) => `<section class="tab-panel" role="tabpanel" id="${p.id}" aria-labelledby="btn-${p.id}"${i === 0 ? '' : ' hidden'}>${p.html}</section>`)
    .join('\n')

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
  <div class="brand">${logo(36, 'goldGradTop')}<span><span class="gold">Rocketing</span> IA</span></div>
  <div class="meta"><span class="txt">Emitido em ${esc(issued)}<br>Copiloto IA · Relatório de atendimento</span><button class="theme" id="theme" type="button" title="Alternar tema" aria-label="Alternar tema">◐</button></div>
</div>
<h1>${esc(title)}</h1>
<h2 class="sub">${esc(filters.join(' · '))}</h2>

<div class="tabs" role="tablist" aria-label="Seções do relatório">${tabButtons}</div>
${panelHtml}

<div class="foot">
  <div class="sig">${logo(22, 'goldGradFoot')}<span>Rocketing IA</span></div><br>
  Copiloto IA, relatório de atendimento · gerado em ${esc(issued)}<br>
  Tempos, contagens e comparativos são calculados pelo sistema a partir das mensagens do CRM. Resumos, notas, objeções e falhas são leitura da IA${r.model ? ` (${esc(r.model)})` : ''} e podem conter erros.<br>
  Grupos de WhatsApp foram excluídos. Conversas com menos de 2 mensagens de texto não são analisadas. Este arquivo contém nomes e telefones de leads: compartilhe com cuidado.
</div>
</div>
<script>${TABS_JS}</script>
</body>
</html>`
}
