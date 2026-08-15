/**
 * Verificação visual — captura as telas em tema claro e escuro, em duas
 * larguras, e falha se detectar estouro horizontal, colisão entre o número de
 * um KPI e o texto do cartão, ou erro de console.
 *
 * Estes foram os defeitos que passaram numa entrega anterior por terem sido
 * validados só na leitura do CSS. Rode antes de dar uma tela como pronta.
 *
 * Requisitos: servidor de desenvolvimento no ar (npm run dev) e Playwright
 * disponível. O Playwright não é dependência do projeto de propósito — o
 * install do Sites é travado no lockfile e é usado no build remoto.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   BASE=http://localhost:5174 node scripts/visual-check.mjs
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
const OUT = process.env.OUT || "/tmp/pecsil-shots";
const only = process.argv[2];

// Cada cenário: nome, tema, e os cliques para chegar na tela.
const scenarios = [
  { name: "01-visao-geral", theme: "dark", steps: [] },
  { name: "02-visao-geral-claro", theme: "light", steps: [] },
  { name: "03-financeiro", theme: "dark", steps: [{ nav: "Financeiro" }] },
  { name: "04-financeiro-claro", theme: "light", steps: [{ nav: "Financeiro" }] },
  { name: "05-financeiro-fluxo", theme: "dark", steps: [{ nav: "Financeiro" }, { seg: "Fluxo de caixa" }] },
  { name: "06-rh", theme: "dark", steps: [{ nav: "Recursos Humanos" }] },
  { name: "07-rh-claro", theme: "light", steps: [{ nav: "Recursos Humanos" }] },
  { name: "08-modulos", theme: "dark", steps: [{ nav: "Módulos" }] },
  { name: "09-pessoas", theme: "dark", steps: [{ nav: "Pessoas e Acessos" }] },
  { name: "10-seguranca", theme: "dark", steps: [{ nav: "Permissões e Segurança" }] },
];

const executablePath = process.env.CHROME_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const problems = [];

for (const scenario of scenarios) {
  if (only && !scenario.name.includes(only)) continue;

  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: scenario.theme,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", m => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", e => consoleErrors.push(String(e)));

  try {
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector(".app-shell", { timeout: 30000 });

    for (const step of scenario.steps) {
      if (step.nav) {
        await page.getByRole("button", { name: step.nav, exact: true }).first().click();
      }
      if (step.seg) {
        await page.getByRole("tab", { name: step.seg, exact: true }).first().click();
      }
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(500);

    await page.screenshot({ path: `${OUT}/${scenario.name}.png`, fullPage: false });

    // Detecção automática de estouro horizontal — foi o defeito que passou.
    const overflow = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Elemento dentro de um contêiner rolável não é estouro: ele rola.
        let scrollable = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") { scrollable = true; break; }
        }
        if (scrollable) continue;
        if (r.right > window.innerWidth + 2 || r.left < -2) {
          bad.push({
            sel: el.className && typeof el.className === "string"
              ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
              : el.tagName,
            left: Math.round(r.left), right: Math.round(r.right),
            text: (el.textContent || "").trim().slice(0, 40),
          });
        }
      }
      const seen = new Set();
      return bad.filter(b => !seen.has(b.sel) && seen.add(b.sel)).slice(0, 8);
    });

    // Detecção de sobreposição entre o número do KPI e seu texto.
    const collisions = await page.evaluate(() => {
      const out = [];
      for (const kpi of document.querySelectorAll(".ds-kpi, .stat-card, .hr-stat, .finance-stat")) {
        const text = kpi.querySelector(".ds-kpi-text, span:last-child, div");
        const value = kpi.querySelector(".ds-kpi-value, strong");
        if (!text || !value) continue;
        const a = text.getBoundingClientRect(), b = value.getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 4 && overlapY > 4 && !text.contains(value)) {
          out.push({ text: (text.textContent || "").slice(0, 30), overlapX: Math.round(overlapX) });
        }
      }
      return out.slice(0, 5);
    });

    if (overflow.length || collisions.length || consoleErrors.length) {
      problems.push({ scenario: scenario.name, overflow, collisions, consoleErrors: consoleErrors.slice(0, 3) });
    }
    console.log(`✓ ${scenario.name}${overflow.length ? `  ⚠ ${overflow.length} estouro(s)` : ""}${collisions.length ? `  ⚠ ${collisions.length} colisão(ões)` : ""}`);
  } catch (error) {
    console.log(`✗ ${scenario.name}: ${String(error).split("\n")[0]}`);
    problems.push({ scenario: scenario.name, error: String(error).split("\n")[0] });
  }

  await context.close();
}

await browser.close();

if (problems.length) {
  console.log("\n=== PROBLEMAS ===");
  console.log(JSON.stringify(problems, null, 2));
  process.exitCode = 1;
} else {
  console.log("\nNenhum estouro, colisão ou erro de console.");
}
