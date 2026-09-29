-- ============================================================================
-- RH › SST: situação de exames e treinamentos calculada pelo vencimento
-- ============================================================================
-- Todo registro entrava como "Programado / Atenção" e ficava assim até alguém
-- editar — ASO que vence daqui a um ano aparecia em atenção. A situação passa
-- a sair da data (mesma regra de lib/rh/sst-situacao.ts, que a tela aplica a
-- cada leitura; aqui o banco grava o valor certo a cada escrita):
--
--   vencido               → overdue  · critical
--   vence em até 60 dias  → due_soon · attention
--   mais de 60 dias       → compliant · regular
--
-- Só exame e treinamento com data; EPI, ocorrência, sem data e "Em análise"
-- (decisão manual) ficam como gravados.
-- ============================================================================

create or replace function public.rh_sst_aplicar_situacao()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  dias int;
begin
  if new.category not in ('exam', 'training') or new.due_date is null or new.status = 'under_review' then
    return new;
  end if;
  dias := new.due_date - (now() at time zone 'America/Sao_Paulo')::date;
  if dias < 0 then
    new.status := 'overdue';
    new.risk := 'critical';
  elsif dias <= 60 then
    new.status := 'due_soon';
    new.risk := 'attention';
  else
    new.status := 'compliant';
    new.risk := 'regular';
  end if;
  return new;
end;
$$;

drop trigger if exists rh_sst_situacao on public.rh_sst_records;
create trigger rh_sst_situacao
before insert or update of due_date, category, status on public.rh_sst_records
for each row execute function public.rh_sst_aplicar_situacao();

-- Acerta os registros de hoje (o gatilho roda neste update).
update public.rh_sst_records
set status = status
where category in ('exam', 'training') and due_date is not null and status <> 'under_review';
