import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

/* ============================================================================
   Primitivas do Design System Pecsil

   Todo módulo compõe suas telas com estes componentes. A regra é simples:
   se um módulo precisa de algo que não existe aqui, a peça sobe para cá antes
   de ser usada — não se cria um estilo local.
   ============================================================================ */

export type Tone = "blue" | "green" | "amber" | "red" | "purple" | "teal" | "neutral";
export type StatusTone = "success" | "attention" | "danger" | "info" | "purple" | "neutral";

/* --- Botão ---------------------------------------------------------------- */

export function Button({
  variant = "primary",
  compact = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  compact?: boolean;
}) {
  return <button className={`ds-button ${variant}${compact ? " compact" : ""} ${className}`} {...props} />;
}

/* --- Superfícies ----------------------------------------------------------- */

export function Card({
  className = "",
  interactive = false,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode; interactive?: boolean }) {
  return (
    <section className={`ds-card${interactive ? " interactive" : ""} ${className}`} {...props}>
      {children}
    </section>
  );
}

/**
 * Painel: cartão com cabeçalho padronizado (título, subtítulo e ação opcional).
 * É o contêiner padrão de qualquer bloco de conteúdo com identidade própria.
 */
export function Panel({
  title,
  subtitle,
  actions,
  className = "",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`ds-panel ${className}`}>
      <header className="ds-panel-head">
        <div>
          <h2 className="ds-panel-title">{title}</h2>
          {subtitle ? <p className="ds-panel-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ds-panel-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Rótulo micro em caixa alta que abre uma seção interna. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="ds-section-label">{children}</p>;
}

/* --- Selos ----------------------------------------------------------------- */

export function Status({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`ds-status ${tone}`}>{children}</span>;
}

/* --- KPI ------------------------------------------------------------------- */

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="ds-kpi-grid">{children}</div>;
}

/**
 * Cartão de número. `caption` explica de onde o número vem — é o que separa um
 * indicador confiável de um número solto na tela, então não é opcional por acaso.
 */
export function Kpi({
  label,
  caption,
  value,
  unit,
  tone = "neutral",
  onOpen,
}: {
  label: ReactNode;
  caption?: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  tone?: Tone;
  /** Quando existe, o cartão vira botão e abre o detalhe do que o número conta. */
  onOpen?: () => void;
}) {
  // O número fica ao lado do rótulo enquanto couber. Valores longos (moeda por
  // extenso, por exemplo) passam a ocupar a própria linha e diminuem — sem
  // isso o número invade o texto, que foi exatamente o defeito da versão
  // anterior. A decisão é pelo comprimento porque é o que determina a largura.
  const length = String(value).length;
  const layout = length > 8 ? "stacked" : length > 5 ? "tight" : "";

  const content = (
    <>
      <div className="ds-kpi-text">
        <span className="ds-kpi-label">{label}</span>
        {caption ? <span className="ds-kpi-caption">{caption}</span> : null}
      </div>
      <div className="ds-kpi-value">
        <strong>{value}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
    </>
  );
  if (onOpen) {
    return (
      <button type="button" className={`ds-kpi ${tone} ${layout} is-clickable`} onClick={onOpen} aria-haspopup="dialog">
        {content}
        <svg className="ds-kpi-more" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
      </button>
    );
  }
  return <article className={`ds-kpi ${tone} ${layout}`}>{content}</article>;
}

/* --- Callout --------------------------------------------------------------- */

const calloutIcon: Record<"info" | "warning" | "success" | "danger", ReactNode> = {
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  warning: <><path d="M12 3 2 21h20L12 3Z" /><path d="M12 10v5M12 18h.01" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
  danger: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
};

const calloutTone: Record<keyof typeof calloutIcon, string> = {
  info: "",
  warning: "amber",
  success: "green",
  danger: "red",
};

/**
 * Bloco editorial que explica um número ou o estado de uma tela. Usado para
 * declarar limitação conhecida, contrato do dado ou origem da informação.
 */
