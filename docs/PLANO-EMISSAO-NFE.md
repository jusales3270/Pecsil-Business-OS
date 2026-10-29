# Plano — emitir NF-e pela plataforma (homologação → produção)

Pedido do proprietário em 29/10/2026: transmitir a nota fiscal pela própria plataforma, começando pela
homologação (o ambiente de teste da SEFAZ, sem valor fiscal). Continua a Entrega 2 de `docs/FISCAL-NFE.md`,
que hoje só tem o treino.

## Onde estamos (29/10/2026)

| Peça | Situação |
|---|---|
| Transmissor (Coolify, rede interna) | Pronto desde 12/10: assina e autoriza, cancela, manda carta de correção e inutiliza números. Alcançou a SEFAZ de SP em homologação. Em 29/10: DANFE sem marca d'água e sem cair com XML ruim (`ff69131`, falta o Deploy dele). |
| Certificado A1 | **Enviado de novo em 29/10, às 09h32, pelo Jefferson.** Válido até **22/04/2027**, no cofre (Vault). |
| Configuração fiscal | Emitente completo (CNPJ, IE, CRT 3, Itu-SP), série padrão 1, ambiente **homologação**. |
| Treino da emissão | Pronto (Fiscal › Notas emitidas): montar, validar o esquema oficial, aprovar, DANFE, cancelar, carta e inutilizar, tudo simulado. |
| Máscaras de impostos | Existem (15/10), sem as regras do Jefferson. |
| Transmitir de verdade | **Não ligado:** `AMBIENTES_LIBERADOS = ["treino"]`, e nenhuma rota chama `autorizar`, `evento` ou `inutilizar` do transmissor. |
| Notas recebidas da SEFAZ | Rodando com o certificado desde 29/10, mas **em homologação**: a SEFAZ responde 137 (nenhum documento) e as notas reais dos fornecedores não chegam (ver F0). |
| Numeração | O GRV emite na **série 1** (janeiro: 10580 a 10634; outubro: até 11170). |

## Andamento (29/10/2026)

- **F0 construída e aplicada** (`889dda6`, migração 202610290007): a busca vai à produção depois do Deploy.
- **Nota cancelada fora da receita** (`889dda6`, migração 202610290008).
- **F1 construída** (migração 202610290009 aplicada): homologação liberada; transmitir, consultar, cancelar,
  carta e inutilizar vão à SEFAZ de teste; trava contra duplo envio; rejeição volta para correção; sem resposta
  exige consulta. Testada na plataforma até a SEFAZ (QA 16/16) e no transmissor (13/13). **Falta a prova real
  na SEFAZ de homologação, depois do Deploy da plataforma E do transmissor** (o certificado só existe no
  servidor). Pendências conhecidas: XML autorizado em Documentos só na produção; quando a resposta se perde e
  a consulta confirma a autorização, o XML autorizado não volta (fica o protocolo).

- **F2 começada** (`scripts/completar-mascaras-jan-2026.mjs`, aplicado com OK): 5915, 5916 e 6916 completadas
  pelas notas de janeiro (CST do IPI 53, PIS/COFINS 49, texto legal), sem confirmação. As de venda (5101,
  6101 por região), exportação (7101) e remessa para industrialização (5901) já tinham sido completadas pelas
  notas de outubro. **Para o Jefferson decidir:** máscaras que não existem e que janeiro usou: 7501
  (exportação de mercadoria recebida para exportar), 3101 e 3551 (importação), 1604 (crédito do CIAP), 6949
  (retorno de mercadoria recebida para teste, com ICMS de 12%); a 1101 da sucata (art. 392 do RICMS-SP) é
  diferente da entrada comum; e o PIS/COFINS da 5915 saiu diferente em duas notas.

## F0 — Notas recebidas da SEFAZ em produção (não emite nada)

A busca das notas que os fornecedores emitem contra a Pecsil (distribuição de DF-e) usa o mesmo ambiente da
emissão. Em homologação, não há nota real para buscar.

- **O que muda:** a distribuição passa a ter ambiente próprio (`dfe_ambiente`, produção), separado do
  ambiente da emissão. A consulta não gera nota nem imposto. A "ciência da operação" automática é o registro
  padrão de que a nota foi vista.
- **Ganho:** as notas de entrada chegam sozinhas (Notas recebidas, Conferência de entradas, Painel do ICMS,
  IBS/CBS), sem ninguém precisar baixar e enviar.
- **Decide:** proprietário (liga a consulta em produção com o certificado da empresa).

## F1 — Homologação: a plataforma transmite para a SEFAZ de teste

Mesmo fluxo do treino (quem opera monta; quem aprova transmite), agora falando com a SEFAZ.

1. **Liberar `homologacao`** em `AMBIENTES_LIBERADOS`. A tela troca a faixa "TREINO" por "HOMOLOGAÇÃO — SEM
   VALOR FISCAL", e a numeração é própria do ambiente (não toca a produção).
