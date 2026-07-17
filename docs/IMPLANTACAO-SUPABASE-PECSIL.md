# Implantação do Supabase — Pecsil Business OS

## Estado atual

O pacote de banco está pronto e validável sem acesso ao servidor. Nenhuma migration foi executada e nenhuma credencial foi armazenada no repositório.

Arquivos oficiais:

- `supabase/migrations/202607140001_foundation.sql`: Fundação empresarial, autenticação, papéis, escopos e RLS.
- `supabase/migrations/202607150001_module_registry_and_security.sql`: catálogo de módulos, ativação por empresa e autorização modular.
- `supabase/tests/001_foundation_contract.sql`: teste estrutural pós-migration.
- `scripts/bootstrap-supabase.mjs`: provisionamento idempotente da Pecsil, estrutura inicial, módulos e proprietário.
- `scripts/validate-supabase-package.mjs`: validação local sem conexão.

## Pré-requisitos no servidor

1. Confirmar que o Supabase interno está saudável.
2. Definir HTTPS válido para a API externa antes de conectar o Sites.
3. Não expor a porta do PostgreSQL à internet; somente o gateway HTTPS do Supabase deve ser público.
4. Criar backup completo do PostgreSQL antes da primeira migration.
5. Criar manualmente o primeiro proprietário no Supabase Auth. O bootstrap não cria nem registra senhas.

## Variáveis necessárias

```text
NEXT_PUBLIC_SUPABASE_URL=https://supabase.pecsil.com.br
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<chave pública>
SUPABASE_SERVICE_ROLE_KEY=<segredo somente do servidor administrativo>
INITIAL_OWNER_EMAIL=<e-mail do proprietário>
INITIAL_OWNER_NAME=<nome do proprietário>
```

A `SUPABASE_SERVICE_ROLE_KEY` nunca deve ser exposta no navegador, commitada ou configurada como variável pública.

## Ordem de implantação

1. Rodar `npm run supabase:validate` no projeto.
2. Fazer backup do banco.
3. Aplicar as migrations em ordem crescente pelo fluxo administrativo escolhido para o Supabase self-hosted.
4. Executar `supabase/tests/001_foundation_contract.sql` no banco.
5. Criar o proprietário no Supabase Auth.
6. Executar `npm run supabase:bootstrap` em uma estação administrativa autorizada.
7. Configurar apenas URL e chave pública no ambiente do Sites.
8. Validar login, menu por permissão, isolamento por organização e leitura da Fundação.
9. Somente depois ativar os dados reais em produção.

## Comportamento esperado

- O RH nasce habilitado para a Pecsil; módulos planejados ficam cadastrados, mas desabilitados.
- Um módulo só aparece quando está integrado, habilitado para a empresa e permitido ao usuário.
- Ocultar o menu não é a proteção: o PostgreSQL confirma permissão e escopo por RLS.
- O bootstrap é idempotente e pode ser repetido para concluir um provisionamento interrompido.

## Critérios de aceite

- As 16 tabelas existem e estão com RLS ativo.
- `can_access_module(text)` existe e retorna falso sem habilitação ou permissão.
- Usuários comuns não conseguem alterar catálogo, ativações ou auditoria.
- O proprietário vê somente módulos habilitados para a Pecsil.
- A aplicação continua em modo demonstrativo se a conexão não estiver configurada.

## Retorno seguro

Em caso de falha, não remover tabelas automaticamente. Interromper a ativação, restaurar o backup em ambiente controlado e analisar a migration que falhou. O modo demonstrativo do frontend permanece disponível enquanto as variáveis públicas não forem configuradas.
