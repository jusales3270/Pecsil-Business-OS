-- Equipe de SARAs (I-12, proprietário 18/10/2026): uma SARA por módulo, com os mesmos guardrails, avisos e
-- regras da do Financeiro. Cada uma é liberada por pessoa em Pessoas e Acessos, na lista do módulo
-- (`<modulo>.sara`), e só responde com as permissões de quem conversa. Ninguém recebe a permissão aqui:
-- quem libera é o proprietário. O registro das conversas (sara_registrar) já exige `<modulo>.sara`.

insert into public.access_features (code, module_code, label, levels, sort) values
  ('compras.sara', 'compras', 'SARA (assistente do módulo)', '{ver}', 95),
  ('almoxarifado.sara', 'almoxarifado', 'SARA (assistente do módulo)', '{ver}', 95),
  ('fundicao.sara', 'fundicao', 'SARA (assistente do módulo)', '{ver}', 95),
  ('comercial.sara', 'comercial', 'SARA (assistente do módulo)', '{ver}', 95),
  ('fiscal.sara', 'fiscal', 'SARA (assistente do módulo)', '{ver}', 95),
  ('rh.sara', 'rh', 'SARA (assistente do módulo)', '{ver}', 95),
  ('portaria.sara', 'portaria', 'SARA (assistente do módulo)', '{ver}', 95),
  ('producao.sara', 'producao', 'SARA (assistente do módulo)', '{ver}', 95)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;
