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
 *   unreachable (só em camada aberta) botão/campo fora da tela e sem rolagem
 *              que o alcance — é o botão que a pessoa não consegue clicar
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
 * WIDTHS (ex.: "1440,390"), CHROME_PATH, QA_STATE (arquivo onde guardar a
 * sessão, para auditar várias vezes sem o servidor de autenticação barrar a
 * rajada de logins).
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
  // A gaveta de SST ficava de fora — e foi justamente onde apareceu um defeito
  // de UI relatado por quem usa. Gaveta não auditada é gaveta sem rede.
  "Recursos Humanos › Saúde e segurança": [
    { name: "Registro de SST", open: ".sst-record-table > button", close: ".employee-layer > aside > header button" },
    { name: "Novo registro de SST", open: ".hr-page-head .ds-button", close: ".sst-form > header button" },
  ],
  "Recursos Humanos › Benefícios": [{ name: "Solicitação de benefício", open: ".benefit-request-table > button", close: "Escape" }],
  "Comercial › CRM › Funil": [{ name: "Novo card", open: ".page-head .ds-button", close: ".user-admin-form > header button" }],
  "Comercial › CRM › Clientes": [{ name: "Novo cliente", open: ".md-toolbar .ds-button", close: ".user-admin-form > header button" }],
  "Cadastros": [{ name: "Editar fornecedor", open: ".md-actions .ds-button", close: ".user-admin-form > header button" }],
  "Visão Geral": [{ name: "Menu da conta", open: ".user-card", close: ".user-card" }],
};

