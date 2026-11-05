# Implantação das correções de segurança

Estado em **04/11/2026**: correções da aplicação, banco da fábrica e perímetro preparadas e
verificadas localmente; **ainda não implantadas na fábrica**. O operador interrompeu expressamente
o trabalho no backup externo e pediu a retomada destas correções. Não condicionar esta implantação
à configuração do destino externo nem retomar esse trabalho sem nova solicitação.
O shell/root do host foi confirmado manualmente em 04/11 pelo terminal do servidor no Coolify
(`systemd`, virtualização `none`, inventário Docker). Após retomar o hardening, o operador confirmou
acesso físico ou console independente do Coolify. Preservar esse acesso durante o fechamento das portas.
O token salvo para a API
HTTPS do Coolify respondeu 401 na verificação anterior; isso não prova revogação, pois token
incorreto e ausente geram a mesma resposta. O histórico em [INFRA.md](INFRA.md) registra a perda
do acesso SSH por senha. Não usar HTTP na porta 8001 para contornar o bloqueio da API. Nenhuma
regra de firewall foi aplicada por aqui.

O inventário enviado pelo operador nesta retomada mostrou **histórico de migrações ausente**
(`supabase_migrations.schema_migrations` não existe), `public.sara_vigia_transmissao` presente e
`public.sara_audio_uso` ausente. A entrada física é `eno1`, com endereço `192.168.0.89/24` e
gateway `192.168.0.254`; Tailscale está ativo. A tabela de rotas enviada não tem rota IPv6
pública, o que não dispensa conferir publicações Docker e o perímetro. Não preencher um histórico
fictício das 179 migrações anteriores para executar estas duas correções.

Na estação de trabalho, a conexão administrativa HTTPS do Supabase recusou o certificado
autossinado antes de enviar credenciais. A impressão SHA256 do certificado deve ser conferida
pelo console do host antes de confiar nessa conexão. A alternativa é executar o instalador
localmente pelo `psql` do contêiner, sem transmitir a chave administrativa pela rede.

Atualização de acesso, **05/11 UTC (noite de 04/11 em Brasília)**: o operador enviou o fingerprint
do certificado local, identificado como `TRAEFIK DEFAULT CERT`. A comparação externa não foi
possível: as conexões HTTPS ao IP dos domínios conhecidos foram recusadas e a LAN não respondeu
desta estação. O nome antigo `supabase.pecsil.com.br` não tem registro DNS público; a resolução
local vinha da configuração antiga, coerente com a seção 2 de [INFRA.md](INFRA.md). Não foi
enviada credencial administrativa. A porta SSH pública respondeu, mas ainda falta autenticação
válida; uma chave de administração temporária e com expiração foi preparada localmente para o
operador instalar pelo console. A preparação não concede acesso por si só nem altera o host.

<details>
<summary>Registro da tentativa de backup externo, interrompida pelo operador</summary>

A tentativa manual de backup de 04/11 às 12:12 UTC gerou o banco criptografado (57.513.601 bytes)
e arquivos criptografados (1.377 objetos, cinco buckets, 61.648.330 bytes), mas terminou com
`fetch failed`. O diagnóstico apontou `ENOTFOUND` no domínio configurado em `VIGIA_URL`, enquanto
o domínio de controle resolveu normalmente; uma consulta DNS pública também retornou NXDOMAIN.
Essas contagens **não comprovam um backup concluído**: o serviço só confirma depois do envio e
do aviso ao vigia, e remove os temporários ao encerrar. Depois do inventário, o operador escolheu
adaptar o projeto existente `fongsabmkjnurojblhge`, preservando suas sete tabelas de negócio.
O instalador anterior informou `42P01` para `pecsil_backup_tabelas_antes`; não se comprovou a causa
da perda da tabela temporária. As consultas posteriores do operador confirmaram que os objetos
principais persistiram: Vigia, função de backup, bucket privado, quatro políticas restritivas,
RLS nas tabelas Vigia e restrição de geração de tokens. Isso não prova a preservação integral
dos dados anteriores. A versão atual executa a instalação num único `DO` atômico com variáveis
locais, sem tabelas temporárias; não deve ser reaplicada nesse destino já instalado.
Depois, o operador vinculou uma conta técnica confirmada e atualizou as credenciais no Coolify.
A execução das 18:27–18:28 UTC gerou banco e arquivos criptografados e chegou ao aviso final,
que retornou `sinal recusado`. Pelo fluxo do serviço, esse aviso ocorre após os envios; o manifesto
na nuvem e a restauração não foram conferidos. **O operador cancelou a continuação desse trabalho.**
Este registro histórico não afirma que o monitoramento externo esteja operacional.

