/**
 * Auditoria visual estrutural — mede o DOM renderizado de TODAS as telas da
 * plataforma, logado, em várias larguras e nos dois temas, e falha se achar:
 *
 *   overflow   elemento além da largura da janela (fora de contêiner rolável)
 *   escape     elemento saindo do cartão/gaveta/modal que o contém
 *   clipped    conteúdo cortado por um ancestral com overflow oculto
 *   wrapped    linha de tabela em grade com mais filhos que colunas (item "caiu")
 *   overlap    irmãos em fluxo normal sobrepostos
 *   distorted  avatar de iniciais esticado (faixa) ou achatado
 *   giant      ícone SVG acima de 40px (SVG sem tamanho escala até o contêiner)
 *   glued      textos irmãos encostados, sem separação
 *   tap        (só celular) alvo de toque menor que 32px — aviso, não falha
 *   console    erro de página ou de console
 *
 * Ler a folha de estilo não substitui medir o DOM: foram defeitos assim que
 * passaram em entregas anteriores.
 *
 * Requisitos: Playwright disponível (não é dependência do projeto de propósito)
 * e uma conta com acesso a todas as telas em QA_EMAIL / QA_PASSWORD (.env.local).
 *
 *   BASE=https://home.pecsil.com.br node scripts/visual-audit.mjs
 *   BASE=http://localhost:3000 OUT=/tmp/audit ONLY="Recursos Humanos" node scripts/visual-audit.mjs
 *
 * Variáveis: BASE, OUT (pasta de saída), ONLY (filtra telas pelo nome),
 * WIDTHS (ex.: "1440,390"), CHROME_PATH.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright não encontrado. Instale sem gravar no lockfile:\n" +
    "  npm i --no-save playwright && npx playwright install chromium");
  process.exit(2);
}

const env = { ...process.env };
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i < 0) continue;
    const key = t.slice(0, i).trim();
    if (env[key] === undefined) env[key] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

const BASE = (env.BASE || "http://localhost:3000").replace(/\/$/, "");
const OUT = env.OUT || "/tmp/pecsil-visual-audit";
const ONLY = env.ONLY || "";
const CHROME = env.CHROME_PATH || (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
const WIDTHS = (env.WIDTHS || "1440,1024,768,390,360").split(",").map(Number);
/** Tema escuro só nas larguras extremas: o layout é o mesmo, muda a cor. */
const DARK_WIDTHS = new Set([Math.max(...WIDTHS), Math.min(...WIDTHS)]);
const MOBILE_MAX = 860;
/** Raiz das camadas abertas (gaveta, formulário, menu): auditadas isoladamente. */
const LAYER_ROOT = ".employee-layer, .form-layer, .finance-layer, .hr-layer, .persona-menu, .pwa-ios-modal-overlay";

