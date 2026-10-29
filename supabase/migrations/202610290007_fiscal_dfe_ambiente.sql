-- Fiscal: a busca das notas recebidas tem ambiente próprio (proprietário, 29/10/2026 — F0 de docs/PLANO-EMISSAO-NFE.md).
--
--   * A distribuição de DF-e (as notas que os fornecedores emitem contra o CNPJ da empresa) usava o ambiente da
--     EMISSÃO. Com a emissão em homologação, a SEFAZ respondia 137 (nenhum documento): as notas reais não chegavam.
--   * `dfe_ambiente` é só da busca (e da ciência da operação, o evento informativo que libera o XML completo).
--     Consultar não emite nota nem gera imposto. A emissão continua no `ambiente` de sempre (homologação).
--   * A numeração da distribuição (NSU) é de cada ambiente: na troca, recomeça do zero (a SEFAZ devolve os
--     últimos 90 dias) e a próxima consulta fica liberada.

alter table public.fiscal_config add column if not exists dfe_ambiente text not null default 'producao'
  check (dfe_ambiente in ('homologacao', 'producao'));
comment on column public.fiscal_config.dfe_ambiente is
  'Ambiente da busca de notas recebidas (distribuição de DF-e) e da ciência da operação. Independe do ambiente da emissão.';

update public.fiscal_config
   set dfe_ultimo_nsu = '000000000000000', dfe_max_nsu = null, dfe_proxima_consulta = now(),
       dfe_ultimo_status = 'Busca passou para produção (29/10/2026): recomeça do início.'
 where dfe_ambiente = 'producao' and ambiente <> 'producao';
