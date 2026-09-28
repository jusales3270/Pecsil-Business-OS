-- ============================================================================
-- RH › Férias e ausências: excluir uma ausência
-- ============================================================================
-- Editar já era permitido a quem aprova férias (rh_absences_decide, UPDATE com
-- rh.ferias em "aprovar"). Excluir segue a mesma régua. A exclusão fica na
-- auditoria pelo gatilho rh_absences_audit (rh_absences.delete, risco alto) e
-- leva junto o dado clínico da ausência (rh_absence_clinical, em cascata).
-- ============================================================================

drop policy if exists rh_absences_delete on public.rh_absences;
create policy rh_absences_delete on public.rh_absences
  for delete to authenticated
  using (organization_id = public.current_organization_id() and public.has_feature('rh.ferias', 'aprovar'));