export function Callout({
  variant = "info",
  title,
  children,
}: {
  variant?: keyof typeof calloutIcon;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`ds-callout ${calloutTone[variant]}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {calloutIcon[variant]}
      </svg>
      <div className="ds-callout-body">
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

/* --- Controle segmentado ---------------------------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact = false,
  ariaLabel,
}: {
  options: readonly T[] | readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const items = options.map(option =>
    typeof option === "string" ? { value: option as T, label: option as ReactNode } : option,
  );

  return (
    <div className={`ds-segmented${compact ? " compact" : ""}`} role="tablist" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item.value}
          role="tab"
          aria-selected={item.value === value}
          className={item.value === value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* --- Linha rotulada com valor ----------------------------------------------- */

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="ds-row">
      <span className="ds-row-label">{label}</span>
      <span className="ds-chip-value">{value}</span>
    </div>
  );
}

/* --- Gráficos ---------------------------------------------------------------- */

export type Slice = { label: string; value: number; tone?: Tone };

const toneVar: Record<Tone, string> = {
  blue: "var(--accent-blue)",
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  red: "var(--accent-red)",
  purple: "var(--accent-purple)",
  teal: "var(--accent-teal)",
  neutral: "var(--text-muted)",
};

/** Cor da série categórica na posição informada. Ordem fixa por contrato. */
export function seriesColor(index: number) {
  return `var(--data-${(index % 8) + 1})`;
}

/**
 * Anel de composição com total ao centro. Desenhado em SVG puro — nenhuma
 * biblioteca externa, porque o artefato do Sites bloqueia host externo.
 */
export function Donut({
  slices,
  total,
  caption,
  size = 180,
  thickness = 18,
}: {
  slices: Slice[];
  total?: number;
  caption?: ReactNode;
  size?: number;
  thickness?: number;
}) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0);
  const displayTotal = total ?? sum;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="ds-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            className="ds-donut-track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
          />
          {sum > 0 &&
            slices.map((slice, index) => {
              const length = (slice.value / sum) * circumference;
              const dash = `${length} ${circumference - length}`;
              const element = (
                <circle
                  key={slice.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={slice.tone ? toneVar[slice.tone] : seriesColor(index)}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              );
              offset += length;
              return element;
            })}
        </g>
      </svg>
      <div className="ds-donut-center">
        <strong>{displayTotal.toLocaleString("pt-BR")}</strong>
        {caption ? <span>{caption}</span> : null}
      </div>
    </div>
  );
}

/** Legenda de série: ponto, rótulo e valor tabular. */
export function Legend({ slices }: { slices: Slice[] }) {
  return (
    <div className="ds-legend">
      {slices.map((slice, index) => (
        <div className="ds-legend-item" key={slice.label}>
          <span
            className="ds-legend-dot"
            style={{ background: slice.tone ? toneVar[slice.tone] : seriesColor(index) }}
          />
          <span>{slice.label}</span>
          <b>{slice.value.toLocaleString("pt-BR")}</b>
        </div>
      ))}
    </div>
  );
}

/** Barra horizontal com trilho. `max` fixo mantém várias barras comparáveis. */
export function Bar({
  label,
  caption,
  value,
  max,
  tone = "blue",
}: {
  label: ReactNode;
  caption?: ReactNode;
  value: number;
  max: number;
  tone?: Tone;
}) {
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="ds-bar">
      <div>
        <div className="ds-kpi-label">{label}</div>
        {caption ? <div className="ds-kpi-caption">{caption}</div> : null}
      </div>
      <div className="ds-bar-track">
        <div className="ds-bar-fill" style={{ width: `${percent}%`, background: toneVar[tone] }} />
      </div>
      <b>{value.toLocaleString("pt-BR")}</b>
    </div>
  );
}

/** Colunas verticais para distribuição por faixa. */
export function Columns({ data }: { data: { label: string; value: number; tone?: Tone }[] }) {
  const max = Math.max(...data.map(item => item.value), 1);
  return (
    <div className="ds-columns">
      {data.map((item, index) => (
        <div className="ds-column" key={item.label}>
          <div
            className="ds-column-fill"
            style={{
              height: `${(item.value / max) * 100}%`,
              background: item.tone ? toneVar[item.tone] : seriesColor(index),
            }}
            title={`${item.label}: ${item.value}`}
          />
          <span className="ds-column-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* --- Sugestão do modelo de decisão (Clef) ------------------------------------ */

/**
 * O que vem do modelo de decisão aparece sempre marcado como tal, em azul e com a
 * confiança à vista (CLAUDE.md, "Modelo de decisão fala em azul"). Nunca como dado
 * apurado: a pessoa aceita, recusa ou corrige. O "por quê?" mostra a pergunta feita.
 */
export function SugestaoModelo({
  modelo = "Clef",
  confianca,
  resposta,
  pergunta,
  detalhe,
  onAceitar,
  onRecusar,
  ocupado = false,
}: {
  modelo?: string;
  /** De 0 a 1. */
  confianca: number | null;
  resposta: ReactNode;
  pergunta?: string;
  detalhe?: ReactNode;
  onAceitar?: () => void;
  onRecusar?: () => void;
  ocupado?: boolean;
}) {
  const pct = typeof confianca === "number" ? ` · ${Math.round(confianca * 100)}%` : "";
  return (
    <div className="ds-sugestao" role="group" aria-label={`Sugestão do ${modelo}`}>
      <div className="ds-sugestao-topo">
        <Status tone="info">Sugestão do {modelo}{pct}</Status>
        {(onAceitar || onRecusar) && (
          <span className="ds-sugestao-acoes">
            {onRecusar && <Button variant="secondary" compact onClick={onRecusar} disabled={ocupado}>Recusar</Button>}
            {onAceitar && <Button compact onClick={onAceitar} disabled={ocupado}>Aceitar</Button>}
          </span>
        )}
      </div>
      <div className="ds-sugestao-resposta">{resposta}</div>
      {detalhe}
      {pergunta && (
        <details className="ds-sugestao-porque">
          <summary>por quê?</summary>
          <p>Pergunta feita ao modelo: {pergunta}</p>
        </details>
      )}
    </div>
  );
}
