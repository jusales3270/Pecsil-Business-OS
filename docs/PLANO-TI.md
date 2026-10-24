# Módulo de TI — Pecsil Business OS

**Consolidação de escopo, ideias e planejamento**
Fontes: 5 conversas entre 19/set e 18/out/2026
Status: em planejamento (nada implementado)

---

## 1. Contexto e motivação

O Pecsil Business OS deve ser um ecossistema em que os departamentos da Pecsil se conversam, e não apenas um ERP. Conforme a camada de inteligência cresce, a TI fica mais crítica do que costuma ser numa indústria, porque sustenta todo o resto.

**Infraestrutura atual**
- Servidor interno da Pecsil, só CPU (sem GPU), que hospeda:
  - a base do ecossistema (Business OS + Supabase);
  - o monitoramento das máquinas CNC.
- GRV ainda em uso, a ser substituído gradualmente conforme o ecossistema cresce.
- O supervisor de TI faz manutenção nas máquinas principalmente via AnyDesk.

**Dores levantadas**
1. **Quedas de energia** derrubam o servidor. Alguém precisa avisar o supervisor de TI, que vai até a fábrica religá-lo.
2. **Oscilação da internet**, que já impediu o FORJA de abrir.
3. **Manutenção remota** sem registro nem auditoria (AnyDesk).
4. **Não existe histórico** das quedas (frequência, duração, causa).

**Decisão de prioridade:** o módulo de TI vem **antes do módulo de Estoque**, por ser o que mantém os demais de pé.

---

## 2. Pré-requisito: resolver a queda de energia fora do software

Se o servidor cai por falta de energia, qualquer agente rodando nele cai junto e não consegue religá-lo. Por isso a solução de religamento é de hardware e vem antes do módulo.

| Medida | Função |
|---|---|
| **Nobreak gerenciável** (USB ou rede) | Segura o servidor durante a queda e faz o desligamento limpo antes de a bateria acabar |
| **BIOS com "Restore on AC Power Loss"** | O servidor religa sozinho quando a energia volta |
| **iDRAC / iLO / IPMI** (se o servidor tiver) | Ligar e diagnosticar o hardware à distância |
| **PDU ou tomada inteligente gerenciável** | Cortar e religar a energia remotamente nos casos mais sérios |

Só as duas primeiras medidas já eliminam a maior parte das idas do supervisor de TI à fábrica.

---

## 3. Arquitetura de monitoramento

### 3.1 Regra crítica
**O monitor não pode rodar no mesmo servidor que ele vigia.** Se o servidor cai, o alerta cai junto. É preciso um vigia externo:
- checador na nuvem, ou
- Raspberry Pi alimentado pelo nobreak.

Os alertas saem por **WhatsApp ou Telegram**.

### 3.2 Coleta: não construir do zero
Ferramentas open source já fazem bem a coleta:
- **Uptime Kuma** (disponibilidade e uptime);
- **Zabbix** (monitoramento completo de infraestrutura);
- **Netdata** (métricas em tempo real).

O módulo de TI **consome os dados** dessas ferramentas, em vez de reimplementar a coleta.

### 3.3 As três frentes

**Rede e internet**
- Ping no gateway interno e em alvos externos.
- Medição de latência e perda de pacote, para detectar oscilação antes de virar queda.
- Registro de padrões (ex.: cai sempre no mesmo horário, ou só em um trecho da rede).
- Failover automático para o link reserva, se houver segunda operadora.
- Aviso proativo de que o link caiu, antes de alguém descobrir ao tentar abrir o FORJA.

**Servidores**
- CPU, memória, disco e temperatura.
- Verificação de que os serviços críticos estão de pé.
- Reinício automático de serviço travado, feito pelo agente de dentro da máquina.

**Computadores interligados**
- Mapa de quem está online.
- Quais estações estão acessando o ecossistema.
- Alerta quando uma máquina crítica some da rede.

---

## 4. Acesso remoto: substituir o AnyDesk

