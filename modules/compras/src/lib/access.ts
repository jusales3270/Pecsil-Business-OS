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
    verFornecedores: canUseFeature(access, 'compras.fornecedores') || canUseFeature(access, 'fundacao.cadastros'),
    editarFornecedores: canUseFeature(access, 'compras.fornecedores', 'operar') || canUseFeature(access, 'fundacao.cadastros', 'operar'),
  };
}

/**
 * Visões disponíveis: compras (cotações/realizadas) e aprovação.
 *
 * No administrativo, a visão segue o cargo: o diretor aprova, então vê só a de
 * Gestor; gerente, assistente e estagiário cotam, então veem só a de
 * Orçamentista. O proprietário e as contas sem cargo seguem as funcionalidades
 * liberadas (e podem alternar quando têm as duas).
 */
export function availableViews(caps: ComprasCaps, access?: Pick<ModuleAccessContext, 'isOwner' | 'jobTitle'>): UserRole[] {
  const views: UserRole[] = [];
  if (caps.verCotacoes || caps.verRealizadas) views.push('ORCAMENTISTA');
  if (caps.verAprovacoes) views.push('GESTOR');
  if (access?.isOwner || !access?.jobTitle || !views.length) return views;
  return access.jobTitle === 'diretor' ? ['GESTOR'] : ['ORCAMENTISTA'];
}

export const VIEW_LABEL: Record<UserRole, string> = { ORCAMENTISTA: 'Orçamentista', GESTOR: 'Gestor' };

/**
 * Visão em uso: mantém a escolhida enquanto ela for permitida; senão, a
 * primeira liberada. O Compras e a casca do Comercial precisam chegar à mesma
 * resposta, senão o menu mostra abas de uma visão e a tela abre em outra.
 */
export function currentView(views: UserRole[], role: UserRole | undefined): UserRole | undefined {
  return role && views.includes(role) ? role : views[0];
}

/** Abas da visão atual, só as liberadas. */
export function tabsFor(role: UserRole | undefined, caps: ComprasCaps): { page: Page; label: string; icon: string }[] {
  const tabs: { page: Page; label: string; icon: string; show: boolean }[] = role === 'GESTOR'
    ? [
        { page: 'dashboard', label: 'Dashboard', icon: 'grid', show: true },
        { page: 'pendentes', label: 'Pendentes de Aprovação', icon: 'clock', show: caps.verAprovacoes },
        { page: 'historico', label: 'Histórico de Decisões', icon: 'check', show: caps.verAprovacoes },
        { page: 'compras', label: 'Compras', icon: 'cart', show: caps.verRealizadas },
        { page: 'fornecedores', label: 'Fornecedores', icon: 'factory', show: caps.verFornecedores },
      ]
    : [
        { page: 'dashboard', label: 'Dashboard', icon: 'grid', show: true },
        { page: 'cotacoes', label: 'Minhas Cotações', icon: 'file', show: caps.verCotacoes },
        { page: 'compras', label: 'Compras Realizadas', icon: 'cart', show: caps.verRealizadas },
        { page: 'fornecedores', label: 'Fornecedores', icon: 'factory', show: caps.verFornecedores },
      ];
  return tabs.filter((tab) => tab.show).map(({ page, label, icon }) => ({ page, label, icon }));
}
