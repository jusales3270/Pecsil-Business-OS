# Plano do módulo Contábil-Fiscal do ECOS

> Núcleo contábil próprio, dois modos de operação (contabilidade interna / escritório externo),
> parâmetros legais com vigência e a **Sentinela**, que mantém o módulo atualizado.
> Criado em 25/10/2026 · Dono: proprietário · Execução: Claude · Ordem: [ROADMAP.md](ROADMAP.md), raia N.
>
> Sementes: [contabil/parametros-2026.json](contabil/parametros-2026.json) (34 parâmetros com fonte) ·
> [contabil/teses.json](contabil/teses.json) (35 teses, firmadas × pendentes) ·
> [contabil/fontes-sentinela.md](contabil/fontes-sentinela.md) (fontes testadas, URL a URL).

---

## 0. Contexto do produto

- A plataforma passa a se chamar **ECOS**. O GRV é só fonte dos dados em migração; o Marco 1 é
  desligá-lo.
- O ECOS vira produto: referência de **R$ 155 mil** (implantação + sistema próprio, sem licença por
  usuário) com **suporte de R$ 3–6 mil/mês**, cerca de 20% abaixo da mediana dos ERPs industriais
  (≈ R$ 200 mil no 1º ano + R$ 4–12 mil/mês). A mensalidade é o que cobre o risco de continuidade.
- Objeções que o comprador vai levantar e que este módulo fecha: **contabilidade própria** (razão,
  DRE, balanço), **SPED e folha** com o escritório, **IBS/CBS parcial** (a primeira pergunta de
  qualquer indústria em 2026). MRP, custo e margem, NF-e em produção, estoque, boleto/Pix e nuvem
  são de outras raias.
- **Decisão do proprietário (25/10/2026): dois modos de operação sobre o mesmo núcleo.**
  1. **Contabilidade interna**: a empresa tem contador e auxiliares próprios e faz o ciclo
     contábil-fiscal inteiro no ECOS.
  2. **Escritório externo**: a empresa delega a um escritório, que entra pelo Portal do escritório
     que já existe (`fiscal_portal_*`, competências, checklist, malotes, guias), com a permissão dada
     por quem responde pelo setor na empresa.
- A Sentinela e a curadoria dos parâmetros legais são o argumento da mensalidade: o sistema se
  mantém atualizado. Nenhum concorrente da tabela vende isso assim.
- Folha: capacidade do produto, **desligada na Pecsil** (decisão da equipe de não guardar salário).
  Entra quando houver cliente que precise; na Pecsil só se a Rosana e a Ana reverem.
- Construção: **não começa agora** (decisão de 25/10, "só registrar"). As três frentes estão
  ocupadas (B-12 conector, B-04 WhatsApp, I-01 unificação). Entra quando uma frente fechar.

## 1. Origem: o pacote "57 Agents Contabilidade"

Pacote de 57 subagentes do Claude Code (ASV Digital / Bravy) para escritório contábil com carteira
de clientes. Lido por inteiro em 25/10/2026. Licença "não redistribuir". Fica **só a ideia** (o que
conferir, o que cruzar, erros comuns); nenhum texto nem tabela é copiado. A Lei 9.610/98, art. 8º,
não protege ideias, métodos nem texto de lei.

Erros do pacote confirmados pela pesquisa oficial (viram casos de teste):

| O pacote diz | O certo em 2026 | Fonte |
|---|---|---|
| Salário mínimo R$ 1.518 | **R$ 1.621** | Decreto 12.797/2025 |
| Teto do INSS R$ 8.157,41 | **R$ 8.475,55** | Portaria MPS/MF 13/2026 |
| IRRF só pela tabela | Tabela + **redução da Lei 15.270/2025** (zera até R$ 5 mil) | Lei 15.270/2025 |
| DCTFWeb dia 25 (agente 08) e dia 15 (agente 25) | **Último dia útil** | IN RFB 2.248/2025 |
| FGTS dia 7 (agentes 19 e 35) | **Dia 20** | Lei 8.036 art. 15; FGTS Digital |
| Dispensa de CSRF até R$ 215,05 | **DARF até R$ 10** | Lei 13.137/2015 |
| 8109 = PIS não cumulativo; 8301 = cumulativo | 8109 cumulativo; **6912** não cumulativo; 8301 é PIS sobre folha | SIEF Receitas |
| Devolução de venda em CFOP 1.949 | 1.201/1.202 e 2.201/2.202 | Tabela CFOP |
| GIA exigida em SP | Dispensada para o RPA desde 01/01/2026 | Portaria SRE 2/2025 |
| Lei 14.759/2023 = Carnaval | É a da Consciência Negra | Lei 14.759/2023 |
| `vt = min(salario * 0.06, 0)` (agente 35) | Sempre zero: bug | — |