| Opção | Características |
|---|---|
| **RustDesk auto-hospedado** | Parecido com o AnyDesk, mas roda no servidor da Pecsil, com controle de quem acessou |
| **MeshCentral** | Acesso remoto, inventário de máquinas e Wake-on-LAN (ligar computadores pela rede) |

As duas opções são gratuitas e registram cada sessão, o que se integra à auditoria do Business OS.

---

## 5. Escopo funcional do módulo

1. **Inventário de ativos:** servidores, estações, equipamentos de rede, coletores das CNCs e GRV.
2. **Painel de saúde:** disponibilidade, disco, backups e status do nobreak.
3. **Incidentes:** quedas com duração e causa, criando o histórico de energia e de rede que hoje não existe.
4. **Chamados internos** (helpdesk).
5. **Acessos remotos auditados:** quem acessou qual máquina, quando e por quanto tempo.

---

## 6. Abordagem agêntica

### 6.1 Decisão de construção
Foi descartado embutir uma ferramenta agêntica pronta no código, por ser pesada demais. O módulo será **desenvolvido manualmente** (Junior + Claude), com abordagem agêntica para monitorar e otimizar rede, servidores e computadores.

### 6.2 Ciclo adaptado da "fábrica agêntica"
Foi analisado um conteúdo sobre um ciclo agêntico de correção de código (agentes que coletam entradas, corrigem o que é verificável, passam por uma política de aprovação e fazem um "look back" semanal). A mesma lógica se aplica à infraestrutura:

| Etapa | Aplicação no módulo de TI |
|---|---|
| **Coleta** | Ping, uptime e métricas de servidores e rede |
| **Política** | Motor determinístico decide o que o agente faz sozinho e o que escala para humano |
| **Ação autônoma permitida** | Reiniciar serviço travado, trocar para o link reserva |
| **Escalonamento** | Alerta via WhatsApp ou Telegram para o responsável |
| **Look back semanal** | Encontra padrões recorrentes (horário, trecho da rede) e gera evidência para cobrar a operadora ou atacar a causa |

### 6.3 Alinhamento com a doutrina
- **Zero-Inference:** o motor determinístico julga se a ação é permitida, e o LLM só executa e narra.
- Equivale ao conceito de **Safe Actions do ECOS**.
- Cada decisão do agente fica registrada de forma auditável.

---

## 7. Integração com o ecossistema

### 7.1 Eventos entre módulos
- Servidor ou coletor fora do ar gera um evento para a **Produção**.
- A Produção marca os dados da CNC como **"sem telemetria"**, em vez de mostrar uma parada falsa.
- É exemplo do tipo de conversa entre módulos que falta hoje para o Business OS deixar de ser só ERP.

### 7.2 Sara
- A Sara seria **uma das primeiras consumidoras** do módulo de TI.
- Avisa quando o servidor cai ou volta e o que ficou pendente.
- **Alertas falados** via TTS local em CPU:
  - **Kokoro** (~82M parâmetros, vozes pt-br, melhor candidato);
  - **Piper** (mais leve, fallback garantido).
- O TTS local também serve de fallback quando a internet oscila e a API de voz na nuvem cai.
- A voz deve degradar sem quebrar nada: se o servidor cair, o Business OS segue operando sem a Sara.
- **Ressalva:** o alerta de "servidor caiu" precisa sair de fora do servidor (ver item 3.1).

---

## 8. Produtização

A Pecsil funciona como laboratório. Depois de validado lá dentro, o módulo vira produto:

1. **TI agêntica white-label para indústria pequena e média.** A maioria não tem equipe de TI. O produto monitora rede, servidores e máquinas, corrige o que é seguro, escala o resto e entrega um relatório mensal de falhas recorrentes com evidência.

2. **Camada de governança da autonomia de agentes.** A política de aprovação (o que o agente faz sozinho, o que exige humano, registro auditável) é o ativo mais valioso. Conecta-se ao **Sentinela** e ao posicionamento de decisão auditável da SomaVerso, e é o que empresa regulada vai exigir antes de deixar um agente agir.

