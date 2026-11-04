-- Departamento PCP (Planejamento e Controle da Produção), pedido do proprietário em 04/11/2026: aparece no cadastro
-- de colaboradores e, com o responsável marcado, nos responsáveis da Portaria. Mesma unidade dos outros departamentos.
insert into public.departments (organization_id, unit_id, name, code, active)
select o.id, (select d.unit_id from public.departments d where d.organization_id = o.id and d.unit_id is not null group by d.unit_id order by count(*) desc limit 1),
       'PCP', 'PCP', true
  from public.organizations o
 where not exists (select 1 from public.departments d where d.organization_id = o.id and (d.code = 'PCP' or lower(d.name) = 'pcp'));
