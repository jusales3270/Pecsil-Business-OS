"use client";

import { useEffect, useMemo } from 'react';
import { useStore } from '@/store';
import Layout from '@/components/Layout';
import DashboardPage from '@/pages/DashboardPage';
import CotacoesPage from '@/pages/CotacoesPage';
import ComprasPage from '@/pages/ComprasPage';
import PendentesPage from '@/pages/PendentesPage';
import HistoricoPage from '@/pages/HistoricoPage';
import { Toaster } from '@/components/ui/sonner';
import { hasMultipleModules, type ModuleAccessContext } from '@/modules/access';
import type { Page } from '@/types';
import { availableViews, comprasCaps, tabsFor } from './lib/access';
import { useModuleNav } from '@/lib/module-nav-context';
import './compras.css';

interface ComprasAppProps {
  access: ModuleAccessContext;
  onExit: () => void;
  notify?: (message: string) => void;
}

export default function ComprasApp({ access, onExit }: ComprasAppProps) {
  const { user, currentPage, fetchInitialData, login, setPage, setCaps } = useStore();
  const { registerNav } = useModuleNav();

  // O que a pessoa pode fazer vem das funcionalidades liberadas pelo proprietário.
  const caps = useMemo(() => comprasCaps(access), [access]);
  const views = useMemo(() => availableViews(caps), [caps]);
  const tabs = useMemo(() => tabsFor(user?.role, caps), [user?.role, caps]);
  const canExit = hasMultipleModules(access);

  useEffect(() => {
    setCaps(caps);
  }, [caps, setCaps]);

  // Visão inicial: mantém a escolhida se ainda for permitida; o nome exibido é
  // sempre o do usuário logado.
  useEffect(() => {
    if (!views.length) return;
    const role = user && views.includes(user.role) ? user.role : views[0];
    if (!user || user.role !== role || user.name !== access.name) login(role, access.name);
  }, [views, user, login, access.name]);

  useEffect(() => {
    registerNav({
      moduleId: 'compras',
      moduleName: 'Compras',
      items: tabs.map(({ page, label, icon }) => ({ id: page, label, icon })),
      activeId: currentPage,
      onSelect: (id) => setPage(id as Page),
    });
    return () => registerNav(null);
  }, [tabs, currentPage, registerNav, setPage]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData, user]);

  const renderPage = () => {
    // Página fora das abas liberadas (troca de visão, link antigo): volta ao Dashboard.
    if (!tabs.some((tab) => tab.page === currentPage)) {
      return <DashboardPage />;
    }

    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'cotacoes':
        return <CotacoesPage />;
      case 'compras':
        return <ComprasPage />;
      case 'pendentes':
        return <PendentesPage />;
      case 'historico':
        return <HistoricoPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="w-full h-full min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] compras-app-root">
      <Layout canExit={canExit} canSwitch={views.length > 1} onExit={onExit}>
        {renderPage()}
      </Layout>
      <Toaster position="bottom-right" />
    </div>
  );
}
