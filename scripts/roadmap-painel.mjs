#!/usr/bin/env node
// Gera o painel do roadmap (HTML) a partir de docs/ROADMAP.md.
// O painel nunca é editado à mão: muda o ROADMAP.md, roda isto e republica.
//
//   node scripts/roadmap-painel.mjs <saida.html>

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(path.join(raiz, 'docs/ROADMAP.md'), 'utf8');
const saida = process.argv[2];
if (!saida) { console.error('uso: node scripts/roadmap-painel.mjs <saida.html>'); process.exit(1); }

// ---------- leitura do markdown ----------
const linhas = md.split('\n');
const celulas = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** Tabelas que aparecem depois de um título (até o próximo título do mesmo nível ou acima). */
function tabelasDe(titulo, nivelParada = 2) {
  const ini = linhas.findIndex((l) => l.startsWith('#') && l.includes(titulo));
  if (ini < 0) throw new Error(`seção não encontrada: ${titulo}`);
  const out = [];
  let atual = null;
  let rotulo = null;
  for (let i = ini + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const m = l.match(/^(#+) /);
    if (m && m[1].length <= nivelParada) break;
    if (m) rotulo = l.replace(/^#+ /, '');
    const negrito = l.match(/^\*\*(.+?)\*\*/);
    if (negrito && !l.startsWith('|')) rotulo = negrito[1];
    if (l.startsWith('|')) {
      if (!atual) { atual = { rotulo, cab: celulas(l), linhas: [] }; continue; }
      if (/^\|[\s:|-]+\|$/.test(l.trim())) continue;
      atual.linhas.push(Object.fromEntries(atual.cab.map((c, k) => [c, celulas(l)[k] ?? ''])));
    } else if (atual) { out.push(atual); atual = null; }
  }
  if (atual) out.push(atual);
  return out;
}

const quadro = tabelasDe('0. Quadro de agora');
const pegar = (inicio) => quadro.find((t) => t.rotulo?.startsWith(inicio))?.linhas ?? [];
const emConstrucao = pegar('Em construção');
const proximos = pegar('Próximos 5');
const travados = pegar('Travados');
const decisoes = pegar('Decisões pendentes');
const pedidos = pegar('Pedidos à equipe');

const raias = tabelasDe('3. Itens por raia', 2).map((t) => ({
  nome: t.rotulo,
  itens: t.linhas.map((r) => ({
    cod: r.Item, oque: r['O quê'], marco: r.Marco, V: r.V, D: r.D, E: r.E, R: r.R,
    nota: r.Nota === '—' ? null : Number(r.Nota.replace(',', '.')),
    situacao: r['Situação'], depende: r['Depende de'], detalhe: r.Detalhe,
  })),
}));
const entregue = tabelasDe('4. Entregue')[0]?.linhas ?? [];
const naoFazer = tabelasDe('5. Não fazer')[0]?.linhas ?? [];
const registro = tabelasDe('8. Registro')[0]?.linhas ?? [];
const atualizado = registro.at(-1)?.Data ?? '';

const itens = raias.flatMap((r) => r.itens.map((i) => ({ ...i, raia: r.nome })));

// ---------- números dos marcos ----------
const GRUPO = {
  'em construção': 'andando', 'próximo': 'andando',
  'na fila': 'pronto',
  'decisão': 'espera', 'pedido à equipe': 'espera',
  'travado': 'travado',
};
const ROTULO_GRUPO = { andando: 'Em construção ou próximo', pronto: 'Pode começar (na fila)', espera: 'Espera decisão ou dado da equipe', travado: 'Travado' };
const marcos = ['1', '2', '+'].map((m) => {
  const lista = itens.filter((i) => i.marco === m);
  const grupos = Object.fromEntries(Object.keys(ROTULO_GRUPO).map((g) => [g, lista.filter((i) => GRUPO[i.situacao] === g).length]));
  const semanas = lista.reduce((s, i) => s + (Number(String(i.E).replace(',', '.')) || 0), 0);
  return { m, total: lista.length, grupos, semanas };
});

// ---------- HTML ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
const pill = (sit) => `<span class="pill s-${slug(sit)}">${esc(sit)}</span>`;
const NOME_MARCO = { '1': 'Marco 1 · GRV desligado', '2': 'Marco 2 · Pronta para escalar', '+': 'Fora do caminho crítico' };
const DESC_MARCO = {
  '1': 'Uma semana inteira de pedidos, OS, notas, compras, estoque e financeiro só pela plataforma e pela Forja.',
  '2': 'Uma segunda empresa de teste criada do zero, sem nenhum código ou texto da PecSil fixo.',
  '+': 'Melhorias de valor que entram quando abre uma frente livre.',
};

const cartaoMarco = (k) => {
  const barra = Object.keys(ROTULO_GRUPO).map((g) => k.grupos[g] ? `<span class="seg g-${g}" style="flex:${k.grupos[g]}" title="${esc(ROTULO_GRUPO[g])}: ${k.grupos[g]}"></span>` : '').join('');
  const legenda = Object.keys(ROTULO_GRUPO).map((g) => `<li><span class="dot g-${g}"></span>${esc(ROTULO_GRUPO[g])} <b>${k.grupos[g]}</b></li>`).join('');
  return `<article class="marco${k.m === '+' ? ' marco-mais' : ''}">
    <header><h3>${esc(NOME_MARCO[k.m])}</h3><p>${esc(DESC_MARCO[k.m])}</p></header>
    <div class="nums"><div><b>${k.total}</b><span>itens em aberto</span></div><div><b>~${fmt(k.semanas)}</b><span>semanas de construção</span></div></div>
    <div class="barra" role="img" aria-label="Distribuição por situação">${barra}</div>
    <ul class="leg">${legenda}</ul>
  </article>`;
};

const cartaoItem = (i) => `<li class="item" data-marco="${esc(i.marco)}" data-grupo="${GRUPO[i.situacao] ?? 'outro'}">
  <div class="item-top"><span class="cod">${esc(i.cod)}</span>${pill(i.situacao)}<span class="mk mk-${i.marco === '+' ? 'mais' : i.marco}">${i.marco === '+' ? '+' : 'M' + esc(i.marco)}</span></div>
  <p class="oque">${inline(i.oque)}</p>
  <div class="item-pe">
    ${i.nota != null ? `<span class="nota" title="(V + 2·D) ÷ E — V${esc(i.V)} D${esc(i.D)} E${esc(i.E)} R${esc(i.R)}"><b>${fmt(i.nota)}</b> V${esc(i.V)}·D${esc(i.D)}·E${esc(i.E)}·R${esc(i.R)}</span>` : '<span class="nota nota-vazia">sem nota</span>'}
    ${i.depende && i.depende !== '—' ? `<span class="dep">depende de ${inline(i.depende)}</span>` : ''}
  </div>
</li>`;

const html = `<title>Roadmap PecSil</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{
  --bg:#f3f1ee; --surface:#fffdfa; --surface-2:#ebe7e1; --fg:#1f2326; --muted:#5f666b; --line:#d8d2ca;
  --accent:#c2410c; --accent-soft:#fbe5d6;
  --g-andando:#c2410c; --g-pronto:#3f6f8f; --g-espera:#b7891b; --g-travado:#8c3a3a;
  --s-andando-bg:#fbe5d6; --s-pronto-bg:#dde9f1; --s-espera-bg:#f6ecd0; --s-travado-bg:#f2dcdc; --s-neutro-bg:#e7e3dd;
  --m1:#c2410c; --m2:#3f6f8f; --mmais:#7a7f84;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#15181a; --surface:#1d2124; --surface-2:#262b2f; --fg:#e8e4de; --muted:#9aa1a6; --line:#33393e;
  --accent:#f0884f; --accent-soft:#3a2418;
  --g-andando:#f0884f; --g-pronto:#79a9cb; --g-espera:#d9b25a; --g-travado:#d27b7b;
  --s-andando-bg:#3a2418; --s-pronto-bg:#1f3140; --s-espera-bg:#3a3019; --s-travado-bg:#3d2324; --s-neutro-bg:#2b3034;
  --m1:#f0884f; --m2:#79a9cb; --mmais:#9aa1a6; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#15181a; --surface:#1d2124; --surface-2:#262b2f; --fg:#e8e4de; --muted:#9aa1a6; --line:#33393e;
  --accent:#f0884f; --accent-soft:#3a2418;
  --g-andando:#f0884f; --g-pronto:#79a9cb; --g-espera:#d9b25a; --g-travado:#d27b7b;
  --s-andando-bg:#3a2418; --s-pronto-bg:#1f3140; --s-espera-bg:#3a3019; --s-travado-bg:#3d2324; --s-neutro-bg:#2b3034;
  --m1:#f0884f; --m2:#79a9cb; --mmais:#9aa1a6; color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:15px/1.5 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;margin:0}
.wrap{max-width:1180px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:40px}
h1,h2,h3{text-wrap:balance;margin:0;line-height:1.2}
h1{font-size:clamp(26px,4vw,34px);font-weight:700;letter-spacing:-.01em}
h2{font-size:20px;font-weight:600}
h3{font-size:16px;font-weight:600}
code,.cod,.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}
code{font-size:.88em;background:var(--surface-2);padding:1px 5px;border-radius:4px}
.eyebrow{font:600 12px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.topo{display:grid;gap:10px}
.topo p{margin:0;color:var(--muted);max-width:68ch}
.formula{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.formula b{font-family:"IBM Plex Mono",monospace;color:var(--fg);background:var(--surface);border:1px solid var(--line);padding:3px 8px;border-radius:6px}
section{display:grid;gap:16px;min-width:0}
.sec-cab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.sec-cab p{margin:0;color:var(--muted);font-size:13px}
.marcos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
.marco{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;display:grid;gap:14px;border-top:4px solid var(--m1)}
.marco:nth-child(2){border-top-color:var(--m2)} .marco-mais{border-top-color:var(--mmais)}
.marco header{display:grid;gap:4px} .marco header p{margin:0;color:var(--muted);font-size:13px}
.nums{display:flex;gap:28px}
.nums div{display:grid} .nums b{font:600 28px/1.1 "IBM Plex Mono",monospace} .nums span{font-size:12px;color:var(--muted)}
.barra{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--surface-2);gap:2px}
.seg{display:block;min-width:4px}
.g-andando{background:var(--g-andando)} .g-pronto{background:var(--g-pronto)} .g-espera{background:var(--g-espera)} .g-travado{background:var(--g-travado)}
.leg{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:13px;color:var(--muted)}
.leg li{display:flex;align-items:center;gap:8px} .leg b{color:var(--fg);margin-left:auto;font-family:"IBM Plex Mono",monospace}
.dot{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none}
.agora{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:20px}
@media (max-width:860px){.agora{grid-template-columns:minmax(0,1fr)}}
.painel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;display:grid;gap:12px;align-content:start;min-width:0}
.fila{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:f}
.fila li{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:12px;align-items:start;padding:10px 0;border-top:1px solid var(--line)}
.fila li:first-child{border-top:0}
.fila .n{font:600 20px/1 "IBM Plex Mono",monospace;color:var(--accent)}
.fila .t{display:grid;gap:2px} .fila .t span{font-size:13px;color:var(--muted)}
.fila .sc{font:600 15px/1 "IBM Plex Mono",monospace;background:var(--accent-soft);color:var(--accent);padding:5px 8px;border-radius:6px}
.construindo{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:10px 12px;border-radius:8px;background:var(--s-andando-bg)}
.construindo span{font-size:13px;color:var(--muted)}
.tab{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font:600 11.5px/1.3 "IBM Plex Mono",monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--surface-2);white-space:nowrap}
tr:last-child td{border-bottom:0}
.filtros{display:flex;gap:8px;flex-wrap:wrap}
.chip{font:500 13px/1 "IBM Plex Sans",sans-serif;border:1px solid var(--line);background:var(--surface);color:var(--fg);padding:8px 12px;border-radius:999px;cursor:pointer}
.chip:hover{border-color:var(--accent)}
.chip[aria-pressed="true"]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.raias{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:18px;align-items:start}
.raia{display:grid;gap:10px;min-width:0}
.raia h3{display:flex;justify-content:space-between;gap:8px;padding-bottom:6px;border-bottom:2px solid var(--fg)}
.raia h3 small{font:500 12px/1.6 "IBM Plex Mono",monospace;color:var(--muted)}
.raia ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.item{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:11px 12px;display:grid;gap:6px}
.item-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cod{font-weight:600;font-size:13px}
.mk{margin-left:auto;font:600 11px/1 "IBM Plex Mono",monospace;padding:3px 6px;border-radius:4px;border:1px solid currentColor}
.mk-1{color:var(--m1)} .mk-2{color:var(--m2)} .mk-mais{color:var(--mmais)}
.oque{margin:0;font-size:14px}
.item-pe{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted);align-items:center}
.nota{font-family:"IBM Plex Mono",monospace} .nota b{color:var(--fg);font-size:13px}
.pill{font:500 12px/1 "IBM Plex Sans",sans-serif;padding:4px 8px;border-radius:999px;background:var(--s-neutro-bg);color:var(--fg);white-space:nowrap}
.s-em-construcao,.s-proximo{background:var(--s-andando-bg);color:var(--g-andando)}
.s-na-fila{background:var(--s-pronto-bg);color:var(--g-pronto)}
.s-decisao,.s-pedido-a-equipe{background:var(--s-espera-bg);color:var(--g-espera)}
.s-travado{background:var(--s-travado-bg);color:var(--g-travado)}
.vazio{color:var(--muted);font-size:13px;margin:0}
.duas{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:20px}
details{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
summary{cursor:pointer;font-weight:600}
details .tab{margin-top:12px;border:0}
footer{color:var(--muted);font-size:12.5px;border-top:1px solid var(--line);padding-top:16px}
</style>

<div class="wrap">
  <header class="topo">
    <span class="eyebrow">PecSil Business OS + Forja · atualizado em ${esc(atualizado)}</span>
    <h1>Roadmap único</h1>
    <p>Uma linha só até a plataforma pronta: primeiro desligar o GRV, depois ficar pronta para outra empresa. Cada item tem a nota de prioridade abaixo; mudar a ordem é mudar uma nota.</p>
    <div class="formula"><b>Nota = (V + 2·D) ÷ E</b> V valor · D destrava o marco · E semanas · R risco (R3 só entra com a dependência resolvida)</div>
  </header>

  <section aria-labelledby="h-marcos">
    <div class="sec-cab"><h2 id="h-marcos">Linha de chegada</h2><p>Itens em aberto e semanas de construção somadas (E).</p></div>
    <div class="marcos">${marcos.map(cartaoMarco).join('')}</div>
  </section>

  <section aria-labelledby="h-agora">
    <div class="sec-cab"><h2 id="h-agora">Agora</h2><p>No máximo 3 frentes em construção.</p></div>
    <div class="agora">
      <div class="painel">
        <h3>Em construção</h3>
        ${emConstrucao.map((r) => `<div class="construindo"><span class="cod">${esc(r.Item)}</span> ${inline(r['O quê'])} <span>${inline(r['Situação'])}</span></div>`).join('') || '<p class="vazio">Nada em construção.</p>'}
        <h3>Próximos 5</h3>
        <ol class="fila">${proximos.map((r) => `<li><span class="n">${esc(r.Ordem)}</span><div class="t"><strong><span class="cod">${esc(r.Item)}</span> ${inline(r['O quê'])}</strong><span>${inline(r['Por que agora'])}</span></div><span class="sc">${esc(r.Nota)}</span></li>`).join('')}</ol>
      </div>
      <div class="painel">
        <h3>Travados</h3>
        <div class="tab"><table><thead><tr><th>Item</th><th>Travado por</th><th>Quem destrava</th></tr></thead><tbody>
          ${travados.map((r) => `<tr><td>${inline(r.Item)}</td><td>${inline(r['Travado por'])}</td><td>${inline(r['Quem destrava'])}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>
  </section>

  <div class="duas">
    <section aria-labelledby="h-dec">
      <div class="sec-cab"><h2 id="h-dec">Decisões pendentes do proprietário</h2><p>${decisoes.length} decisões</p></div>
      <div class="tab"><table><thead><tr><th>Decisão</th><th>Destrava</th></tr></thead><tbody>
        ${decisoes.map((r) => `<tr><td>${inline(r['Decisão'])}</td><td class="mono">${inline(r.Destrava)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section aria-labelledby="h-ped">
      <div class="sec-cab"><h2 id="h-ped">Pedidos à equipe</h2><p>Dados, não construção</p></div>
      <div class="tab"><table><thead><tr><th>Quem</th><th>O quê</th><th>Destrava</th></tr></thead><tbody>
        ${pedidos.map((r) => `<tr><td><strong>${inline(r.Quem)}</strong></td><td>${inline(r['O quê'])}</td><td class="mono">${inline(r.Destrava)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
  </div>

  <section aria-labelledby="h-raias">
    <div class="sec-cab"><h2 id="h-raias">Itens por raia</h2><p>${itens.length} itens · passe o mouse na nota para ver a conta</p></div>
    <div class="filtros" role="group" aria-label="Filtrar por marco">
      <button class="chip" data-f="marco" data-v="todos" aria-pressed="true">Todos</button>
      <button class="chip" data-f="marco" data-v="1" aria-pressed="false">Marco 1</button>
      <button class="chip" data-f="marco" data-v="2" aria-pressed="false">Marco 2</button>
      <button class="chip" data-f="marco" data-v="+" aria-pressed="false">Fora do caminho (+)</button>
    </div>
    <div class="filtros" role="group" aria-label="Filtrar por situação">
      <button class="chip" data-f="grupo" data-v="todos" aria-pressed="true">Qualquer situação</button>
      ${Object.entries(ROTULO_GRUPO).map(([g, r]) => `<button class="chip" data-f="grupo" data-v="${g}" aria-pressed="false">${esc(r)}</button>`).join('')}
    </div>
    <div class="raias">
      ${raias.map((r) => `<div class="raia"><h3>${esc(r.nome)} <small>${r.itens.length}</small></h3><ul>${[...r.itens].sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1)).map(cartaoItem).join('')}</ul><p class="vazio" hidden>Nenhum item com este filtro.</p></div>`).join('')}
    </div>
  </section>

  <section aria-labelledby="h-hist">
    <div class="sec-cab"><h2 id="h-hist">Entregue</h2><p>Histórico com os commits</p></div>
    <div class="tab"><table><thead><tr><th>Quando</th><th>O quê</th><th>Commit</th></tr></thead><tbody>
      ${entregue.map((r) => `<tr><td class="mono">${esc(r.Quando)}</td><td>${inline(r['O quê'])}</td><td>${inline(r.Commit)}</td></tr>`).join('')}
    </tbody></table></div>
    <details><summary>Não fazer (decidido) · ${naoFazer.length}</summary>
      <div class="tab"><table><thead><tr><th>O quê</th><th>Por quê</th></tr></thead><tbody>
        ${naoFazer.map((r) => `<tr><td>${inline(r['O quê'])}</td><td>${inline(r['Por quê'])}</td></tr>`).join('')}
      </tbody></table></div>
    </details>
  </section>

  <footer>Gerado de <code>docs/ROADMAP.md</code> por <code>scripts/roadmap-painel.mjs</code>. Não edite esta página: mude o documento e republique.</footer>
</div>

<script>
(() => {
  const filtro = { marco: 'todos', grupo: 'todos' };
  const aplicar = () => {
    document.querySelectorAll('.raia').forEach((raia) => {
      let visiveis = 0;
      raia.querySelectorAll('.item').forEach((it) => {
        const ok = (filtro.marco === 'todos' || it.dataset.marco === filtro.marco) && (filtro.grupo === 'todos' || it.dataset.grupo === filtro.grupo);
        it.hidden = !ok; if (ok) visiveis++;
      });
      raia.querySelector('.vazio').hidden = visiveis > 0;
    });
  };
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    filtro[b.dataset.f] = b.dataset.v;
    document.querySelectorAll('.chip[data-f="' + b.dataset.f + '"]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    aplicar();
  }));
})();
</script>
`;

writeFileSync(saida, html);
console.log(JSON.stringify({ itens: itens.length, raias: raias.length, proximos: proximos.length, travados: travados.length, decisoes: decisoes.length, pedidos: pedidos.length, entregue: entregue.length, marcos }, null, 1));