</details>

As correções reduzem os riscos identificados. Não constituem garantia de ausência de outras
vulnerabilidades nem evidência de que nunca houve acesso indevido.

## 1. Preparar acesso e validação

- Definir uma janela com o responsável pelo servidor. Manter console físico/hipervisor ou outro
  canal de recuperação realmente testado; uma segunda janela SSH no mesmo caminho não é console
  independente. Guardar as credenciais no cofre, sem colá-las em chamados, logs ou comandos.
- Usar o shell/root do host já confirmado. A API HTTPS do Coolify é um caminho opcional e depende
  de credencial válida; sua indisponibilidade não impede o procedimento manual pelo host.
  Confirmar a versão implantada, o inventário dos
  contêineres, interface(s) de entrada, encaminhamentos do roteador, IPv4/IPv6, rede LAN/VPN e
  redes Docker. Não deduzir o nome da interface ou os CIDRs a partir dos exemplos deste documento.
- Registrar os commits e imagens em execução, a lista real de migrações e os objetos necessários
  antes de aplicar as alterações. Executar o SQL de forma transacional, interrompendo no primeiro
  erro. O procedimento de backup externo foi retirado desta sequência a pedido do operador.
- Executar os testes do pacote em ambiente isolado e registrar o commit/imagens anteriores para
  rollback. Não usar dados pessoais reais para os testes de autorização.
- Suspender automações que recarreguem firewall durante a janela. Não trocar o backend do Docker,
  reiniciar o proxy ou recriar contêineres como parte do fechamento das portas.

A [pré-checagem do servidor](../infra/security-preflight.sh) reúne o inventário de banco e rede:

```bash
bash infra/security-preflight.sh
```

Executar no host Linux com `root`, no terminal do servidor do Coolify, usando o arquivo desta
revisão. O script recusa o terminal de uma aplicação, consulta o banco em transação somente de
leitura e não aplica migrações nem regras de firewall. A saída determina o plano real de implantação;
histórico ausente, instalação parcial ou diferenças de esquema precisam ser resolvidos antes do SQL.

## 2. Fechar o perímetro sem romper LAN e Docker

O novo [protect-public-ports.py](../infra/protect-public-ports.py) acrescenta regras na tabela
`filter` de **IPv4 e IPv6**, em `INPUT` e `DOCKER-USER`. Bloqueia da interface escolhida as portas TCP
**5432, 6543, 6001, 6002, 8000, 8001, 8080, 8443, 3000, 3100 e 3200**, preservando as fontes
LAN/VPN explicitamente informadas. Na cadeia Docker compara a **porta original anterior ao DNAT**, de modo que
`8001 → outra porta do contêiner` também seja protegido. HTTP 80/HTTPS 443 e os fluxos das bridges
Docker não recebem bloqueios novos. A lista LAN usa `RETURN`: as regras existentes do host ainda
se aplicam; o programa não abre permissões gerais.

