# Blueprint Mestre — PecSil Business OS

> **Documento vivo.** Descreve a direção, não uma prisão. As regras aqui existem para
> evitar retrabalho e decisões contraditórias — não para bloquear boas ideias.
> Toda regra pode ser alterada; o que se pede é que a mudança seja **explícita e
> registrada** (ver [§10 — Como mudar este documento](#10--como-mudar-este-documento)).

Última revisão: 10/10/2026 (SARA como harness corporativo e Segundo Cérebro: Fase 6 e Referências)

---

## 1 — O que estamos construindo

O PecSil Business OS é uma **plataforma empresarial modular** que centraliza a operação
da PecSil em um único ecossistema. Substitui sistemas e planilhas isoladas por módulos
que compartilham autenticação, usuários, banco de dados, permissões, documentos,
auditoria, notificações e Design System.

Não é um ERP com dashboards. É uma **infraestrutura operacional própria**:

```
módulos de negócio + dados compartilhados + governança + inteligência corporativa
+ (futuro) capacidade de criar novos sistemas dentro do próprio sistema
```

A trajetória em uma linha:

> **Demo RH → Core real → RH integrado → Financeiro → demais módulos → dados
> consolidados → SARA → Module Builder**

---

## 2 — Princípios inegociáveis

Estes seis pontos definem a identidade do produto. Mudá-los muda o que estamos
construindo, não só como.

1. **Plataforma única, não federação de apps.** Um módulo que reimplementa login,
   usuários, permissões, documentos ou notificações está errado por definição.

2. **Segurança no banco, não na tela.** O menu esconde; o PostgreSQL protege. A
   autorização real é `Usuário + Papel + Módulo + Recurso + Ação + Escopo +
   Sensibilidade`, aplicada por RLS. Nenhum módulo confia na visibilidade do frontend.

3. **Módulo nasce desligado.** `status: "Planejado"`, `enabled: false`,
   `menu.enabled: false`. Só muda após homologação com usuários reais. Existe teste de
   contrato para impedir ativação acidental — ele não deve ser contornado.

4. **Auditoria é obrigatória, não opcional.** Toda ação crítica gera evento auditável
   declarado no manifesto.

5. **Um Design System, reutilizado.** Módulo não cria sua própria linguagem visual.

6. **Migration aplicada é imutável.** Correções vêm por nova migration, nunca por
   edição da anterior.

### Decisões revisáveis (não são princípios)

Estas foram escolhas de contexto e **devem** ser reavaliadas quando o contexto mudar:

- A ordem dos módulos no roadmap.
- Hospedagem em ChatGPT Sites / runtime vinext.
- Supabase self-hosted vs. gerenciado.
- Estrutura de pastas e organização do repositório.
- O modo demonstrativo com dados mockados.

---

## 3 — Estado real hoje (declarado × código)

Auditoria do repositório em 10/08/2026. A coluna **Código** é o que existe de fato.

| Componente | Situação declarada | Código | Leitura honesta |
|---|---|---|---|
| Conceito e arquitetura | 🟢 Definidos | Contrato de módulos implementado e testado | Confere |
| Fundação / Core | 🟡 Em evolução | Migrations `202607140001` (421 linhas) + `202607150001` (93). Repository com fallback. **Zero aplicado em banco real** | Especificado e codificado; **não provado** |
| Design System | 🟢 Validado | `packages/design-system/` = **38 linhas totais** (Button, Card, Status + tokens) | ⚠️ **Validado no Figma/demo, não extraído para código** |
| RH | 🟢 Demo aprovada | `hr-module.tsx` 782 linhas, dados mockados inline. **Sem `data/`, sem repository, sem migration** | UI madura, camada de dados inexistente |
| Financeiro | 🟡 Em desenvolvimento | `finance-module.tsx` 144 linhas + `finance-repository.ts` + migrations v1 (467 linhas) | **Mais maduro que o RH em dados**, menos em UI |
| Compras / Estoque / Produção / Qualidade | ⚪ Planejado | Declarados em `planned.ts` | Confere |
| Manutenção / Portaria e Frota / Fiscal / Comercial | ⚪ Planejado | **Ausentes do `planned.ts`** | Lacuna de registro |
| Camada analítica | ⚪ Planejada | — | Confere |
| SARA | ⚪ Planejado | — | Confere |
| Module Builder | 🔵 Backlog | — | Confere |

### 3.1 — Divergências abertas

Não são bugs; são desalinhamentos entre intenção e repositório que precisam de decisão.

| # | Divergência | Impacto | Encaminhamento sugerido |
|---|---|---|---|
| D1 | RH e Financeiro estão `status: "Integrado", enabled: true` rodando com mocks | Viola o Princípio 3 e corrompe o significado de "Integrado" | Criar o status intermediário **`"Homologado"`** e rebaixar ambos até haver persistência real |
| D2 | Design System é esquelético (38 linhas) enquanto a UI real vive nos módulos | Próximo módulo vai copiar/colar do RH e o padrão diverge | Extrair componentes do `hr-module.tsx` para `packages/design-system/` **antes** do 3º módulo |
| D3 | 4 dos 8 módulos planejados não estão em `planned.ts` | Catálogo administrativo mostra roadmap incompleto | Completar `planned.ts` (baixo custo, alto valor de comunicação) |
| D4 | Stack declarada (monorepo pnpm/Turborepo) ≠ real (npm, vinext, Cloudflare Sites) | Documentação induz decisões erradas | Assumir a stack real neste documento; migrar só se houver ganho concreto |
| D5 | Supabase em LAN sem HTTPS público; app hospedado externamente | **Bloqueia toda a Fase 1** | Ação presencial no servidor — ver `PENDENCIA-INFRA-SUPABASE.md` |
| D6 | RH não tem camada de dados; Financeiro tem | O "módulo de referência" não é referência arquitetural | RH deve adotar o padrão do Financeiro, não o contrário |

**Observação sobre D6:** a narrativa trata o RH como módulo de referência. Hoje ele é
referência **visual**. A referência **arquitetural** é o Financeiro. Vale explicitar isso
para quem for criar o próximo módulo.

---

## 4 — Roadmap por fases

Cada fase tem **critérios de saída objetivos**. Fase não termina por sensação de pronto.

### Fase 0 — Destravar a infraestrutura 🔴 *bloqueador atual*

Nada da Fase 1 se prova sem isto.

- [ ] `docker ps` no servidor para identificar o gateway (Kong ou Envoy) e a porta
- [ ] DNS `supabase.pecsil.com.br` → IP público da PecSil
- [ ] Reverse proxy (Caddy + Let's Encrypt), somente 80/443, com WebSocket e `X-Forwarded`
- [ ] Postgres 5432/6543, Studio, Docker, SSH e MCP **não** expostos
- [ ] Backup completo antes da primeira migration

**Saída:** aplicação externa autentica contra o Supabase interno por HTTPS válido.

---

### Fase 1 — Consolidar a Fundação 🎯 *foco atual*

Transformar especificação em infraestrutura funcionando.

Escopo: autenticação · organizações/unidades/departamentos · RBAC + escopos · RLS ·
catálogo de módulos · navegação dinâmica · documentos · notificações · auditoria ·
busca global · shell central · Design System extraído para código.

**Critérios de saída:**

- [ ] Migrations aplicadas; 16 tabelas existem com RLS ativo
- [ ] `supabase/tests/001_foundation_contract.sql` passa no banco real
- [ ] `can_access_module(text)` retorna falso sem habilitação **ou** sem permissão
- [ ] Usuário comum não altera catálogo, ativações ou auditoria (provado por teste)
- [ ] Login real funcionando; menu montado a partir de permissões reais
- [ ] Isolamento por organização verificado com dois usuários de escopos distintos
- [ ] Design System com os componentes efetivamente usados pelo RH (**resolve D2**)
- [ ] `planned.ts` com os 10 domínios (**resolve D3**)
- [ ] Status `"Homologado"` criado no contrato (**resolve D1**)

---

### Fase 2 — Integrar o RH

O RH deixa de ser demonstração e passa a consumir Core e dados reais.

Escopo: colaboradores · jornada · ausências · férias · benefícios · SST · exames ·
treinamentos · documentos · indicadores.
**Folha de pagamento permanece deliberadamente fora.**

**Critérios de saída:**

- [ ] `modules/rh/data/` + repository seguindo o padrão do Financeiro (**resolve D6**)
- [ ] Migrations de RH aplicadas com RLS por organização, módulo e permissão
- [ ] `hr-module.tsx` sem dados mockados inline; consumindo repository
- [ ] Componentes visuais vindos do Design System, não locais
- [ ] Testes de fluxo rodando contra dados persistidos
- [ ] Homologado com pelo menos dois perfis distintos de usuário real
- [ ] Só então: `status: "Integrado"`

---

### Fase 3 — Finalizar o Financeiro

Consolidar progressivamente: contas a pagar · contas a receber · fluxo de caixa ·
orçamento · custos · resultados · indicadores · visão gerencial.

**Critérios de saída:**

- [ ] Migrations `202608040001/0002` aplicadas e validadas
- [ ] Fallback demonstrativo removido do caminho de produção
- [ ] Consome usuários, centros de custo, documentos, permissões e estrutura
      organizacional **do Core** (sem cadastro paralelo)
- [ ] Alçadas de aprovação por faixa de valor, nível e papel operando
- [ ] Baixa integral, parcial e reversível preservando o valor original
- [ ] Conciliação bancária validada pela Tesouraria
- [ ] Regras fiscais (PIS/Cofins, exportação, câmbio) validadas pelo escritório contábil
- [ ] Itens `Pendente` do painel de homologação zerados
- [ ] UI ao nível do RH (hoje é ~1/5 do tamanho)

---

### Fase 4 — Expansão dos módulos

Os 10 domínios do Blueprint: RH · Financeiro · Compras · Estoque · Produção ·
Qualidade · Manutenção · Portaria e Frota · Fiscal · Comercial.

**A ordem não é rígida** — segue a prioridade operacional da PecSil. Recomendação de
sequência por acoplamento de dados (revisável): **Compras → Estoque → Produção →
Qualidade**, porque formam a cadeia física e alimentam o Financeiro com dados reais.

Cada módulo passa pelo mesmo ciclo (§5). Integrações entre módulos são explícitas:
pedido aprovado em Compras gera previsão/título no Financeiro — nunca por acesso direto
à tabela do outro módulo.

**Gate de qualidade:** a partir do 3º módulo, se dois módulos implementarem o mesmo
conceito de formas diferentes, o conceito sobe para a Fundação antes de seguir.

---

### Fase 5 — Camada analítica corporativa

Só faz sentido com dados confiáveis em vários módulos.

Objetivo: fonte única da verdade para a diretoria. Cruzamentos como
`Compras + Estoque + Produção + Financeiro` ou `RH + Produção + Qualidade + Manutenção`.

**Pré-condição:** pelo menos 4 módulos em produção com dados reais.
**Regra de ouro:** um KPI tem uma definição só. Dois departamentos não apresentam
números diferentes para o mesmo conceito.

**Caminho definido (25/09/2026):** a primeira entrega da camada analítica é **custo
real por OS e margem por cliente e artigo**, com a OS como fio comum entre os
módulos. Decisões pendentes, etapas e critérios de aceite em
[PLANO-CUSTO-MARGEM.md](PLANO-CUSTO-MARGEM.md).

---

### Fase 6 — SARA (antes "Jarvis Business")

> **21/09/2026:** a inteligência transversal passou a se chamar **SARA**. Base já criada: a trilha de eventos entre módulos (`module_events`), que registra os fatos de cada departamento para a SARA narrar, cobrar e recomendar.

Camada transversal de inteligência sobre todo o Business OS — **não** um chatbot
colocado em cima do ERP. Construído em níveis:

| Nível | Capacidade | Exemplo |
|---|---|---|
| 1 — Consulta | Responder sobre dados da empresa | "Qual o saldo previsto para o dia 20?" |
| 2 — Diagnóstico | Anomalias, tendências, gargalos, causas prováveis | "Por que nossa margem caiu?" |
| 3 — Conselheiro | Simular cenários, comparar alternativas, recomendar | "Que impacto teria aumentar a produção desta linha?" |
| 4 — Executor controlado | Preparar e executar operações | Gerar cotação — com aprovação humana |

**Restrições inegociáveis:**

- A SARA **herda as permissões de quem pergunta**. Nunca vê mais que o usuário.
- Toda resposta é auditável e rastreável até a origem do dado.
- Nível 4 exige aprovação humana explícita para qualquer ação crítica.
- Nível N+1 só começa quando o nível N estiver em uso real.

#### SARA como harness corporativo (10/10/2026)

> Decidido com o proprietário em 10/10/2026. Mudança leve (§10): detalha *como* a
> SARA é construída, sem mexer nos princípios nem nas restrições acima.

A SARA é o **harness corporativo da PecSil**: o programa que coordena os modelos de IA
para cumprir uma tarefa. Ele entrega a informação certa, oferece as ferramentas,
controla o que pode ser feito e mantém o trabalho andando até o resultado ou até
precisar parar e perguntar. Ela não é um chat colocado em cima do sistema. Usa as
**mesmas ferramentas que as telas usam, como a pessoa logada**, e nunca acessa o
banco por fora delas.

Quase todas as peças desse harness já existem na plataforma:

| Peça do harness | O que já existe no Business OS |
|---|---|
| **Permissões** | Funcionalidades por pessoa (ver/operar/aprovar) e as travas no banco (RLS). A SARA herda as de quem pergunta. |
| **Aprovações** | "Mostra e a pessoa confirma" (envio de arquivos) e as aprovações de processo (cotação pelo diretor). A SARA prepara; quem confirma é a pessoa. |
| **Ferramentas** | As rotas e funções da plataforma (consultar títulos, criar pedido, ler nota, gerar ordem de compra…). Cada uma confere a permissão de quem chama. |
| **Registro** | Trilha de eventos dos módulos (`module_events`) e registro de envios de arquivo (`file_intakes`). |
| **Memória** | O banco de dados e o **Segundo Cérebro** (documentos da empresa ligados aos dados), em [`docs/PLANO-SEGUNDO-CEREBRO.md`](./PLANO-SEGUNDO-CEREBRO.md). |
| **Skills** | O jeito PecSil de trabalhar, escrito em [`docs/PROCESSOS-PECSIL.md`](./PROCESSOS-PECSIL.md), virando instrução para a IA seguir. |
| **Vários modelos** | Clef (Cloudflare) para decisões rápidas e baratas; um modelo maior só para conversa e análise. Cada tarefa usa o mais barato que resolve. |
| **Teto de uso** | Limite de consumo de IA por setor, com painel de quem usa o quê (a construir). |

**Onde a IA não entra:** no miolo dos módulos. Conciliação bancária, ordem de compra,
recebimento da nota, ICMS e permissões são regras exatas e dão sempre o mesmo resultado.
A SARA **consulta, prepara, tria e cobra**. Quem grava continua sendo a regra do módulo,
com a confirmação da pessoa.

**Como as entregas atuais se encaixam:** a coleta de arquivos dos computadores é uma
*ferramenta*, a triagem por setor é uma *skill*, e o Segundo Cérebro é a *memória*.
Por isso essas entregas podem começar antes da Fase 6 sem violar a pré-condição abaixo:
são fundação, não a SARA.

**Pré-condição:** Fase 5 entregue.

---

### Fase 7 — PecSil Module Builder 🔵 *backlog estratégico*

Permitir que um administrador crie módulos sem programar — descrevendo em linguagem
natural e obtendo entidades, campos, telas, formulários, dashboards, workflows,
aprovações, permissões e notificações, com prévia, homologação e publicação.

**Está deliberadamente no backlog.** Não deve ser iniciado agora.

**Pré-condições para sequer avaliar:**

- Fundação estável em produção
- Pelo menos 4 módulos reais entregues pelo processo manual
- Contrato de módulo estabilizado (sem breaking changes por ~2 módulos consecutivos)

O gerador atual (`npm run module:create`) é o embrião honesto disso: cria estrutura
técnica, não regras de negócio.

---

## 5 — Ciclo padrão de um módulo

```
processo atual → dados → regras → permissões → indicadores → protótipo
→ validação → implementação → testes → homologação → produção
```

Passos operacionais:

1. `npm run module:create -- --code <x> --name "..." --short XX --description "..." --icon <i> --color <c> --dry-run`
2. Gerar a estrutura definitiva
3. Implementar regras e telas do domínio (Design System, sem UI própria)
4. Adicionar migrations próprias — **sem tocar em migrations aplicadas**
5. Criar testes de regras, acesso e escopo
6. `npm run modules:validate && npm run lint && npm test`
7. Homologar com perfis diferentes
8. Só então solicitar ativação e inclusão no menu

O SDK cria e registra a estrutura. Ele **não** inventa regras de negócio, **não** cria
tabelas automaticamente, **não** concede permissões e **não** ativa o módulo.

---

## 6 — Estados de um módulo

| Status | `enabled` | `menu` | Significado |
|---|---|---|---|
| `Planejado` | `false` | `false` | Declarado no catálogo, sem implementação |
| `Em construção` | `false` | `false` | Em desenvolvimento ativo |
| `Homologado` ⚠️ *a criar* | `false` | `false` | Funcional, validado por usuários, **ainda sem dados reais** |
| `Integrado` | `true` | `true` | Persistência real, RLS ativo, em produção |

> ⚠️ O status `Homologado` ainda não existe no contrato. Criá-lo é item da Fase 1 e
> resolve a divergência **D1** — hoje RH e Financeiro estão como `Integrado` sem
> atender ao critério.

Um módulo só aparece para o usuário quando: **está integrado** *e* **habilitado para a
empresa** *e* **o usuário tem a permissão de entrada** *e* **tem escopo compatível**.

---

## 7 — Regras de engenharia

**Contrato**
- Estrutura obrigatória: `manifest.ts`, `permissions.ts`, `data/`, `components/`, `tests/`, `README.md`
- Seis permissões padrão: `view`, `create`, `edit`, `approve`, `export`, `admin`
- Escopos: `company`, `unit`, `department`, `team`
- Eventos de auditoria declarados no manifesto

**Dados**
- Padrão de referência: `lib/data/finance-repository.ts` (repository + fallback demonstrativo)
- Módulo não lê tabela de outro módulo. Integração é por contrato explícito.
- Cadastros mestres (usuários, centros de custo, estrutura organizacional) vivem na Fundação

**Segurança**
- `SUPABASE_SERVICE_ROLE_KEY` é exclusiva de servidor. Nunca no navegador, nunca commitada, nunca pública.
- RLS nega por padrão; libera combinando organização + papel + permissão + escopo
- Em falha de migration: **não** remover tabelas. Interromper, restaurar backup, analisar.

**Qualidade**
- `npm run modules:validate && npm run lint && npm test` antes de qualquer entrega
- Teste de contrato garante que módulo não seja ativado acidentalmente

---

## 8 — O que estamos evitando de propósito

Registrado para não ser reaberto sem motivo novo:

- **Folha de pagamento no RH** — complexidade regulatória desproporcional ao valor inicial
- **Module Builder agora** — sem contrato estabilizado, geraria dívida estrutural
- **SARA como chatbot sobre o ERP** — precisa ser camada transversal com permissões
- **Módulos com login/usuários próprios** — mata a premissa da plataforma
- **Dados demonstrativos em produção** — o modo demo é ponte, não destino

---

## 9 — Riscos conhecidos

| Risco | Sinal de alerta | Mitigação |
|---|---|---|
| Infra Supabase trava tudo | Fase 1 parada há semanas | Avaliar Supabase gerenciado como plano B — decisão revisável (§2) |
| Divergência visual entre módulos | 3º módulo copiando do RH | Extrair Design System antes (D2) |
| "Integrado" perde significado | Módulo em produção com mocks | Status `Homologado` (D1) |
| Demo vira produto | Diretoria usando dados fictícios para decidir | Marcação visual explícita de modo demonstrativo |
| Roadmap de 10 módulos vira maratona | Fase 4 sem entrega há muito tempo | Um módulo por vez, completo, até produção |

---

## 10 — Como mudar este documento

Este blueprint **não é engessado**. Ideias de otimização são bem-vindas e esperadas.

**Mudança leve** (ordem de módulos, escopo de fase, ferramenta, estrutura de pastas):
alterar direto e anotar a data e o motivo em uma linha. Não precisa de cerimônia.

**Mudança estrutural** (qualquer um dos seis princípios do §2, ou pular uma pré-condição
de fase): registrar antes de executar — o que muda, por quê, o que isso quebra, e como
voltar atrás se der errado. Não é burocracia; é para que daqui a seis meses a decisão
ainda faça sentido.

**Boas otimizações a trazer a qualquer momento:** simplificar o contrato de módulo,
reduzir passos do ciclo, automatizar validação, antecipar valor de uma fase posterior
sem violar suas pré-condições, ou eliminar algo daqui que não esteja pagando o próprio
custo.

Se uma regra deste documento estiver atrapalhando o trabalho real, o padrão é
**questionar a regra**, não contorná-la em silêncio.

---

## Referências

| Documento | Conteúdo |
|---|---|
| [`modules/README.md`](../modules/README.md) | Contrato de módulos |
| [`docs/SDK-MODULOS-PECSIL.md`](./SDK-MODULOS-PECSIL.md) | Gerador e SDK |
| [`docs/IMPLANTACAO-SUPABASE-PECSIL.md`](./IMPLANTACAO-SUPABASE-PECSIL.md) | Ordem de implantação e critérios de aceite |
| [`docs/PENDENCIA-INFRA-SUPABASE.md`](./PENDENCIA-INFRA-SUPABASE.md) | Bloqueio de infraestrutura (Fase 0) |
| [`modules/planned.ts`](../modules/planned.ts) | Roadmap de módulos em código |
| [`docs/PROCESSOS-PECSIL.md`](./PROCESSOS-PECSIL.md) | Cadeias entre departamentos (base das reações entre módulos) |
| [`docs/PLANO-SEGUNDO-CEREBRO.md`](./PLANO-SEGUNDO-CEREBRO.md) | Segundo Cérebro: coleta de arquivos dos computadores, guarda por setor, ligações com o banco e busca (memória da SARA) |
| [`docs/PLANO-JEV.md`](./PLANO-JEV.md) | Uso do modelo de decisão (Jev, depois Clef): etapas, regras e calibração |
| [`docs/VISAO-PRODUTO-ESCALA.md`](./VISAO-PRODUTO-ESCALA.md) | **Retomar ao fim do roadmap:** levar o Business OS a outras indústrias — diferenciais, prioridades P1–P4 e reflexos no sistema |
| [`.env.example`](../.env.example) | Variáveis necessárias |