Premissas minhas que a pesquisa corrigiu (também viram teste): a Súmula 463 do STJ é IR sobre horas
extras indenizadas (aviso prévio indenizado é o **Tema 478**); o Tema 1125 é ICMS-ST na base do
PIS/COFINS; o Tema 1247 do STF é anterioridade nonagesimal, não subvenção.

## 2. Estudo de caso: Pecsil, indústria no interior de SP, outubro de 2026

Pesquisa em cinco frentes (mapa interno, parâmetros federais, reforma, jurisprudência, fontes
monitoráveis). Cada fato tem norma, URL e confiança; o detalhe está nas sementes em `docs/contabil/`.
Onde o Planalto ou um PDF oficial não respondeu, a confirmação veio de cópia integral (Câmara/legin,
normaslegais) ou de imprensa especializada, e está marcado como média.

### 2.1 Perfil que define as regras

| Dado | Onde está | Situação |
|---|---|---|
| UF, município (IBGE), CNAE, CRT | `fiscal_config` (uma linha por organização) | Preenchido para a NF-e; CRT 3 = regime normal; a plataforma não distingue Presumido de Real |
| Regime de IRPJ (Presumido × Real) | Não existe | **Decisão a registrar** (Jefferson + contador). Muda a LC 224, os créditos de PIS/COFINS, o Tema 779 e o N-13 |
| Receita bruta anual | Títulos e NF-e (incompleto até a virada do GRV) | Necessária para o limite de R$ 5 mi da LC 224 |
| CNAE secundários, RAT, FAP | Não existem | FAP 2027 publicado (Portaria MPS/MF 16/2026; contestação 1 a 30/11/2026) |
| Benefício fiscal estadual | Não existe | Se houver, entram o Tema 843 (STF), o Tema 1416 (STJ) e o FCBF (habilitação 2026–2028 pelo e-CAC) |

### 2.2 Parâmetros federais 2026 (resumo; a íntegra está em `parametros-2026.json`)

| Item | Valor / regra 2026 | Norma | Conf. |
|---|---|---|---|
| Salário mínimo | R$ 1.621,00 | Decreto 12.797/2025 | alta |
| INSS segurado | 7,5% até 1.621,00 · 9% até 2.902,84 · 12% até 4.354,27 · 14% até 8.475,55 (teto) | Portaria MPS/MF 13/2026 | alta |
| Salário-família | R$ 67,54 por filho; remuneração ≤ R$ 1.980,38 | Portaria MPS/MF 13/2026 | alta |
| IRRF mensal | Tabela de mai/2025 (isento até 2.428,80 … 27,5% acima de 4.664,68; dependente 189,59; simplificado 607,20) + **redução Lei 15.270**: ≤ 5.000 zera; 5.000,01–7.350 → 978,62 − 0,133145 × rendimento | Lei 15.191/2025; Lei 15.270/2025 | alta |
| Dividendos | 10% na fonte acima de R$ 50 mil/mês por PF; fora os lucros até 2025 aprovados até 31/12/2025; IRPFM só na declaração de 2027 | Lei 15.270/2025 | alta |
| FGTS | 8%; dia 20; rescisório no 10º dia; multa 40%; adicional de 10% extinto | Lei 8.036; Lei 13.932/2019 | alta |
| Prazos | eSocial e Reinf dia 15 · DCTFWeb último dia útil · EFD-Contribuições 10º dia útil do 2º mês · EFD ICMS/IPI SP dia 20 · GIA dispensada · ECD junho · ECF julho · DIRF extinta | IN 2.248/2025; IN 2.043; IN 1.252; CAT 147/2009; SRE 2/2025; IN 2.003 e 2.004 | alta |
| Terceiros | Base integral (sem teto de 20 SM) | STJ Temas 1.079 e 1.390 | alta |
| Lucro Presumido | 8% / 12%; **LC 224/2025**: 8,8% / 13,2% só na parcela da receita anual acima de R$ 5 mi (IRPJ desde jan/2026, CSLL desde abr/2026) | LC 224/2025; IN 2.305 e 2.306 | alta |
| PIS/COFINS | 1,65%/7,6% e 0,65%/3%; receita financeira 0,65%/4%; ICMS fora da base e fora dos créditos (05/2023) | Leis 10.637, 10.833; Decreto 8.426; Lei 14.592 | alta |
| Códigos DARF | 2089 · 0220 · 2362 · 2430 · 2372 · 6012 · 2484 · 6773 · 8109 · 6912 · 2172 · 5856 · 5123 · 1708 · 8045 · 5952 | SIEF (reproduzido) | média |

