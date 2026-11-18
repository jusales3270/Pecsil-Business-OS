# Plano — Fiscal assume do GRV em 01/12/2026 e entra em 2027 nas regras novas

## Contexto

A partir de 01/12/2026 a plataforma emite as notas da Pecsil e o GRV é desligado. Um mês depois, em 01/01/2027, mudam as regras (CBS e IBS passam a valer de verdade, PIS e COFINS acabam). O plano tem dois compromissos que não se negociam:

1. **Nenhum tipo de nota fica sem sair.** Tudo o que o GRV emite hoje, a plataforma emite.
2. **Nenhuma nota sai errada.** Nada que exponha a Pecsil à Receita ou à SEFAZ.

Base do plano: leitura do código do Fiscal, das três calculadoras da Receita, da documentação da API da CBS e de **55 notas reais emitidas pelo GRV** (janeiro e outubro de 2026), que mostram exatamente o que precisa ser reproduzido.

**Premissas**
- Cobre o Fiscal e o faturamento. Estoque, orçamentos em aberto e o resto do Marco 1 (`docs/ROADMAP.md`) têm planos próprios e decisões das áreas; aqui só aparecem como dependência.
- Não conferi o banco de produção (a consulta foi bloqueada). O passo 0.1 faz isso antes de qualquer construção.
- Regra fiscal é decisão do Jefferson com a Sandra. Entra como dado (máscara, parâmetro), nunca fixa no código.

## As quatro travas contra equívoco

Valem do primeiro ao último passo.

1. **Espelho do GRV.** As 55 notas reais viram teste: a plataforma monta a mesma nota e o XML tem de bater com o do GRV campo a campo e centavo a centavo. Operação que não bate não é liberada.
2. **Três conferências antes da SEFAZ:** regras da plataforma, esquema oficial (já existe) e a calculadora da Receita (nova).
3. **Liberação por operação.** Cada operação só emite em produção depois de: espelho ok → autorizada em homologação → máscara confirmada pelo Jefferson → primeira nota real acompanhada.
4. **GRV de reserva, sem emitir**, até cada operação ter saído autorizada uma vez em produção. É a rede que garante o compromisso 1.

## O que o GRV emite e o que falta (das 55 notas reais)

| Operação | CFOP | Situação na plataforma |
|---|---|---|
| Venda dentro e fora de SP | 5101, 6101 | Calcula igual ao GRV; faltam grupos do XML (lista A) |
| Remessa e retorno de conserto | 5915, 5916, 6916 | Idem, com referência à nota de origem |
| Remessa para industrialização | 5901 | Idem |
| Retorno de mercadoria recebida para teste | 6949 | Falta a máscara |
| Exportação direta e indireta | 7101, 7501 | **Não emite** (lista B) |
| Importação (nota de entrada) | 3101, 3551 | **Não emite** (lista C) |
| Entrada própria de sucata | 1101 | Falta a máscara; PIS/COFINS de entrada quebra no esquema |
| Crédito do CIAP (nota de ajuste, valor zero) | 1604 | **Não emite** (exige valor maior que zero) |

Nenhuma das 55 tem ST, DIFAL ou venda a consumidor final. Não entram na Onda 1; o Jefferson confirma que a Pecsil não usa.

**Lista A — grupos que o GRV põe em toda nota e a plataforma não gera** (`lib/fiscal/emissao/xml.ts`, `tipos.ts`, `normalizar.ts`)
- Texto legal no campo do fisco (`infAdFisco`): hoje vai para as informações complementares.
- Valor total do item (`vItem`) e total aproximado de tributos (`vTotTrib`).
- Frete por conta própria: modalidades 3 e 4 (a maioria das notas usa 3; a plataforma só aceita 0, 1, 2 e 9).
- Endereço da transportadora, placa do veículo, marca e numeração dos volumes.
- Unidade tributável diferente da comercial; indicador de presença (o GRV usa 0, a plataforma 9).
- Grupo de integração do pagamento (`card`) que o GRV envia no boleto.
- PIS/COFINS com CST de 50 a 98 no grupo certo (hoje caem num grupo que o esquema recusa).

**Lista B — exportação**
- Destinatário no exterior: identificação estrangeira, país, município 9999999, UF "EX" (`regras.ts` recusa hoje).
- Grupo de exportação (UF e local de saída) e, na indireta, a nota de remessa e a quantidade por item.

**Lista C — importação e ajuste**
- Declaração de importação com adições, imposto de importação, base do ICMS informada (não é a conta padrão), PIS/COFINS da importação.
- Nota de ajuste com valor de produto zero e ICMS informado (CIAP).

## Onda 0 — medir antes de construir (17 a 19/11)

