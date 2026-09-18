"use client";

import { useEffect } from 'react';
import { useStore } from '@/store';
import Layout from '@/components/Layout';
import DashboardPage from '@/pages/DashboardPage';
import CotacoesPage from '@/pages/CotacoesPage';
import ComprasPage from '@/pages/ComprasPage';
import PendentesPage from '@/pages/PendentesPage';
import HistoricoPage from '@/pages/HistoricoPage';
import { Toaster } from '@/components/ui/sonner';
import type { ModuleAccessContext } from '@/modules/access';
import { useModuleNav } from '@/lib/module-nav-context';
import './compras.css';

interface ComprasAppProps {
  access: ModuleAccessContext;
  onExit: () => void;
  notify?: (message: string) => void;
}

export default function ComprasApp({ access, onExit }: ComprasAppProps) {
  const { user, currentPage, fetchInitialData, login, setPage } = useStore();
  const { registerNav } = useModuleNav();

  useEffect(() => {
    const tabs = user?.role === 'ORCAMENTISTA' ? [
      { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
      { id: 'cotacoes', label: 'Minhas Cotações', icon: 'file' },
      { id: 'compras', label: 'Compras Realizadas', icon: 'cart' },
    ] : [
      { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
      { id: 'pendentes', label: 'Pendentes de Aprovação', icon: 'clock' },
      { id: 'historico', label: 'Histórico de Decisões', icon: 'check' },
      { id: 'compras', label: 'Compras', icon: 'cart' },
    ];
    registerNav({
      moduleId: 'compras',
      moduleName: 'Compras',
      items: tabs,
      activeId: currentPage,
      onSelect: (id) => setPage(id as any),
    });
    return () => registerNav(null);
  }, [user?.role, currentPage, registerNav, setPage]);

  const isOwner = access.roleCode === 'owner' || access.roleCode === 'director' || access.role === 'Proprietário';
  const isManager = access.roleCode === 'manager' || access.role === 'Gestor';

  // Configuração inicial de perfil e acesso
  useEffect(() => {
    if (isOwner) {
      // Proprietário tem acesso a ambas as visões, inicia como orçamentista ou mantém a selecionada
      if (!user) {
        login('ORCAMENTISTA', access?.name ?? 'Orçamentista');
      }
    } else if (isManager) {
      // Perfil Gestor isolado
      if (!user || user.role !== 'GESTOR') {
        login('GESTOR', 'Gestor');
      }
    } else {
      // Perfil Orçamentista isolado
      if (!user || user.role !== 'ORCAMENTISTA') {
        login('ORCAMENTISTA', 'Orçamentista');
      }
    }
  }, [isOwner, isManager, login, user]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData, user]);

  const renderPage = () => {
    // Bloqueia telas restritas caso um orçamentista tente acessar página de gestor
    if (!isOwner && !isManager && (currentPage === 'pendentes' || currentPage === 'historico')) {
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
      <Layout isOwner={isOwner} onExit={onExit}>
        {renderPage()}
      </Layout>
      <Toaster position="bottom-right" />
    </div>
  );
}
