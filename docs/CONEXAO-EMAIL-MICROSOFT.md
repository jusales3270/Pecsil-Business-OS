# Ligar a leitura de e-mail do CRM (Microsoft 365)

> Para quem administra o Microsoft 365 da PecSil. São 5 passos, feitos uma vez.
> Ao final, o Business OS passa a ler a caixa comercial e a registrar os pedidos
> e cobranças que chegam por e-mail.
>
> O Business OS **nunca** pede a senha de ninguém. Ele usa uma identidade de
> aplicativo, com permissão limitada a caixas específicas.

## O que vai ser liberado (e o que não vai)

| Caixa | O aplicativo pode | O aplicativo **não** pode |
|---|---|---|
| `comercial@pecsil.com.br` | ler as mensagens (com o corpo), marcar como lida e **enviar** em nome dela | nada além desta caixa |
| Caixa do diretor de operações | ler **remetente, assunto e data** | ler o corpo, ler anexo, enviar |

A caixa do diretor entra com permissão reduzida de propósito: o Business OS
precisa saber que um cliente conhecido escreveu, não precisa ler o que ele
escreveu. Para trazer o conteúdo, o diretor encaminha a mensagem para
`comercial@`.

---

## Passo 1 — Criar a caixa comercial

No centro de administração do Microsoft 365, criar `comercial@pecsil.com.br`
(caixa compartilhada serve e não consome licença). É o endereço que passa a ser
divulgado aos clientes.

## Passo 2 — Registrar o aplicativo no Entra ID

1. Entra ID → **Registros de aplicativo** → **Novo registro**.
2. Nome: `PecSil Business OS — E-mail`. Contas: **somente neste diretório**.
   Sem URI de redirecionamento (não há login de usuário).
3. Guardar da tela **Visão geral**: **ID do aplicativo (cliente)** e **ID do diretório (locatário)**.
4. **Certificados e segredos** → **Novo segredo do cliente** → validade de 24 meses.
   Copiar o **Valor** na hora: ele não aparece de novo.
5. **Permissões de API: não adicionar nada.** Nenhum `Mail.Read` aqui.

> Por que nada aqui: permissão consentida no Entra vale para **todas** as caixas
> da empresa. A própria Microsoft documenta que ela se **soma** ao escopo do
> Exchange — ou seja, um `Mail.Read` no Entra anularia a limitação por caixa do
> passo 3. Se alguém já tiver concedido, é preciso remover.

## Passo 3 — Limitar por caixa, no Exchange Online

Esta é a parte que garante o escopo. No PowerShell, com uma conta de
**Administração da Organização** do Exchange:

```powershell
Connect-ExchangeOnline

# 3.1 — apontar para o aplicativo criado no passo 2.
# ATENÇÃO: os dois ids saem da página "Aplicativos empresariais" (não de
# "Registros de aplicativo", que mostra outro Object Id).
New-ServicePrincipal -AppId <ID do aplicativo> -ObjectId <Object Id do aplicativo empresarial> `
  -DisplayName "PecSil Business OS - E-mail"

# 3.2 — grupo com a caixa comercial, e escopo em cima dele.
New-DistributionGroup -Name "BOS-Caixa-Comercial" -Type Security `
  -Members comercial@pecsil.com.br
$g1 = (Get-Group "BOS-Caixa-Comercial").DistinguishedName
New-ManagementScope -Name "BOS-Comercial" -RecipientRestrictionFilter "MemberOfGroup -eq '$g1'"

# 3.3 — grupo com a caixa do diretor, e escopo em cima dele.
New-DistributionGroup -Name "BOS-Caixa-Diretor" -Type Security `
  -Members <e-mail do diretor de operações>
$g2 = (Get-Group "BOS-Caixa-Diretor").DistinguishedName
New-ManagementScope -Name "BOS-Diretor" -RecipientRestrictionFilter "MemberOfGroup -eq '$g2'"