O programa não altera binds do compose nem muda tudo para `127.0.0.1`: o Business OS e o backup
usam serviços no endereço LAN do servidor. Também não limpa regras globais, não redefine UFW,
não modifica policies e não reinicia serviços. O antigo [harden-supabase.sh](../infra/harden-supabase.sh)
foi desativado e recusa `--apply`.

### Condições exigidas

- Host Linux com root, Python 3, systemd operacional, `iptables`/`ip6tables` usando **nf_tables**
  (compatibilidade iptables-nft), ferramentas de snapshot e `nft` disponíveis.
- Docker usando iptables com `DOCKER-USER` e salto ativo a partir de `FORWARD` em ambas as famílias.
  O programa recusa Docker com backend nftables nativo, regras legacy paralelas ou firewalld ativo.
- Interface de entrada física e CIDRs válidos e restritos informados pelo operador. A versão atual
  cobre **uma interface de entrada** e recusa outra alteração enquanto a primeira estiver ativa.
  Hosts com múltiplas entradas públicas precisam de plano específico revisado antes da aplicação.
- Se não houver `DOCKER-USER` IPv6, a aplicação é recusada, mesmo que o operador acredite não usar
  IPv6. Conferir publicações, proxy IPv6→IPv4 e o backend; preparar uma solução dual stack coerente
  com console disponível. Não criar uma cadeia vazia apenas para passar na checagem, nem desligar
  IPv6/Docker às cegas. Não há opção para ignorar essa cobertura.
- Firewall do roteador/provedor continua necessário quando aplicável. Reduzir os encaminhamentos
  públicos ao que foi efetivamente autorizado; conferir IPv6, que pode chegar sem NAT.
