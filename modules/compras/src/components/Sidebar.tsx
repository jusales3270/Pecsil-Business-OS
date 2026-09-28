import { useStore } from '@/store';
import type { Page } from '@/types';
import {
  LayoutDashboard,
  FileText,
  ShoppingCart,
  ClipboardCheck,
  History,
  ArrowLeft,
  X,
} from 'lucide-react';

interface SidebarProps {
  onClose: () => void;
  isOwner?: boolean;
  onExit?: () => void;
}

const orcamentistaMenu: { icon: React.ReactNode; label: string; page: Page }[] = [
  { icon: <LayoutDashboard size={20} />, label: 'Dashboard', page: 'dashboard' },
  { icon: <FileText size={20} />, label: 'Minhas Cotações', page: 'cotacoes' },
  { icon: <ShoppingCart size={20} />, label: 'Compras Realizadas', page: 'compras' },
];

const gestorMenu: { icon: React.ReactNode; label: string; page: Page }[] = [
  { icon: <LayoutDashboard size={20} />, label: 'Dashboard', page: 'dashboard' },
  { icon: <ClipboardCheck size={20} />, label: 'Pendentes de Aprovação', page: 'pendentes' },
  { icon: <History size={20} />, label: 'Histórico de Decisões', page: 'historico' },
  { icon: <ShoppingCart size={20} />, label: 'Compras', page: 'compras' },
];

export default function Sidebar({ onClose, isOwner, onExit }: SidebarProps) {
  const { user, currentPage, setPage, login } = useStore();

  if (!user) return null;

  const menuItems = user.role === 'ORCAMENTISTA' ? orcamentistaMenu : gestorMenu;

  const handlePage = (page: Page) => {
    setPage(page);
    onClose();
  };

  return (
    <aside className="w-[260px] h-full bg-white text-slate-700 flex flex-col overflow-y-auto border-r border-slate-200">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/pecsil-logo.png?v=2" alt="Pecsil Logo" className="h-8 object-contain" />
          <div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Módulo Compras</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="md:hidden text-slate-400 hover:text-slate-600"
        >
          <X size={20} />
        </button>
      </div>

      {/* User info */}
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-sm border border-slate-200">
            {user.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${
              user.role === 'ORCAMENTISTA'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {user.role === 'ORCAMENTISTA' ? 'Orçamentista' : 'Gestor'}
            </span>
          </div>
        </div>
      </div>

      {/* Switcher de Visão para o Proprietário */}
      {isOwner && (
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
            Alternar Visão (Proprietário)
          </label>
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/80 rounded-lg">
            <button
              type="button"
              onClick={() => {
                login('ORCAMENTISTA', user.name);
                setPage('dashboard');
              }}
              className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-all ${
                user.role === 'ORCAMENTISTA'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Orçamentista
            </button>
            <button
              type="button"
              onClick={() => {
                login('GESTOR', user.name);
                setPage('dashboard');
              }}
              className={`py-1.5 px-2 rounded-md text-xs font-semibold transition-all ${
                user.role === 'GESTOR'
                  ? 'bg-white text-amber-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Gestor
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.page}
            onClick={() => handlePage(item.page)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 text-left ${
              currentPage === item.page
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Botão de retorno ao Business OS */}
      {onExit && (
        <div className="p-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onExit}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all duration-200 text-left font-medium"
          >
            <ArrowLeft size={18} />
            <span>Voltar à Plataforma</span>
          </button>
        </div>
      )}
    </aside>
  );
}
