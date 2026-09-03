"use client";

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store';
import type { Page } from '@/types';
import {
  Bell,
  CheckCircle,
  XCircle,
  ShoppingCart,
  Clock,
  Cog,
  Flame,
  ChevronLeft,
} from 'lucide-react';

interface TopbarProps {
  onExit?: () => void;
  isOwner?: boolean;
}

const tipoIcon = {
  COTACAO_APROVADA: <CheckCircle size={18} className="text-green-600" />,
  COTACAO_REJEITADA: <XCircle size={18} className="text-red-600" />,
  NOVA_COTACAO_PENDENTE: <Clock size={18} className="text-orange-500" />,
  COTACAO_COMPRADA: <ShoppingCart size={18} className="text-blue-600" />,
};

const orcamentistaTabs: { page: Page; label: string }[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'cotacoes', label: 'Minhas Cotações' },
  { page: 'compras', label: 'Compras Realizadas' },
];

const gestorTabs: { page: Page; label: string }[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'pendentes', label: 'Pendentes de Aprovação' },
  { page: 'historico', label: 'Histórico de Decisões' },
  { page: 'compras', label: 'Compras' },
];

export default function Topbar({ onExit, isOwner }: TopbarProps) {
  const {
    user,
    currentPage,
    setPage,
    notificacoes,
    markNotificacaoLida,
    markAllLidas,
    currentDivisao,
    setDivisao,
    cotacoes,
    setActiveCotacaoIdForModal,
    login,
  } = useStore();

  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const tabs = user?.role === 'ORCAMENTISTA' ? orcamentistaTabs : gestorTabs;

  const unreadCount = notificacoes.filter(
    n => n.userId === user?.id && !n.lida
  ).length;

  const myNotificacoes = notificacoes
    .filter(n => n.userId === user?.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 flex-shrink-0 gap-4">
      {/* Esquerda: Voltar ao Ecossistema + Seletor de Perfil (Proprietário) */}
      <div className="flex items-center gap-3">
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold shadow-xs transition-colors"
          >
            <ChevronLeft size={16} />
            <span>Ecossistema</span>
          </button>
        )}

        {isOwner ? (
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => {
                login('ORCAMENTISTA', user?.name || 'Júnior Sales');
                setPage('dashboard');
              }}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                user?.role === 'ORCAMENTISTA'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Orçamentista
            </button>
            <button
              type="button"
              onClick={() => {
                login('GESTOR', user?.name || 'Júnior Sales');
                setPage('dashboard');
              }}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                user?.role === 'GESTOR'
                  ? 'bg-white text-amber-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Gestor
            </button>
          </div>
        ) : (
          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
            user?.role === 'ORCAMENTISTA'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {user?.role === 'ORCAMENTISTA' ? 'Orçamentista' : 'Gestor'}
          </span>
        )}
      </div>

      {/* Centro: Submenus do Módulo de Compras (Estilo Segmented Tabs do Business OS) */}
      <nav className="flex items-center gap-1 p-1 bg-slate-100/90 rounded-lg border border-slate-200/80 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = currentPage === tab.page;
          return (
            <button
              key={tab.page}
              type="button"
              onClick={() => setPage(tab.page)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Direita: Divisão ativa + Notificações + Usuário */}
      <div className="flex items-center gap-3">
        {user && (
          <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
            currentDivisao === 'USINAGEM'
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-orange-50 text-orange-700 border border-orange-200'
          }`}>
            {currentDivisao === 'USINAGEM' ? <Cog size={12} /> : <Flame size={12} />}
            {currentDivisao === 'USINAGEM' ? 'Usinagem' : 'Fundição'}
          </span>
        )}

        {/* Sino de Notificações */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
            title="Notificações"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: '8px',
                width: '460px',
                maxWidth: 'calc(100vw - 32px)',
                background: '#ffffff',
                borderRadius: '12px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid #e2e8f0',
                zIndex: 60,
                overflow: 'hidden',
              }}
            >
              {/* Cabeçalho do Box */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  borderBottom: '1px solid #e2e8f0',
                  background: '#ffffff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                    Notificações
                  </h3>
                  {unreadCount > 0 && (
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#dbeafe',
                        color: '#1d4ed8',
                      }}
                    >
                      {unreadCount} nova{unreadCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {myNotificacoes.some(n => !n.lida) && (
                  <button
                    type="button"
                    onClick={() => { markAllLidas(); }}
                    style={{
                      background: 'transparent',
                      border: 0,
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#2563eb',
                    }}
                  >
                    Marcar todas como lidas
                  </button>
                )}
              </div>

              {/* Lista de Cards de Notificações com Espaçamento e Respiro */}
              <div
                style={{
                  maxHeight: '440px',
                  overflowY: 'auto',
                  padding: '12px',
                  background: '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {myNotificacoes.length === 0 ? (
                  <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
                    Nenhuma notificação recente
                  </div>
                ) : (
                  myNotificacoes.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        markNotificacaoLida(n.id);
                        setShowNotifs(false);
                        if (n.cotacaoId) {
                          const targetCotacao = cotacoes.find(c => c.id === n.cotacaoId);
                          if (targetCotacao?.divisao) {
                            setDivisao(targetCotacao.divisao);
                          }
                          setActiveCotacaoIdForModal(n.cotacaoId);
                          if (user?.role === 'GESTOR') {
                            if (targetCotacao && targetCotacao.status !== 'PENDENTE') {
                              setPage('historico');
                            } else {
                              setPage('pendentes');
                            }
                          } else {
                            setPage('cotacoes');
                          }
                        }
                      }}
                      style={{
                        background: n.lida ? '#ffffff' : '#f0f7ff',
                        border: n.lida ? '1px solid #e2e8f0' : '1px solid #bae6fd',
                        borderRadius: '10px',
                        padding: '14px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Linha superior: Ícone + Tipo + Data + Dot */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              background: '#ffffff',
                              border: '1px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {tipoIcon[n.tipo]}
                          </div>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              color: n.lida ? '#64748b' : '#0284c7',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {n.tipo === 'NOVA_COTACAO_PENDENTE'
                              ? 'Cotação Pendente'
                              : n.tipo === 'COTACAO_APROVADA'
                              ? 'Cotação Aprovada'
                              : n.tipo === 'COTACAO_REJEITADA'
                              ? 'Cotação Rejeitada'
                              : 'Compra Realizada'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {new Date(n.createdAt).toLocaleDateString('pt-BR')} às{' '}
                            {new Date(n.createdAt).toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {!n.lida && (
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#2563eb',
                                flexShrink: 0,
                              }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Mensagem com respiro e tipografia limpa */}
                      <p
                        style={{
                          margin: 0,
                          fontSize: '13px',
                          lineHeight: '1.45',
                          color: '#1e293b',
                          fontWeight: 500,
                        }}
                      >
                        {n.mensagem}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Avatar */}
        {user && (
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold shadow-xs">
            {user.name.charAt(0)}
          </div>
        )}
      </div>
    </header>
  );
}
