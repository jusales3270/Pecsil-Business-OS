# Fiscal — NF-e: emissão e notas recebidas da SEFAZ

Plano aprovado pelo proprietário em 12/10/2026. Duas entregas:

1. **Entrega 1 (esta):** transmissor, configuração fiscal, certificado no cofre e notas
   recebidas da SEFAZ.
2. **Entrega 2:** emissão de NF-e com portão humano. Começou pelo **treino** (13/10, sem SEFAZ
   e sem valor fiscal); homologação e produção só com o OK do proprietário.

O material do Jefferson (como emite hoje no GRV, regras de CFOP/CST/alíquotas, série e
numeração, planilhas) ajusta a Entrega 2. A estrutura já fica pronta para recebê-lo.

## Arquitetura

```
Plataforma (dona da nota)                       Transmissor (peça trocável)
───────────────────────────                     ─────────────────────────────
Fiscal › Configuração ─┐                        services/transmissor-nfe
Fiscal › Notas recebidas ├─ lib/fiscal/servidor.ts   (Node, GPL-3.0, sem estado)
(Entrega 2: emissão)  ─┘        │                          │
                                ▼                          ▼
                 lib/fiscal/transmissor/  ── HTTP interno ──►  NFeWizard ──► SEFAZ
                 (contrato + http.ts)       x-transmissor-secret
                                │
         Supabase: fiscal_config, fiscal_series, fiscal_dfe, fiscal_dfe_eventos,
                   certificado no Vault (fiscal_certificado_segredos → vault.secrets)
```

- **A plataforma é dona da nota:** dados, regras, aprovação, guarda dos XML (Documentos),
  ligações e eventos.
- **O transmissor só fala com a SEFAZ.** Não guarda nada. Emitente, ambiente e certificado
  chegam a cada chamada.
- **Licença:** a NFeWizard é GPL-3.0, então o transmissor é um programa separado, com
  licença GPL e código aberto próprio. A plataforma não importa nada dele.

### Trocar o transmissor (opção 3 → opção 4, API paga)

1. Criar `lib/fiscal/transmissor/<fornecedor>.ts` implementando a interface `Transmissor`
   de `contrato.ts`. As respostas seguem o mesmo formato (`RespostaSefaz`,
   `ResultadoDistribuicao`…).
2. Em `lib/fiscal/transmissor/index.ts`, escolher a implementação por `TRANSMISSOR_TIPO`.
3. Nada mais muda: tabelas, telas, regras e fluxo continuam iguais.

## Segurança

- **Certificado A1:**
  - **Envio:** só o proprietário. O transmissor abre o `.pfx` com a senha (confere a senha
    e lê titular, CNPJ e validade). O banco grava o arquivo e a senha **cifrados no
    Supabase Vault**.
  - **Leitura:** só a chave de serviço (`fiscal_certificado_ler`), na hora de falar com a
    SEFAZ. Nenhum usuário lê o certificado pela plataforma.
  - **Validação:** recusa certificado vencido ou de outro CNPJ (a raiz, os 8 primeiros
    dígitos, tem de bater com a do emitente).
  - **Logs:** o certificado e a senha nunca vão para log nem para resposta. A biblioteca
    registraria a configuração com eles; o transmissor descarta esse log antes de carregar
    a biblioteca.
- **Transmissor:**
  - sem domínio público (só a rede interna do Coolify);
  - toda chamada exige `x-transmissor-secret` (32+ caracteres, comparação em tempo
    constante).
- **Ambiente:**
  - começa em **homologação** (teste da SEFAZ, sem valor fiscal);
  - só o proprietário liga a produção.
- **Cofre e backup:** a chave do Vault é da instalação do Supabase. Se o banco for
  restaurado em outro servidor sem essa chave, o certificado precisa ser enviado de novo
  (é só reenviar o `.pfx`).
- **Configuração:** escrita só pela função `fiscal_config_salvar`, com lista fechada de
  campos. Não há escrita direta na tabela.