### 2.3 Retenções que a empresa faz como tomadora

| Retenção | Regra | Norma | Conf. |
|---|---|---|---|
| IRRF | 1,5% profissionais; 1% limpeza, vigilância, locação de mão de obra; dispensa ≤ R$ 10; não retém de Simples; dia 20 | RIR/2018 arts. 714/716 (numeração a confirmar); Lei 9.430 art. 67 | alta / média |
| CSRF 4,65% | Serviços do art. 30; dispensa ≤ R$ 10; código 5952; dia 20 do mês seguinte ao pagamento | Lei 10.833 arts. 30, 31, 35 | alta |
| INSS 11% | Só cessão de mão de obra ou empreitada (rol taxativo); materiais discriminados fora da base; IN 2.289/2025 tirou empreitada total; R-2010 → DCTFWeb; dia 20. Usinagem e manutenção: SC Cosit 28/2017 e 93/2021 (só com subordinação) | Lei 8.212 art. 31; IN 2.110/2022 | alta / média |
| ISS | Prestador, salvo lista do art. 3º; tomador responsável nos subitens do art. 6º §2º; no interior só se a lei do município prevê | LC 116/2003 | média |

### 2.4 Reforma tributária: o que já vale e o que vem

| Quando | O quê | Conf. |
|---|---|---|
| 2026 | CBS 0,9% + IBS 0,1% só destacados; apuração informativa; recolhimento dispensado para quem cumpre as obrigações acessórias; NF-e com grupos IBS/CBS **obrigatória desde 03/08/2026** (sem rejeição por ora); NT 2025.002 v1.52; Programa de Conformidade até 31/12/2026 | alta |
| 2027 | CBS plena; PIS/COFINS extintos; **IPI zero** para as peças da Pecsil (exceção ZFM, lista pendente); Imposto Seletivo **não alcança** fundição/usinagem; split payment opcional (obrigatório sinalizado para 2028, sem ato) | alta / média |
| Alíquota | Estimativa 27,91% (Res. CGIBS 14/2026); **CBS 2027 por Resolução do Senado até 15/12/2026** | média-alta |
| 2029–2032 | ICMS/ISS caem 10% ao ano; benefícios reduzidos; FCBF só para benefícios onerosos | alta |
| 2033 | ICMS/ISS extintos; saldos credores de ICMS: homologação em 5 anos, IPCA, 240 parcelas | alta |
| Sempre | Exportação imune com crédito; crédito integral e imediato em bens de capital; EPI e uniforme com crédito; fim da ST | alta |
| Integração | Apuração assistida (LC 214 art. 46); APIs de apuração da CBS em piloto/beta; DeRE v1.3.0 | média |

### 2.5 Jurisprudência: firmada × pautada (íntegra em `teses.json`)