- **0.1 Estado real do banco** (leitura, com o seu OK): máscaras e quais estão confirmadas, emitente, certificado, série e último número, clientes sem dados fiscais, produtos sem NCM.
- **0.2 Banco de prova:** conversor "XML do GRV → nota da plataforma" e teste do espelho com as 55 notas. As notas ficam fora do repositório (têm dados de clientes).
- **0.3 Calculadora da Receita no ar** como serviço interno ao lado do transmissor (container Java, banco gerado pelos scripts dela) e as 55 notas passando por ela. Resultado: quantas calcula, quantas diverge, quantas não trata.
- **0.4 Decisões enviadas às áreas** (lista no fim), pelo canal Decisões para você.

## Onda 1 — emitir tudo o que o GRV emite (até 30/11, regras de 2026)

Ordem pelo que mais fatura: vendas → conserto e industrialização → exportação → entradas próprias, importação e CIAP.

- **1.1 Lista A** no XML, com o espelho das vendas, consertos e remessas batendo.
- **1.2 Lista B** (exportação), com o espelho das 3 notas de exportação.
- **1.3 Lista C** (importação e CIAP) e a entrada de sucata.
- **1.4 Máscaras:** completar as existentes e criar 7501, 3101, 3551, 1604, 6949 e 1101, com o IBS/CBS de cada uma (000001, 410999, 410004, como o GRV usa). **Produção só aceita máscara confirmada pelo Jefferson** (trava nova em `validarEGravar`).
- **1.5 Produção liberada com trava:** `AMBIENTES_LIBERADOS` (`lib/fiscal/emissao/servidor.ts`), troca de ambiente na Configuração com dupla confirmação e auditoria, tela A faturar para orçamento real (`modules/fiscal/src/AFaturar.tsx`). **Feito em 18/11:** a troca exige digitar PRODUÇÃO e a permissão de aprovar NF-e, vai para a auditoria com risco alto; a opção Produção só aparece em Notas emitidas e A faturar com a Configuração em produção, e as rotas recusam antes disso.
- **1.6 Numeração:** série 1 continuando do último número do GRV, gravado no dia da virada; inutilização dos números que ficarem para trás. **Trava feita em 18/11:** sem o próximo número gravado na série, ou com ele igual/abaixo do maior número da empresa visto nas notas guardadas, a nota de produção não valida. Falta gravar o número no dia da virada.
- **1.7 Depois de autorizada:** XML e DANFE guardados em Documentos; envio ao cliente (e-mail se houver caixa de envio; senão, download e WhatsApp, que já existe); recuperar o XML autorizado quando a resposta da SEFAZ se perde (pendência conhecida).
- **1.8 Contas a receber** pelas duplicatas da nota autorizada; cancelamento desfaz. Regra da Ana.
- **1.9 SEFAZ fora do ar:** verificar se o transmissor suporta contingência; se não, procedimento escrito (esperar e consultar, nunca reenviar às cegas). Decisão do Jefferson.
- **1.10 Notas de entrada chegando sozinhas:** religar a busca na SEFAZ depois de combinar com o escritório quem busca (hoje os dois usam o mesmo certificado e a SEFAZ bloqueia).
- **1.11 Escritório sem o GRV:** baixar os XMLs do mês (emitidas e recebidas) em um arquivo só, pelo Portal.
- **1.12 Prova em homologação:** uma nota de cada operação da tabela, mais cancelamento, carta de correção e inutilização. Aceite do Jefferson.
- **1.13 Virada (01/12):** apagar o treino, gravar o último número do GRV, primeira nota real de cada operação acompanhada, conferência diária na primeira semana (autorizadas, rejeitadas, numeração sem buraco).

## Onda 2 — regras de 2027 (até 31/12)

- **2.1 Ler a nota técnica vigente da NF-e para 2027** antes de escrever (totais com IBS/CBS, PIS/COFINS, IBS municipal). Nada de memória.
- **2.2 Um motor só, guiado pela data.** Hoje a base do IBS/CBS está escrita em três lugares (`emissao/calculo.ts`, `ibs-cbs/conferencia.ts`, `contabil/reforma.ts`). Passa a existir uma regra "tributos que valem nesta data" usada por emissão, orçamento, conferência e simulador.
- **2.3 Parâmetro de 2027 pronto para receber o número:** chave `ibs_cbs_aliquotas` com CBS, IBS do estado e IBS do município por vigência. A emissão lê do parâmetro; a máscara guarda só CST e classificação. Quando o Senado publicar a CBS, a curadoria lança e vale na hora.
- **2.4 XML de 2027:** IBS dividido entre estado e município, PIS e COFINS fora, total da nota e duplicatas com o IBS/CBS, conforme 2.1.
- **2.5 Tabelas oficiais** (CST, classificação, NCM permitido por classificação, indicadores de crédito) lidas da própria calculadora e recarregadas a cada versão dela. A máscara passa a escolher de lista validada.
- **2.6 Calculadora como terceira conferência:** erro de classificação bloqueia; diferença de centavo vira alerta com justificativa; calculadora fora do ar avisa e não trava o faturamento.
- **2.7 Conferência das notas recebidas em 2027:** regra pela data, Simples com o grupo obrigatório, reduções pela tabela.
- **2.8 Orçamentos com entrega em 2027** mostrando o preço com IBS/CBS por fora.
- **2.9 Ensaio de janeiro em dezembro:** as operações da Pecsil com data de 2027 passando pelas três conferências.