## Notas recebidas (distribuição de documentos da SEFAZ)

- **Busca:** a tarefa agendada (`scripts/fiscal-dfe-cron.mjs`, a cada 15 min) chama
  `/api/fiscal/dfe/processar`. Para cada organização com a busca ligada, consulta a partir
  do último NSU.
- **Regra da SEFAZ (NT 2014.002):** sem documento novo (137) ou no fim da fila (ultNSU =
  maxNSU), só consultar de novo **depois de 1 hora**. A plataforma grava
  `dfe_proxima_consulta` e respeita o prazo, inclusive no botão "Buscar agora". Consumo
  indevido (656) ou erro: recua 1 hora (ou 15 min, se a rede caiu).
- **O que chega e o que acontece:**
  - **resumo (`resNFe`):** cria a linha da nota, ainda sem o XML;
  - **nota completa (`nfeProc`):** o XML original, assinado, vai para **Documentos ›
    Fiscal** (origem `sefaz`). A partir daí rodam sozinhas a leitura, as ligações e a
    captura do CNPJ;
  - **evento de cancelamento (110111):** a nota fica "cancelada". Se ela já estava no
    Painel do ICMS, quem opera o painel é avisado.
- **Ciência da Operação (210210):** é um evento informativo (não confirma nem recusa a
  compra). A SEFAZ só entrega o XML completo depois dela. Funciona de dois jeitos:
  - automática, ligada na Configuração;
  - manual, nota a nota, com o botão "Dar ciência".
- **Conferência "o governo tem e nós não":** cada nota mostra se já está no Painel do ICMS
  e se foi recebida no Almoxarifado. "Lançar no painel" lança a partir do XML guardado.

## Instalação no Coolify (fazer uma vez)

1. **App do transmissor:**
   - criar uma Application a partir do mesmo repositório e da branch `main`, com Build
     Pack **Dockerfile**, Base Directory `/services/transmissor-nfe` e porta `3100`;
   - **sem domínio** (apagar o domínio gerado);
   - variável `TRANSMISSOR_SECRET` = um segredo de 48 caracteres hexadecimais;
   - Deploy. O `/saude` responde `{"ok":true}`.
2. **No app do Business OS**, criar as variáveis abaixo e fazer Deploy:
   - `TRANSMISSOR_URL` = `http://<uuid-do-app-transmissor>:3100` (o nome do contêiner na
     rede `coolify`);
   - `TRANSMISSOR_SECRET` = o mesmo segredo do passo 1;
   - `FISCAL_DFE_SECRET` = outro segredo (16+ caracteres), para a rodada agendada.
3. **Tarefa agendada no app do Business OS:** "Notas recebidas da SEFAZ", comando
   `node scripts/fiscal-dfe-cron.mjs`, frequência `*/15 * * * *`.
4. **Na plataforma:** em Fiscal › Configuração, o proprietário:
   - confere os dados do emitente;
   - envia o certificado A1;
   - clica em "Testar conexão com a SEFAZ";
   - liga a busca das notas recebidas.

Nenhuma dessas variáveis leva o prefixo `NEXT_PUBLIC_`.

## O que espera o Jefferson (ajusta a Entrega 2)

- Como emite hoje no GRV: natureza das operações e notas típicas (venda, remessa para
  metalização ou conserto, retorno, devolução, exportação).
- Regras de CFOP, CST/CSOSN e alíquotas por operação, cliente e UF. Vão para a tabela
  `fiscal_regras`, e não para o código.
- **Série e próximo número** no GRV, para continuar sem buraco. Já dá para gravar em
  Configuração › Emissão.
- Se a empresa usa cadastro de produtos (código, NCM, unidade) ou digita os itens. O
  cadastro de produtos fica para depois dessa conversa.
- O tipo do certificado: o servidor precisa do **A1 (.pfx)**. Se a empresa só tem A3
  (cartão ou token), é preciso adquirir um A1.
- As planilhas de controle dele.

## Entrega 2 — começa pelo TREINO (13/10/2026)

