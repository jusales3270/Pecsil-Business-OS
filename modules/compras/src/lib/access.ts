import type { ComprasCaps, Page, UserRole } from '@/types';
import { canUseFeature, type ModuleAccessContext } from '@/modules/access';

/** Capacidades no Compras a partir das funcionalidades liberadas ao usuário. */
export function comprasCaps(access: ModuleAccessContext): ComprasCaps {
  return {
    verCotacoes: canUseFeature(access, 'compras.cotacoes'),
    cotar: canUseFeature(access, 'compras.cotacoes', 'operar'),
    verAprovacoes: canUseFeature(access, 'compras.aprovacoes'),
    aprovar: canUseFeature(access, 'compras.aprovacoes', 'aprovar'),
    verRealizadas: canUseFeature(access, 'compras.realizadas'),
    comprar: canUseFeature(access, 'compras.realizadas', 'operar'),
  };
}

/** Visões disponíveis: compras (cotações/realizadas) e aprovação. */
export function availableViews(caps: ComprasCaps): UserRole[] {
  const views: UserRole[] = [];
  if (caps.verCotacoes || caps.verRealizadas) views.push('ORCAMENTISTA');
  if (caps.verAprovacoes) views.push('GESTOR');
  return views;
}

export const VIEW_LABEL: Record<UserRole, string> = { ORCAMENTISTA: 'Orçamentista', GESTOR: 'Gestor' };

/** Abas da visão atual, só as liberadas. */
export function tabsFor(role: UserRole | undefined, caps: ComprasCaps): { page: Page; label: string; icon: string }[] {
  const tabs: { page: Page; label: string; icon: string; show: boolean }[] = role === 'GESTOR'
    ? [
        { page: 'dashboard', label: 'Dashboard', icon: 'grid', show: true },
        { page: 'pendentes', label: 'Pendentes de Aprovação', icon: 'clock', show: caps.verAprovacoes },
        { page: 'historico', label: 'Histórico de Decisões', icon: 'check', show: caps.verAprovacoes },
        { page: 'compras', label: 'Compras', icon: 'cart', show: caps.verRealizadas },
      ]
    : [
        { page: 'dashboard', label: 'Dashboard', icon: 'grid', show: true },
        { page: 'cotacoes', label: 'Minhas Cotações', icon: 'file', show: caps.verCotacoes },
        { page: 'compras', label: 'Compras Realizadas', icon: 'cart', show: caps.verRealizadas },
      ];
  return tabs.filter((tab) => tab.show).map(({ page, label, icon }) => ({ page, label, icon }));
}
