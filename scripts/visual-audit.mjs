/**
 * Auditoria estrutural — percorre TODAS as seções de cada módulo e da Fundação,
 * em tema claro e escuro, e falha se encontrar:
 *
 *   giant      ícone acima de 40px (SVG sem width/height escala até o contêiner)
 *   glued      textos irmãos encostados, sem separação (o par <b>/<small>)
 *   stretched  avatar de iniciais esticado virando faixa colorida
 *   overflow   elemento fora da viewport, ignorando contêiner rolável
 *
 * Estes foram exatamente os defeitos que passaram em entregas anteriores por
 * terem sido validados só na leitura do CSS. Ler folha de estilo não substitui
 * medir o DOM renderizado.
 *
 * Requisitos: servidor de desenvolvimento no ar e Playwright disponível. O
 * Playwright não é dependência do projeto de propósito — o install do Sites é
 * travado no lockfile e roda no build remoto.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   BASE=http://localhost:5174 node scripts/visual-audit.mjs
 */
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright não encontrado. Instale sem gravar no lockfile:\n" +
    "  npm i --no-save playwright && npx playwright install chromium");
  process.exit(2);
}

const BASE = process.env.BASE || "http://localhost:5174";
const CHROME = process.env.CHROME_PATH || undefined;

// Percorre TODAS as seções de cada módulo e toda a navegação da Fundação.
const routes = [
  { nav: null, segs: [] },
  { nav: "Módulos", segs: [] },
  { nav: "Pessoas e Acessos", segs: [] },
  { nav: "Estrutura", segs: [] },
  { nav: "Permissões e Segurança", segs: [] },
  { nav: "Documentos", segs: [] },
  { nav: "Notificações", segs: [] },
  { nav: "Auditoria", segs: [] },
  { nav: "Banco e Autenticação", segs: [] },
  {
    nav: "Financeiro",
    segs: ["Painel", "Contas a pagar", "Contas a receber", "Fluxo de caixa",
           "Bancos e conciliação", "Centros de custo", "Relatórios", "Homologação"],
  },
  {
    nav: "Recursos Humanos",
    segs: ["Painel", "Colaboradores", "Ponto e jornada", "Férias e ausências",
           "Benefícios", "Saúde e segurança", "Documentos", "Relatórios", "Homologação"],
  },
];

const probe = () => {
  const out = { giant: [], glued: [], stretched: [], overflow: [] };

  // 1. Ícone maior que 40px fora de um gráfico é quase sempre SVG sem tamanho.
  for (const svg of document.querySelectorAll("svg")) {
    const r = svg.getBoundingClientRect();
    if (r.width > 40 || r.height > 40) {
      if (svg.closest(".ds-donut, .ds-columns, .brand, .cash-bars")) continue;
      out.giant.push({
        w: Math.round(r.width), h: Math.round(r.height),
        parent: svg.parentElement?.className || svg.parentElement?.tagName,
      });
    }
  }

  // 2. Texto grudado: irmãos inline sem separação visual entre eles.
  for (const el of document.querySelectorAll("div, span, p, li, section, button")) {
    const kids = [...el.children].filter(c => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && (c.textContent || "").trim().length > 1;
    });
    if (kids.length < 2) continue;
    const style = getComputedStyle(el);
    if (style.display.includes("flex") || style.display.includes("grid")) continue;
    if (el.closest(".sidebar") || el.classList.contains("app-shell")) continue;
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      // Mesma linha e encostados: gap horizontal menor que 2px.
      if (Math.abs(a.top - b.top) < 4 && b.left - a.right < 2 && b.left >= a.left) {
        out.glued.push({
          cls: el.className || el.tagName,
          text: (el.textContent || "").trim().slice(0, 48),
        });
        break;
      }
    }
  }

  // 3. Avatar/ícone quadrado esticado virando faixa.
  for (const el of document.querySelectorAll("i, .avatar, .employee-avatar, [class*='-person'] > i")) {
    const r = el.getBoundingClientRect();
    const bg = getComputedStyle(el).backgroundColor;
    if (r.width > 90 && r.height > 16 && bg !== "rgba(0, 0, 0, 0)" && r.width / r.height > 3) {
      out.stretched.push({ cls: el.className || "i", w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // 4. Estouro horizontal fora de contêiner rolável.
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    let scrollable = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll") { scrollable = true; break; }
    }
    if (scrollable) continue;
    if (r.right > window.innerWidth + 2) {
      out.overflow.push({ cls: el.className || el.tagName, right: Math.round(r.right) });
    }
  }

  const dedupe = a => [...new Map(a.map(x => [JSON.stringify(x), x])).values()].slice(0, 6);
  return { giant: dedupe(out.giant), glued: dedupe(out.glued), stretched: dedupe(out.stretched), overflow: dedupe(out.overflow) };
};

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
let total = 0;

for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: theme });
  const page = await ctx.newPage();

  for (const route of routes) {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector(".app-shell");
    if (route.nav) {
      await page.getByRole("button", { name: route.nav, exact: true }).first().click();
      await page.waitForTimeout(350);
    }
    const steps = route.segs.length ? route.segs : [null];
    for (const seg of steps) {
      if (seg) {
        const tab = page.getByRole("tab", { name: seg, exact: true }).first();
        if (await tab.count()) { await tab.click(); await page.waitForTimeout(300); }
      }
      const found = await page.evaluate(probe);
      const n = found.giant.length + found.glued.length + found.stretched.length + found.overflow.length;
      if (n) {
        total += n;
        console.log(`\n[${theme}] ${route.nav || "Visão Geral"}${seg ? " › " + seg : ""}`);
        for (const [kind, list] of Object.entries(found)) {
          if (list.length) console.log(`  ${kind}: ${JSON.stringify(list)}`);
        }
      }
    }
  }
  await ctx.close();
}

await browser.close();
console.log(total ? `\nTOTAL DE DEFEITOS: ${total}` : "\nNenhum defeito estrutural encontrado.");
process.exitCode = total ? 1 : 0;
