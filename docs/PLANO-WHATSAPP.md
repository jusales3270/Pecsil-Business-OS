# Plano do WhatsApp — Evolution API

Decisões do proprietário em 24/10/2026. Item do ROADMAP: B-04 (canal), que serve também o P-06 (alertas da
Forja e do Business OS) e o envio da SARA central (PLANO-MINDMASTER §3).

## 1. Decisões tomadas

| # | Decisão | Resposta |
|---|---|---|
| 1 | Ferramenta | **Evolution API v2**, não a Evolution Go. Ela faz o WhatsApp Web (QR Code) e a API oficial da Meta (`WHATSAPP-BUSINESS`) na mesma interface; a Go só faz o WhatsApp Web, e o plano precisa dos dois. |
| 2 | Número | **O chip de uso interno já existe.** Ele entra pelo WhatsApp Web. Quem é de fora (fornecedores e clientes) fica para um número na API oficial, mais tarde (W5). |
| 3 | Ativação | **Aceita**, para quando a versão 2.4 (que pede ativação) for usada; a 2.3.7 instalada na W1 não pede. A ativação é com o e-mail e o telefone indicados pelo proprietário (guardados fora do repositório). O sinal a cada 5 minutos leva versão, contagem de mensagens, recursos ligados e o IP do servidor; não leva conteúdo, contatos nem números (documentação da Evolution; conferir o tráfego na W1). |
| 4 | Ação pedida pelo WhatsApp | **Meio-termo.** Ação de baixo risco, com limite, pode ser confirmada no próprio WhatsApp; o resto vai como link para o Permitir da plataforma (§5). |
| 5 | Formato da resposta | **A SARA responde no formato em que recebeu.** Texto vira texto; áudio vira áudio (§4). |

**Não muda:** o vigia externo (T-03) continua mandando alerta direto pela API oficial da Meta. Ele roda na nuvem e
tem de avisar justamente quando o nosso servidor cai; não pode depender de nada instalado nele.

## 2. Regras que não mudam

- **Credencial:** quem fala com a SARA pelo WhatsApp é a pessoa do cadastro, com as permissões dela (a mesma sessão
  que as guias usam). Número sem pessoa ligada recebe só a resposta padrão de que o número não está cadastrado.
- **Lista fechada de números (decisão do proprietário, 24/10):** só os números cadastrados à mão em
  Fundação › WhatsApp, cada um ligado a um usuário da plataforma, falam com a SARA. Mensagem de qualquer outro
  número é **ignorada em silêncio**: a SARA não responde, não marca como lida e não mostra "digitando". Fica só a
  contagem (data, hora e os 4 últimos dígitos, sem o conteúdo), para o proprietário ver se alguém tentou.
  Grupos são sempre ignorados.
- **A credencial vem do cadastro:** o número identifica o usuário e a SARA responde com a sessão e as permissões
  dele, como na plataforma. Usuário desativado ou com acesso vencido: o número para de valer sozinho.
- **Chip interno só com quem aceitou:** volume baixo, sem disparo em massa e sem contato de fora. O WhatsApp Web
  automatizado é cliente não oficial e o número pode ser banido sem recurso; esta é a proteção.
- **Tudo auditado:** cada mensagem que entra e sai fica registrada (quem, quando, tipo, ligação com a conversa da
  SARA e com a ação). O conteúdo segue as regras da SARA: nada de CPF, saúde ou folha em mensagem.
- **Horário silencioso** (P-06, decidido em 24/10): nenhum alerta sai entre 20h e 7h nem aos domingos; o que surgir
  vai junto no primeiro envio do horário seguinte. A conversa iniciada pela pessoa é respondida a qualquer hora.
  O alerta de infraestrutura do vigia (T-03) não segue essa regra (sai pela Meta).
- **Nenhum dado da empresa sai por canal que a pessoa não pode ver:** a SARA só manda o que a credencial da pessoa
  permite ver, como na plataforma.

## 3. Arquitetura

```
 celular da pessoa ──WhatsApp──▶ chip interno ◀──WhatsApp Web (sai do servidor)── Evolution API (Coolify, rede interna)
                                                                                   │  webhook com segredo
                                                                                   ▼
                                                     Business OS: /api/whatsapp/webhook  ──▶ fila whatsapp_entrada
                                                                                   │
                                     texto ─────────────┬───── áudio ──▶ Whisper (Cloudflare) ──▶ texto
                                                        ▼
                                          SARA da área (ou central) com a sessão da pessoa
                                                        │
                              resposta em texto ◀───────┴──────▶ resposta em áudio: TTS Grok (luna) ──▶ nota de voz
                                                        │
                                          Evolution API: sendText / sendWhatsAppAudio / sendMedia (PDF)
```