Firmadas com modulação definida: STF 69, 985, 962, 1093/ADI 7066/1266, ADC 49, 1046, 1247;
STJ 779, 1125, 1372, 1364, 1223, 1231, 1312, 1373, 1174, 1.079, 478 e 1170; TST OJ 394, Súmula 60,
IRR 239-55, Súmula 441; CARF (súmulas 72, 101, 104, 14, 25; Portaria MF 1.785/2026); SC Cosit
(EPI, frete de insumo, energia, manutenção, IPI por encomenda, retenção de 11%).

Pautadas ou sem modulação, que a Sentinela vigia primeiro:

| Tema | Estado em 25/10/2026 | Impacto |
|---|---|---|
| STF 118 (ISS fora de PIS/COFINS) | Mérito julgado em 21/10/2026 (6×5); modulação pendente | Usinagem sob encomenda com ISS; recuperar 5 anos exige ação antes da ata dos ED |
| STF 843 (crédito presumido de ICMS fora de PIS/COFINS) | Mérito 07/10/2026; modulação pendente | Só com crédito outorgado em SP |
| STJ 1416 (crédito presumido de ICMS no IRPJ/CSLL pós-Lei 14.789) | Afetado, suspensão nacional | Idem |
| STJ 1412 (bonificações e descontos) | Adiado sem data | Compras com bonificação |
| STJ 1390 (ED) | Modulação do fim do teto de 20 SM | Cobrança retroativa de 5 anos |
| STF 1067 (PIS/COFINS na própria base) | Sem pauta | Passado até 2026 |
| STF 1401 (trava de 30% na extinção) | Pendente | Reorganizações |
| Reforma (13 ações; ADI 8002 CNI × LC 224) | Sem mérito; ADIs 7779/7790 julgadas em 03/08/2026 | LC 224 pode cair; exceções da LC 214 podem ser revistas |
| Senado | Alíquota da CBS 2027 até 15/12/2026 | Preço do orçamento 2027 |
| Executivo | MP do Imposto Seletivo; lista ZFM do IPI; ato do split payment; ato do art. 109 | Caixa e preço |

### 2.6 Lacunas (ficam `rascunho` até conferir)

Numeração dos arts. 714/716 do RIR e rol do art. 112 da IN 2.110 (Planalto e PDF inacessíveis);
códigos DARF pela página oficial do SIEF; texto literal do Tema 1266 e dos ED do Tema 1390;
enunciados das súmulas CARF e TST no site oficial; Pareceres PGFN 4366/2025 e 784/2026 (PDF sem
texto); conteúdo da Res. CGIBS 13/2026 e dos ATC 5–8/2026; data-fim da suspensão das rejeições da
NF-e; taxas de depreciação no texto da IN 1.700; prazo do ICMS para a CPR da Pecsil; lei do ISS do
município da Pecsil; INLABS e in.gov.br não responderam em 25/10 (validar de outra rede).

## 3. Arquitetura

### 3.1 Três camadas de parâmetro, todas com vigência

| Camada | Escopo | Exemplos | Quem mantém |
|---|---|---|---|
| 1. Legal | Igual para todas as empresas | Tabelas de INSS e IRRF, salário mínimo, códigos DARF, prazos federais, alíquotas interestaduais, retenções, cronograma da reforma, taxas de depreciação, feriados nacionais, **teses** | A plataforma (curadoria central), alimentada pela Sentinela |
| 2. UF / município | Por estado e por município | Vencimento do ICMS por CPR, alíquota interna, Agenda Tributária Paulista, ISS e retenção municipal, feriados locais | A plataforma, alimentada pela Sentinela (DOE-SP, Sefaz-SP) |
| 3. Empresa | Por `organization_id`, com RLS | **Modo de operação**, regime (Presumido/Real), CNAE secundários, RAT×FAP, benefício estadual, escritório, **exceções** com motivo | Quem responde pela área na empresa (Pecsil: Jefferson com o contador; Ana; Rosana) |

Precedência na leitura: exceção da empresa > município > UF > legal, sempre pela **data do fato
gerador**.

### 3.2 Esquema (migração da N-01)

