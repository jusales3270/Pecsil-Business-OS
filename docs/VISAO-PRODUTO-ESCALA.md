# Visão de produto — do PecSil Business OS para outras indústrias

> **Status:** as frentes comerciais (prova de resultado, modelo de negócio, produtização)
> continuam estacionadas até concluir o roadmap do Business OS
> (`docs/BLUEPRINT-PECSIL-BUSINESS-OS.md`, Fases 0–7). **Desde 11/10/2026, porém, o jeito de
> construir já é de produto**: ver a seção 6. Ao retomar, cada item abaixo é ligado à fase
> correspondente do sistema completo.
>
> Registrado em 21/09/2026, a partir da análise de um estudo de caso: uma indústria
> de alumínio em Cabreúva (SP) e a consultoria Kistra, parceira da Acelera 360.

---

## 1. A tese

O conhecimento de quem **vive a operação** de uma indústria vira software. Esse
software é entregue como **serviço** a outras indústrias parecidas
("service-as-software").

- **Mercado:** indústrias familiares, pequenas e médias. Faturam bem, mas "têm muito
  dinheiro parado" e muitas vezes estão "dirigindo um caminhão cego".
- **O diferencial não é a IA genérica.** É o conhecimento vertical do processo
  industrial transformado num sistema operacional com IA por cima.
- **O papel da PecSil:** é a **fábrica de validação**. O que funcionar aqui, medido
  e com resultado comprovado, é o que se leva à segunda empresa.

O caso analisado é quase idêntico ao nosso: um diretor operacional de indústria
familiar construiu o próprio sistema e o validou no chão da fábrica. O momento que
convence é o dono ver no celular "quanto custa cada item".

---

## 2. Diferenciais que já temos (e onde estão no sistema)

| Diferencial | Por que vende | Onde está |
|---|---|---|
| **Dado real do chão de fábrica** | Tira a indústria do "caminhão cego": OS, fundição fase a fase, paradas, gargalos em horas, pontualidade | Produção ↔ Forja: `lib/forja/client.ts`, `lib/forja/forja-session.ts`, `modules/producao/src/ProducaoApp.tsx` |
| **Acesso por funcionalidade, garantido pelo banco** | Cada pessoa (inclusive terceiro, com validade) vê só o que foi liberado. Raro em ERP de empresa média. | `modules/access-catalog.ts`, migrações `202609190001_user_access.sql`, `202609190002_feature_rls.sql`, `202609200001_external_users.sql`; matriz de testes `scripts/access-matrix-check.mjs` |
| **Base para a IA já construída** | A SARA vai precisar de fatos organizados, e a maioria das empresas que vendem IA para indústria não tem essa base | Trilha de eventos `202609210001_module_events.sql` + `modules/event-catalog.ts`; cadastros mestres `202609210002_master_data.sql`; telas `app/components/event-trail.tsx`, `app/components/master-data.tsx` |
| **Dados dentro da empresa** | Indústria familiar desconfia de nuvem; o dado fica no servidor dela | Hospedagem própria (Coolify + Supabase); Supabase fechado atrás do gateway `app/sb` |
| **Plataforma modular** | Vende-se só o que o cliente precisa; módulo novo sem refazer o resto | Contrato de módulos `modules/types.ts`, `modules/registry.ts` |
| **Uso no chão de fábrica pelo celular** | Instalável, funciona no celular do encarregado | PWA do Business OS |

---

## 3. O que incluir, por prioridade

Legenda:
- **P1:** sem isso não dá para vender nem mostrar o "número que arrepia";
- **P2:** transforma o ERP em ecossistema com inteligência;
- **P3:** transforma o sistema da PecSil em produto;
- **P4:** estratégia de negócio e escala.

### P1.1 — Pré-requisitos para levar a outra empresa (confiabilidade)
- **Por quê:** ninguém compra um sistema que cai. A confiança é o produto.
- **Reflexo no sistema:**
  - estabilizar o HTTPS (a porta 443 oscilou em 18 e 19/09);
  - fechar as portas públicas do Supabase;
  - trocar as chaves (JWT, anon, service_role) e desligar o cadastro público no GoTrue;
  - remover os **números fixos do Financeiro** (fluxo de caixa, bancos, centros de custo em `app/components/finance-module.tsx`);
  - corrigir o webhook de deploy automático do Coolify.