- Antes de fechar 8001, 6001 e 6002, verificar painel, atualizações em tempo real e uma nova sessão
  do terminal do Coolify pelo domínio HTTPS em 443, preservando o console independente. O
  inventário de 04/11 mostrou 6001/6002 no Coolify e 8080 no `coolify-proxy`, publicados em IPv4/IPv6;
  isso não prova acesso pela internet. 6001 atende o Reverb e 6002 o terminal web. A porta 8080
  do proxy pode servir a API/painel do Traefik: conferir a configuração real e manter
  `api.insecure` desativado. Ver [firewall do Coolify](https://coolify.io/docs/core/infrastructure/servers/firewall)
  e [painel do Traefik](https://coolify.io/docs/core/networking/proxy/traefik/dashboard).

### Gerar e revisar o plano

Exemplo **ilustrativo**: substituir interface e redes pelas apuradas no host. O plano funciona na
estação de desenvolvimento e não executa ferramentas administrativas nem lê regras do host.

```bash
python3 infra/protect-public-ports.py \
  --interface ens18 \
  --allow-cidr 192.168.0.0/24 \
  --allow-cidr fd12:3456:789a::/64
```

Revisar cada fonte permitida, sobretudo se internet e LAN entram pela mesma interface. Verificar
que o proxy do Coolify, os clientes do banco, o transmissor, o conector e o backup mantêm seus
caminhos internos. Não adicionar `0.0.0.0/0` ou `::/0` — o programa os recusa.

### Aplicar temporariamente e conferir

**Executar somente no host de produção após recuperar console e acesso autorizado.** Manter
aberto o console durante toda a janela. `--recovery-verified` é uma declaração do operador de
que essa recuperação foi testada; o programa não consegue atestar um console físico.

```bash
sudo python3 infra/protect-public-ports.py --apply \
  --interface ens18 \
  --allow-cidr 192.168.0.0/24 \
  --allow-cidr fd12:3456:789a::/64 \
  --recovery-verified \
  --rollback-seconds 180
```

Antes da primeira regra, o programa copia um runner protegido em `/var/lib/pecsil-firewall`, grava
estado e snapshots de diagnóstico (root, modos 0700/0600), agenda um timer systemd e exige que
este esteja ativo. Se isso falhar, nenhuma regra é instalada. Se o operador não confirmar, o timer
remove **somente as regras/cadeias próprias** após o prazo. Uma aplicação que falhe também tenta
reverter suas regras. O rollback não depende de Docker ou da interface ainda existirem. Mudança
externa do backend pode impedir recuperação e requer o console — por isso ele é indispensável.

Anotar o identificador de 12 caracteres exibido. Dentro dos 180 segundos:

1. De **fora da LAN**, verificar IPv4 e, se houver rota/AAAA, IPv6 separadamente: as onze portas
   sensíveis não devem aceitar conexão; HTTPS 443 deve continuar atendendo com certificado válido.
   Conferir também 80 conforme o redirecionamento/desafio TLS da instalação. O script
   `HOST=dominio-da-plataforma npm run check:perimeter` confere todas as respostas DNS IPv4/IPv6.
   Se houver endereço público não publicado no DNS, informar também
   `TARGET_IPS='IPv4_PUBLICO,IPv6_PUBLICO'`; o certificado continua sendo validado pelo `HOST`.
   Substituir os exemplos pelos valores reais e confirmar que nenhuma família ficou sem teste.
   O auditor retorna **0** para os destinos cobertos sem falha observada, **1** para exposição,
   DNS/rede/TLS inválidos ou nenhum destino, e **2** para cobertura incompleta de IPv4/IPv6.
   Saída 2 não aprova o fechamento. Somente após obter evidência do provedor de que uma família
   pública realmente não existe, declarar `NO_PUBLIC_IPV4=1` ou `NO_PUBLIC_IPV6=1`; a declaração
   é recusada se houver um destino daquela família. Guardar a evidência junto à verificação,
   sem usar a variável para ignorar endereço inacessível desta estação.
2. Abrir a plataforma e testar login, acesso ao banco, leitura de documento e uma operação
   reversível de teste. Conferir painel administrativo por HTTPS/VPN e uma **nova sessão** de
   administração, preservando o console atual. Conferir também as atualizações em tempo real e
   uma nova sessão do terminal do Coolify pelo domínio em 443, com as portas diretas bloqueadas.
3. Pela LAN e de dentro dos contêineres, testar os caminhos usados pela aplicação, transmissor,
   conector e backup. Não imprimir tokens ou cabeçalhos de autorização nos resultados.
4. Se qualquer teste falhar, executar o rollback pelo console ou deixar o timer agir. Não confirmar
   parcialmente só porque a página inicial abriu.

Confirmar apenas depois das verificações:

```bash
sudo python3 infra/protect-public-ports.py --confirm \
  --state-id IDENTIFICADOR --checks-passed --persist
```

`IDENTIFICADOR` é o valor real retornado, não o texto literal acima. A confirmação cancela a
reversão. Com `--persist`, instala e habilita `pecsil-public-ports.service`, que reaplica a mesma
configuração **já confirmada** após o Docker/boot sem restaurar fotografias globais de regras
Docker. Essa reaplicação não é uma nova mudança de configuração e não reabre a janela do timer.
A unidade também é iniciada de forma assíncrona após confirmar; conferir seu estado/journal.
Sem `--persist`, as regras valem só até limpeza/reboot do firewall. O programa não sobrescreve
unidade existente e não administra serviços UFW/iptables-persistent de terceiros.

Depois de reboot, restart do Docker ou reload de firewall, repetir as provas internas/externas.
Um reload de outro gerenciador pode apagar regras sem disparar a unidade: monitorar e revisar
isso no servidor. Se for necessária nova configuração, reverter a anterior numa janela com console,
gerar novo plano e reaplicar com timer; não editar o JSON de estado para contornar validações.

### Rollback manual

```bash
sudo python3 /var/lib/pecsil-firewall/runner.py --rollback --state-id IDENTIFICADOR
```

Isso desabilita/remove a unidade persistente pertencente à alteração, quando existe, cancela o
timer e remove apenas suas regras. Não usar `iptables-restore` dos snapshots globais no servidor
em atividade: eles servem para diagnóstico e podem conter regras Docker já obsoletas. Se a
recuperação automática ou manual falhar, manter o console e revisar as cadeias `PBOI_`, `PBOD_` e
`PBOS_` do identificador; não limpar o firewall inteiro.

### SSH e painel administrativo

Por padrão a porta **22 fica como estava** para preservar o acesso disponível. Restringi-la exige,
no plano e na aplicação, **ambos** `--admin-cidr ENDERECO/32` (ou IPv6 `/128`) e
`--console-verified`, além de `--recovery-verified` na aplicação. Informar a rede administrativa
real e testar nova sessão de dentro dela antes de confirmar. A família sem CIDR administrativo
fica bloqueada para SSH na interface escolhida; isso é proposital e precisa constar da revisão.
Não habilitar essa opção se o acesso depende de IP dinâmico sem VPN ou de console não testado.

Fechar 8001 elimina o acesso direto público por HTTP; 6001/6002 deixam de receber acesso direto
público aos serviços em tempo real/terminal, e 8080 ao serviço publicado pelo proxy. Os destinos
internos das redes Docker continuam necessários. O domínio do Coolify servido em 443 precisa
ser restringido à VPN/rede administrativa no proxy, conforme a política escolhida e depois de
validar o acesso de recuperação; o filtro de portas não restringe um hostname HTTPS específico.
Revisar chaves SSH, autenticação e quem mantém acesso administrativo após a recuperação.

## 3. Aplicar banco, depois aplicações e testes

Não executar migrações antigas novamente, `db reset` ou `db push` na produção sem histórico
reconciliado. A instalação atual não registra versões no esquema da CLI; o procedimento histórico
aplicava SQL manualmente. Usar o instalador específico abaixo: ele verifica as dependências reais,
aplica somente as duas correções em uma transação e registra somente os seus próprios recibos.

A base integrada é o `main` em `559cf2b`. Ela inclui as migrações
`202611030001_rh_beneficio_adesao.sql`, `202611030002_sara_vigia_config.sql` e
`202611030003_qualidade_ocorrido_e_descarte.sql`. A presença da tabela da transmissão SARA foi
confirmada pelo operador, mas não comprova sozinha a instalação integral dessa base. O instalador
exige as tabelas, colunas, tipos, funções, RLS e buckets necessários antes de alterar o banco;
uma recusa deve ser investigada, sem repetir as 179 migrações ou contornar a verificação.

As fontes revisadas, seladas por SHA256 no instalador, são aplicadas nesta ordem:

1. [20261103174707_sara_security.sql](../supabase/migrations/20261103174707_sara_security.sql)
2. [20261103174840_data_security_boundaries.sql](../supabase/migrations/20261103174840_data_security_boundaries.sql)

O [gerador do instalador](../scripts/ti-security-instalar.py) funciona sem rede e produz um único
bloco `DO`. Não usa tabelas temporárias nem altera o histórico da CLI. Cria recibos privados em
`pecsil_ops.security_patches`, com versão, arquivo, SHA256, commit e data. Instalações parciais,
objetos conflitantes ou recibos divergentes interrompem tudo. Uma repetição com os mesmos dois
recibos confere as pós-condições e não reaplica o SQL. Os corpos das 14 funções alteradas são
conferidos pelo SHA256 extraído das fontes revisadas. O esquema de recibos não concede acesso a
`PUBLIC`, `anon`, `authenticated` nem `service_role`. Essas verificações não substituem a revisão
das demais políticas e permissões existentes no banco de produção.

No **terminal root do host**, usando um checkout autenticado desta revisão e com o deploy
compatível pronto, gerar e aplicar:

```bash
(
  set -euo pipefail
  umask 077
  sql_instalacao=$(mktemp /tmp/pecsil-security.XXXXXX)
  trap 'rm -f "$sql_instalacao"' EXIT
  python3 scripts/ti-security-instalar.py \
    --source-commit "$(git rev-parse HEAD)" --output "$sql_instalacao"
  docker exec -i -u postgres \
    -e PGOPTIONS='-c statement_timeout=120000' supabase-db \
    psql -X -w -U postgres -d postgres -v ON_ERROR_STOP=1 \
    --single-transaction -f - < "$sql_instalacao"
)
```

O repositório é privado: obter o checkout pelo acesso autenticado já autorizado. Não substituir
por download público de `raw.githubusercontent.com`. Esse comando não serve no terminal `/app`
nem no SQL Editor. Pelo SQL Editor, usar somente o conteúdo SQL gerado, com conexão administrativa
verificada. Um aviso de instalação dentro de uma transação externa só vale após o commit.
Depois, conferir em uma nova consulta administrativa que existem exatamente os dois recibos:

```sql
SELECT version, filename, sql_sha256, source_commit, applied_at
FROM pecsil_ops.security_patches
WHERE version IN ('20261103174707', '20261103174840')
ORDER BY version;
```

As novas regras corrigem confidencialidade do RH/Storage, fluxos de aprovação, autorização da
SARA e isolamento por empresa. Mudanças de autorização no banco podem fazer a versão antiga
falhar de forma restritiva: coordenar a aplicação com o deploy imediato dos componentes compatíveis.
Depois de aplicar o banco, implantar o Business OS e os serviços cujas dependências mudaram,
conferindo o commit e as versões efetivas de cada imagem. Deploy do app não aplica migrações sozinho.

Antes de encerrar a janela, executar os testes funcionais com perfis de menor privilégio:

- RH: acesso permitido ao documento correto; acesso direto ao Storage e alteração/exclusão de
  documento confidencial proibidos para quem só vê documentos comuns.
- Financeiro/RH: criação de solicitação pendente, aprovação por pessoa autorizada e recusa de
  alteração direta ou criação já aprovada por operador/colaborador comum.
  Previsões precisam ser confirmadas como título antes da baixa; a confirmação invalida aprovações
  anteriores quando houver alçada aplicável. A tela oferece **Confirmar previsão**. Previsões antigas
  com baixas precisam de conferência e estorno antes dessa conversão; não convertê-las em lote.
- SARA: registrar consumo pelo servidor e rejeitar gravação/chamada direta pelo usuário; conferir
  se o uso legítimo continua somando no orçamento e se as permissões da conversa permanecem válidas.
- WhatsApp: associação válida dentro da mesma empresa e recusa de usuário de outra empresa.
- Portal de fornecedores: proposta válida com/sem PDF, resposta única e convite expirado; rejeição
  de corpo excessivo, arquivo falso e solicitação que tenta usar o mesmo convite simultaneamente.
- Leitura: DOCX/XLSX normais, PDF com texto, PDF escaneado com OCR local e recusa segura de ZIP
  excessivamente expandido ou XML malformado. Não enviar arquivo malicioso ao servidor de produção para testar limites.

### Mudanças de comportamento e limites da SARA

- A voz ao vivo retorna **503 temporariamente**: o token direto do provedor não oferece um teto de
  consumo vinculante. Texto e envio de áudio gravado continuam disponíveis. Reativar a voz ao vivo
  exige um mecanismo de consumo equivalente, com testes; não remover a proteção para contornar o erro.
- A transcrição recebe no máximo **4 MiB em 15 segundos**, com leitura em fluxo e cancelamento do
  excesso. Antes de chamar o provedor, debita uma reserva conservadora de 5 mil a 200 mil
  tokens equivalentes por áudio, inclusive se a chamada falhar. O limite é de seis transcrições por
  minuto por perfil, com bloqueio atômico por perfil e módulo no banco.
- O chat verifica o uso antes e grava o consumo depois da chamada. Solicitações concorrentes podem
  ultrapassar o teto mensal: esse teto não é uma garantia financeira absoluta. Consultas de uso que
  falhem bloqueiam novas chamadas, e o navegador não pode escrever no registro de consumo.
- Vigia/crescimento agendados recusam uma instalação com várias empresas quando não há contexto
  explícito. A execução manual usa a empresa da sessão; a instalação atual de uma empresa mantém o fluxo.
- Downloads e envios usam a mesma validação de pasta e nome. Caminhos legados fora do padrão seguro
  são recusados; conferir e regenerar o arquivo autorizado em vez de relaxar a validação.

### Proxy e limites do portal de fornecedores

O portal verifica existência, situação e validade do hash do convite **antes de ler o corpo**.
A RPC transacional do banco continua garantindo resposta única. O corpo tem teto real de
15.256.000 bytes, arquivo PDF de até 15.000.000, até oito partes e 30 segundos de recebimento.
A leitura ZIP tem teto de 25 MB compactados, 32 MB por entrada, 64 MB acumulados, mil entradas,
razão máxima mil e prazo de oito segundos; limites ultrapassados viram falha de leitura segura.
O processamento XML tem orçamento próprio de dois segundos, 500 mil marcas, profundidade 128 e
tags de até 4 KiB. DOCX/XLSX usam varredura linear, com até 100 mil textos compartilhados e
32.767 caracteres decodificados por célula. DTD é recusado; OFX mantém compatibilidade SGML.
O texto final é limitado a 200 mil caracteres; dimensões de planilha não alocam matrizes. Esses
limites podem recusar arquivos muito grandes ou complexos mesmo quando o ZIP está abaixo do teto.

Definir **`COTAR_TRUST_PROXY=1` apenas se** o app não puder ser acessado diretamente e o proxy
confiável acrescentar/substituir `X-Forwarded-For` com o IP de quem conectou. É usado o último
endereço válido dessa cadeia; cabeçalho `X-Real-IP` arbitrário não é utilizado. Sem essa variável,
os cabeçalhos são ignorados e um balde global conservador representa os clientes sem IP confiável.
Não ligar a variável só para eliminar mensagens de limite, nem aceitar XFF enviado pelo navegador.

Os limites são locais ao processo: 30 tentativas/IP e oito/convite em dez minutos, dois envios
simultâneos/IP, um/convite e oito globais, com quantidade de chaves limitada. A instalação descrita
usa uma instância. **Antes de múltiplas réplicas**, implantar limite compartilhado no proxy/Redis e
verificar os limites reais do proxy, timeouts e tamanho máximo. Reinício do processo limpa as janelas;
o filtro local não substitui proteção de borda contra tráfego distribuído.

## 4. Rotacionar segredos e fechar a verificação

Depois de eliminar os caminhos públicos em HTTP, inventariar credenciais que tenham circulado
por eles ou por histórico indevido: banco/pooler, JWT/service role, Coolify, MinIO e integrações
conforme o ambiente real. Planejar atualização conjunta de emissores/consumidores, testar por canal
seguro e revogar os valores antigos. Rotação de JWT afeta sessões e consumidores: não trocar uma
chave isoladamente sem conhecer todos os usos. Não presumir comprometimento efetivo como fato,
mas tratar exposição de credencial como motivo para a rotação coordenada.

Não usar `--secret` com valor no terminal nem imprimir arquivos `.env`, tokens, URLs com senha,
chaves ou payloads de certificado. O utilitário legado `rotate-jwt-keys.mjs` não substitui o plano
de rotação e seus resultados não devem aparecer no histórico do chat. Fazer a troca no cofre e nas
configurações protegidas dos serviços, com pessoa responsável e recuperação preparada.

Verificação local registrada nesta preparação:

| Verificação | Resultado e limite |
|---|---|
| Build de produção | Next.js 16.4.4 passou |
| Contratos de módulos e pacote Supabase | 13 módulos e 181 migrações válidos |
| Rodada completa após integrar `559cf2b` | 932 passaram de 933, sem testes ignorados; uma falha legada |
| Falha legada | `rendered-html` espera `dist/server/index.js`, ausente no app Next; reproduzida antes das correções. As duas falhas fiscais da rodada inicial foram corrigidas pelo upstream integrado |
| Banco descartável | 181 migrações aplicadas do zero; 17 testes de RH/financeiro/documentos e um teste composto de SARA/WhatsApp passaram, incluídos na rodada completa |
| Análise SQL | Nenhum alerta nas 14 funções alteradas; a análise global aponta cinco referências a tabelas temporárias em funções inalteradas, além de avisos antigos |
| Lint dos arquivos alterados | 54 arquivos, sem erros ou avisos |
| Lint global | A rodada inicial encontrou 55 erros fora das alterações; não se declara aprovação global |
| Leitura, extratos, portal e limites | Testes de arquivos normais, XML malformado, expansão, tempo, streaming e cancelamento passaram; incluídos na rodada completa |
| Firewall | 11 cenários Python com executor falso e dois testes Node passaram; sem aplicar regras reais |
| Auditor de perímetro | 16 cenários com DNS/TCP/TLS simulados, incluindo exposição isolada de 6001/6002/8080 em ambas as famílias; sem tráfego a produção |
| Pré-checagem do host | Sintaxe Bash e recusa do ambiente Mac conferidas; SQL exato executado com sucesso no Postgres 17.6 descartável em transação somente leitura, sem mutações de produção |
| Instalador manual sem histórico | 14 testes passaram, sem ignorados, no banco descartável: fontes seladas, dependências, falha intermediária com rollback, conflitos, preservação de dados, dois recibos, isolamento inclusive diante de grants padrão para service_role, repetição sem reaplicar e detecção de alteração em função/ACL |
| Backup no projeto compartilhado | 13 testes locais com RLS real, repetidos com o artefato `DO` exato sem reescrever comandos: políticas antigas permissivas, conta dedicada, preservação da aplicação, conflitos e reversão; registros fictícios revertidos e cron sem commit, sem chamadas externas |
| Transmissor | 15/15 testes passaram na imagem Linux Node 22 |
| Conector | 9/9 testes passaram |
| Auditoria de dependências | App: 16 moderados em ferramentas de desenvolvimento; transmissor: sete moderados e cinco baixos indiretos; conector: zero; nenhum crítico/alto nos três |

Esses números descrevem a rodada registrada, não uma certificação da produção. Conferir a
validação final da revisão e repetir as provas do ambiente implantado; a suíte e o lint globais
não foram declarados integralmente aprovados.

As atualizações incluem Next.js 16.4.4, Transformers 4.3.2, node-forge 1.4.2 e pacotes relacionados.
O conector passou a mssql 12.7.13 e Azure Identity 4.14.1. O pacote contém correções compatíveis de
dependências indiretas. Permanecem alertas moderados/baixos em cadeias de ferramentas/esquema sem
correção compatível disponível; não forçar downgrade ou declarar auditoria zerada. Anexar a auditoria
de cada serviço e os testes da imagem final à revisão do pacote.

Registrar separadamente: código corrigido, migrações aplicadas, serviços efetivamente implantados,
perímetro confirmado em IPv4/IPv6, segredos rotacionados e pendências de acesso. Só marcar cada item
como concluído com sua prova. Se houver falha funcional, reimplantar a imagem anterior compatível;
reverter mudanças de autorização no banco exige análise específica para não reabrir o risco. Para
falha no perímetro usar a reversão direcionada acima. Nunca combinar restauração de dados com
rollback de código por automatismo.

Referências técnicas: [Docker e iptables](https://docs.docker.com/engine/network/firewall-iptables/),
[Docker e firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/) e
[conntrack no iptables](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html).