> **Construído em 25/10/2026** (`supabase/migrations/202610250006_contabil_parametros.sql`). Diferenças do desenho abaixo:
> a curadoria é a tabela `contabil_curadoria` (uma organização, hoje a Pecsil) + a permissão `fiscal.parametros`
> (operar); a situação é `rascunho | conferido | descartado` (conferir uma versão nova fecha a anterior na véspera,
> em vez de marcá-la "substituída"); cada parâmetro tem `titulo`; `contabil_propostas`, `contabil_fontes`,
> `contabil_itens_coletados` e `contabil_excecoes` ficam para a N-02 (Sentinela) e para quando houver a primeira
> exceção. A auditoria e os eventos da curadoria saem em nome da organização curadora (a tabela é global).

```sql
-- Camadas 1 e 2: sem organization_id; leitura para todos; escrita só pela função de curadoria.
contabil_parametros (
  id uuid pk, chave text, escopo text check (escopo in ('legal','uf','municipio')),
  uf char(2), codigo_municipio char(7), valor jsonb,
  vigente_de date, vigente_ate date,
  fonte jsonb,              -- {norma, url, trecho}
  situacao text check (situacao in ('rascunho','conferido','substituido')),
  origem text check (origem in ('carga_inicial','sentinela','manual')),
  proposta_id uuid, conferido_por uuid, conferido_em timestamptz,
  unique (chave, escopo, uf, codigo_municipio, vigente_de)
)
contabil_teses (id, tribunal, tema, titulo, tese, data, modulacao, situacao, impacto,
                parametros_afetados text[], fontes jsonb, confianca, atualizado_em)
contabil_propostas (id, fonte_id, item_hash, tipo ('parametro'|'tese'|'sinal'),
                    chave, valor_atual jsonb, valor_proposto jsonb, vigente_de,
                    norma, url, trecho, confianca, nivel ('automatico'|'assistido'|'tese'|'sinal'),
                    decisao_id, situacao ('aberta'|'aprovada'|'recusada'|'aplicada'), criado_em)
contabil_fontes (id, nome, url, formato, cadencia, ultimo_item_em, ultimo_erro, silencio_maximo)
contabil_itens_coletados (id, fonte_id, hash sha256, titulo, data_publicacao, url, documento_id, triagem jsonb)

-- Camada 3: por organização, com RLS e audit_mudanca('contabil').
contabil_perfil_empresa (organization_id pk, modo ('interna'|'escritorio'), regime ('presumido'|'real'),
                         cnaes_secundarios text[], rat numeric, fap numeric, beneficio_estadual jsonb,
                         escritorio jsonb, atualizado_por, atualizado_em)
contabil_excecoes (id, organization_id, chave, valor jsonb, vigente_de, vigente_ate, motivo, aprovado_por)

-- Núcleo contábil (N-04 e N-05): plano_contas_contabil, regras_lancamento (evento → partidas, com vigência),
-- lancamentos (cabeçalho), partidas (D/C), competencias (trava), com RLS.
```

### 3.3 Contrato das funções de cálculo (`lib/contabil/`)

```ts
type Vigencia = { chave: string; valor: unknown; vigenteDe: string; fonte: { norma: string; url: string }; situacao: "rascunho" | "conferido" };
type Memoria = { passo: string; valor: number; usa: Vigencia[] }[];
type Resultado<T> = { resultado: T; memoria: Memoria; aConferir: Vigencia[] };

// Toda função é pura: recebe os parâmetros vigentes na data do fato gerador, o perfil da empresa e os dados.
// Nunca busca nada; nunca chama modelo. Se usa parâmetro `rascunho`, devolve-o em `aConferir`
// e o resultado é marcado "a conferir" na tela e no PDF.
calcularRetencoes(params, perfil, nota): Resultado<{ irrf; csrf; inss11; iss; liquido }>
calcularIrrfMensal(params, { rendimento, inss, dependentes, simplificado }): Resultado<{ imposto; reducao }>
calcularPresumido(params, perfil, { receitaTrimestre, receitaAcumuladaAno, outras }): Resultado<{ irpj; adicional; csll }>
conferirGuia(params, perfil, guia, base): Resultado<{ ok: boolean; divergencias: string[] }>
proximoVencimento(params, perfil, obrigacao, competencia): Resultado<{ data; regra: "antecipa" | "prorroga" | "mantem" }>
lancarEvento(regras, evento): Resultado<Partida[]>   // partida dobrada por regra; D = C ou erro
```