- **Serviços no Coolify:** Evolution API v2, Postgres próprio e Redis próprio. O banco fica separado do Supabase.
  Sem porta pública: a plataforma fala com ela pela rede interna (`coolify-proxy`, como a Forja).
- **Chaves:** `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `WHATSAPP_WEBHOOK_SEGREDO`, só no servidor (nunca
  `NEXT_PUBLIC_`).
- **Entrada:** a Evolution não assina o webhook. A rota aceita só a rede interna e exige o segredo, e responde
  na hora (a Evolution espera até 30 s). O trabalho vai para a fila `whatsapp_entrada`, processada fora da
  requisição. A mesma mensagem não é processada duas vezes (chave = id da mensagem no WhatsApp).
- **Porta 443:** o WhatsApp Web sai do nosso servidor para fora; a conversa funciona mesmo com a 443 fechada para
  quem está fora. O link do Permitir (§5) depende dela: mais um motivo para fechar o B-06.
- **Memória do servidor:** medir antes da W1 (Evolution em Node + Redis + Postgres).

## 4. Texto com texto, áudio com áudio

A SARA identifica o tipo da mensagem que chegou pelo webhook (texto, nota de voz, áudio, imagem, documento) e
responde no mesmo formato.

| Recebeu | Ela entende por | Responde com |
|---|---|---|
| Texto | o próprio texto | texto (formatação do WhatsApp: *negrito*, listas curtas; sem tabela larga) |
| Nota de voz ou áudio | transcrição pelo Whisper (Cloudflare, já usado na plataforma) | **nota de voz** gravada pelo TTS do Grok (voz luna, a mesma da SARA), no formato de áudio gravado do WhatsApp |
| Imagem (com ou sem legenda) | a foto vai ao modelo, como a "foto do item" da E2 | texto, ou áudio se a legenda veio em áudio |
| Documento | o leitor de anexos da E5 | texto |

Regras da resposta em áudio:
- **O que é falado:** a resposta direta, como na voz da central (até ~60 palavras, números ditos por extenso do
  jeito certo, sem tabela nem marcação). A personalidade vira as tags do motor de voz, nunca lidas.
- **O que não cabe em áudio vai junto em texto, curto:** o link do Permitir, um número de pedido ou OC para copiar,
  ou uma tabela. Ela diz no áudio "mandei o link aqui embaixo".
- **A transcrição fica registrada** na conversa da SARA (marcada com 🎤), como já acontece com a voz na plataforma.
- **Se a voz falhar** (TTS fora do ar ou teto de custo), ela responde em texto e avisa que foi por texto.
- **Formato do arquivo:** o TTS grava em mp3; a nota de voz do WhatsApp é OGG/Opus. Conferir na W1 se a Evolution
  converte no envio (`sendWhatsAppAudio`); se não, a plataforma converte antes.
- **Custo:** cada resposta em áudio soma o TTS ao custo da SARA (painel E4), dentro do teto do mês.

## 5. Ações pedidas pelo WhatsApp (meio-termo)

A SARA prepara a ação como hoje (ela nunca grava sozinha). A diferença está em onde a pessoa confirma:

- **Confirmar no WhatsApp:** só as ações que a área liberou para isso, com limite. Mesmo quadro de limites das
  Guias (E3), com uma marca a mais por ação: "pode confirmar pelo WhatsApp", até N por dia. Quem libera é quem
  responde pela área (decisão da área, não do proprietário). O padrão é nada liberado.
  - A SARA responde com o resumo e um código curto: "Abrir chamado de TI: impressora do Almoxarifado sem papel.
    Responda **SIM 4821** para confirmar." Vale 15 minutos e só do mesmo número que pediu.
  - "SIM" sem o código, código errado ou vencido não confirma nada.
  - Áudio dizendo "sim" não confirma: a confirmação é sempre digitada, com o código.
- **Todo o resto vai para o Permitir na plataforma:** a SARA manda o link do cartão; quem confirma entra com a
  senha ou a digital. Ação de risco alto, dinheiro, pedido de material, convite a fornecedor e qualquer envio para
  fora ficam sempre aqui.
- **Candidatas a liberar primeiro** (cada área decide): abrir chamado de TI, anotar na Biblioteca da Fundição.

## 6. Etapas

| # | Etapa | Entrega | Portão |
|---|---|---|---|
| W1 | Canal | Evolution API + Postgres + Redis no Coolify (rede interna); chip conectado por QR em **Fundação › WhatsApp** (estrutura da plataforma, só o proprietário): estado da conexão, QR Code, desconectar e envio de teste; conferência do formato de áudio | Memória do servidor medida; o proprietário lê o QR com o chip |
| W2 | Vários números, listas e alertas internos | **Vários números da plataforma** (cada um uma instância da Evolution): nome, departamento, descrição do que atende e **SARA responsável**; conectar pelo QR, teste, desconectar, desativar e remover. Em cada número, duas listas fechadas: **Comunicação interna** (número + usuário, que precisa ter a SARA do número) e **Comunicação externa** (número + nome + fornecedor/cliente/outro, com vínculo opcional ao cadastro); ativar/desativar, remover, boas-vindas opcional e auditoria (migração 202610240002); alertas da plataforma e da Forja (P-06) com horário silencioso (20h–7h e domingo); quais avisos vão ao WhatsApp: **a decidir** | W1 |
| W3 | SARA pelo WhatsApp | Entrada pelo webhook, identificação da pessoa, a SARA da área certa (ou a central, para quem tem) com a sessão dela, texto com texto e áudio com áudio (§4), Permitir por link | W2 |
| W4 | Confirmar pelo WhatsApp e envios da central | Marca "pode confirmar pelo WhatsApp" no quadro de limites (§5); documentos em PDF e mensagens de voz da SARA central para pessoas da empresa, com o Permitir | W3; áreas liberam as ações |
| W5 | Quem é de fora | Número na API oficial da Meta (instância `WHATSAPP-BUSINESS`), modelos de mensagem aprovados, convite e cobrança a fornecedores, mensagens a clientes | Número oficial e conta Meta Business verificada |

## 7. Pendências

- Medir a memória livre do servidor (antes da W1).
- O proprietário lê o QR Code com o chip interno (W1).
- As áreas escolhem quais ações podem ser confirmadas pelo WhatsApp (W4).
- Para a W5: número oficial e conta Meta Business verificada (a mesma que o vigia T-03 vai usar).

## 8. Registro

| Data | O que mudou | Quem |
|---|---|---|
| 24/10/2026 | Vários números (pedido do proprietário): cada número com departamento, descrição e SARA responsável (ex.: um só para o Comercial, outro para o atendimento a clientes, outro para o Fiscal); as listas passam a ser de cada número; o chip atual vira o primeiro número | Proprietário |
| 24/10/2026 | Duas listas (pedido do proprietário): Comunicação interna (funcionários, ligados ao usuário) e Comunicação externa (fornecedores, clientes e outros, para os envios e respostas autorizadas da W5). Um número vale para uma lista só | Proprietário |
| 24/10/2026 | Lista fechada de números cadastrada à mão pelo proprietário, ligada ao usuário (no lugar do número confirmado pela própria pessoa); número fora da lista é ignorado em silêncio. Horário silencioso 20h–7h e domingo. Quais avisos vão ao WhatsApp: a decidir | Proprietário |
| 24/10/2026 | **W1 concluída:** Deploy feito pelo proprietário; chip interno conectado pelo QR em Fundação › WhatsApp e mensagem de teste recebida no celular dele. A v2.3.7 conectou sem problema de protocolo | Proprietário |
| 24/10/2026 | W1: Evolution API **v2.3.7** instalada no Coolify (serviço `evolution-api-whatsapp`, só rede interna, tetos de memória 1 GB / 256 MB / 128 MB, telemetria desligada). A 2.4.0 ainda é versão de teste; a 2.3.7 não pede ativação. A tela do canal fica na **Fundação › WhatsApp** (decisão do proprietário: é estrutura, não TI) | Proprietário |
| 24/10/2026 | Plano criado: Evolution API v2; chip interno existente; ativação aceita; meio-termo para confirmar ações; resposta no mesmo formato da mensagem (texto ou áudio) | Proprietário |
