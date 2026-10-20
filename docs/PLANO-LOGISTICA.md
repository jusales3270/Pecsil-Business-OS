# Plano da Logística: entregas e frota (raia L do ROADMAP)

> A ordem fica no [ROADMAP](ROADMAP.md), raia L. Aqui estão o desenho, as decisões e o aceite.
> Criado em 20/10/2026. A PecSil tem **frota própria** (confirmado pelo proprietário em 19/10).

## 1. Arquitetura

**O motor das entregas é o Fleetbase** (fork [`fleetbase-frota`](https://github.com/jusales3270/fleetbase-frota)). Ele roda
como **serviço separado** no mesmo servidor, e a plataforma fala com ele **só pela API**. É o mesmo arranjo da
Forja e do transmissor de NF-e. Os motivos:
- **Licença:** o Fleetbase é AGPL-3.0. Incorporado ao código, a plataforma inteira herdaria a licença.
- **Tecnologia:** é outra (PHP/Laravel, Ember, MySQL).
- **Atualizações:** as do projeto original continuam chegando sem conflito.

**Quem guarda o quê:**

| Business OS (fonte da verdade) | Fleetbase (execução) |
|---|---|
| A entrega: de qual OS, pedido ou nota; o cliente e o endereço; a situação; o comprovante | Locais com coordenada, a ordem, o motorista, o veículo, as posições do GPS, a previsão de chegada |

**Os fluxos:**
- **Ida:** a pessoa da expedição cria a entrega na plataforma. A plataforma:
  - geocodifica o endereço do cliente (só na primeira vez, e guarda);
  - cria o local e a ordem no Fleetbase;
  - guarda o número da ordem e o número de rastreio.
- **Volta:** quando a ordem muda no Fleetbase (despachada, a caminho, entregue), o aviso (webhook) só **dispara uma
  conferência**. A plataforma busca a ordem pela própria chave e só acredita no que veio de lá. O Fleetbase assina
  os avisos com segredos diferentes conforme a origem; o console usa até o texto fixo "internal". Por isso a
  assinatura não serve de prova.
  - A tela "ao vivo" também confere as entregas abertas a cada leitura. Sem aviso nenhum, a situação se acerta do mesmo jeito.
- **Ao vivo:** a tela lê do servidor a posição dos motoristas e das entregas abertas a cada 5 s. O mapa é OpenStreetMap
  (Leaflet). O tempo real nativo do Fleetbase, por SocketCluster, fica para depois: exigiria expor mais uma porta.

**Eventos:** cada mudança de situação vira evento do módulo `logistica`:
- `logistica.entrega.criada`, `.enviada`, `.saiu`, `.entregue`, `.falhou` e `.cancelada`;
- eles chegam ao Segundo Cérebro como pulso e às SARAs.

## 2. Decisões técnicas (tomadas na construção)

- **Versão travada:** `fleetbase/fleetbase-api` e `fleetbase-console` **v0.7.68** (05/10/2026). Nunca a `latest`.
- **Ambiente local:**
  - fica em `~/fleetbase-frota`, com `docker-compose.override.yml` próprio;
  - portas só em 127.0.0.1 e MySQL com senha (o original vem sem senha);
  - as credenciais ficam em `~/fleetbase-frota/.credenciais-locais` (permissão 600).
- **Origem das entregas:** é configuração da Logística (nome, endereço, coordenada), não um texto fixo da PecSil
  no código. Segue a diretriz de produto (VISAO-PRODUTO-ESCALA §6).
- **Endereço → coordenada:**
  - o cadastro do cliente (CEP, logradouro, número, bairro, município, UF) vai para o Nominatim (OpenStreetMap)
    uma vez por endereço, e o resultado fica guardado;
  - vai só o endereço comercial, nunca dado pessoal;
  - quem opera pode corrigir o ponto à mão.
- **Quando a entrega é nossa:** pela modalidade de frete do pedido, 0 (por conta do emitente) ou 3 (transporte
  próprio do remetente). Com frete FOB, o caminhão é do cliente.
- **Consumo:** o Fleetbase parado usa cerca de 1,5 GB de memória (medido no ambiente local em 20/10).

## 3. Decisões que não são técnicas

| Decisão | Quem decide | Trava |
|---|---|---|
| Quem responde pela expedição (opera as entregas) e quem cadastra a frota | Proprietário indica a área (vai delegar depois, 20/10) | Liberar `logistica.entregas` e `logistica.frota` |
| Regra de privacidade do rastreio do motorista: GPS só durante a entrega ou o expediente, ciência por escrito | Rosana (RH) | L-03 em produção |
| Instalar o Fleetbase no servidor da fábrica (recurso do servidor) | Proprietário | L-01 em produção |
| Rotas de verdade | Proprietário: **decidido em 20/10, Google Routes** (ver abaixo) | — |

**Rotas e previsão de chegada: Google Routes (decisão do proprietário, 20/10/2026).**
- **Plano:** o Fleetbase pede rota de carro **com trânsito** (`TRAFFIC_AWARE_OPTIMAL`), o que cai no **Routes Pro**: 5.000
  consultas grátis por mês e US$ 10 a cada 1.000 depois. Não usa rota de caminhão (Enterprise, a mais cara).
- **Guarda:** o Fleetbase refaz a rota a cada posição nova do motorista, e cada rota é uma consulta paga. Por isso a
  **plataforma** guarda a rota e a previsão de cada entrega por **3 minutos** (`rastreioGuardado`), seja quem for que
  pergunte. Com 3 caminhões e 2 horas de estrada por dia, dá cerca de 2.600 consultas por mês, dentro da cota.
  - Entre uma consulta e outra, **quanto falta e o percentual** são medidos pela própria plataforma: ela usa a rota
    guardada e a posição atual (`restanteNaRota`), sem consulta nova. Só a hora de chegada espera a próxima consulta.
- **Teto:** a cota diária no Google Cloud é de **200** no ComputeRoutes. Se estourar, o Fleetbase volta sozinho à
  estimativa em linha reta até o dia seguinte; a conta não sobe. A cota do ComputeRouteMatrix também deve ser limitada.
- **Chave:** fica só no ambiente do Fleetbase (`GOOGLE_MAPS_API_KEY`), restrita à Routes API e ao IP do servidor.
  Nunca vai para a plataforma nem para o navegador. O mapa da tela continua OpenStreetMap.
- **Teste de 20/10:** Americana → Campinas deu 39,9 km pela estrada (25 km em linha reta), 47 min sem trânsito e
  **69 min com o trânsito**, com confiança alta. A rota (polyline do Google) é desenhada no mapa.
- **LGPD:** vão ao Google só coordenadas (a posição do caminhão e a do cliente), sem nome, placa ou documento. A regra de
  privacidade do rastreio (Rosana) precisa dizer que a rota é calculada por esse serviço externo.

**A porta 443 aberta de fora (B-06)** é pré-requisito do celular do motorista na estrada.

**Quem mais consulta o Google (fora da plataforma), conferido no código em 20/10:**

| Quem | Quando consulta | Risco para a cota |
|---|---|---|
| A plataforma | No máximo 1 vez a cada 3 min por entrega na estrada | Baixo (é a guarda) |
| Tarefa do Fleetbase a cada 10 min (`update-estimations`) | Usa o cálculo próprio, não o Google | Nenhum |
| App do motorista (Navigator) | Ao abrir a ordem, ao mudar a situação ou ao puxar para atualizar (`/tracker` + `/eta`), e guarda 5 min | Baixo (umas 2 por vez) |
| Console do Fleetbase, aberto na ordem | A cada posição nova do GPS | **Alto**: acompanhar pela plataforma, não pelo console |
| **Link de rastreio do cliente** (`/int/v1/fleet-ops/lookup`, público, pelo número de rastreio) | **2 consultas a cada abertura ou atualização da página**, sem guarda e sem limite de frequência | **Alto.** Também mostra a posição do motorista e o endereço a quem tiver o número |

**Decisão do proprietário (20/10), aplicada:**
- **A consulta pública do Fleetbase está fechada.** A rota `/int/v1/fleet-ops/lookup` fica bloqueada no nginx do
  Fleetbase (`infra/fleetbase/vhost.conf`, já ligado no local) e, no servidor, também no proxy.
- **O link do cliente é o da plataforma** (`/rastreio/<código>`, migração `202610200002`):
  - é sem conta, vale 3 dias e o banco guarda só o hash;
  - é lido só pelo servidor, e a resposta de cada link fica guardada 20 s;
  - a rota vem da guarda de 3 min, então o link não gasta a cota do Google;
  - a página mostra a entrega, a previsão e o caminhão a caminho, nunca nome, telefone ou placa do motorista.
- **Quem gera:** na tela de Entregas ("Link do cliente"). Mandar ou não o link ao cliente é decisão do Comercial (Rafael).
O teto diário de 200 no Google continua sendo a última proteção: estourou, a previsão volta à linha reta e a conta não sobe.

**Cores do mapa:** a rota que falta é azul forte com contorno branco e começa no caminhão; o trajeto feito é cinza. O
laranja e o vermelho se confundiam com as estradas do mapa (pedido do proprietário, 20/10).

**Armadilhas do Fleetbase (achadas no teste de 20/10):**
- **Lista de motoristas presa no cache:** a lista (`/v1/drivers`) devolve a posição antiga, porque o GPS grava sem avisar
  o cache. O detalhe de cada motorista vem atual: a plataforma usa a lista só para saber quem são (`motoristasComPosicao`).
- **A coleta no pátio precisa ser marcada.** Sem isso, o Fleetbase calcula a rota voltando ao pátio antes do cliente.
  No app do motorista é o "coletado, saindo". O simulador faz o equivalente (`set-destination` para o cliente).
- **O trajeto feito se interrompe num salto grande** (falha de GPS, celular sem sinal), em vez de desenhar uma reta falsa.

## 4. Etapas

| Etapa | O quê | Aceite |
|---|---|---|
| L-01 local | Fleetbase no ambiente local, versão travada, conta e chave de integração | **Feito em 20/10**: API e console no ar; local, ordem, motorista, despacho, posição e previsão testados |
| L-02 | Módulo Logística na plataforma: entregas (criar a partir de OS, pedido ou avulsa), mapa ao vivo, frota (leitura), origem configurável, conferência pelo aviso, eventos | **Feito em 20/10**: migração aplicada; teste de navegador 15/15 (usuários temporários, Fleetbase local, simulador, rota e previsão com trânsito pelo Google) |
| L-01 produção | Instalar no servidor (Coolify, MySQL próprio, backup no T-02, rede interna) | **Instalado em 20/10** (OK do proprietário): app `fleetbase-entregas` no Coolify, nome interno `frota.pecsil`, conta da empresa e chave de integração criadas, aviso cadastrado, consulta pública e cadastro de contas fechados. **No ar em 20/10** (Deploy de `57ac65a`): a plataforma lê a frota e o mapa pelo Traefik, e o aviso do Fleetbase chega à plataforma (200, testado com uma ordem de teste apagada em seguida). Falta o backup do MySQL dele no T-02 |
| L-02b | Cadastro da frota e dos motoristas na plataforma (pedido do proprietário, 20/10): veículos (placa normalizada, antiga e Mercosul), motorista = colaborador ativo do RH com o veículo de costume; a plataforma é a dona do cadastro e espelha no Fleetbase (do motorista, **só o nome**); motorista na criação da entrega ou em "Designar motorista". Permissão nova `logistica.frota` (ver/operar); quem tem entregas lê a frota | **Feito em 20/10**: migração `202610200003` aplicada (ninguém recebeu acesso); banco descartável com o esquema de produção; teste de navegador 29/29 (colaborador temporário do RH, Fleetbase local). Achado: o Fleetbase cria o motorista no ponto 0,0, que a plataforma agora trata como "sem posição" |
| L-03 | App do motorista (Navigator) em produção, com comprovante (foto e assinatura); veículos e manutenção | B-06 e a regra de privacidade |