3. **Versão Autopilot: serviços gerenciados de TI por resultado.**
   - Em vez de vender software, vender "infraestrutura de pé" como SLA para indústria de médio porte.
   - O agente monitora e remedia.
   - Pacote sugerido junto com o financeiro (BPO financeiro automatizado), oferecido a outras indústrias da região.
   - Cobrança por SLA, não por assento de software.

---

## 9. Ordem de execução sugerida

1. **Hardware:** nobreak gerenciável + BIOS com religamento automático (+ iDRAC/iLO/IPMI, se houver).
2. **Backup:** garantir backup do banco do Supabase fora do servidor.
3. **Vigia externo:** Uptime Kuma (nuvem ou Raspberry Pi) com alertas por WhatsApp ou Telegram.
4. **Coleta interna:** Zabbix ou Netdata nos servidores e na rede.
5. **Acesso remoto:** substituir o AnyDesk por RustDesk ou MeshCentral.
6. **Módulo no Business OS:** inventário, painel de saúde, incidentes, chamados e acessos auditados.
7. **Eventos entre módulos:** TI → Produção ("sem telemetria").
8. **Camada agêntica:** política determinística + ações autônomas seguras + look back semanal.
9. **Sara:** alertas falados de TI com TTS local.
10. **Empacotamento** como produto white-label ou serviço por SLA.

---

## 10. Riscos e pontos de atenção

- **Maior risco atual do ecossistema:** não há confirmação de backup do Supabase fora do servidor, dado o histórico de quedas.
- Qualquer máquina local 24h (vigia, agentes) também cai na falta de energia, por isso o nobreak vem antes de qualquer agente.
- A oscilação da internet é um ponto único de falha se FORJA ou Business OS dependerem da nuvem.

---

## 11. Pendências em aberto

- [ ] O FORJA e o Business OS rodam 100% no servidor interno ou dependem de algo na nuvem? (Define se a oscilação da internet deveria derrubar o FORJA.)
- [ ] Existe backup do Supabase fora do servidor?
- [ ] O servidor tem iDRAC, iLO ou IPMI?
- [ ] A Pecsil tem, ou pode ter, um link de internet reserva (segunda operadora)?
- [ ] Qual modelo de nobreak existe hoje, e se ele é gerenciável?
- [ ] Testar Kokoro e Piper na CPU do servidor com frases típicas da Sara (tempo de geração e qualidade da voz).

---

## Conversas de origem

| Data | Conversa | Conteúdo principal |
|---|---|---|
| 19/set/2026 | Análise do repositório Jarvis Voice Butler | Sara como consumidora do módulo de TI; voz que degrada sem quebrar |
| 20/set/2026 | skills pecsil B.O. | Origem do módulo, hardware, monitoramento externo, substituição do AnyDesk, escopo funcional, evento TI → Produção, risco de backup |
| 29/set/2026 | Módulo de TI para Opex e Business Boss | Abordagem agêntica, três frentes, oscilação da internet, ciclo da fábrica agêntica, produtização |
| 29/set/2026 | Pesquisa sobre repositório | Alertas de TI por voz com TTS local em CPU (Kokoro/Piper) |
| 18/out/2026 | Empresa de 1 trilhão de dólares | Versão Autopilot: serviços gerenciados de TI por SLA |

---

*SomaVerso AI Systems*

---

## Estado em 18/10/2026 (anotado no repositório)

O texto acima é a consolidação das 5 conversas, trazida pelo proprietário em 18/10/2026. As
conversas aconteceram fora deste repositório e foram registradas aqui sem mudança. O que segue é o
cruzamento com o que o repositório já registra.

### O que o debate já tem no roadmap