## Onda 3 — CBS direto com a Receita (começa já, em paralelo)

Começa agora porque a API não devolve o passado: a primeira consulta parte do dia 1º do mês corrente e depois só traz os últimos 8 dias.

- **3.1 Credencial da Pecsil** gerada no portal da Receita por quem representa a empresa; guardada no cofre, uma por empresa (mesmo modelo do certificado).
- **3.2 Consulta diária** das quatro consultas (débitos, créditos, pagamentos, recolhimentos), no modelo de `scripts/fiscal-dfe-cron.mjs`, perguntando a situação em vez de expor um endereço para a Receita chamar. Token reaproveitado; link de download nunca em log.
- **3.3 Confronto por nota,** pela chave: o que a plataforma apurou × o que a Receita apurou. Divergência, suspenso e não processado viram alerta.
- **3.4 Crédito por situação** (a apropriar, apropriado, suspenso, prescrito, saldo), no lugar de contar todo crédito destacado.
- **3.5 Créditos travados por fornecedor,** com a opção de gerar a guia que paga o débito dele e destrava o crédito.
- **3.6 Guia da CBS da própria Pecsil** gerada pela plataforma e enviada a contas a pagar pelo caminho que as guias do escritório já usam; CBS e IBS no calendário fiscal.
- **3.7 Apurações de 2027:** CBS a pagar no lugar do PIS/COFINS.
- **3.8 IBS:** aguarda o Comitê Gestor liberar a API dele.

## Onda 4 — acabamento (janeiro)

- Escritório vendo notas sem ter aceitado o termo (achado de LGPD no Portal).
- Fila de ciência das notas recebidas que pode travar; Painel do ICMS que não acompanha cancelamento.
- Nota de serviço (NFS-e), se a Pecsil cobrar conserto por ela.
- Limpeza das suposições de SP e dos dados da Pecsil nas migrações, para o ECOS.

## Decisões das áreas

| Decisão | Quem |
|---|---|
| Confirmar cada máscara e as seis novas | Jefferson, com a Sandra |
| ST, DIFAL e consumidor final: a Pecsil usa? Conserto é cobrado por nota de serviço? | Jefferson |
| Quem busca as notas na SEFAZ (plataforma ou escritório) | Jefferson e Sandra |
| Quem aprova e transmite além do Jefferson; o que fazer se a SEFAZ cair | Jefferson |
| Regra do título a receber (parcelas, conta, cancelamento) | Ana |
| Quem gera a credencial da API da CBS | Quem representa a Pecsil no gov.br |
| Deploys, migrações em produção e virada do ambiente | Proprietário |

## Arquivos principais

- Emissão: `lib/fiscal/emissao/{tipos,normalizar,calculo,regras,xml,servidor,do-orcamento}.ts`, `lib/fiscal/mascaras.ts`, `app/api/fiscal/nfe/**`, `app/api/fiscal/faturar/route.ts`
- Telas: `modules/fiscal/src/{NotasEmitidas,AFaturar,MascarasImpostos,ConfiguracaoFiscal,IbsCbs,Apuracoes}.tsx`
- Reforma: `lib/fiscal/ibs-cbs/*`, `lib/contabil/{reforma,parametros,calendario}.ts`, `lib/contabil/apuracao/*`
- Transmissor: `services/transmissor-nfe/servidor.mjs`, `lib/fiscal/transmissor/*`
- Novos: serviço da calculadora (`services/calculadora-rtc`), cliente da API da CBS (`lib/fiscal/cbs/*`), migrações para tabelas oficiais, credencial da CBS e títulos a receber

## Verificação

- Espelho das 55 notas: 100% batendo antes da virada (teste automático).
- Homologação: uma nota autorizada por operação, mais os três eventos, com protocolo.
- Calculadora: as mesmas notas sem erro de classificação.
- Em cada entrega: testes do repositório, teste no navegador com usuário que tem só as permissões reais do Jefferson, e conferência depois do Deploy.
- Primeira semana de dezembro: conferência diária da numeração e das autorizações.

## Riscos, ditos com franqueza

- **O prazo de 01/12 é curto para tudo.** As vendas, consertos e remessas (a maior parte do faturamento) são o caminho mais seguro de fechar a tempo. Exportação, importação e CIAP são construção nova; se alguma não estiver provada no dia 1º, ela sai pelo GRV de reserva até estar. Por isso a trava 4.
- **Depende de pessoas:** a confirmação das máscaras e a prova em homologação são do Jefferson; sem elas a operação não é liberada.
- **Depende de fora:** a alíquota da CBS de 2027 (Senado), a API do IBS (Comitê Gestor) e a nota técnica de 2027.