- **Fase do blueprint:** Fase 0 e Fase 3.
- **Pronto quando:** uma semana sem queda, portas fechadas, chaves novas e nenhum dado fictício em tela.

### P1.2 — Almoxarifado / Estoque ("dinheiro parado")
- **Por quê:** o vídeo destaca o estoque gigantesco e o capital parado. Além disso, é o elo que falta na cadeia real da PecSil: Compras aprova → Almoxarifado recebe → Financeiro gera a conta a pagar (`docs/PROCESSOS-PECSIL.md`, Cadeia 1).
- **Reflexo no sistema:**
  - novo módulo (hoje "planejado" em `modules/planned.ts`): recebimento contra a cotação aprovada, entradas e saídas, saldo, giro e capital parado;
  - cadastro mestre de **item** (ainda não existe; fornecedor e centro de custo já existem);
  - eventos `estoque.recebimento.confirmado` etc. na trilha.
- **Fase do blueprint:** Fase 4.
- **Pronto quando:** um pedido aprovado é recebido no sistema, o saldo se move e o capital parado aparece.

### P1.3 — Custo real por OS / peça / cliente ("quanto custa cada item")
- **Por quê:** é a frase-chave do caso e o momento que convence um dono de indústria.
- **Reflexo no sistema:** juntar três fontes que hoje estão separadas:
  - tempo por operação e paradas (Forja);
  - material (Compras → Almoxarifado, via item e centro de custo);
  - custo-hora (RH).

  O resultado é custo e margem por OS, por peça e por cliente, mais o **custo da parada**.
- **Depende de:** P1.2 (material por item), do mapeamento de como a PecSil calcula custo hoje e de trazer eventos do Forja para a trilha.
- **Fase do blueprint:** Fase 4 e Fase 5.
- **Pronto quando:** para uma OS finalizada, o sistema mostra o custo real comparado ao orçado e a margem, e o número bate com a conferência manual.

### P2.1 — Painel executivo cruzado ("o número no celular")
- **Por quê:** indicadores que só existem juntando módulos; é a vitrine do sistema.
- **Reflexo no sistema:**
  - custo da parada;
  - compras × produção;
  - capital parado;
  - pontualidade por cliente;
  - margem por produto;
  - leitura da trilha de eventos e dos cadastros mestres;
  - visão móvel para o dono.
- **Fase do blueprint:** Fase 5 (camada analítica corporativa).
- **Pronto quando:** o dono abre no celular e vê os 5 números que decidem a semana.

### P2.2 — SARA como conselheira (o papel de quem vem de fora)
- **Por quê:** no caso, quem vem de fora aponta gargalos que o dono não vê. A SARA faz esse papel todo dia.
- **Reflexo no sistema:**
  - ler a trilha de eventos e os indicadores;
  - alertar sobre cadeias travadas (ex.: "3 compras aprovadas há 10 dias sem recebimento");
  - apontar gargalos ("a Fundição concentra 60% da carga");
  - fazer um resumo diário;
  - responder perguntas em linguagem natural, **herdando as permissões de quem pergunta**.
- **Fase do blueprint:** Fase 6.
- **Pronto quando:** a SARA gera, sozinha, um alerta útil por semana, confirmado pela operação.

### P2.3 — Reações entre módulos (a virada de ERP para ecossistema)
- **Por quê:** hoje os módulos anunciam o que acontece, mas nenhum outro módulo reage.
- **Reflexo no sistema:** assinaturas do tipo "quando o evento X, o módulo Y faz Z", cadeia a cadeia. Exemplos:
  - recebimento → conta a pagar (o título já aceita `source_module`/`source_entity_id`);
  - desligamento → bloqueio de acesso → Portaria.
- **Depende de:** cada cadeia confirmada em `docs/PROCESSOS-PECSIL.md`.
- **Fase do blueprint:** Fase 4 e Fase 5.
- **Pronto quando:** a Cadeia 1 roda de ponta a ponta sem planilha nem WhatsApp.

