import { useStore, calcularTotal, formatCurrency, formatCotacaoProdutosDesc, formatCotacaoProdutosQtd, formatDateTime } from '@/store';
import {
  FileText,
  Clock,
  CheckCircle,
  DollarSign,
  Inbox,
  Scale,
  X,
  ArrowRight,
  Pencil,
  Trash2,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useMemo, useState } from 'react';
import DivisaoTabs from '@/components/DivisaoTabs';

const COLORS = {
  PENDENTE: '#f57c00',
  APROVADO: '#2e7d32',
  REJEITADO: '#c62828',
  COMPRADO: '#1565c0',
};

export default function DashboardPage() {
  const { user, cotacoes, compras, setPage, currentDivisao, setDashboardAction } = useStore();
  const [drilldownType, setDrilldownType] = useState<'PENDENTES' | 'APROVADOS_MES' | 'COMPRADOS' | 'ORC_TOTAL' | 'ORC_PENDENTES' | 'ORC_APROVADOS' | 'ORC_COMPRADOS' | null>(null);

  const handleAction = (type: 'VIEW' | 'EDIT' | 'DELETE', cotacaoId: number) => {
    setDashboardAction({ type, cotacaoId });
    setPage('cotacoes');
  };

  const stats = useMemo(() => {
    if (!user) return null;

    if (user.role === 'ORCAMENTISTA') {
      const myCotacoes = cotacoes.filter(c => c.userId === user.id && c.deletedAt === null && c.divisao === currentDivisao);
      const total = myCotacoes.length;
      const aprovados = myCotacoes.filter(c => c.status === 'APROVADO' || (c.status === 'PENDENTE' && c.produtos && c.produtos.some(p => p.status === 'APROVADO'))).length;
      const pendentes = myCotacoes.filter(c => c.status === 'PENDENTE' && !(c.produtos && c.produtos.some(p => p.status === 'APROVADO'))).length;
      const comprados = myCotacoes.filter(c => c.status === 'COMPRADO').length;
      const totalAprovadoAguardando = myCotacoes
        .filter(c => c.status === 'APROVADO' || (c.status === 'PENDENTE' && c.produtos && c.produtos.some(p => p.status === 'APROVADO')))
        .reduce((sum, c) => {
          const list = c.produtos && c.produtos.length > 0 ? c.produtos.filter(p => p.status === 'APROVADO') : [];
          if (list.length > 0) {
            return sum + list.reduce((itemSum, p) => itemSum + (p.valorUnit * p.quantidade * (1 + p.ipi / 100)), 0);
          }
          return sum + calcularTotal(c);
        }, 0);

      // Pie chart data
      const statusData = [
        { name: 'Pendente', value: pendentes, color: COLORS.PENDENTE },
        { name: 'Aprovado', value: aprovados, color: COLORS.APROVADO },
        { name: 'Rejeitado', value: myCotacoes.filter(c => c.status === 'REJEITADO').length, color: COLORS.REJEITADO },
      ].filter(d => d.value > 0);

      // Monthly bar chart
      const meses: Record<string, number> = {};
      const agora = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        const key = d.toLocaleString('pt-BR', { month: 'short', year: '2-digit' });
        meses[key] = 0;
      }
      myCotacoes.forEach(c => {
        const d = new Date(c.createdAt);
        const key = d.toLocaleString('pt-BR', { month: 'short', year: '2-digit' });
        if (meses[key] !== undefined) meses[key]++;
      });
      const monthlyData = Object.entries(meses).map(([name, value]) => ({ name, value }));

      return {
        type: 'ORCAMENTISTA' as const,
        total,
        pendentes,
        aprovados,
        comprados,
        totalAprovadoAguardando,
        statusData,
        monthlyData,
        recentCotacoes: myCotacoes
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5),
      };
    } else {
      // GESTOR
      const allCotacoes = cotacoes.filter(c => c.deletedAt === null && c.divisao === currentDivisao);
      const pendentes = allCotacoes.filter(c => c.status === 'PENDENTE');
      const totalPendente = pendentes.reduce((sum, c) => sum + calcularTotal(c), 0);
      const qtdPendentes = pendentes.length;

      const now = new Date();
      const mesAtual = now.getMonth();
      const anoAtual = now.getFullYear();

      const aprovadosMes = allCotacoes.filter(c => {
        if (!c.dataDecisao || c.status !== 'APROVADO') return false;
        const d = new Date(c.dataDecisao);
        return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
      }).length;

      const rejeitadosMes = allCotacoes.filter(c => {
        if (!c.dataDecisao || c.status !== 'REJEITADO') return false;
        const d = new Date(c.dataDecisao);
        return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
      }).length;

      const totalComprado = compras.reduce((sum, c) => sum + c.total, 0);

      // Weekly decisions bar chart
      const semanas: Record<string, { aprovados: number; rejeitados: number }> = {};
      for (let i = 3; i >= 0; i--) {
        const key = `Sem ${i + 1}`;
        semanas[key] = { aprovados: 0, rejeitados: 0 };
      }
      allCotacoes.forEach(c => {
        if (c.dataDecisao) {
          const d = new Date(c.dataDecisao);
          const diff = Math.floor((now.getTime() - d.getTime()) / (7 * 24 * 60 * 60 * 1000));
          if (diff >= 0 && diff < 4) {
            const key = `Sem ${4 - diff}`;
            if (c.status === 'APROVADO') semanas[key].aprovados++;
            if (c.status === 'REJEITADO') semanas[key].rejeitados++;
          }
        }
      });
      const weeklyData = Object.entries(semanas).map(([name, v]) => ({
        name,
        Aprovados: v.aprovados,
        Rejeitados: v.rejeitados,
      }));

      // Value range pie
      const faixas = [
        { name: 'Até R$1k', min: 0, max: 1000, count: 0, color: '#3b82f6' },      // Blue
        { name: 'R$1k-R$5k', min: 1001, max: 5000, count: 0, color: '#10b981' },    // Green
        { name: 'R$5k-R$10k', min: 5001, max: 10000, count: 0, color: '#f59e0b' },  // Orange/Yellow
        { name: 'Acima de R$10k', min: 10001, max: Infinity, count: 0, color: '#ef4444' }, // Red
      ];
      pendentes.forEach(c => {
        const t = calcularTotal(c);
        const f = faixas.find(fa => t >= fa.min && t <= fa.max);
        if (f) f.count++;
      });
      const faixaData = faixas
        .filter(f => f.count > 0)
        .map(f => ({
          name: f.name,
          value: f.count,
          color: f.color,
        }));

      return {
        type: 'GESTOR' as const,
        totalPendente,
        qtdPendentes,
        aprovadosMes,
        rejeitadosMes,
        totalComprado,
        weeklyData,
        faixaData,
        topPendentes: [...pendentes]
          .sort((a, b) => calcularTotal(b) - calcularTotal(a))
          .slice(0, 5),
      };
    }
  }, [user, cotacoes, compras, currentDivisao]);

  // Counts for division tabs
  const divisaoCounts = useMemo(() => {
    if (!user) return { USINAGEM: 0, FUNDICAO: 0 };
    const base = user.role === 'ORCAMENTISTA'
      ? cotacoes.filter(c => c.userId === user.id && c.deletedAt === null)
      : cotacoes.filter(c => c.deletedAt === null);
    return {
      USINAGEM: base.filter(c => c.divisao === 'USINAGEM').length,
      FUNDICAO: base.filter(c => c.divisao === 'FUNDICAO').length,
    };
  }, [user, cotacoes]);

  if (!user || !stats) return null;

  return (
    <div className="space-y-6">
      {/* Division Tabs */}
      <DivisaoTabs counts={divisaoCounts} />

      {/* Stats Row */}
      {stats.type === 'ORCAMENTISTA' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={<FileText size={20} />} label="Total de Cotações" value={String(stats.total)} color="#2563eb" onClick={() => setDrilldownType('ORC_TOTAL')} />
          <StatCard icon={<Clock size={20} />} label="Aguardando Aprovação" value={String(stats.pendentes)} color="#f57c00" onClick={() => setDrilldownType('ORC_PENDENTES')} />
          <StatCard icon={<CheckCircle size={20} />} label="Aprovadas" value={String(stats.aprovados)} color="#2e7d32" onClick={() => setDrilldownType('ORC_APROVADOS')} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={<DollarSign size={20} />} label="Total Pendente (R$)" value={formatCurrency(stats.totalPendente)} color="#c62828" onClick={() => setDrilldownType('PENDENTES')} />
          <StatCard icon={<Inbox size={20} />} label="Qtd Pendentes" value={String(stats.qtdPendentes)} color="#f57c00" onClick={() => setDrilldownType('PENDENTES')} />
          <StatCard icon={<CheckCircle size={20} />} label="Aprovadas no Mês" value={String(stats.aprovadosMes)} color="#2e7d32" onClick={() => setDrilldownType('APROVADOS_MES')} />
        </div>
      )}

      {/* Highlight Banner */}
      <div
        className="rounded-xl p-5 md:p-6 text-white shadow-md"
        style={{
          background: 'linear-gradient(90deg, #1e40af 0%, #2563eb 55%, #60a5fa 100%)',
        }}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-400/20 flex items-center justify-center flex-shrink-0">
            {stats.type === 'ORCAMENTISTA' ? (
              <DollarSign size={24} className="text-amber-400" />
            ) : (
              <Scale size={24} className="text-amber-400" />
            )}
          </div>
          <div>
            {stats.type === 'ORCAMENTISTA' ? (
              <>
                <p className="text-xl md:text-2xl font-bold">
                  {formatCurrency(stats.totalAprovadoAguardando)} — {stats.aprovados} {stats.aprovados === 1 ? 'item' : 'itens'} aguardando ordem de compra
                </p>
                <p className="text-sm text-white/70 mt-1">Cotações aprovadas prontas para compra</p>
              </>
            ) : (
              <>
                <p className="text-xl md:text-2xl font-bold">
                  {formatCurrency(stats.totalPendente)} — {stats.qtdPendentes} {stats.qtdPendentes === 1 ? 'cotação' : 'cotações'} aguardando aprovação
                </p>
                <p className="text-sm text-white/70 mt-1">Cotações pendentes precisam de sua decisão</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Pie Chart */}
        <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-5">
          <h3 className="text-sm font-semibold text-[#212121] mb-4">
            {stats.type === 'ORCAMENTISTA' ? 'Distribuição por Status' : 'Cotações por Faixa de Valor'}
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={stats.type === 'ORCAMENTISTA' ? stats.statusData : stats.faixaData}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {(stats.type === 'ORCAMENTISTA' ? stats.statusData : stats.faixaData).map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Bar Chart */}
        <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-5">
          <h3 className="text-sm font-semibold text-[#212121] mb-4">
            {stats.type === 'ORCAMENTISTA' ? 'Cotações por Mês (Últimos 6 meses)' : 'Decisões por Semana'}
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            {stats.type === 'ORCAMENTISTA' ? (
              <BarChart data={stats.monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <BarChart data={stats.weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Aprovados" fill="#2e7d32" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Rejeitados" fill="#c62828" radius={[2, 2, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#212121]">
            {stats.type === 'ORCAMENTISTA' ? 'Últimas 5 Cotações' : 'Top 5 Cotações Pendentes por Valor'}
          </h3>
          <button
            onClick={() => setPage(stats.type === 'ORCAMENTISTA' ? 'cotacoes' : 'pendentes')}
            className="text-xs text-primary hover:underline font-medium"
          >
            Ver todas
          </button>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.08]">
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase">ID</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase">Fornecedor</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase">Produto</th>
                <th className="text-right py-2.5 px-3 font-medium text-[#757575] text-xs uppercase">Qtd</th>
                <th className="text-right py-2.5 px-3 font-medium text-[#757575] text-xs uppercase">Total</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase">Status</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(stats.type === 'ORCAMENTISTA' ? stats.recentCotacoes : stats.topPendentes).map((c) => (
                <tr key={c.id} className="border-b border-black/[0.04] hover:bg-[#fafafa]">
                  <td className="py-2.5 px-3 text-[#212121]">#{c.id}</td>
                  <td className="py-2.5 px-3 text-[#212121] max-w-[200px] truncate">{c.fornecedor}</td>
                  <td className="py-2.5 px-3 text-[#212121] max-w-[250px] truncate" title={c.produtos?.map(p => p.produto).join(', ') || c.produto}>
                    {formatCotacaoProdutosDesc(c)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[#212121]">{formatCotacaoProdutosQtd(c)}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-[#212121]">{formatCurrency(calcularTotal(c))}</td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={c.status} cotacao={c} />
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      {stats.type === 'ORCAMENTISTA' ? (
                        <>
                          <button
                            onClick={() => handleAction('VIEW', c.id)}
                            className="p-1 hover:bg-black/[0.04] rounded text-[#757575] hover:text-primary transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => handleAction('EDIT', c.id)}
                            className="p-1 hover:bg-black/[0.04] rounded text-[#757575] hover:text-primary transition-colors"
                            title="Editar cotação"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleAction('DELETE', c.id)}
                            className="p-1 hover:bg-black/[0.04] rounded text-[#757575] hover:text-[#c62828] transition-colors"
                            title="Excluir cotação"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setDashboardAction({ type: 'VIEW', cotacaoId: c.id });
                            setPage('pendentes');
                          }}
                          className="p-1 hover:bg-black/[0.04] rounded text-[#757575] hover:text-primary transition-colors"
                          title="Ver para aprovar"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {(stats.type === 'ORCAMENTISTA' ? stats.recentCotacoes : stats.topPendentes).map((c) => (
            <div key={c.id} className="p-3 bg-[#fafafa] rounded-lg border border-black/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#757575]">#{c.id}</span>
                <StatusBadge status={c.status} cotacao={c} />
              </div>
              <p className="text-sm font-medium text-[#212121] truncate">{c.fornecedor}</p>
              <p className="text-xs text-[#757575] truncate">{formatCotacaoProdutosDesc(c)}</p>
              <div className="flex items-center justify-between mt-2 mb-2">
                <span className="text-xs text-[#757575]">{formatCotacaoProdutosQtd(c)}</span>
                <span className="text-sm font-semibold text-primary">{formatCurrency(calcularTotal(c))}</span>
              </div>
              
              {stats.type === 'ORCAMENTISTA' ? (
                <div className="flex items-center gap-2 pt-2 mt-2 border-t border-black/[0.06]">
                  <button
                    onClick={() => handleAction('VIEW', c.id)}
                    className="flex-1 py-1 rounded bg-[#f5f5f5] text-[#212121] text-[11px] font-medium flex items-center justify-center gap-1"
                  >
                    <Eye size={12} /> Ver
                  </button>
                  <button
                    onClick={() => handleAction('EDIT', c.id)}
                    className="flex-1 py-1 rounded bg-[#e8eaf6] text-primary text-[11px] font-medium flex items-center justify-center gap-1"
                  >
                    <Pencil size={12} /> Editar
                  </button>
                  <button
                    onClick={() => handleAction('DELETE', c.id)}
                    className="flex-1 py-1 rounded bg-[#ffebee] text-[#c62828] text-[11px] font-medium flex items-center justify-center gap-1"
                  >
                    <Trash2 size={12} /> Excluir
                  </button>
                </div>
              ) : (
                <div className="pt-2 mt-2 border-t border-black/[0.06]">
                  <button
                    onClick={() => {
                      setDashboardAction({ type: 'VIEW', cotacaoId: c.id });
                      setPage('pendentes');
                    }}
                    className="w-full py-1 rounded bg-primary text-white text-[11px] font-medium flex items-center justify-center gap-1"
                  >
                    <Eye size={12} /> Decidir
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {drilldownType && (
        <DrilldownModal
          type={drilldownType}
          onClose={() => setDrilldownType(null)}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color, onClick }: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  color: string;
  onClick?: () => void;
}) {
  return (
    <div 
      onClick={onClick}
      className={`bg-white rounded-xl border border-black/[0.08] shadow-sm p-5 transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98]' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}15`, color }}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-lg md:text-xl font-bold text-[#212121] truncate">{value}</p>
          <p className="text-[11px] text-[#757575] uppercase tracking-wider font-medium truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, cotacao }: { status: string; cotacao?: any }) {
  const isPartial = status === 'APROVADO' && cotacao?.produtos?.length > 0 && cotacao.produtos.some((p: any) => p.status !== 'APROVADO');
  const config: Record<string, { bg: string; text: string; label: string }> = {
    PENDENTE: { bg: 'bg-[#fff3e0]', text: 'text-[#e65100]', label: 'Aguardando' },
    APROVADO: { 
      bg: isPartial ? 'bg-[#fffde7] border border-[#f57f17]/20' : 'bg-[#e8f5e9]', 
      text: isPartial ? 'text-[#f57f17]' : 'text-[#2e7d32]', 
      label: isPartial ? 'Aprovado (Parcial)' : 'Aprovado' 
    },
    REJEITADO: { bg: 'bg-[#ffebee]', text: 'text-[#c62828]', label: 'Rejeitado' },
    COMPRADO: { bg: 'bg-[#e3f2fd]', text: 'text-[#1565c0]', label: 'Comprado' },
  };
  const c = config[status] || config.PENDENTE;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function DrilldownModal({ type, onClose }: { type: 'PENDENTES' | 'APROVADOS_MES' | 'COMPRADOS' | 'ORC_TOTAL' | 'ORC_PENDENTES' | 'ORC_APROVADOS' | 'ORC_COMPRADOS'; onClose: () => void }) {
  const { user, cotacoes, compras, currentDivisao, setPage, setActiveCotacaoIdForModal, setDashboardAction, revertCotacaoParaPendente } = useStore();

  const title = {
    PENDENTES: 'Cotações Pendentes de Aprovação (Gestor)',
    APROVADOS_MES: 'Cotações Aprovadas no Mês (Gestor)',
    COMPRADOS: 'Faturamento / Compras Realizadas (Gestor)',
    ORC_TOTAL: 'Minhas Cotações (Total)',
    ORC_PENDENTES: 'Minhas Cotações (Aguardando Aprovação)',
    ORC_APROVADOS: 'Minhas Cotações (Aprovadas)',
    ORC_COMPRADOS: 'Minhas Compras Realizadas',
  }[type];

  const items = useMemo(() => {
    if (type === 'PENDENTES') {
      return cotacoes.filter(c => c.deletedAt === null && c.status === 'PENDENTE' && c.divisao === currentDivisao);
    }
    if (type === 'APROVADOS_MES') {
      return cotacoes.filter(c => {
        if (c.deletedAt !== null) return false;
        if (c.divisao !== currentDivisao) return false;
        if (c.status !== 'APROVADO' && c.status !== 'COMPRADO') return false;
        if (!c.dataDecisao) return false;
        const d = new Date(c.dataDecisao);
        return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear();
      }).sort((a, b) => {
        const da = a.dataDecisao ? new Date(a.dataDecisao).getTime() : 0;
        const db = b.dataDecisao ? new Date(b.dataDecisao).getTime() : 0;
        return db - da;
      });
    }
    if (type === 'COMPRADOS') {
      return compras.filter(comp => {
        const cot = cotacoes.find(c => c.id === comp.cotacaoId);
        return cot && cot.divisao === currentDivisao;
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    if (type === 'ORC_TOTAL') {
      return cotacoes.filter(c => c.deletedAt === null && c.divisao === currentDivisao && c.userId === user?.id);
    }
    if (type === 'ORC_PENDENTES') {
      return cotacoes.filter(c => c.deletedAt === null && c.status === 'PENDENTE' && c.divisao === currentDivisao && c.userId === user?.id);
    }
    if (type === 'ORC_APROVADOS') {
      return cotacoes.filter(c => c.deletedAt === null && c.divisao === currentDivisao && c.userId === user?.id && (
        c.status === 'APROVADO' || (c.status === 'PENDENTE' && c.produtos && c.produtos.some(p => p.status === 'APROVADO'))
      ));
    }
    if (type === 'ORC_COMPRADOS') {
      return compras.filter(comp => {
        const cot = cotacoes.find(c => c.id === comp.cotacaoId);
        return cot && cot.divisao === currentDivisao && cot.userId === user?.id;
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return [];
  }, [type, cotacoes, compras, currentDivisao, user]);

  const handleItemClick = (cotacaoId: number) => {
    onClose();
    if (type === 'PENDENTES') {
      setActiveCotacaoIdForModal(cotacaoId);
      setPage('pendentes');
    } else if (type === 'APROVADOS_MES') {
      setActiveCotacaoIdForModal(cotacaoId);
      setPage('historico');
    } else if (type === 'COMPRADOS') {
      setActiveCotacaoIdForModal(cotacaoId);
      setPage('compras');
    } else if (type === 'ORC_TOTAL' || type === 'ORC_PENDENTES' || type === 'ORC_APROVADOS') {
      setDashboardAction({ type: 'VIEW', cotacaoId });
      setPage('cotacoes');
    } else if (type === 'ORC_COMPRADOS') {
      setActiveCotacaoIdForModal(cotacaoId);
      setPage('compras');
    }
  };

  const handleActionClick = (actionType: 'VIEW' | 'EDIT' | 'DELETE', cotacaoId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    setDashboardAction({ type: actionType, cotacaoId });
    setPage('cotacoes');
  };

  const handleRevertClick = async (cotacaoId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Tem certeza que deseja reverter esta cotação para a aprovação dos gestores?')) {
      try {
        await revertCotacaoParaPendente(cotacaoId);
        toast.success('Cotação revertida para pendente com sucesso!');
      } catch (err) {
        console.error(err);
        toast.error('Erro ao reverter cotação.');
      }
    }
  };

  const isCompraType = type === 'COMPRADOS' || type === 'ORC_COMPRADOS';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[720px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.08]">
          <h3 className="text-md font-bold text-[#212121]">{title} ({items.length})</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#757575] hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="text-center py-10 text-[#757575] text-sm">
              Nenhum registro encontrado nesta divisão.
            </div>
          ) : (
            <div className="space-y-3">
              {isCompraType ? (
                (items as typeof compras).map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleItemClick(c.cotacaoId)}
                    className="p-4 bg-slate-50 border border-black/[0.06] rounded-xl hover:bg-slate-100 hover:border-black/[0.12] cursor-pointer transition-all flex justify-between items-center group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-primary">NF: {c.nf || 'Sem NF'}</span>
                        <span className="text-xs text-[#757575]">• Cotação #{c.cotacaoId}</span>
                      </div>
                      <p className="text-sm font-semibold text-[#212121]">{c.fornecedor}</p>
                      <p className="text-xs text-[#757575]">{c.produto} — {c.quantidade} {c.unidade}</p>
                    </div>
                    <div className="text-right flex items-center gap-4 flex-shrink-0">
                      <div>
                        <p className="text-sm font-bold text-primary">{formatCurrency(c.total)}</p>
                        <p className="text-[10px] text-[#757575]">{formatDateTime(c.createdAt)}</p>
                      </div>
                      <ArrowRight size={16} className="text-[#757575] group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                ))
              ) : (
                (items as typeof cotacoes).map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleItemClick(c.id)}
                    className="p-4 bg-slate-50 border border-black/[0.06] rounded-xl hover:bg-slate-100 hover:border-black/[0.12] cursor-pointer transition-all flex justify-between items-center group"
                  >
                    <div className="space-y-1 min-w-0 flex-1 pr-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#757575]">#{c.id}</span>
                        {type === 'APROVADOS_MES' && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-green-50 text-green-700 font-semibold border border-green-200">
                            Aprovado por: {c.aprovadoPor || 'Ricardo'}
                          </span>
                        )}
                        {type.startsWith('ORC_') && (
                          <StatusBadge status={c.status} cotacao={c} />
                        )}
                      </div>
                      <p className="text-sm font-semibold text-[#212121] truncate">{c.fornecedor}</p>
                      <p className="text-xs text-[#757575] truncate">{formatCotacaoProdutosDesc(c)}</p>
                    </div>
                    <div className="text-right flex items-center gap-4 flex-shrink-0">
                      <div>
                        <p className="text-sm font-bold text-primary">{formatCurrency(calcularTotal(c))}</p>
                        <p className="text-[10px] text-[#757575]">
                          {c.status === 'PENDENTE' ? formatDateTime(c.createdAt) : (c.dataDecisao ? formatDateTime(c.dataDecisao) : formatDateTime(c.createdAt))}
                        </p>
                      </div>
                      
                      {type.startsWith('ORC_') ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => handleActionClick('VIEW', c.id, e)}
                            className="p-1.5 hover:bg-black/[0.06] rounded text-[#757575] hover:text-primary transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye size={14} />
                          </button>
                          {(c.status === 'APROVADO' || (c.status === 'PENDENTE' && c.produtos && c.produtos.some(p => p.status === 'APROVADO'))) && (
                             <button
                               onClick={(e) => handleRevertClick(c.id, e)}
                               className="p-1.5 hover:bg-black/[0.06] rounded text-[#757575] hover:text-amber-600 transition-colors"
                               title="Reverter para aprovação"
                             >
                               <RotateCcw size={14} />
                             </button>
                           )}
                          <button
                            onClick={(e) => handleActionClick('EDIT', c.id, e)}
                            className="p-1.5 hover:bg-black/[0.06] rounded text-[#757575] hover:text-primary transition-colors"
                            title="Editar cotação"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={(e) => handleActionClick('DELETE', c.id, e)}
                            className="p-1.5 hover:bg-black/[0.06] rounded text-[#757575] hover:text-[#c62828] transition-colors"
                            title="Excluir cotação"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <ArrowRight size={16} className="text-[#757575] group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-t-black/[0.08] bg-slate-50 rounded-b-xl text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-black/[0.08] hover:bg-slate-50 rounded-lg text-sm font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