Teste de cada função: exemplos oficiais (tabela, vencimento em feriado, retenção na faixa limite) e um
caso por erro da seção 1.

### 3.4 Retroatividade

Modulação de efeitos ou lei com vigência passada cria uma versão com `vigente_de` no passado. O
motor marca os períodos afetados e gera "o que mudou e desde quando". Não recalcula sozinho o que já
foi pago: a área decide (retificar, compensar, nada).

### 3.5 Núcleo contábil próprio

| Peça | O quê | Reaproveita |
|---|---|---|
| Plano de contas contábil | Sintéticas e analíticas, natureza, **referencial da RFB** (de-para para ECD/ECF), ligado ao plano gerencial de 97 contas e aos centros de custo (F-05/D1) | `finance_chart_accounts`, `lib/finance/plano-contas-core.ts` |
| Lançamentos automáticos por evento | NF-e emitida (receita, impostos como redutores, CMV quando houver estoque); nota de entrada (estoque ou despesa, tributos a recuperar); título e baixa (fornecedores/clientes × banco); conciliação (tarifas, juros); guia paga; depreciação; provisões. A regra é dado, por conta e por evento, com vigência | `module_events`, `finance_*`, `fiscal_dfe`, `fiscal_nfe`, conciliação |
| Lançamento manual e ajuste | Histórico obrigatório, anexo, trilha; estorno nunca apaga | `audit_mudanca` |
| Razão, balancete, DRE, balanço, DFC | Por competência e acumulado; integridade (D = C, sintética = soma) e coerência de natureza; CPC 26; DFC direto pelos bancos | `finance_bank_entries`, `lib/finance/fluxo-90.ts` |
| Fechamento mensal | Checklist por competência (já existe para o escritório em `fiscal_competencias`), trava de período, reabertura com motivo | Portal do escritório |
| Exportação | Razão e lançamentos em CSV/TXT no leiaute que o escritório importa; ECD pelo ECOS quando a escrituração estiver completa | Portal do escritório |

Escrituração é regra determinística: sem IA. A SARA explica um lançamento e aponta inconsistência;
não lança.

### 3.6 Dois modos, um núcleo

| | Contabilidade interna | Escritório externo |
|---|---|---|
| Quem opera | Contador e auxiliares da empresa (`contabil.*`) | Escritório, pelo Portal, com as permissões que quem responde pelo setor concede |
| Lançamentos | O ECOS lança por regra; o contador interno revisa e fecha | O ECOS lança por regra; o escritório revisa, pode exportar |
| Apurações | O ECOS apura e **gera** a guia | O ECOS apura e **confere** a guia devolvida (F-09) |
| Obrigações | O ECOS gera o arquivo; o contador interno assina e transmite | O ECOS gera o arquivo ou os dados; o escritório assina e transmite |
| Fechamento | Checklist da competência dentro da empresa | Checklist compartilhado com o escritório (já existe) |
| Responsável técnico | Contador interno (CRC) | Escritório (CRC) |
| Parâmetros e Sentinela | Iguais: curadoria central | Iguais |

O modo é configuração do perfil (camada 3) e muda sem migração de dados. A Pecsil começa no modo
**escritório externo**.

### 3.7 White label

As camadas 1 e 2 são o serviço que a plataforma vende: curadoria central, uma só para todas as
empresas. Cada empresa mantém o perfil e as exceções e recebe o aviso do que mudou. Nenhum regime,
UF ou CNAE fica no código.

## 4. Sentinela

Nome escolhido porque "Vigia" já é duas coisas (`lib/sara/central/vigia.ts` e o monitor de TI de
[VIGIA-EXTERNO.md](VIGIA-EXTERNO.md)).