Pedido do proprietário: "simulação, que não gere obrigação fiscal", para o Jefferson treinar a
emissão dentro da plataforma antes de subir para produção. Impostos por item no treino: ICMS,
IPI, PIS e COFINS (ST, DIFAL e IBS/CBS entram com o material do Jefferson).

A nota segue sempre o mesmo caminho; muda só o **ambiente** (`fiscal_nfe.ambiente`):

| Ambiente | O que faz | Liberado |
|---|---|---|
| `treino` | Só na plataforma: nada vai à SEFAZ; protocolo e DANFE simulados, sem valor fiscal. | **Sim** |
| `homologacao` | Teste oficial da SEFAZ, com o certificado A1. | Não |
| `producao` | Para valer. Só com o OK do proprietário. | Não |

A liberação é a lista `AMBIENTES_LIBERADOS` em `lib/fiscal/emissao/servidor.ts`. As rotas recusam
qualquer outro ambiente, e o teste `tests/fiscal-nfe-emissao.test.mjs` garante que nenhuma rota
da emissão chama o transmissor para autorizar, gerar evento ou inutilizar na SEFAZ.

**Peças:**
- `lib/fiscal/emissao/`:
  - `calculo.ts`: impostos por item e totais, centavo a centavo, com rateio do frete;
  - `xml.ts`: XML 4.00 gerado pela plataforma, chave de acesso e o `nfeProc` do treino;
  - `regras.ts`: o que o esquema não pega, como CFOP × destino, CST × regime, duplicatas × total e DV de CNPJ/CPF;
  - `normalizar.ts`: o que vem da tela, transformado em dados limpos;
  - `servidor.ts`: validar e gravar, auditoria e autor da sessão.
- **Migração `202610130003_fiscal_nfe_emissao.sql`:**
  - `fiscal_nfe`, `fiscal_nfe_eventos` (cancelamento, carta, inutilização) e `fiscal_nfe_numeracao`;
  - leitura para quem tem `fiscal.nfe`; escrita só pelo servidor;
  - `fiscal_nfe_reservar_numero` é atômica, por ambiente e série, e pula faixas inutilizadas. A produção continua do "próximo número" da Configuração.
- **Rotas (`app/api/fiscal/nfe/`):**
  - lista, cria e limpa o treino;
  - `[id]`: abre, salva e descarta;
  - `[id]/acao`: validar, enviar, devolver, transmitir, cancelar e carta;
  - `[id]/danfe`, `[id]/xml` e `inutilizar`.
- **Tela:** Fiscal › Notas emitidas (`modules/fiscal/src/NotasEmitidas.tsx`), com a faixa
  "TREINO — SEM VALOR FISCAL".

**Fluxo (portão humano igual ao da produção):**
1. Quem **opera** monta a nota e valida. A validação confere as regras da plataforma e o esquema oficial (pelo transmissor, sem certificado, com uma assinatura fictícia só para o esquema) e reserva o número.
2. Quem opera envia a nota para aprovação, e quem tem **aprovar** é avisado.
3. Quem aprova transmite: confere de novo, gera o XML com a data de agora e "autoriza" com um protocolo fictício que começa por 9. Ou então devolve a nota com um recado.
4. Com a nota autorizada saem o DANFE (marca "SEM VALOR FISCAL") e o XML. Quem aprova também pode:
   - cancelar, em até 24 h e com 15 ou mais caracteres de justificativa;
   - mandar carta de correção, até 20 por nota;
   - inutilizar faixas de numeração.
5. "Limpar o treino" (aprovar) apaga as notas, os eventos e a numeração do treino.

Tudo vai para `audit_logs` (`fiscal_nfe.*`).

**Para homologação e produção (depois):**
- certificado A1;
- assinatura real no transmissor;
- XML e DANFE em Documentos;
- a tabela `fiscal_regras` com o material do Jefferson;
- dados fiscais do cliente em `customers`;
- conta a receber das duplicatas.
