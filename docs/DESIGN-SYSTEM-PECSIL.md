# Design System — Pecsil Business OS

> Padrão visual único da plataforma. Todo módulo criado daqui em diante segue
> este documento. Não é uma sugestão de estilo: é o que faz dez módulos
> parecerem um produto só.
>
> Como o Blueprint, é um documento vivo — ver [§9](#9--como-evoluir-o-sistema).

Última revisão: 10/08/2026

---

## 1 — As cinco regras

1. **Nenhuma cor literal em código.** Sempre um token. `#fff` não sobrevive ao
   tema escuro; `var(--bg-surface)` sim.
2. **Nada abaixo de 11px.** A escala tem piso. Texto de 7px foi o defeito mais
   visível da versão anterior.
3. **Número é monoespaçado e tabular.** Colunas de valores precisam alinhar.
4. **Módulo não cria estilo próprio.** Se a peça não existe, ela sobe para o
   Design System antes de ser usada.
5. **Módulo não tem barra lateral própria.** Seções são navegação horizontal.
   Uma segunda sidebar compete com a navegação da plataforma.

---

## 2 — Arquitetura

```
packages/design-system/
├── tokens.css      cor, tipografia, espaço, raio, elevação — claro e escuro
├── base.css        reset, escala tipográfica, elementos nativos, foco
├── legacy.css      ⚠️ telas não convertidas — em extinção, ver §8
├── shell.css       barra lateral, cabeçalho, conteúdo, seletor de perfil
├── patterns.css    vocabulário de produto: KPI, painel, callout, tabela, gráfico
├── components.tsx  primitivas React
├── theme.tsx       ThemeProvider, useTheme, ThemeToggle, script anti-flash
└── index.ts        superfície pública
```

`app/globals.css` **apenas importa** essas camadas, em ordem. Ele não declara
estilo. A ordem importa: `legacy` vem antes de `shell` e `patterns`, então o
Design System sempre vence uma regra herdada sobre o mesmo seletor.

---

## 3 — Tokens

### Superfícies e texto

| Token | Papel |
|---|---|
| `--bg-canvas` | Fundo da aplicação |
| `--bg-sidebar` | Barra lateral |
| `--bg-surface` | Cartões e painéis |
| `--bg-surface-raised` | Menus, toasts, sobreposições |
| `--bg-subtle` | Faixas internas, cabeçalho de tabela |
| `--bg-hover` / `--bg-active` | Estados de interação |
| `--border-subtle` / `--border` / `--border-strong` | Três níveis de separação |
| `--text-primary` / `--text-secondary` / `--text-muted` | Três níveis de ênfase |

### Acentos semânticos

A paleta cromática da Pecsil foi **conservada**. O que muda entre os temas é a
luminosidade de cada matiz — no tema claro os acentos escurecem para ter
contraste sobre branco; no escuro, clareiam.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--accent-blue` | `#2864ed` | `#4d9bff` | Marca, ação primária, neutro-positivo |
| `--accent-green` | `#059669` | `#34d399` | Sucesso, dentro do previsto |
| `--accent-amber` | `#b45309` | `#fbbf24` | Atenção, pendência |
| `--accent-red` | `#be123c` | `#ff6b7d` | Erro, vencido, crítico |
| `--accent-purple` | `#7e22ce` | `#c084fc` | Contagem, destaque neutro |
| `--accent-teal` | `#0f766e` | `#2dd4bf` | Categoria auxiliar |

Cada acento tem um `--tint-*` (fundo lavado, para chips e banners) e um
`--edge-*` (borda tonal).

### Série de dados

`--data-1` a `--data-8`, **ordem fixa por contrato**. Nunca reordenar: `--data-1`
é sempre a série primária, `--data-2` sempre a crítica. Use `seriesColor(index)`
no código. `--data-track` é o trilho atrás de barras e anéis.

### Tipografia

| Token | Tamanho | Uso |
|---|---|---|
| `--fs-micro` | 11px | Rótulos uppercase com tracking |
| `--fs-xs` | 12px | Metadados, legendas |
| `--fs-sm` | 13px | Texto secundário, células |
| `--fs-md` | 14px | Corpo padrão |
| `--fs-lg` | 16px | Título de bloco |
| `--fs-xl` | 20px | Título de painel |
| `--fs-2xl` | 26px | Título de página |
| `--fs-metric` | 40px | Número de KPI |

Pesos: 400 / 500 / 600 / 700. Nada de 650 ou 750.

---

## 4 — Tema claro e escuro

Três estados: `light` explícito, `dark` explícito, e `system` (padrão, sem
atributo no `<html>`).

```
:root                                          → paleta clara completa
@media (prefers-color-scheme: dark)
  :root:not([data-theme="light"])              → escuro pelo sistema
:root[data-theme="dark"]                       → escuro por escolha
```

A escolha do usuário vence a preferência do sistema **nos dois sentidos**.

**Anti-flash:** `themeBootstrapScript` roda no `<head>`, síncrono, antes da
primeira pintura. Sem ele a página nasce clara e pisca para escura.

**Estado:** `theme.tsx` usa `useSyncExternalStore` para ler `localStorage` e
`matchMedia`. Não há efeito de montagem chamando `setState` — isso causaria
render em cascata e inconsistência de hidratação.

```tsx
const { theme, preference, setPreference, toggle } = useTheme();
```

---

## 5 — Primitivas

```tsx
import { Button, Callout, Card, Panel, Kpi, KpiGrid, Row, Segmented,
         SectionLabel, Status, Donut, Legend, Bar, Columns } from "packages/design-system";
```

### KPI — o cartão de número

```tsx
<KpiGrid>
  <Kpi label="Ordens na fila" caption="337 estavam ocultas na planilha"
       value="439" tone="blue" />
  <Kpi label="Aderência" caption="46 de 112 dentro do previsto"
       value="41" unit="%" tone="red" />
</KpiGrid>
```

`caption` explica **de onde o número vem**. É o que separa um indicador
confiável de um número solto na tela. Não é decoração.

### Callout — a explicação editorial

```tsx
<Callout variant="warning" title="Metade desta tela está vazia por um motivo">
  A base registra em que setor cada ordem está agora, mas nunca <strong>quando</strong>
  ela chegou lá. Sem essa marcação não existe realizado interno.
</Callout>
```

Variantes: `info` · `warning` · `success` · `danger`.

Use para declarar limitação conhecida, contrato do dado ou origem da informação.
**Uma tela que mostra número sem dizer de onde ele veio perde credibilidade** —
e explicar a lacuna vale mais que escondê-la.

### Painel

```tsx
<Panel title="Pesos e cortes" subtitle="A regra que a planilha aplica hoje"
       actions={<Status tone="info">V1</Status>}>
  <SectionLabel>Situação na cobertura</SectionLabel>
  <Row label="PRIO 1 — Passivo sem estoque" value={6} />
</Panel>
```

### Navegação de seções

```tsx
<div className="ds-module-bar">
  <Button variant="secondary" compact onClick={onExit}>Ecossistema</Button>
  <Segmented options={sections} value={section} onChange={setSection} />
  <Status tone="info">{access.scopeLabel}</Status>
</div>
```

### Gráficos

SVG puro, sem biblioteca externa — o artefato do Sites bloqueia host externo,
então qualquer CDN quebraria a página em produção.

```tsx
<Donut slices={slices} caption="ordens" />
<Legend slices={slices} />
<Bar label="MAGNAGHI" caption="R$ 373 mil · média 21 d" value={113} max={137} />
<Columns data={[{ label: "até 5", value: 18 }, { label: "6 a 10", value: 24 }]} />
```

---

## 6 — Anatomia de uma tela

```
┌─ cabeçalho ────────────────────────────────────────────────────┐
│  Título · subtítulo        [estado] [busca] [☾] [🔔] [usuário]  │
├────────────────────────────────────────────────────────────────┤
│  ds-module-bar:  [← Ecossistema]  [Segmented]        [escopo]  │
│                                                                 │
│  Callout — o que esta tela mede e o que ela não mede           │
│                                                                 │
│  KpiGrid — 4 números com legenda de origem                     │
│                                                                 │
│  Painéis — grade 1.5fr / 0.8fr                                 │
└────────────────────────────────────────────────────────────────┘
```

O título vem do cabeçalho da plataforma, não do módulo. Em `app/page.tsx`, o
mapa `headerCopy` define título e subtítulo de cada área.

---

## 7 — Escrever um módulo novo

`npm run module:create` já entrega o esqueleto no padrão: `ds-module-bar` com
`Segmented`, um `Callout` declarando que os dados são demonstrativos, `KpiGrid`
e um `Panel`. O gerado compila, passa lint e passa o teste de contrato.

Checklist antes de pedir homologação:

- [ ] Zero cor literal — só tokens
- [ ] Zero `font-size` abaixo de 11px
- [ ] Todo KPI tem `caption` dizendo a origem do número
- [ ] Limitações conhecidas estão em `Callout`, não escondidas
- [ ] Nenhuma classe CSS nova fora de `patterns.css`
- [ ] Testado nos dois temas
- [ ] Testado em 1280px e em 720px
- [ ] `npm run modules:validate && npm run lint && npm test`

---

## 8 — Composição estrutural (por que telas não convertidas ficam certas)

O CSS legado **foi removido**. Nenhuma regra herdada sobrevive.

Isso funcionou porque as telas repetem uma mesma gramática de markup:

```html
<Card>
  <button>
    <span class="icone" />
    <span><b>título</b><small>detalhe</small></span>
    <Status />
    <svg />   <!-- seta -->
  </button>
</Card>
```

A seção 14 do `patterns.css` estiliza **essa gramática**, não os nomes de classe.
Uma tela que nunca foi tocada — a matriz de Permissões, por exemplo — cai no
padrão sozinha, porque compõe com as mesmas peças.

Consequência prática: ao escrever markup novo, siga a gramática. `<b>` é o
título da linha, `<small>` é o detalhe, o primeiro `<span>` é o ícone. Fugir
disso é o que obriga a criar estilo local.

**Convertidos para as primitivas:** shell, Financeiro, RH.
**Ainda no markup antigo (mas visualmente corretos):** views internas de
`page.tsx` e as seções profundas do RH.

### Verificação visual é obrigatória

Existe um roteiro Playwright que captura 10 telas em tema claro e escuro, em
duas larguras, e falha se detectar:

- estouro horizontal (elemento fora da viewport, ignorando contêiner rolável);
- colisão entre o número de um KPI e o texto do cartão;
- erro de console.

Foram esses dois primeiros defeitos que passaram na primeira entrega. **Rode o
roteiro antes de dar uma tela como pronta** — ler o CSS não substitui olhar a
página.

---

## 9 — Como evoluir o sistema

**Mudança leve** (adicionar uma variante, ajustar um espaçamento, criar uma
primitiva nova): faça e siga. É assim que o sistema cresce.

**Mudança estrutural** (alterar um token semântico, mudar a escala tipográfica,
quebrar uma das cinco regras): afeta todas as telas de uma vez. Registre o quê,
o porquê e o que isso quebra antes de aplicar.

Se uma regra daqui estiver atrapalhando o trabalho real, o padrão é **questionar
a regra**, não contorná-la com um estilo local — um estilo local invisível é
exatamente como a divergência visual começa.

---

## Referências

| Documento | Conteúdo |
|---|---|
| [`docs/BLUEPRINT-PECSIL-BUSINESS-OS.md`](./BLUEPRINT-PECSIL-BUSINESS-OS.md) | Direção do produto, fases, divergência D2 |
| [`docs/SDK-MODULOS-PECSIL.md`](./SDK-MODULOS-PECSIL.md) | Gerador de módulos |
| [`modules/README.md`](../modules/README.md) | Contrato de módulos |
| [`app/components/finance-module.tsx`](../app/components/finance-module.tsx) | Módulo de referência já convertido |