> **Construída em 25/10/2026** (`supabase/migrations/202610250007_contabil_sentinela.sql` e `0008`,
> `lib/contabil/sentinela/`, aba Fiscal › Parâmetros legais › Sentinela). 18 fontes ativas na v1; INLABS (DOU),
> Portal da NF-e e sistema de normas da Receita ficam desligados, com o motivo na tela. O envio por "Decisões para
> você" começa desligado (o proprietário liga na própria aba). Lições da primeira coleta real: o RSS de notícias da
> Receita parou em julho (usar o de últimas notícias); a Selic "acumulada no mês" do mês corrente é parcial (gravar
> só mês fechado); datas do Senado em DD/MM/AAAA; o filtro por pasta do CONFAZ devolve vazio (usar por tipo).

### 4.1 Fontes da v1

Catorze fontes, todas testadas em 25/10/2026, com URL, formato, acesso, cadência e restrições em
[contabil/fontes-sentinela.md](contabil/fontes-sentinela.md). Fora da v1: RFB Normas (exige navegador
headless), LexML, STF pauta, STJ repetitivos/SCON, ConJur, Jusbrasil, bases pagas.

### 4.2 Pipeline

```
coleta (cron) → item novo? (sha256 do conteúdo normalizado; só item novo, nunca mudança de layout)
  → triagem por regra (palavras, números de norma, temas vigiados, UF/município das empresas)
  → extração pelo modelo (Haiku, saída tipada): o que muda, qual parâmetro ou tese, vigência,
    norma, trecho citado, confiança. Vai só o texto público; nunca dado de empresa
  → PROPOSTA (contabil_propostas): diff "valor atual → proposto", fonte, trecho, confiança
  → nível de automação (4.3)
  → nova versão do parâmetro + aviso às empresas afetadas + auditoria
  → recálculo marcado (3.4) + alerta da SARA + Bom dia + WhatsApp quando a área liberar
```

Reaproveita: `scripts/sync-os-cron.mjs` + rota `/rodar` com `x-sync-secret` (padrão A);
`guardarOriginalSistema` e `company_document_texts` para guardar o original (novo `source`
`sentinela`: migração); `decisoes` + `sara_responsaveis` para a aprovação (mesmo mecanismo das
lições, `trg_sara_licao_pela_decisao`); `lib/sara/alertas.ts`; `audit_mudanca` e `module_events`
(novo tipo em `modules/event-catalog.ts`); `whatsapp_agendados`. Segredo do INLABS em variável de
ambiente (chave da plataforma, não da empresa). Uso de IA (extração) registrado no Plano do Jev.

### 4.3 Níveis de automação (decididos pelo proprietário em 25/10/2026)

| Nível | O que entra | Como entra |
|---|---|---|
| Automático | Dado de API oficial legível por máquina: Selic, IPCA, INPC, feriados, tabela NCM, FAP | Vigência nova na hora, com auditoria e aviso |
| Assistido (1 clique) | Parâmetro legal lido de norma: tabela, alíquota, prazo, código | Proposta com diff e trecho; quem responde aprova em "Decisões para você"; vale **na hora**, sem deploy |
| Tese | Decisão judicial, súmula, SC Cosit | Entra em `contabil_teses`; só altera parâmetro se houver parâmetro ligado, e aí vira proposta |
| Sinal | Imprensa, tramitação, pauta | Só alerta "pode mudar"; nunca muda nada |

Regra da plataforma mantida: o modelo propõe, uma pessoa confirma. "Imediato" significa que a
aprovação é um clique e vale na hora para todas as empresas, porque parâmetro é dado.

### 4.4 Métricas e teste de regressão

- Métrica: horas entre a publicação oficial e a proposta (meta: < 24 h para DOU e RSS; < 1 h para
  RFB, STF e CGIBS).
- Regressão: rodando sobre o histórico, a Sentinela tem de propor Decreto 12.797/2025, Portaria
  MPS/MF 13/2026, Lei 15.270/2025, LC 224/2025, IN 2.248/2025, Portaria SRE 2/2025, Ato Conjunto
  RFB/CGIBS 4/2026, NT 2025.002 v1.52, Res. CGIBS 14/2026, Portaria MPS/MF 16/2026, Temas 1390,
  1372, 1364 e 118.
- Alarme de silêncio: fonte sem item novo por mais tempo que o normal vira chamado de TI.

## 5. Entregas e critérios de aceite (raia N do roadmap)

