-- ============================================================================
-- Portaria: reconhecimento facial de verdade
-- ============================================================================
-- A match_visitantes de 202609040002 era um esboço: ignorava a foto e devolvia
-- o primeiro visitante da tabela com "similaridade 1.0" — a busca trazia
-- sempre a mesma pessoa. Também rodava sem filtro de organização nem de
-- permissão.
--
-- Aqui ela compara de fato a assinatura da foto (128 números do face-api.js)
-- com as cadastradas, pela distância euclidiana, e devolve os candidatos mais
-- próximos. Limite 0,45: medido nos dados reais, pares abaixo de ~0,42 são a
-- mesma pessoa; a mediana até o rosto mais parecido de OUTRA pessoa é 0,53.
--
-- As assinaturas vindas da nuvem estavam gravadas como TEXTO (a lista entre
-- aspas); passam a ser lista, com os mesmos valores.
-- ============================================================================

update public.visitantes
set face_descriptor = (face_descriptor #>> '{}')::jsonb
where jsonb_typeof(face_descriptor) = 'string';

do $$ begin
  alter table public.visitantes
    add constraint visitantes_face_descriptor_check
    check (face_descriptor is null
      or (jsonb_typeof(face_descriptor) = 'array' and jsonb_array_length(face_descriptor) = 128));
exception when duplicate_object then null; end $$;

-- O tipo de retorno muda (ganha a distância): recria.
drop function if exists public.match_visitantes(float8[], float8, int);

create function public.match_visitantes(
  query_embedding float8[],
  match_threshold float8 default 0.45,
  match_count int default 3
)
returns table (
  id uuid,
  nome text,
  empresa text,
  documento text,
  contato text,
  distance float8,
  similarity float8
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_feature('portaria.visitas') then
    raise exception 'Sem permissão para buscar visitantes.' using errcode = '42501';
  end if;
  if query_embedding is null or array_length(query_embedding, 1) <> 128 then
    raise exception 'Assinatura facial inválida.';
  end if;

  return query
  with consulta as (
    select q.val, q.ord from unnest(query_embedding) with ordinality as q(val, ord)
  ), distancias as (
    select v.id, sqrt(sum((c.val - e.val::float8) ^ 2)) as dist
    from public.visitantes v
    cross join lateral jsonb_array_elements_text(v.face_descriptor) with ordinality as e(val, ord)
    join consulta c on c.ord = e.ord
    where v.organization_id = public.current_organization_id()
      and v.face_descriptor is not null
    group by v.id
  )
  select v.id, v.nome, v.empresa, v.documento, v.contato, d.dist, 1 - d.dist
  from distancias d
  join public.visitantes v on v.id = d.id
  where d.dist <= match_threshold
  order by d.dist
  limit greatest(match_count, 1);
end;
$$;

revoke all on function public.match_visitantes(float8[], float8, int) from public;
grant execute on function public.match_visitantes(float8[], float8, int) to authenticated;