### P3.1 — Produtização (da PecSil para qualquer indústria)
- **Por quê:** para a segunda empresa, o sistema não pode ter a PecSil "no código".
- **Reflexo no sistema:**
  - **Roteiro de implantação:** diagnóstico, mapeamento de processos (o `PROCESSOS-PECSIL.md` vira modelo), importação da folha, dos fornecedores e dos itens.
  - **Adaptadores de produção:** o Forja é da PecSil. Outras fábricas precisam de apontamento próprio, ou de integração com o sistema que já usam.
  - **Separar o que é específico:** nome e marca, integração com o Forja, os ajustes de "caixa 1/2" do Compras, textos fixos.
  - **Decidir o modelo de hospedagem:** um servidor por cliente (os dados na empresa, que é o diferencial) ou nuvem com várias empresas (`organization_id` já existe em todas as tabelas).
- **Fase do blueprint:** depois da Fase 5; é pré-requisito da escala.
- **Pronto quando:** uma segunda indústria é implantada em semanas, sem mudar código.

### P3.2 — Prova de resultado (o estudo de caso PecSil)
- **Por quê:** o que vende para a segunda indústria é o resultado medido na primeira.
- **Reflexo no sistema:**
  - registrar agora a **linha de base** (pontualidade, tempo parado, capital parado e custo por peça, quando existir);
  - medir de novo após cada fase;
  - a trilha de eventos já guarda o histórico para isso.
- **Fase do blueprint:** contínuo, a partir de agora.
- **Pronto quando:** existe um "antes × depois" em números, apresentável.

### P4.1 — Modelo de negócio: serviço com software
- **Por quê:** o caso mostra que não se vende o software, e sim o serviço de transformação, com o conhecimento embarcado no software.
- **Reflexo:**
  - oferta em camadas: diagnóstico, implantação por módulo e acompanhamento com a SARA;
  - precificação;
  - contrato e suporte;
  - possível parceria com consultorias ou redes do setor.
- **Fase do blueprint:** estratégia, fora do código.

### P4.2 — Module Builder (criar módulos sem código)
- **Por quê:** cada indústria tem uma particularidade. Criar módulos por IA reduz o custo de atender cada nicho.
- **Fase do blueprint:** Fase 7 (backlog estratégico).

---

## 4. Como retomar

1. Ao concluir o roadmap do blueprint, reler este documento e o `docs/PROCESSOS-PECSIL.md`.
2. Confirmar com o proprietário a ordem das prioridades (pode ter mudado com o uso real).
3. Para cada item, abrir o planejamento a partir do **"reflexo no sistema"** e do **"pronto quando"** acima.
4. Manter a regra do ecossistema: **eventos agora, reações só com o processo mapeado**.

## 5. O que pesa contra hoje (honestidade para a retomada)

- Infraestrutura ainda frágil: HTTPS oscilando, Supabase exposto, chaves antigas.
- Financeiro com dados fictícios em tela.
- Almoxarifado inexistente: a cadeia de compras para no meio.
- A Produção depende do Forja, que é específico da PecSil.
- Integração ainda "só fala": os módulos anunciam, mas ninguém reage.

## 6. Diretriz de construção: produto multiempresa (11/10/2026)

Decisão do proprietário: o Business OS vai ser **empacotado como produto para outras
empresas**. A PecSil continua sendo a fábrica de validação e a primeira cliente, mas **toda
arquitetura e toda feature nova já nascem pensadas para dados empresariais genéricos**. A
identidade e as regras de cada empresa são **variáveis** que respondem a um mesmo núcleo, o
**"harness business"**.

### 6.1 O que vira variável de cada empresa

