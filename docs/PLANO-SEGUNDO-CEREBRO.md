# Plano do Segundo Cérebro da PecSil

> Documento de referência. Cada etapa só começa quando a anterior cumprir o
> critério de aceite, e nenhuma etapa muda de escopo sem decisão registrada
> aqui (seção 8).
>
> Criado em 10/10/2026 · Dono: proprietário da PecSil · Execução: Claude
> Faz parte da Fase 6 (SARA) do [blueprint](./BLUEPRINT-PECSIL-BUSINESS-OS.md#sara-como-harness-corporativo-10102026):
> o Segundo Cérebro é a **memória** do harness corporativo.

---

## 1. O que é e o que não é

O **Segundo Cérebro** é a memória da empresa: os documentos da PecSil e os dados que já
estão na plataforma, **ligados entre si e pesquisáveis**, sempre respeitando o que cada
pessoa tem permissão de ver.

Um exemplo do que ele permite: ao abrir o fornecedor MIRAI, aparecem as notas, cotações,
ordens de compra, pagamentos e também o contrato e as propostas antigas que estavam
esquecidos no computador de alguém.

**O que ele NÃO é:**

- **Não é outro banco nem o lugar onde os arquivos moram.** O arquivo entra uma vez só,
  na plataforma, no setor certo. O cérebro é a camada de ligações e busca por cima.
- **Não decide nada sozinho.** Ligações sugeridas por modelo são sugestões até alguém
  confirmar.
- **Não passa por cima das permissões.** Um documento do RH continua só do RH, dentro
  ou fora do cérebro.

### Por que os arquivos não vão direto para o cérebro

O proprietário levantou essa alternativa em 10/10/2026. Ficou decidido que não, por
quatro motivos:

1. **Permissão:** fora do banco, um holerite ficaria sem a trava do RH. Seria preciso
   construir um segundo sistema de permissões só para o cérebro.
2. **Rastreabilidade:** o blueprint exige que toda resposta seja rastreável até a origem.
   A origem precisa ser um registro: qual documento, quem enviou, quando, de qual computador.
3. **Reconstrução:** a forma de ligar e indexar vai mudar (modelo, técnica de busca).
   Como índice, o cérebro é refeito a partir do banco. Como depósito, a empresa ficaria presa a ele.
4. **Duplicados:** o mesmo arquivo costuma estar em vários computadores. Na entrada pelo
   banco, ele é reconhecido pelo conteúdo (sha256) e guardado uma vez só.

---

## 2. Regras que valem para todas as etapas

1. **Fonte única no banco.** Documentos e dados vivem na plataforma. O cérebro é
   **derivado e reconstruível**: apagar o índice não perde nada.
2. **Herda as permissões de quem consulta.** Cada documento pertence a um setor e é
   protegido pela funcionalidade desse setor. Ligação e busca nunca mostram o que a pessoa
   não poderia abrir pela tela.
3. **Mostra e a pessoa confirma.** Nada sobe, nenhum dado é gravado e nenhuma ligação
   sugerida por modelo vale sem o clique de uma pessoa.
4. **LGPD:**
   - arquivo pessoal (foto de família, documento pessoal do funcionário) é descartado na
     triagem e não sobe;
   - CPF, PIS, holerite, atestado/CID, salário e biometria **nunca** vão para serviço
     externo, nem para o Clef;
   - ao modelo vai só o mínimo: nome do arquivo e trecho sem dados pessoais. O filtro de
     saída do [PLANO-JEV](./PLANO-JEV.md) (seção 2, regra 5) vale aqui.
5. **Tudo auditado:** aceite de acesso a pastas, envio, leitura, ligação e consulta.
   Cada um fica registrado com quem, quando e de onde.
6. **Arquivo repetido é reconhecido** pelo conteúdo (sha256), como já faz o
   `file_intakes`.
7. **Teto de uso de IA por setor**, com painel de consumo (decisão D6).
8. **Regra exata não vira IA.** Onde já existe leitor por regra (extrato, NF-e, DANFE), o
   modelo não entra. O Clef só julga o que a regra não resolve.

---

## 3. Arquitetura

### Caminho de cada arquivo

```
computador da pessoa                         plataforma (fonte única)                 Segundo Cérebro (derivado)
──────────────────────                       ────────────────────────                 ──────────────────────────
pasta escolhida ─► triagem local ─► lista ─► documento guardado no setor ─► leitura ─► ligações ─► busca
 (aceite          (tipo, setor,    para       (armazenamento privado,       (extrato,   (CNPJ, NF,   (texto e, na
  registrado)      repetido)       conferir    permissão do setor,           nota,       OS, valor+   fase da SARA,
                                    e aprovar   sha256, quem enviou)          planilha…)  data…)       por significado)
```

### Tabelas previstas (nomes de trabalho)

| Tabela | Guarda |
|---|---|
| Documentos do setor | Metadados do arquivo (nome, tipo, tamanho, sha256, setor, origem, quem enviou, quando, computador) e o caminho no armazenamento privado. Pode ter versões. |
| Acessos concedidos | Quem concedeu, quando, **qual computador** (nome dado pela pessoa + identificador gerado pela plataforma), qual pasta e quando revogou. |
| Ligações | De → para (documento, fornecedor, cliente, nota, título, OS, colaborador, lançamento bancário), tipo da ligação, origem (**regra** ou **modelo**), confiança e quem confirmou. |
| Trechos para busca (Etapa 5) | Pedaços de texto dos documentos com o vetor de significado, herdando a permissão do documento. |

**No servidor (levantado em 10/10/2026):**
- Já existe o registro de envios `file_intakes`, só com metadados.
- Só há armazenamento privado para o RH (`rh-documents`).
- Estão **disponíveis e ainda não instaladas** as extensões `vector` 0.8.2 (busca por
  significado), `pg_trgm` e `unaccent` (busca por texto com e sem acento).
- Não precisa de banco de grafo separado: as ligações são uma tabela no próprio Postgres.

---

## 4. As etapas

### Etapa 0: Decisões do proprietário e base do modelo de decisão

- **Decisões:** D1 a D6 (seção 6) precisam estar respondidas antes da etapa que depende de
  cada uma. A Etapa 1 depende de D3.
- **Base comum do modelo de decisão (Clef):** é a Etapa 0 do
  [PLANO-JEV](./PLANO-JEV.md#3-etapa-0-base-comum-pré-requisito-de-todas), construída já com
  o Clef. Inclui:
  - cliente do modelo;
  - filtro que bloqueia CPF, CID e salário;
  - registro de cada consulta e do que a pessoa decidiu;
  - selo de sugestão com a confiança;
  - fila de conferência.

  **Precisa existir antes das Etapas 2 e 3**, que usam o Clef na triagem e no mapeamento
  de colunas. As Etapas 1 e 4 não dependem dela.

### Etapa 1: Guarda de documentos por setor

- **Objetivo:** todo setor pode guardar documentos na plataforma, com a mesma trava de
  permissão das telas. Hoje só o RH tem.
- **O que entra:**
  - armazenamento privado por organização, com uma pasta lógica por setor;
  - a tabela de documentos;
  - envio pela tela de cada módulo (mesmo componente "Enviar arquivo" de hoje);
  - repetido reconhecido pelo sha256;
  - versão quando o mesmo documento é atualizado.
- **Aceite:** um documento enviado ao Financeiro não aparece para quem é só do RH, nem
  pela tela nem pela consulta direta ao banco (teste com a matriz de acesso).

### Etapa 2: Coleta pelo navegador

- **Objetivo:** achar os arquivos esquecidos nos computadores (todos Windows) sem
  instalar nada.
- **Fluxo:**
  1. **Pedir acesso:** a pessoa clica em **"Conceder acesso a uma pasta"** (Chrome ou Edge)
     e escolhe Documentos, Área de trabalho, Downloads, a pasta da rede ou o próprio
     perfil. O navegador mostra o aviso dele, e ela aceita.
  2. **Registrar o aceite:** a plataforma grava quem aceitou, quando, a pasta e o
     computador. Na primeira vez, a pessoa dá um nome ao computador, por exemplo
     "PC Ana – Financeiro".
  3. **Triar no próprio computador:**
     - a plataforma lê a pasta e calcula o sha256 sem subir nada;
     - descarta o que já está na plataforma;
     - classifica primeiro por regra: os leitores que já existem (extrato, NF-e, DANFE,
       planilha), mais nome, extensão e padrões (holerite, férias, recibo, contrato,
       orçamento…);
     - manda ao Clef só os casos em dúvida, com o mínimo (regra 4).
  4. **Conferir:** a lista aparece agrupada por setor sugerido. A pessoa troca o setor,
     desmarca ou marca como pessoal (e aí o arquivo não sobe).
  5. **Subir:** sobe só o que ela aprovou, para a guarda do setor (Etapa 1). Onde existe
     leitor, a leitura entra no fluxo de sempre: extrato vai para a conciliação, nota vai
     para o ICMS ou o recebimento, sempre com a prévia e a confirmação.
- **Limite:** o navegador só alcança a pasta escolhida e só lê com a plataforma aberta.
  Isso é a proteção do próprio navegador contra sites maliciosos, e nenhum botão muda isso.
- **Aceite:**
  - QA com usuário temporário e pasta fictícia (com arquivos pessoais, repetidos e de
    vários setores);
  - nada sobe sem confirmação;
  - arquivo pessoal e repetido ficam fora;
  - o aceite aparece no registro;
  - nenhum dado com CPF sai para o Clef (teste do filtro).

### Etapa 3: Mais leitores

- **.docx (Word):** leitura de texto, no mesmo esquema do leitor de Excel (sem biblioteca
  nova).
- **Planilha livre** (estoque, controle de compras, lista de fornecedores):
  - o Clef sugere qual coluna corresponde a qual campo da plataforma, recebendo só os
    títulos e linhas de exemplo sem dados pessoais;
  - a pessoa confirma o mapeamento;
  - a plataforma mostra a prévia do que vai gravar.
- **PDF escaneado e foto:** OCR, conforme a decisão D4.
- **Aceite:** para cada leitor, testes com arquivos reais anonimizados, e a prévia confere
  com o documento.

### Etapa 4: Ligações por regra

- **Objetivo:** ligar cada documento ao que já existe no banco, sem IA, de forma exata e
  barata.
- **Regras:**

  | Achado no documento | Liga a |
  |---|---|
  | CNPJ | fornecedor ou cliente |
  | Chave de acesso ou nº/série da NF | recebimento, conta a pagar, linha do Painel do ICMS |
  | Nº da OS | ordem de serviço |
  | Nº da cotação ou da ordem de compra | cotação / ordem de compra |
  | Nome ou matrícula de colaborador | colaborador (**só visível ao RH**) |
  | Valor + data | lançamento no extrato / título pago (sugestão, com a mesma regra da conciliação) |

- **Na tela:** bloco **"Documentos ligados"** nas telas de fornecedor, cliente, nota,
  ordem de compra, OS e colaborador.
- **Aceite:** abrir um fornecedor mostra as notas, cotações, OCs, pagamentos e os
  documentos dele. Ninguém vê ligação para algo que não pode abrir.

### Etapa 5: Busca por significado e perguntas (na fase da SARA)

- **O que entra:**
  - extensão `vector`;
  - os documentos são divididos em trechos com o vetor de significado, cada trecho com
    a permissão do documento;
  - busca em linguagem normal ("o contrato de manutenção do forno de 2023");
  - perguntas sobre os documentos pela SARA.
- **Regras:** a resposta sempre traz a fonte (qual documento e trecho). Ligações
  sugeridas pelo modelo entram como **sugestão a confirmar**.
- **Depende de:** decisão D5 e da SARA nível 1 (consulta) em uso.

### Etapa 6 (opcional): Programa instalado no Windows

- **Quando:** só se as Etapas 1–2 mostrarem volume relevante fora do alcance do
  navegador (disco inteiro, unidades de rede, varredura agendada).
- **Como:** programa da PecSil baixado de dentro da plataforma, entrando com a conta da
  pessoa, com o **mesmo aceite e o mesmo registro**, e enviando para a mesma triagem e
  conferência.
- **Não é computer use.** A IA controlando tela e mouse é lenta, cara e frágil para
  inventário de arquivos.

---

## 5. Ordem de execução

| Ordem | Etapa | Pronta para começar? |
|---|---|---|
| 0 | Decisões D1–D6 | aguardando o proprietário |
| 0 | Base do modelo de decisão (Etapa 0 do PLANO-JEV, com o Clef) | aguardando a conta da Cloudflare (número da conta e token só de Workers AI) |
| 1 | Guarda de documentos por setor | após D3 |
| 2 | Coleta pelo navegador | após a 1, a base do Clef, D1 e D2 |
| 3 | Mais leitores | após a 2 e a base do Clef (prioridade pelo que a coleta mais encontrar) |
| 4 | Ligações por regra | após a 1; ganha força com a 2 |
| 5 | Busca por significado e perguntas | na fase da SARA, após D5 |
| 6 | Programa instalado (opcional) | só se a 2 mostrar necessidade |

**Portão entre etapas:** igual ao do PLANO-JEV. A próxima etapa só começa quando a
anterior cumprir o aceite e estiver em produção sem incidente.

---

## 6. Decisões pendentes do proprietário

| # | Pergunta | Opções / recomendação |
|---|---|---|
| D1 | Quem pode coletar arquivos dos computadores? | Todos que operam algum setor, ou só pessoas indicadas por setor (recomendado para começar). |
| D2 | Quais pastas sugerir e quais excluir? | Sugerir Documentos, Área de trabalho, Downloads e a pasta da rede; excluir sempre pastas de sistema, de programas e de fotos pessoais. |
| D3 | Depois de ler um arquivo (ex.: extrato), guardar o original? | Guardar o original junto do dado extraído (recomendado: rastreabilidade), ou só o dado. |
| D4 | OCR de escaneados: onde roda? | Local no servidor (nada sai da empresa, mais lento) ou serviço externo (mais preciso, dados saem). |
| D5 | Busca por significado: onde roda? | Modelo local (nada sai) ou na nuvem, mandando só trechos sem dados pessoais. |
| D6 | Teto de uso de IA por setor | Valor mensal por setor e quem acompanha o painel. |

---

## 7. Como executar cada etapa (roteiro fixo)

1. Reler este documento e conferir se as dependências da etapa estão cumpridas.
2. Plano detalhado da etapa (arquivos, migração, telas), aprovado pelo proprietário.
3. Implementação com testes.
4. Migração testada com transação desfeita no banco real. Aplicação em produção só com
   o OK do proprietário.
5. QA no navegador com usuários temporários e as permissões reais da equipe, nas telas
   1440 e 390 e nos temas claro e escuro. O teste só toca dados criados por ele e apaga
   tudo no fim.
6. Entrada nas Novidades (`lib/novidades.ts`).
7. Commit, merge e deploy só com pedido explícito.

---

## 8. Registro de decisões

| Data | Etapa | Decisão | Quem |
|---|---|---|---|
| 10/10/2026 | todas | Arquivos entram uma vez só no banco (fonte única); o Segundo Cérebro é a camada de ligações e busca por cima, derivada e reconstruível | Proprietário |
| 10/10/2026 | 2 | Coleta começa pelo navegador, com aceite registrado (quem, quando, computador, pasta) e conferência antes de subir; programa instalado só se precisar | Proprietário |
| 10/10/2026 | 2 | Todos os computadores da PecSil são Windows | Proprietário |
| 10/10/2026 | todas | SARA tratada como harness corporativo; o Segundo Cérebro é a memória dela (blueprint, Fase 6) | Proprietário |
| 10/10/2026 | 0, 2, 3 | O modelo de decisão é o Clef; a base comum do PLANO-JEV (feita com o Clef) é pré-requisito das Etapas 2 e 3 | Proprietário |
