-- SARA central (E7, J1 — docs/PLANO-MINDMASTER.md), 23/10/2026: o cérebro da empresa inteira, na War Room.
-- Ela pergunta às SARAs dos módulos (com as permissões de quem pergunta) e o verificador confere os números.
--   * Permissão própria (`warroom.sara`), por pessoa, em Pessoas e Acessos. Ninguém recebe aqui: por enquanto
--     só o proprietário usa (W1). Sozinha, não abre a War Room (a pessoa precisa também de um submenu dela).
--   * Modelo e teto do mês (decisão do proprietário, 23/10): Sonnet 5.5 e cerca de R$ 300 por mês. O teto é em
--     tokens (como as outras SARAs): 60 milhões, pela conta da E4 com o cache (~R$ 5 por milhão no Sonnet).
--     O aviso aos 80% já vale (sara_aviso_teto).

insert into public.access_features (code, module_code, label, levels, sort) values
  ('warroom.sara', 'warroom', 'SARA central (conselho)', '{ver}', 20)
on conflict (code) do update set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

insert into public.sara_modulos (organization_id, modulo, modelo, teto_tokens_mes, atualizado_por)
select id, 'warroom', 'claude-sonnet-5-5', 60000000, 'Plano da SARA central (R$ 300 por mês)' from public.organizations
on conflict (organization_id, modulo) do update set modelo = excluded.modelo, teto_tokens_mes = excluded.teto_tokens_mes, atualizado_por = excluded.atualizado_por, updated_at = now();
