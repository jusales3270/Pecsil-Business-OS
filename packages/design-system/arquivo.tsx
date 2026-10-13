"use client";

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type RefObject } from "react";

/* ============================================================================
   Escolher arquivo — o ÚNICO jeito de abrir a janela de arquivos na plataforma.

   O campo nativo do navegador ("Escolher arquivo · Nenhum arquivo escolhido")
   é apagado e confuso, e a janela do sistema às vezes demora a abrir: sem
   aviso, a pessoa não sabe se está carregando ou se não funcionou. Aqui:
   - botão claro, com ícone e efeito ao passar o mouse;
   - "Abrindo a janela…" com indicador desde o clique até a janela fechar;
   - o nome do arquivo escolhido à vista;
   - "ocupado" para o que vem depois (lendo, enviando).
   Telas com área de soltar própria usam o hook `useEscolherArquivo`.
   ============================================================================ */

export function Carregando({ tamanho = 16 }: { tamanho?: number }) {
  return <span className="ds-carregando" style={{ width: tamanho, height: tamanho }} aria-hidden />;
}

export function useEscolherArquivo(onEscolher: (arquivos: File[]) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const [abrindo, setAbrindo] = useState(false);
  const callback = useRef(onEscolher);
  useEffect(() => { callback.current = onEscolher; }, [onEscolher]);

  // A janela do sistema fecha → a página volta a ter foco. Se nada foi escolhido (cancelou), some o aviso.
  useEffect(() => {
    if (!abrindo) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const voltou = () => { timer = setTimeout(() => setAbrindo(false), 800); };
    const limite = setTimeout(() => setAbrindo(false), 60_000);
    const el = ref.current;
    const cancelou = () => setAbrindo(false);
    window.addEventListener("focus", voltou);
    el?.addEventListener("cancel", cancelou);
    return () => { window.removeEventListener("focus", voltou); el?.removeEventListener("cancel", cancelou); clearTimeout(timer); clearTimeout(limite); };
  }, [abrindo]);

  const abrir = useCallback(() => { setAbrindo(true); ref.current?.click(); }, []);
  const inputProps: InputHTMLAttributes<HTMLInputElement> & { ref: RefObject<HTMLInputElement | null> } = {
    ref,
    type: "file",
    hidden: true,
    onChange: (e) => {
      setAbrindo(false);
      const arquivos = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (arquivos.length) callback.current(arquivos);
    },
  };
  return { abrir, abrindo, inputProps };
}

const IconeArquivo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" />
  </svg>
);

export function EscolherArquivo({
  rotulo = "Escolher arquivo",
  aceita,
  multiplo = false,
  onEscolher,
  desabilitado = false,
  ocupado = false,
  textoOcupado = "Enviando…",
  arquivo,
  compacto = false,
  ajuda,
}: {
  rotulo?: string;
  aceita?: string;
  multiplo?: boolean;
  onEscolher: (arquivos: File[]) => void;
  desabilitado?: boolean;
  /** Depois de escolher: lendo, enviando… */
  ocupado?: boolean;
  textoOcupado?: string;
  /** Nome do arquivo já escolhido (mostrado ao lado do botão). */
  arquivo?: string | null;
  compacto?: boolean;
  ajuda?: string;
}) {
  const { abrir, abrindo, inputProps } = useEscolherArquivo(onEscolher);
  const esperando = abrindo || ocupado;
  return (
    <div className="ds-arquivo">
      <input {...inputProps} accept={aceita} multiple={multiplo} />
      <button
        type="button"
        className={`ds-button ds-arquivo-botao${compacto ? " compact" : ""}`}
        onClick={abrir}
        disabled={desabilitado || esperando}
        aria-busy={esperando}
      >
        {esperando ? <Carregando /> : <IconeArquivo />}
        {abrindo ? "Abrindo a janela…" : ocupado ? textoOcupado : arquivo ? "Trocar arquivo" : rotulo}
      </button>
      {arquivo && !esperando && (
        <span className="ds-arquivo-nome" title={arquivo}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
          {arquivo}
        </span>
      )}
      {ajuda && !arquivo && !esperando && <small className="ds-arquivo-ajuda">{ajuda}</small>}
    </div>
  );
}

/** Selo de botão dentro de uma área de "arrastar ou clicar": deixa claro que ali se escolhe um arquivo. */
export function ZonaBotao({ abrindo, rotulo = "Escolher arquivo" }: { abrindo: boolean; rotulo?: string }) {
  return (
    <span className="ds-zona-botao" aria-hidden>
      {abrindo ? <Carregando /> : <IconeArquivo />}
      {abrindo ? "Abrindo a janela…" : rotulo}
    </span>
  );
}