| Do debate | Item | Situação em 18/10 |
|---|---|---|
| Backup do Supabase fora do servidor (o "maior risco", §10) | B-02 = T-02 | adiado (16/10); o debate pede reabrir |
| Vigia externo e alertas (§3.1) | B-04 + T-03 | decisão: o B-04 espera o chip do WhatsApp; o Telegram (citado no §3.1) não depende dele |
| Nobreak e link reserva (§2, §3.3) | B-10 + T-01 | travado: compra |
| Internet e porta 443 | B-06 | travado: operadora e SSH |
| Telemetria das CNCs (§7.1) | P-10 | na fila |

Os itens do módulo estão na raia **T — TI** do [ROADMAP.md](ROADMAP.md), seguindo a ordem do §9.
A produtização (§8) fica estacionada pela regra de 17/10: primeiro a Pecsil pronta e validada.

### Respostas que o repositório já dá às pendências do §11

- **Existe backup do Supabase fora do servidor?** Não. O Coolify não administra nenhum banco, então
  não faz backup do Supabase nem do Postgres da Forja ([INFRA.md](INFRA.md), "Backup").
- **O Forja e o Business OS rodam 100% no servidor interno?** Os dois rodam no `innovait-server`
  (192.168.0.89), dentro do Coolify. Dependem da internet:
  - o acesso de fora da fábrica (IP público e porta 443, B-06);
  - a SARA (Anthropic);
  - o Clef (Cloudflare Workers AI);
  - o e-mail do Comercial (Microsoft 365, ainda não ligado, C-14).

  Na rede interna, a oscilação da internet não deveria derrubar o Forja. Fora da fábrica, derruba.
- **Continuam em aberto, com o supervisor de TI:**
  - se o servidor tem iDRAC, iLO ou IPMI;
  - o modelo do nobreak e se ele é gerenciável;
  - se existe link reserva;
  - o teste do Kokoro e do Piper na CPU.

### Quem decide

- **Supervisor de TI:** as regras do módulo (categorias e prazos de chamado, o que o agente pode
  fazer sozinho) e a escolha das ferramentas (Uptime Kuma, Netdata ou Zabbix, RustDesk ou MeshCentral).
  É o **Cesar Augusto Santos** (confirmado pelo proprietário em 19/10/2026).
- **Proprietário:** compras e recursos (nobreak, link reserva, onde roda o vigia externo, o canal de
  alerta) e o uso de IA.

### T-01: roteiro do supervisor de TI (hardware, §2)

Não é software. É o que tira a ida à fábrica quando a energia cai:

1. **BIOS do servidor:** ligar a opção "Restore on AC Power Loss", que em algumas placas aparece
   como "AC Back" ou "After Power Failure", em **Power On** (ou **Last State**). Com isso, o servidor
   religa sozinho quando a energia volta.
2. **Controle remoto do hardware:** ver se o servidor tem iDRAC (Dell), iLO (HP) ou IPMI. Se tiver,
   ligar, pôr senha e deixar acessível só pela rede interna ou VPN.
3. **Nobreak:** anotar o modelo atual, a autonomia e se ele é gerenciável (porta USB ou de rede para
   o servidor). Se não for, a compra é do proprietário.
4. **Depois do nobreak gerenciável:** instalar o NUT (Network UPS Tools) no servidor, para
   desligamento limpo antes de a bateria acabar.
5. **Teste combinado:** num horário sem produção, desligar a energia do servidor e religar. O vigia
   (T-03) deve registrar a queda como "o servidor reiniciou durante a queda" e o servidor deve voltar
   sozinho.

### T-03: vigia externo (construído em 18/10)

Escolhas do proprietário em 18/10: o vigia roda num **projeto Supabase na nuvem**, e o alerta sai
pelo **WhatsApp, pela API oficial (Meta Cloud API)**. O envio também sai de fora da fábrica: a
Evolution API rodaria no próprio servidor e cairia junto com ele.

Pronto no repositório:
- `infra/vigia/001_vigia.sql`;
- `scripts/ti-sinal-cron.mjs` e `lib/ti/sinal-de-vida.mjs`;
- testes;
- instalação em [VIGIA-EXTERNO.md](VIGIA-EXTERNO.md).