# 3.4 — os papéis. Leitura completa e envio SÓ na caixa comercial.
New-ManagementRoleAssignment -App <ID do aplicativo> -Role "Application Mail.ReadWrite" -CustomResourceScope "BOS-Comercial"
New-ManagementRoleAssignment -App <ID do aplicativo> -Role "Application Mail.Send"      -CustomResourceScope "BOS-Comercial"

# 3.5 — na caixa do diretor, somente o básico (sem corpo, sem anexo, sem envio).
New-ManagementRoleAssignment -App <ID do aplicativo> -Role "Application Mail.ReadBasic" -CustomResourceScope "BOS-Diretor"
```

**Conferir antes de sair** (deve mostrar `InScope: True` só onde é esperado):

```powershell
Test-ServicePrincipalAuthorization -Identity "PecSil Business OS - E-mail" -Resource comercial@pecsil.com.br | Format-Table
Test-ServicePrincipalAuthorization -Identity "PecSil Business OS - E-mail" -Resource <outra caixa qualquer> | Format-Table
```

A segunda chamada precisa dar **False** em tudo. Se der True, ainda existe
permissão concedida no Entra (passo 2.5) e o escopo não está valendo.

> Mudança de permissão leva de 30 minutos a 2 horas para valer (cache do
> Exchange). O `Test-ServicePrincipalAuthorization` ignora esse cache e mostra
> a configuração real.

## Passo 4 — Colocar as credenciais no servidor

No Coolify, na aplicação do Business OS, em **Environment Variables** (marcar
como segredo):

```
MS_GRAPH_TENANT_ID=<ID do diretório (locatário)>
MS_GRAPH_CLIENT_ID=<ID do aplicativo (cliente)>
MS_GRAPH_CLIENT_SECRET=<o Valor copiado no passo 2.4>
MAIL_SYNC_SECRET=<gerar com: openssl rand -base64 32>
```

Nenhuma dessas variáveis leva o prefixo `NEXT_PUBLIC_` — com ele, o segredo iria
para o navegador. Depois de salvar, fazer **Redeploy**.

## Passo 5 — Agendar a leitura

Ainda no Coolify, na aplicação do Business OS, **Scheduled Tasks** → nova tarefa:

- **Nome:** `Ler caixas de e-mail`
- **Frequência:** `*/5 * * * *` (a cada 5 minutos)
- **Comando:**
  ```sh
  curl -fsS -X POST -H "x-sync-secret: $MAIL_SYNC_SECRET" http://localhost:3000/api/comercial/sync
  ```

A chamada é feita **por dentro do contêiner**, em `localhost`. Isso é
deliberado: a porta 443 da PecSil oscila, e a entrada de e-mail não pode
depender dela.

---

## Conferir no sistema

No Business OS: **Comercial › CRM › Conexão**.

1. O aviso "Falta para o CRM começar a receber e-mail" deve desaparecer.
2. Cadastrar as duas caixas em **+ Nova caixa**:
   - `comercial@pecsil.com.br` → *Caixa da empresa — lê tudo, com o corpo*;
   - caixa do diretor → *Caixa de pessoa — só remetentes conhecidos, sem o corpo*.
3. Em até 5 minutos, cada caixa deve sair de "nunca sincronizou" para uma data.
4. Se aparecer **Com erro**, a mensagem diz o que falta. Os casos comuns:

| Mensagem | O que fazer |
|---|---|
| "Microsoft recusou o token (401)" | segredo errado ou vencido — refazer o passo 2.4 e o 4 |
| "Microsoft negou o acesso a esta caixa (403)" | falta o papel do passo 3 para **aquela** caixa, ou o cache ainda não virou |
| "Caixa não encontrada (404)" | o endereço cadastrado no passo 2 da conferência está diferente do real |
| "Microsoft pediu para esperar (429)" | normal em carga; a próxima rodada tenta de novo |

## Antes de a caixa do diretor entrar

A caixa dele só registra mensagem de **remetente já cadastrado**. Então, antes:
cadastrar os clientes e os e-mails deles em **Fundação › Cadastros › Clientes**.
Sem isso, aquela caixa não registra nada — o que é o comportamento certo, não
uma falha.