if (!env.QA_EMAIL || !env.QA_PASSWORD) {
  console.error("Defina QA_EMAIL e QA_PASSWORD (conta com acesso a todas as telas).");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

/**
 * Camadas abertas a partir de uma tela: gaveta, formulário ou menu. `tabs`
 * percorre abas internas. Selecionadas pelo nome da tela + subseção.
 */
const LAYERS = {
  "Recursos Humanos › Colaboradores": [{ name: "Ficha do colaborador", open: ".hr-people-table > button", tabs: ".employee-tabs button", close: "Escape" }],
  "Recursos Humanos › Feriados": [{ name: "Editar feriado", open: ".holiday-row", close: "Escape" }],
  "Recursos Humanos › Documentos": [{ name: "Documento", open: ".doc-table > button", close: "Escape" }],
  "Recursos Humanos › Férias e ausências": [{ name: "Ausência", open: ".absence-table > button", close: "Escape" }],
  "Visão Geral": [{ name: "Menu da conta", open: ".user-card", close: ".user-card" }],
};

// ---------------------------------------------------------------------------
// Sonda executada dentro da página
// ---------------------------------------------------------------------------
const probe = ({ mobile, root, width }) => {
  // Cache: getComputedStyle/getBoundingClientRect repetidos em milhares de nós
  // (e em cada ancestral) tornavam a varredura lenta demais.
  const styles = new Map();
  const rects = new Map();
  const CS = el => { let v = styles.get(el); if (!v) { v = getComputedStyle(el); styles.set(el, v); } return v; };
  const RECT = el => { let v = rects.get(el); if (!v) { v = el.getBoundingClientRect(); rects.set(el, v); } return v; };
  const found = { overflow: [], escape: [], clipped: [], wrapped: [], overlap: [], distorted: [], giant: [], glued: [], tap: [] };
  // Largura configurada, não innerWidth: no modo celular o navegador alarga a
  // área de layout até caber o conteúdo que estoura, escondendo o defeito.
  const W = width;
  if (!root && document.documentElement.scrollWidth > W + 1) {
    found.overflow.push(`página com ${document.documentElement.scrollWidth}px em tela de ${W}px`);
  }

  const describe = el => {
    const part = node => {
      if (!node || node === document.body) return "";
      const cls = typeof node.className === "string" ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
      return node.tagName.toLowerCase() + (cls ? "." + cls : "");
    };
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${part(el.parentElement)} > ${part(el)}${text ? ` "${text}"` : ""}`;
  };
  const visible = el => {
    const r = RECT(el);
    if (r.width < 1 || r.height < 1) return false;
    const s = CS(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const inside = (el, selector) => Boolean(el.closest(selector));
  // Gráficos, calendário de mapas e mídia têm geometria própria.
  const IGNORE = "svg, canvas, video, .ds-donut, .ds-columns, .cash-bars, .recharts-wrapper, .toast, [data-audit-ignore]";

  const scope = (root && document.querySelector(root)) || document.body;
  const all = [...scope.querySelectorAll("*")].filter(el => !inside(el, IGNORE) && visible(el));

  for (const el of all) {
    const r = RECT(el);
    const s = CS(el);
    if (s.position === "fixed") continue;

    // overflow / escape / clipped: sobe até o primeiro ancestral que limita.
    let scrolls = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = CS(p);
      const ox = ps.overflowX;
      const pr = RECT(p);
      if (ox === "auto" || ox === "scroll") { scrolls = true; break; }
      if (ps.position === "fixed" && !p.matches(".sidebar")) {
        if (r.right > pr.right + 2 || r.left < pr.left - 2) found.escape.push(describe(el));
        break;
      }
      if ((ox === "hidden" || ox === "clip") && pr.width > 0) {
        if ((r.right > pr.right + 2 || r.left < pr.left - 2) && s.position !== "absolute") {
          // Texto com reticências é corte intencional.
          if (s.textOverflow !== "ellipsis") found.clipped.push(describe(el));
        }
        break;
      }
      const box = p.matches(".ds-card, aside, [role=dialog], form, .ds-kpi, .ds-status, .ds-button, .kpi, .card");
      if (box) {
        if ((r.right > pr.right + 2 || r.left < pr.left - 2) && s.position !== "absolute") found.escape.push(describe(el));
        break;
      }
    }
    if (!scrolls && r.right > W + 2 && !inside(el, ".sidebar")) found.overflow.push(describe(el));

    // wrapped: linha em grade (botão/linha de tabela) com mais filhos do que colunas.
    if (s.display === "grid" && (el.tagName === "BUTTON" || /row|item|line/.test(String(el.className)))) {
      const cols = s.gridTemplateColumns.split(" ").filter(Boolean).length;
      const kids = [...el.children].filter(visible);
      // Só conta filho posicionado automaticamente: células com grid-column/row
      // explícitos (layout de cartão no celular) quebram de linha por projeto.
      const auto = kids.filter(k => CS(k).gridColumnStart === "auto" && CS(k).gridRowStart === "auto");
      const firstTop = kids.length ? RECT(kids[0]).top : 0;
      const fell = auto.some(k => RECT(k).top > firstTop + RECT(kids[0]).height - 2);
      if (cols > 1 && kids.length > cols && fell && s.gridTemplateAreas === "none") found.wrapped.push(`${describe(el)} [${kids.length} filhos / ${cols} colunas]`);
    }

    // distorted: avatar de iniciais (1–3 letras, fundo colorido, arredondado).
    const txt = (el.textContent || "").trim();
    if (el.children.length === 0 && /^[A-ZÀ-Ú]{1,3}$/.test(txt) && s.backgroundColor !== "rgba(0, 0, 0, 0)" && parseFloat(s.borderRadius) >= 6) {
      const ratio = r.width / r.height;
      if (ratio > 1.6 || ratio < 0.62) found.distorted.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    // tap: alvo pequeno no celular.
    if (mobile && el.matches("button, a[href], select, input:not([type=hidden]), [role=tab]") && !el.disabled) {
      if (Math.min(r.width, r.height) < 32 && !inside(el, "p, small, .ds-callout")) found.tap.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  // overlap: irmãos em fluxo normal que se sobrepõem.
  for (const parent of all) {
    const kids = [...parent.children].filter(k => visible(k) && !inside(k, IGNORE) && ["static", "relative"].includes(CS(k).position));
    if (kids.length < 2 || kids.length > 40) continue;
    const ps = CS(parent);
    if (ps.display === "grid" && ps.gridTemplateAreas !== "none") continue;
    for (let i = 0; i < kids.length; i++) {
      const a = RECT(kids[i]);
      for (let j = i + 1; j < kids.length; j++) {
        const b = RECT(kids[j]);
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 4 && h > 4) { found.overlap.push(`${describe(kids[i])} ⟷ ${describe(kids[j])}`); break; }
      }
    }
  }

  // giant: SVG maior que 40px fora de gráficos.
  for (const svg of scope.querySelectorAll("svg")) {
    const r = RECT(svg);
    if ((r.width > 40 || r.height > 40) && !svg.closest(".ds-donut, .ds-columns, .brand, .cash-bars, .recharts-wrapper, [data-audit-ignore]")) {
      found.giant.push(`${describe(svg.parentElement)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  // glued: irmãos com texto encostados fora de flex/grid.
  for (const el of all) {
    if (!el.matches("div, span, p, li, section, button")) continue;
    const st = CS(el);
    if (st.display.includes("flex") || st.display.includes("grid") || inside(el, ".sidebar")) continue;
    const kids = [...el.children].filter(c => {
      if (!visible(c) || (c.textContent || "").trim().length < 2) return false;
      const d = CS(c).display;
      return (d === "inline" || d === "inline-block") && RECT(c).height < 60;
    });
    for (let i = 1; i < kids.length; i++) {
      const a = RECT(kids[i - 1]), b = RECT(kids[i]);
      if (Math.abs(a.top - b.top) < 4 && b.left - a.right < 2 && b.left >= a.left) { found.glued.push(describe(el)); break; }
    }
  }

  const dedupe = list => [...new Set(list)].slice(0, 15);
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, dedupe(v)]));
};

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Aciona a navegação pelo próprio elemento do menu lateral. No desktop os
 * subitens de módulo ficam ocultos (as seções são trocadas pela barra do
 * módulo) e no celular o menu fica fechado; o clique programático dispara o
 * mesmo handler do React nas duas situações, sem depender de visibilidade.
 */