2. **Transmitir** (`app/api/fiscal/nfe/[id]/acao`):
   - gera o XML com a data de agora; o transmissor assina com o certificado do cofre e chama `autorizar`;
   - **100 autorizada:** monta o `nfeProc` (XML + protocolo), guarda e marca autorizada;
   - **rejeição (2xx/7xx):** a nota volta para edição com o código e o motivo da SEFAZ, e o número continua
     reservado para ela;
   - **resposta perdida ou lote em processamento:** consulta pela chave antes de qualquer reenvio. Nunca
     reenviar às cegas (o contrato já proíbe).
   - Regra da SEFAZ em homologação: o nome do destinatário vai como "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO -
     SEM VALOR FISCAL". Hoje o XML da plataforma não faz isso.
3. **Eventos pela SEFAZ:** cancelamento (110111, até 24 h, justificativa com 15 ou mais caracteres), carta de
   correção (110110, até 20 por nota) e inutilização de faixa, cada um com o protocolo de volta.
4. **Guardar:** o XML autorizado e o DANFE em Documentos › Fiscal, ligados à nota. A leitura da receita e do
   IBS/CBS já pega a nota emitida pela plataforma (`nfe_id`), sem repetir com o XML do GRV.
5. **Aviso de vencimento do certificado:** 30 dias antes de 22/04/2027, para quem aprova (sino e Bom dia).

**Teste (com o Jefferson):** uma nota de cada operação da Pecsil, tiradas das notas de janeiro: venda em SP
(5101), venda para outro estado (6101, com 12% e com 7%), exportação (7101/7501), remessa para conserto
(5915), retorno de conserto (6916), remessa para industrialização (5901), devolução e nota de entrada própria.
Além disso: cancelar uma, mandar carta de correção em outra e inutilizar um número. Pronto quando todas
saírem autorizadas e os eventos voltarem com protocolo.

## F2 — As regras do Jefferson nas máscaras (a nota sai certa sem digitar imposto)

- Ponto de partida: **as notas reais de janeiro**, que mostram como o GRV emite cada operação. Por exemplo,
  venda com redução de base pelo Convênio 52/91 (carga de 8,8% e de 5,14% no N/NE), IPI a 0% (Decreto
  8.950/2016), o texto do RICMS-SP no campo do fisco, conserto sem ICMS (CST 41), remessa para
  industrialização com suspensão (CST 50 e IPI 55).
- A plataforma propõe uma máscara por operação a partir dessas notas. **O Jefferson confere e corrige**: é
  dele a palavra final sobre CFOP, CST e alíquota.
- A nota nova escolhe a operação e o cliente; CFOP, CST, alíquotas e textos legais vêm da máscara.
- Ficam como dado (`fiscal_mascaras`), nunca no código: vale para outra empresa no futuro.

## F3 — Ligações com os outros módulos

- **A faturar → nota:** o orçamento ganho ou a OS gera a nota com os itens e o pedido do cliente (o fluxo
  orçamento → nota de 13/10).
- **Duplicatas → contas a receber** (Financeiro), com o vencimento da nota. A carta de correção de vencimento
  atualiza a parcela. Decide a Ana.
- Nota cancelada sai da receita e do contas a receber.

## F4 — Produção (só com o OK do proprietário)

**Decisões antes da virada:**

| # | Decisão | Quem decide |
|---|---|---|
| D1 | **Série:** série própria da plataforma (ex.: série 2, sem chance de colisão com o GRV) **ou** a série 1 continuando do último número do GRV, com o GRV parando de emitir no mesmo dia. | Jefferson (com a Sandra) |
| D2 | **Dia da virada** e período em paralelo (o GRV segue como reserva por algumas semanas). | Jefferson, com o OK do proprietário |
| D3 | **Quem aprova** (transmite): só o Jefferson, ou mais alguém para férias e ausências. | Jefferson / proprietário (acessos) |
| D4 | **Se a SEFAZ cair:** esperar, ou emitir pela contingência (SVC). | Jefferson |
| D5 | **Ligar a produção.** | Proprietário |

**Virada:** a primeira nota real acompanhada (o Jefferson e eu juntos), conferida na SEFAZ e no DANFE. Na
primeira semana, conferência diária: autorizadas, rejeitadas e numeração sem buraco.

## Ordem e portões

1. **F0** e **F1** em paralelo (F0 só depende do OK do proprietário).
2. **F1** termina com o teste completo em homologação, conferido com o Jefferson.
3. **F2** começa junto com a F1 (a proposta das máscaras sai das notas de janeiro) e depende das respostas
   do Jefferson.
4. **F3** depois da F1.
5. **F4** só com F1, F2 e F3 prontas e as decisões D1 a D5 tomadas.

Cada migração em produção pede o OK do proprietário. O Deploy é dele, e o do transmissor é separado.