// ---------------------------------------------------------------------------
// Sonda executada dentro da página
// ---------------------------------------------------------------------------
const probe = ({ mobile, root, width, height }) => {
  // Cache: getComputedStyle/getBoundingClientRect repetidos em milhares de nós
  // (e em cada ancestral) tornavam a varredura lenta demais.
  const styles = new Map();
  const rects = new Map();
  const CS = el => { let v = styles.get(el); if (!v) { v = getComputedStyle(el); styles.set(el, v); } return v; };
  const RECT = el => { let v = rects.get(el); if (!v) { v = el.getBoundingClientRect(); rects.set(el, v); } return v; };
  const found = { overflow: [], escape: [], clipped: [], wrapped: [], overlap: [], distorted: [], giant: [], glued: [], unreachable: [], tap: [] };
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
    // Aba e botão de seleção ficam de fora: um rótulo curto em maiúsculas
    // ("CRM") não é avatar, e a proporção dele é do texto, não de um retrato.
    const txt = (el.textContent || "").trim();
    const avatarPossivel = el.children.length === 0 && el.getAttribute("role") !== "tab" && !el.closest(".ds-segmented, [role=tablist]");
    if (avatarPossivel && /^[A-ZÀ-Ú]{1,3}$/.test(txt) && s.backgroundColor !== "rgba(0, 0, 0, 0)" && parseFloat(s.borderRadius) >= 6) {
      const ratio = r.width / r.height;
      if (ratio > 1.6 || ratio < 0.62) found.distorted.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    // unreachable: dentro de uma camada aberta (gaveta, formulário, menu), um
    // controle fora da tela sem rolagem que o alcance é um botão que a pessoa
    // não consegue clicar. Só vale com `root`: na página inteira, controle
    // abaixo da dobra é normal — a própria página rola.
    if (root && el.matches("button, a[href], input:not([type=hidden]), select, textarea") && !el.disabled) {
      const foraDaTela = r.bottom > height + 2 || r.top < -2;
      if (foraDaTela) {
        let alcancavel = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ps = CS(p);
          if (ps.overflowY === "auto" || ps.overflowY === "scroll") { alcancavel = true; break; }
        }
        if (!alcancavel) found.unreachable.push(`${describe(el)} [${Math.round(r.top)}..${Math.round(r.bottom)} em tela de ${height}px]`);
      }
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
  // Departamento (ex.: Comercial): primeiro a área, depois a seção dela.
  if (view.area) {
    await clickMenu(page, ".sidebar-area", view.area);
    await sleep(900);
  }
  if (view.sub) {
    await clickMenu(page, view.area ? ".sidebar-section" : ".sidebar-subitem", view.sub);
    await sleep(900);
  }
  if (width <= MOBILE_MAX && await page.locator(".sidebar.open").count()) await page.locator(".scrim").click({ timeout: 3000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await sleep(500);
}

async function discover(page) {
  const views = [];
  const navs = await page.locator(".sidebar nav > button[aria-label]").evaluateAll(els => els.map(e => e.getAttribute("aria-label")));
  const textos = (page, seletor) => page.locator(seletor).evaluateAll(els => els.map(e => e.textContent.trim()));
  for (const nav of navs) {
    await clickMenu(page, ".sidebar nav > button[aria-label]", nav);
    await sleep(1200);

    // Departamento: cada área tem as próprias seções (Comercial › CRM › …).
    // Sem isso, as telas do departamento sumiriam da auditoria.
    const areas = await textos(page, ".sidebar-area");
    if (areas.length) {
      for (const area of areas) {
        await clickMenu(page, ".sidebar-area", area);
        await sleep(1200);
        const secoes = await textos(page, ".sidebar-section");
        if (secoes.length) for (const sub of secoes) views.push({ nav, area, sub });
        else views.push({ nav, area, sub: null });
      }
      continue;
    }

    const subs = await textos(page, ".sidebar-subitem");
    if (subs.length) for (const sub of subs) views.push({ nav, sub });
    else views.push({ nav, sub: null });
  }
  return views;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

/**
 * Entra na plataforma. Tenta de novo com folga: o servidor de autenticação
 * recusa uma rajada de logins com senha, e auditar várias vezes seguidas caía
 * nisso — parecia falha da tela, e não era.
 */
async function login(context, tentativas = 3) {
  for (let tentativa = 1; ; tentativa += 1) {
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await sleep(400);
      await page.fill('input[type="email"]', env.QA_EMAIL);
      await page.fill('input[type="password"]', env.QA_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForSelector(".app-shell", { state: "attached", timeout: 30000 });
      await esperarMenu(page);
      return page;
    } catch (erro) {
      await page.close();
      if (tentativa >= tentativas) throw erro;
      console.log(`  login recusado; nova tentativa em 20s (${tentativa}/${tentativas})`);
      await sleep(20000);
    }
  }
}

/**
 * Sessão reaproveitável (opcional, via `QA_STATE=/caminho/estado.json`).
 *
 * Auditar várias vezes seguidas fazia o servidor de autenticação recusar o
 * login (ele barra uma rajada de tentativas com senha). Guardar a sessão
 * resolve e deixa a auditoria mais rápida; sem a variável, nada muda.
 */
const STATE = env.QA_STATE;

/**
 * Espera a barra lateral ter módulos. `.app-shell` aparece antes de as
 * permissões chegarem — varrer nesse intervalo descobre zero telas e a
 * auditoria passa sem medir nada.
 */
async function esperarMenu(page) {
  await page.waitForFunction(
    () => document.querySelectorAll(".sidebar nav > button[aria-label]").length > 0,
    { timeout: 30000 },
  );
  await sleep(800);
}

/** Tenta a sessão guardada; se ela não valer mais, faz o login. */
async function abrirSessao() {
  if (STATE && existsSync(STATE)) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: JSON.parse(readFileSync(STATE, "utf8")),
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".app-shell", { state: "attached", timeout: 20000 });
      await esperarMenu(page);
      return { ctx, page };
    } catch {
      await ctx.close();
    }
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { ctx, page: await login(ctx) };
}

const { ctx: discoverCtx, page: discoverPage } = await abrirSessao();
const storage = await discoverCtx.storageState();
if (STATE) writeFileSync(STATE, JSON.stringify(storage), { mode: 0o600 });
const views = (await discover(discoverPage)).filter(v => !ONLY || [v.nav, v.area, v.sub].filter(Boolean).join(" › ").includes(ONLY));
await discoverCtx.close();
console.log(`Telas descobertas: ${views.length} · larguras: ${WIDTHS.join(", ")} · base: ${BASE}\n`);

// Nenhuma tela descoberta e "0 defeitos" no fim é um verde falso — foi o que
// aconteceu quando a sessão guardada venceu e a varredura rodou na tela de
// login. Sem tela para medir, a auditoria falha.
if (views.length === 0) {
  console.error(
    ONLY
      ? `Nenhuma tela casou com ONLY="${ONLY}". Confira o nome (ex.: "Comercial › CRM › Funil").`
      : "Nenhuma tela descoberta: a sessão não abriu a plataforma. Confira QA_EMAIL/QA_PASSWORD e o BASE.",
  );
  await browser.close();
  process.exit(2);
}

const report = [];
let failures = 0;
let warnings = 0;
/** Cobertura: o relatório só guarda o que teve defeito, então a contagem do
 *  que foi realmente medido precisa ser feita aqui — "0 defeitos" só vale se
 *  vier acompanhado de quantas telas passaram pela régua. */
const medidas = new Set();
let medicoes = 0;

async function audit(page, label, width, theme, shotName, root = null) {
  const result = await page.evaluate(probe, { mobile: width <= 480, root, width, height: page.viewportSize().height });
  const tap = result.tap; delete result.tap;
  const count = Object.values(result).reduce((n, list) => n + list.length, 0);
  medidas.add(label);
  medicoes += 1;
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
      const label = [view.nav, view.area, view.sub].filter(Boolean).join(" › ");
      const slug = `${label}-${width}-${theme}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
      try {
        errors.length = 0;
        await goTo(page, width, view);
        await audit(page, label, width, theme, slug);
        let indiceCamada = 0;
        for (const layer of LAYERS[label] ?? []) {
          // Duas camadas na mesma tela precisam de nomes de captura diferentes,
          // senão a segunda sobrescreve a evidência da primeira.
          indiceCamada += 1;
          const slugCamada = `${slug}-camada-${indiceCamada}`;
          const opener = page.locator(layer.open).first();
          if (!(await opener.count())) continue;
          await opener.click({ timeout: 5000 }); await sleep(700);
          const tabs = layer.tabs ? await page.locator(layer.tabs).count() : 0;
          if (tabs) {
            for (let t = 0; t < tabs; t++) {
              await page.locator(layer.tabs).nth(t).click({ timeout: 5000 }); await sleep(300);
              await audit(page, `${label} › ${layer.name} › aba ${t + 1}`, width, theme, `${slugCamada}-aba-${t + 1}`, LAYER_ROOT);
            }
          } else {
            await audit(page, `${label} › ${layer.name}`, width, theme, slugCamada, LAYER_ROOT);
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
console.log(`\nMedidas: ${medidas.size} de ${views.length} telas · ${medicoes} medições (largura × tema)`);
if (medidas.size < views.length) {
  console.log(`Não medidas: ${views.filter(v => !medidas.has([v.nav, v.area, v.sub].filter(Boolean).join(" › "))).map(v => [v.nav, v.area, v.sub].filter(Boolean).join(" › ")).join(", ")}`);
}
console.log(`Defeitos: ${failures} · avisos de toque (celular): ${warnings}`);
console.log(`Relatório: ${OUT}/report.json · capturas em ${OUT}`);
process.exitCode = failures ? 1 : 0;
