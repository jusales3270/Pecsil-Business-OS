-- Compras: preço lançado na plataforma dispensa o link de cotação (decisão do proprietário, 20/10/2026).
-- Quando a cotação (ou a compra imediata) de um fornecedor entra no pedido, o link de cotação ainda aberto
-- para esse mesmo fornecedor nesse pedido é cancelado: o preço já foi acertado (WhatsApp, e-mail) e
-- lançado à mão. Vale para o link do ramo e para o link do pedido inteiro com o mesmo fornecedor.
-- A resposta pelo próprio link também passa por aqui e depois marca o convite como "respondido".

create or replace function public.trg_cotacao_cancela_convites()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.material_request_id is null or new.deleted_at is not null then return null; end if;
  update public.compras_convites cv set situacao = 'cancelado'
  where cv.organization_id = new.organization_id and cv.material_request_id = new.material_request_id and cv.situacao = 'aberto'
    and (
      (new.ramo_id is not null and cv.ramo_id = new.ramo_id)
      or (cv.ramo_id is null and ((new.supplier_id is not null and cv.supplier_id = new.supplier_id) or lower(btrim(cv.fornecedor)) = lower(btrim(new.fornecedor))))
    );
  return null;
end $$;
drop trigger if exists cotacoes_cancela_convites on public.cotacoes;
create trigger cotacoes_cancela_convites after insert on public.cotacoes
  for each row execute function public.trg_cotacao_cancela_convites();