| Item | Entrega | Aceite |
|---|---|---|
| N-01 | Fundação: tabelas das três camadas, teses, perfil com o modo, exceções; carga de `parametros-2026.json` e `teses.json` em `rascunho`; tela Fiscal › Parâmetros (ver, conferir, nova vigência, histórico). **Construído em 25/10/2026; falta Deploy e a conferência do contador** | Contador confere a carga e muda para `conferido`; uma segunda organização de teste não vê o perfil da Pecsil; registro de teste apagado pelo id |
| N-02 | Sentinela v1 | 14 fontes coletando; regressão da 4.4 passando; uma proposta real aprovada em 1 clique e aplicada sem deploy; métrica no painel |
| N-03 | IBS/CBS completo | XML com os grupos da NT vigente aceito em homologação (C-09); apuração informativa de 2026 batendo com as notas; CBS 2027 lida do parâmetro |
| N-04 | Núcleo contábil 1 | Um mês inteiro de eventos lançado por regra; balancete fecha (D = C) e bate com os títulos e o extrato conciliado |
| N-05 | Núcleo contábil 2 | DRE e balanço do mês conferidos pelo contador; competência travada; exportação importada pelo escritório sem ajuste |
| N-06 | Calendário fiscal | Todas as obrigações do perfil com data certa num mês com feriado; avisos D-7/D-3/D-1 entregues |
| N-07 | Apurações e guias | Guia do escritório conferida contra a base; divergência explicada; no modo interno, guia gerada com a memória de cálculo |
| N-08 | Patrimônio e depreciação | Bens do GRV cadastrados; depreciação mensal lançada (N-04) e no custo-hora (K-03) |
| N-09 | Checagem das notas de entrada | Toda nota do mês classificada; inconsistência CFOP × CST × NCM apontada |
| N-10 | Obrigações em arquivo | Arquivo validado pelo PVA sem erro, degrau a degrau |
| N-11 | Simulador da reforma | Preço e caixa 2027 com IPI zero e CBS do Senado, por orçamento |
| N-12 | DRE gerencial e relatório | Relatório de 1 página aprovado pela Ana |
| N-13 | Créditos de PIS/COFINS | Levantamento entregue ao contador, só se Lucro Real |
| N-14 | Folha (produto) | Desligada na Pecsil |

Sempre: QA como a equipe (usuário temporário com as permissões reais), tela conferida em claro e
escuro, e perguntar antes do Deploy.

## 6. Perguntas para as áreas (não enviadas; o proprietário libera)

Canal: "Decisões para você".

- **Jefferson, com o contador:** regime de IRPJ (Presumido ou Real) e receita bruta de 2025; CPR do
  ICMS; benefício fiscal estadual (crédito outorgado, e-CredAc); lei do ISS do município e se há
  retenção pelo tomador; quem aprova parâmetro fiscal no modo escritório; prazo que o escritório
  usa para cada obrigação.
- **Ana:** quem aprova juros e multa de guia atrasada; conta contábil das retenções (IRRF, CSRF,
  INSS 11%, ISS) e dos tributos a recuperar; plano de contas contábil × gerencial (D1).
- **Rosana:** RAT, FAP 2026 e 2027 (contestação até 30/11/2026), CCT vigente.
- **Proprietário:** cadastro no INLABS (gratuito); custo do modelo na extração (Haiku); se E0–E2
  entram nos "Próximos" do roadmap.

## 7. Registro

| Data | O que mudou | Quem |
|---|---|---|
| 25/10/2026 | N-02 construída e aplicada (Sentinela; migrações 0007 e 0008); primeira coleta real sem erro; QA 30/30 | Proprietário / Claude |
| 25/10/2026 | N-01 construído e aplicado (migração 202610250006; `lib/contabil/`; tela Fiscal › Parâmetros legais); QA 48/48. N-01 entrou nas frentes no lugar do B-04 | Proprietário / Claude |
| 25/10/2026 | Plano criado a partir da leitura do pacote "57 Agents Contabilidade", de cinco frentes de pesquisa e das decisões do proprietário (dois modos, Sentinela com automático só para dado de API, folha desligada na Pecsil, "só registrar agora") | Proprietário / Claude |
