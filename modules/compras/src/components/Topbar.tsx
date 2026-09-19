"use client";

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store';
import { tabsFor } from '../lib/access';
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
  canExit?: boolean;
  canSwitch?: boolean;
}

const tipoIcon = {
  COTACAO_APROVADA: <CheckCircle size={18} className="text-green-600" />,
  COTACAO_REJEITADA: <XCircle size={18} className="text-red-600" />,
  NOVA_COTACAO_PENDENTE: <Clock size={18} className="text-orange-500" />,
  COTACAO_COMPRADA: <ShoppingCart size={18} className="text-blue-600" />,
};

export default function Topbar({ onExit, canExit, canSwitch }: TopbarProps) {
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
    caps,
  } = useStore();

  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const tabs = tabsFor(user?.role, caps);

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
    <header className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-[var(--text-primary)] flex flex-wrap md:flex-nowrap items-center justify-between px-3 sm:px-4 md:px-6 py-2.5 md:py-0 md:h-16 flex-shrink-0 gap-2 sm:gap-4">
      {/* Esquerda: Voltar ao Ecossistema + Seletor de Perfil (Proprietário) */}
      <div className="flex items-center gap-2 sm:gap-3 order-1">
        {onExit && canExit && (
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] text-xs font-semibold shadow-xs transition-colors"
          >
            <ChevronLeft size={16} />
            <span className="hidden xs:inline">Ecossistema</span>
          </button>
        )}

        {canSwitch ? (
          <div className="flex items-center gap-1 bg-[var(--bg-subtle)] p-1 rounded-lg border border-[var(--border)]">
            <button
              type="button"
              onClick={() => {
                login('ORCAMENTISTA', user?.name);
                setPage('dashboard');
              }}
              className={`px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                user?.role === 'ORCAMENTISTA'
                  ? 'bg-[var(--bg-surface)] text-[var(--accent-blue)] shadow-xs border border-[var(--border-subtle)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Orçamentista
            </button>
            <button
              type="button"
              onClick={() => {
                login('GESTOR', user?.name);
                setPage('dashboard');
              }}
              className={`px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                user?.role === 'GESTOR'
                  ? 'bg-[var(--bg-surface)] text-[var(--accent-amber)] shadow-xs border border-[var(--border-subtle)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Gestor
            </button>
          </div>
        ) : (
          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
            user?.role === 'ORCAMENTISTA'
              ? 'bg-[var(--tint-blue)] text-[var(--accent-blue)]'
              : 'bg-[var(--tint-amber)] text-[var(--accent-amber)]'
          }`}>
            {user?.role === 'ORCAMENTISTA' ? 'Orçamentista' : 'Gestor'}
          </span>
        )}
      </div>

      {/* Centro: Submenus do Módulo de Compras (Estilo Segmented Tabs do Business OS) - escondido no mobile e transferido para o menu lateral */}
      <nav className="hidden md:flex items-center gap-1 p-1 bg-[var(--bg-subtle)] rounded-lg border border-[var(--border)] overflow-x-auto w-full md:w-auto order-3 md:order-2 scrollbar-none">
        {tabs.map((tab) => {
          const isActive = currentPage === tab.page;
          return (
            <button
              key={tab.page}
              type="button"
              onClick={() => setPage(tab.page)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs border border-[var(--border)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Direita: Divisão ativa + Notificações + Usuário */}
      <div className="flex items-center gap-2 sm:gap-3 order-2 md:order-3">
        {user && (
          <span className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[11px] font-semibold ${
            currentDivisao === 'USINAGEM'
              ? 'bg-[var(--tint-blue)] text-[var(--accent-blue)] border border-[var(--edge-blue)]'
              : 'bg-[var(--tint-amber)] text-[var(--accent-amber)] border border-[var(--edge-amber)]'
          }`}>
            {currentDivisao === 'USINAGEM' ? <Cog size={12} /> : <Flame size={12} />}
            <span>{currentDivisao === 'USINAGEM' ? 'Usinagem' : 'Fundição'}</span>
          </span>
        )}

        {/* Sino de Notificações */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
                background: 'var(--bg-surface-raised)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border)',
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
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface-raised)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Notificações
                  </h3>
                  {unreadCount > 0 && (
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: 'var(--tint-blue)',
                        color: 'var(--accent-blue)',
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
                      color: 'var(--accent-blue)',
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
                  background: 'var(--bg-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {myNotificacoes.length === 0 ? (
                  <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
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
                        background: n.lida ? 'var(--bg-surface)' : 'var(--tint-blue)',
                        border: n.lida ? '1px solid var(--border-subtle)' : '1px solid var(--edge-blue)',
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
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-subtle)',
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
                              color: n.lida ? 'var(--text-muted)' : 'var(--accent-blue)',
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
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
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
                                background: 'var(--accent-blue)',
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
                          color: 'var(--text-primary)',
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
          <div className="w-8 h-8 rounded-full bg-[var(--text-primary)] text-[var(--text-inverse)] flex items-center justify-center text-xs font-bold shadow-xs">
            {user.name.charAt(0)}
          </div>
        )}
      </div>
    </header>
  );
}
