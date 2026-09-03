"use client";

import Topbar from './Topbar';

interface LayoutProps {
  children: React.ReactNode;
  isOwner?: boolean;
  onExit?: () => void;
}

export default function Layout({ children, isOwner, onExit }: LayoutProps) {
  return (
    <div className="flex flex-col w-full h-screen bg-[#f8fafc] overflow-hidden compras-app-root">
      {/* Barra superior de navegação com submenus do módulo Compras */}
      <Topbar isOwner={isOwner} onExit={onExit} />

      {/* Conteúdo principal da tela */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
