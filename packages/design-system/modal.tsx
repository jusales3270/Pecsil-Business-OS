"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Status, type StatusTone } from "./components";

/* --- Janela de detalhe (popup) -------------------------------------------- */

/**
 * Popup central para o detalhe de um indicador ou aviso. Fecha no Esc, no X e
 * clicando fora; devolve o foco a quem abriu.
 */
export function Modal({
  eyebrow,
  title,
  subtitle,
  onClose,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="ds-modal-layer">
      <section className="ds-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="ds-modal-body">{children}</div>
      </section>
    </div>
  );
}

export type DetailRow = {
  key: string;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  status?: { tone: StatusTone; label: ReactNode };
};

/** Lista do popup de detalhe: título, linha de apoio e um valor à direita. */
export function DetailRows({ rows, empty }: { rows: DetailRow[]; empty: ReactNode }) {
  if (!rows.length) return <p className="ds-detail-empty">{empty}</p>;
  return (
    <ul className="ds-detail-rows">
      {rows.map((row) => (
        <li key={row.key}>
          <span>
            <b>{row.title}</b>
            {row.subtitle ? <small>{row.subtitle}</small> : null}
          </span>
          {row.status ? <Status tone={row.status.tone}>{row.status.label}</Status> : null}
          {row.meta ? <em>{row.meta}</em> : null}
        </li>
      ))}
    </ul>
  );
}