Falta do proprietário:
- criar o projeto na nuvem;
- cadastrar as 3 variáveis e a tarefa no Coolify;
- para o WhatsApp: o chip, a conta Meta Business e o modelo aprovado.

### T-02: backup externo (construído em 18/10)

Decisão do proprietário em 18/10: o backup fica **no mesmo projeto Supabase da nuvem do vigia**; os
**desenhos da Forja ficam fora** (serão guardados na plataforma, no módulo da Fundição).

O desenho:
- criptografado com `age` antes de sair, com a chave privada só com o proprietário;
- o servidor só grava, sem ler nem apagar;
- papel `backup_leitura` só de leitura no banco;
- retenção feita pela nuvem;
- aviso ao vigia, que alerta se passar 26 h sem backup.

Instalação e restauração em [BACKUP-EXTERNO.md](BACKUP-EXTERNO.md).

Falta:
- o OK para aplicar o papel no banco;
- o projeto na nuvem (o mesmo do vigia);
- a chave `age`;
- o app no Coolify;
- **a restauração real**, sem a qual o T-02 não conta como entregue.

### T-06: módulo TI no Business OS (construído em 19/10)

O escopo é o do §5. Ficam para depois os **acessos remotos auditados**, que dependem da ferramenta
que vai substituir o AnyDesk (T-05), e a **leitura do nobreak**, que depende do T-01.

| Tela | O que faz | Permissão |
|---|---|---|
| Painel | O servidor (no ar, ligado há quanto tempo, disco, memória, serviços por dentro), o backup diário, os testes de fora e os alertas por WhatsApp. Tudo lido do vigia na nuvem (`infra/vigia/003_painel.sql`) | `ti.saude` |
| Incidentes | Quedas do vigia copiadas para `ti_incidentes`, com a categoria provável pela regra; a TI confirma a causa e registra à mão o que o vigia não vê | `ti.saude` (operar registra e confirma) |
| Chamados | A fila de toda a empresa, com prazo por prioridade, responsável e histórico | `ti.chamados` (operar atende; aprovar muda as regras) |
| Inventário | Servidores, computadores, rede, coletores das CNCs, sistemas; crítico ou não | `ti.ativos` |
| Regras | Categorias e prazos dos chamados | `ti.chamados` aprovar |
| Chamados de TI (menu da conta) | Qualquer pessoa abre e acompanha os seus; os avisos do sino trazem para o chamado | nenhuma |

Como as quedas chegam:
- a tarefa do sinal de vida (`scripts/ti-sinal-cron.mjs`) lê o painel do vigia depois de avisar e copia
  as quedas dos últimos 3 dias, a cada minuto;
- as telas também copiam o histórico inteiro, no máximo uma vez por minuto.

Quem pode ver uma queda (`ti.saude`) é avisado no sino quando ela entra; alarme falso não avisa ninguém.

A leitura usa o mesmo `VIGIA_TOKEN` do sinal, sem chave nova. A cópia usa a chave de serviço que o
contêiner já tem. Se houver mais de uma empresa no banco, é preciso informar `TI_ORGANIZATION_ID`.

**Decisões do Cesar, provisórias até ele revisar em TI › Regras:**
- **Categorias:** Computador ou notebook, Impressora, Internet ou rede, E-mail, Acesso e senha,
  Business OS, Forja, GRV, Coletor das CNCs, Outro.
- **Prazos para resolver,** em horas corridas: urgente 4 h, alta 8 h, normal 24 h, baixa 72 h.
- **Em aberto:** se o prazo deve parar enquanto o chamado está "aguardando". Hoje não para.

Aplicado em 19/10: a migração `202610190001_ti_base.sql` no banco da plataforma e o `003_painel.sql`
na nuvem do vigia. Falta o deploy e os acessos do Cesar, que o proprietário libera.

**Aviso à empresa toda ("Chamar a TI pela plataforma"):** decisão do proprietário em 19/10, só sai
depois de o Cesar revisar as regras. Entra então como novidade sem `modulos` em `lib/novidades.ts`.
