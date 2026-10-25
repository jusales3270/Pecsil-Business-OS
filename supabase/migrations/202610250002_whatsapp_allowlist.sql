-- WhatsApp: allowlist por número e comportamento próprio de cada número (decisões do proprietário em 25/10/2026).
--
-- 1. Cada número da plataforma (whatsapp_canais) ganha o PROMPT de sistema (como a SARA se comporta naquele número;
--    complementa a SARA, e as regras de segurança continuam por cima) e o MODELO (hoje só Anthropic; o provedor já
--    fica registrado para outros provedores no futuro). Sem modelo: o da SARA.
-- 2. A allowlist do número: a lista interna (whatsapp_contatos.lista = 'interna'), sempre ligada a um usuário da
--    plataforma, passa a ter a SARA de CADA pessoa (de qual SARA ela recebe e envia informação). O nome digitado
--    (coluna nome) fica só como apelido. Fornecedores e clientes ficam para depois.
-- 3. A SARA do número (whatsapp_canais.sara_modulo) passa para cada pessoa da lista e deixa de ser usada; a coluna
--    sai numa migração depois do Deploy (o código no ar ainda a lê).

alter table public.whatsapp_canais
  add column if not exists prompt text check (prompt is null or length(prompt) <= 4000),
  add column if not exists provedor text not null default 'anthropic' check (provedor in ('anthropic')),
  add column if not exists modelo text check (modelo is null or modelo ~ '^[a-z0-9.-]{3,60}$');

comment on column public.whatsapp_canais.prompt is 'Como a SARA se comporta neste número (definido pelo proprietário). Complementa a SARA; as regras de segurança (credencial, escopo da empresa, Permitir) continuam por cima.';
comment on column public.whatsapp_canais.modelo is 'Modelo deste número (nulo: o da SARA de cada pessoa). Provedor em provedor.';
comment on column public.whatsapp_canais.sara_modulo is 'SEM USO desde 25/10/2026: a SARA é de cada pessoa da allowlist (whatsapp_contatos.sara_modulo). Sai numa migração depois do Deploy.';

alter table public.whatsapp_contatos
  add column if not exists sara_modulo text check (sara_modulo is null or sara_modulo ~ '^[a-z]{2,30}$');

comment on column public.whatsapp_contatos.sara_modulo is 'Allowlist: a SARA de que esta pessoa recebe e envia informação por este número (a credencial dela tem de liberar essa SARA).';
comment on column public.whatsapp_contatos.nome is 'Lista externa: o nome do contato. Allowlist (interna): apelido opcional; a pessoa é sempre o usuário (profile_id).';

-- A SARA do número passa para cada pessoa da lista.
update public.whatsapp_contatos c set sara_modulo = k.sara_modulo
from public.whatsapp_canais k
where k.id = c.canal_id and c.lista = 'interna' and c.sara_modulo is null and k.sara_modulo is not null;

-- Na allowlist, cada pessoa tem a sua SARA.
alter table public.whatsapp_contatos drop constraint if exists whatsapp_contatos_sara_interna;
alter table public.whatsapp_contatos add constraint whatsapp_contatos_sara_interna check (lista <> 'interna' or sara_modulo is not null);
