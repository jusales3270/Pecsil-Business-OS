"use client";

import Topbar from './Topbar';

interface LayoutProps {
  children: React.ReactNode;
  /** Mostra "Ecossistema": proprietário ou quem tem mais de um módulo. */
  canExit?: boolean;
  /** Alterna entre as visões Orçamentista e Gestor: quem tem as duas. */
  canSwitch?: boolean;
  onExit?: () => void;
}

export default function Layout({ children, canExit, canSwitch, onExit }: LayoutProps) {
  return (
    <div className="flex flex-col w-full min-h-[100dvh] h-[100dvh] bg-[var(--bg-canvas)] text-[var(--text-primary)] overflow-hidden compras-app-root">
      {/* Barra superior de navegação com submenus do módulo Compras */}
      <Topbar canExit={canExit} canSwitch={canSwitch} onExit={onExit} />

      {/* Conteúdo principal da tela */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 pb-24 md:pb-6 bg-[var(--bg-canvas)]">
        {children}
      </main>
    </div>
  );
}