async function clickMenu(page, selector, text) {
  const ok = await page.evaluate(({ selector, text }) => {
    const el = [...document.querySelectorAll(selector)].find(e => text == null || e.textContent.trim() === text || e.getAttribute("aria-label") === text);
    if (!el) return false;
    el.click();
    return true;
  }, { selector, text });
  if (!ok) throw new Error(`Menu não encontrado: ${selector} "${text}"`);
}

async function goTo(page, width, view) {
  await clickMenu(page, ".sidebar nav > button[aria-label]", view.nav);
  await sleep(900);
  if (view.sub) {
    await clickMenu(page, ".sidebar-subitem", view.sub);
    await sleep(900);
  }
  if (width <= MOBILE_MAX && await page.locator(".sidebar.open").count()) await page.locator(".scrim").click({ timeout: 3000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await sleep(500);
}

async function discover(page) {
  const views = [];
  const navs = await page.locator(".sidebar nav > button[aria-label]").evaluateAll(els => els.map(e => e.getAttribute("aria-label")));
  for (const nav of navs) {
    await clickMenu(page, ".sidebar nav > button[aria-label]", nav);
    await sleep(1200);
    const subs = await page.locator(".sidebar-subitem").evaluateAll(els => els.map(e => e.textContent.trim()));
    if (subs.length) for (const sub of subs) views.push({ nav, sub });
    else views.push({ nav, sub: null });
  }
  return views;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', env.QA_EMAIL);
  await page.fill('input[type="password"]', env.QA_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".app-shell", { timeout: 30000 });
  await sleep(1500);
  return page;
}

const discoverCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const discoverPage = await login(discoverCtx);
const storage = await discoverCtx.storageState();
const views = (await discover(discoverPage)).filter(v => !ONLY || `${v.nav} › ${v.sub ?? ""}`.includes(ONLY));
await discoverCtx.close();
console.log(`Telas descobertas: ${views.length} · larguras: ${WIDTHS.join(", ")} · base: ${BASE}\n`);

const report = [];
let failures = 0;
let warnings = 0;

async function audit(page, label, width, theme, shotName, root = null) {
  const result = await page.evaluate(probe, { mobile: width <= 480, root, width });
  const tap = result.tap; delete result.tap;
  const count = Object.values(result).reduce((n, list) => n + list.length, 0);
  failures += count;
  warnings += tap.length;
  if (count || tap.length) report.push({ view: label, width, theme, ...result, tap });
  if (count || (theme === "light" && (width === 1440 || width === 390))) {
    await page.screenshot({ path: `${OUT}/${shotName}.png`, fullPage: true }).catch(() => {});
  }
  if (count) {
    console.log(`✗ ${label} · ${width}px · ${theme}`);
    for (const [kind, list] of Object.entries(result)) if (list.length) console.log(`    ${kind}: ${list.slice(0, 4).join(" | ")}${list.length > 4 ? ` (+${list.length - 4})` : ""}`);
  }
}

for (const width of WIDTHS) {
  for (const theme of DARK_WIDTHS.has(width) ? ["light", "dark"] : ["light"]) {
    const ctx = await browser.newContext({ viewport: { width, height: width <= 480 ? 844 : 900 }, colorScheme: theme, storageState: storage, isMobile: width <= 480, hasTouch: width <= 480 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e).slice(0, 160)));
    page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 30000 });
    await sleep(1500);

    for (const view of views) {
      const label = view.sub ? `${view.nav} › ${view.sub}` : view.nav;
      const slug = `${label}-${width}-${theme}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
      try {
        errors.length = 0;
        await goTo(page, width, view);
        await audit(page, label, width, theme, slug);
        for (const layer of LAYERS[label] ?? []) {
          const opener = page.locator(layer.open).first();
          if (!(await opener.count())) continue;
          await opener.click({ timeout: 5000 }); await sleep(700);
          const tabs = layer.tabs ? await page.locator(layer.tabs).count() : 0;
          if (tabs) {
            for (let t = 0; t < tabs; t++) {
              await page.locator(layer.tabs).nth(t).click({ timeout: 5000 }); await sleep(300);
              await audit(page, `${label} › ${layer.name} › aba ${t + 1}`, width, theme, `${slug}-layer-${t + 1}`, LAYER_ROOT);
            }
          } else {
            await audit(page, `${label} › ${layer.name}`, width, theme, `${slug}-layer`, LAYER_ROOT);
          }
          if (layer.close === "Escape") { await page.keyboard.press("Escape"); await page.mouse.click(5, 5).catch(() => {}); }
          else await page.locator(layer.close).first().click().catch(() => {});
          await sleep(400);
        }
        if (errors.length) {
          failures += errors.length;
          report.push({ view: label, width, theme, console: [...new Set(errors)] });
          console.log(`✗ ${label} · ${width}px · ${theme}\n    console: ${[...new Set(errors)].slice(0, 2).join(" | ")}`);
        }
      } catch (error) {
        failures++;
        report.push({ view: label, width, theme, navigation: String(error).slice(0, 200) });
        console.log(`✗ ${label} · ${width}px · ${theme}\n    navegação: ${String(error).split("\n")[0].slice(0, 160)}`);
        await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
        await sleep(1500);
      }
    }
    await ctx.close();
  }
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\nDefeitos: ${failures} · avisos de toque (celular): ${warnings}`);
console.log(`Relatório: ${OUT}/report.json · capturas em ${OUT}`);
process.exitCode = failures ? 1 : 0;
