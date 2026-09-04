import { useStore } from '@/store';
import type { Divisao } from '@/types';
import { Cog, Flame } from 'lucide-react';

const DIVISOES: { value: Divisao; label: string; icon: React.ReactNode; activeColor: string; activeBg: string; hoverBg: string }[] = [
  {
    value: 'USINAGEM',
    label: 'Usinagem',
    icon: <Cog size={18} />,
    activeColor: 'text-blue-700',
    activeBg: 'bg-blue-50 border-blue-500',
    hoverBg: 'hover:bg-slate-50',
  },
  {
    value: 'FUNDICAO',
    label: 'Fundição',
    icon: <Flame size={18} />,
    activeColor: 'text-orange-700',
    activeBg: 'bg-orange-50 border-orange-500',
    hoverBg: 'hover:bg-slate-50',
  },
];

interface DivisaoTabsProps {
  /** Optional: show cotação count for each division */
  counts?: Record<Divisao, number>;
}

export default function DivisaoTabs({ counts }: DivisaoTabsProps) {
  const { currentDivisao, setDivisao } = useStore();

  return (
    <div className="flex items-center gap-2">
      {DIVISOES.map((d) => {
        const isActive = currentDivisao === d.value;
        const isUsinagem = d.value === 'USINAGEM';

        return (
          <button
            key={d.value}
            onClick={() => setDivisao(d.value)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border
              ${isActive
                ? isUsinagem
                  ? 'bg-[var(--tint-blue)] border-[var(--accent-blue)] text-[var(--accent-blue)] shadow-sm'
                  : 'bg-[var(--tint-amber)] border-[var(--accent-amber)] text-[var(--accent-amber)] shadow-sm'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }
            `}
          >
            <span className={`transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
              {d.icon}
            </span>
            <span>{d.label}</span>
            {counts && counts[d.value] !== undefined && (
              <span className={`
                ml-1 min-w-[20px] h-5 flex items-center justify-center rounded-full text-[11px] font-bold px-1.5
                ${isActive
                  ? isUsinagem
                    ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
                    : 'bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]'
                  : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'
                }
              `}>
                {counts[d.value]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