| Variável | Hoje, na PecSil | Destino |
|---|---|---|
| Identidade (razão social, CNPJ, IE, endereço, telefones) | `lib/empresa.ts` (`EMPRESA_PECSIL`) e `CNPJ_PECSIL` em `lib/finance/extrato-classificar.ts` | **Feito em parte (12/10/2026):** `fiscal_config` (Fiscal › Configuração) guarda o emitente por organização. A Ordem de Compra passa a ler dali quando for mexida. |
| Certificado digital, série e numeração, regras fiscais | — | `fiscal_config` + cofre (Vault) + `fiscal_series`, por organização ([FISCAL-NFE.md](FISCAL-NFE.md)) |
| Marca (logo claro e escuro, cores, nome na tela) | `public/pecsil-logo*.png`, texto "Pecsil Molds for Glass" | Configuração da empresa |
| Setores e módulos ativos | `lib/documentos/setores.ts`, `SETORES_COLETA`, catálogo de acesso | Configuração da empresa sobre o catálogo comum |
| Regras de triagem (bancos, palavras do ramo, como "fundição" e "forno") | `lib/coleta/triagem.ts`, `lib/leitura/conteudo.ts` | Dicionário por empresa, com o comum como base |
| Integrações (ex.: Forja na Produção) | `lib/forja/` | Conector por empresa |
| Nome do cookie de sessão | `sb-pecsil-auth-token` | Derivado da instalação |

**Licença do transmissor de NF-e (12/10/2026):** a biblioteca gratuita que fala com a SEFAZ
(NFeWizard) é GPL-3.0. Por isso ela vive num **serviço separado** (`services/transmissor-nfe`,
GPL, código aberto próprio), e a plataforma fala com ele por HTTP, pelo contrato em
`lib/fiscal/transmissor/`. A plataforma não importa nada dele e continua com a licença que o
proprietário escolher. Trocar por uma API paga é trocar a implementação do contrato.

### 6.2 Regras para construir daqui em diante

1. **Código novo não fixa a PecSil.** Lê a identidade da organização ou da configuração da
   empresa. Exemplo do jeito certo: as ligações por regra excluem o CNPJ da própria empresa
   lendo `organizations.tax_id`, e não uma constante.
2. **O banco já é multiempresa** (`organization_id` em tudo, RLS por organização). Manter
   assim em toda tabela nova.
3. **Vieses da PecSil são bem-vindos**, desde que entrem como dado ou configuração, e não
   como regra escondida no código.
4. Os pontos fixos da tabela 6.1 são levados para configuração **quando o trabalho passar
   por eles**, sem refatoração avulsa.
5. As frentes comerciais (cadastro de empresas no login, cobrança, onboarding de cliente)
   só começam com pedido do proprietário. A diretriz muda o jeito de construir, não a ordem
   do roadmap.

### 6.3 Referência estudada: "AI Operating System" (11/10/2026)

Um vídeo sobre um sistema operacional de IA para empresas (cérebro em pasta + harness +
executor de ações + filas + cofre de segredos). O que serve para nós, com o nosso
alinhamento (nota geral: cerca de 70 de 100):

| Padrão | Nós | Situação |
|---|---|---|
| Números no banco; o cérebro só sabe onde buscar | Banco como fonte única; Segundo Cérebro como camada de ligações e busca | Feito |
| Sistema próprio, aberto, auto-hospedado | Coolify no servidor da empresa; OCR e busca pelo sentido locais | Feito |
| Tudo que entra passa por triagem e cai numa fila de decisão humana | Sino, aprovações, fila de Sugestões da IA, "mostra e confirma" | Em boa parte |
| O cérebro guarda conhecimento **e processos** | Documentos por setor, texto, ligações e busca; processos em `docs/PROCESSOS-PECSIL.md` | Falta transformar processo em habilidade da SARA |
| Segredos só como apelido, com valor num cofre e registro de uso | Variáveis no Coolify, nunca no código | Falta o cofre |
| Harness para conversar com o cérebro | A SARA, sempre com a permissão de quem pergunta | Planejado |
| Executor de ações separado do cérebro | Eventos dos módulos (`module_events`); reações só com o processo mapeado | Planejado |
| Conversas com a IA guardadas por empresa e setor | A SARA deve registrar as conversas, com permissão | Planejado |

**Nossa vantagem sobre a referência:** lá o cérebro é uma pasta, e quem a abre vê tudo.
Aqui há **permissão por pessoa e por setor** em tudo, inclusive na busca e nas ligações, e
o RH é tratado à parte por causa da LGPD.

**Lacunas que mais pesam:** SARA (harness), reações automáticas (executor) e cofre de
segredos.
