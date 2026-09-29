"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NOVIDADES, novidadesNovas, type Novidade } from "../../lib/novidades";

/**
 * Aviso "Nova versão disponível".
 *
 * Um app aberto (aba, atalho instalado no computador ou app no celular) segue
 * rodando a versão com que foi carregado — no celular o sistema quase nunca o
 * fecha de verdade. Aqui o app pergunta ao servidor qual versão está no ar ao
 * abrir, ao voltar para a tela e a cada poucos minutos; se mudou, mostra o
 * aviso. Não recarrega sozinho: quem está no meio de um registro termina e
 * atualiza quando quiser.
 *
 * Ao clicar em Atualizar, a janela "O que há de novo" mostra o que a versão no
 * ar traz a mais que esta (lib/novidades.ts), e só então recarrega.
 */

const VERSAO_CARREGADA = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
/** Ids das novidades que a pessoa já viu neste aparelho. */
const CHAVE_VISTAS = "pecsil_novidades_vistas";

function lerVistas(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_VISTAS) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function marcarVistas(ids: string[]) {
  try {
    localStorage.setItem(CHAVE_VISTAS, JSON.stringify([...new Set([...lerVistas(), ...ids])]));
  } catch {
    // Sem armazenamento local: a janela pode reaparecer, nada além disso.
  }
}
const INTERVALO_MS = 5 * 60_000;
const REAVISAR_MS = 30 * 60_000;

export function UpdateNotice() {
  const [disponivel, setDisponivel] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [novidades, setNovidades] = useState<Novidade[] | null>(null);
  // "depois": aberta ao entrar numa versão nova (quem atualizou pelo botão antigo
  // ou recarregou a página) — só informa. "antes": aberta pelo botão Atualizar.
  const [modo, setModo] = useState<"antes" | "depois">("antes");

  useEffect(() => {
    // Só dentro da plataforma: na tela de login a pessoa ainda nem entrou.
    if (window.location.pathname.startsWith("/login")) return;
    const vistas = new Set(lerVistas());
    const naoVistas = NOVIDADES.filter((n) => !vistas.has(n.id));
    if (!naoVistas.length) return;
    const mostrar = window.setTimeout(() => {
      setModo("depois");
      setNovidades(naoVistas);
    }, 1500);
    return () => window.clearTimeout(mostrar);
  }, []);
  const adiadoAte = useRef(0);

  const verificar = useCallback(async () => {
    if (!VERSAO_CARREGADA || document.visibilityState === "hidden") return;
    try {
      const resposta = await fetch("/api/version", { cache: "no-store" });
      if (!resposta.ok) return;
      const { version } = (await resposta.json()) as { version: string | null };
      if (version && version !== VERSAO_CARREGADA && Date.now() >= adiadoAte.current) {
        setDisponivel(true);
        // Já baixa o service worker novo, para a atualização ser imediata.
        navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
      }
    } catch {
      // Sem conexão: tenta de novo na próxima vez.
    }
  }, []);

  useEffect(() => {
    const inicial = window.setTimeout(verificar, 3000);
    const intervalo = window.setInterval(verificar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === "visible") verificar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", verificar);
    window.addEventListener("online", verificar);
    return () => {
      window.clearTimeout(inicial);
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", verificar);
      window.removeEventListener("online", verificar);
    };
  }, [verificar]);

  /** Busca na versão nova o que ela traz e abre a janela antes de recarregar. */
  const mostrarNovidades = async () => {
    setAtualizando(true);
    try {
      const resposta = await fetch("/api/novidades", { cache: "no-store" });
      if (!resposta.ok) throw new Error();
      const { novidades: doServidor } = (await resposta.json()) as { novidades: Novidade[] };
      setModo("antes");
      setNovidades(novidadesNovas(doServidor ?? [], NOVIDADES));
    } catch {
      // Sem a lista, não segura a atualização.
      await atualizar();
      return;
    }
    setAtualizando(false);
  };

  const atualizar = async () => {
    setAtualizando(true);
    // O que foi mostrado aqui não reaparece depois de recarregar.
    if (novidades) marcarVistas([...NOVIDADES, ...novidades].map((n) => n.id));
    try {
      const registro = await navigator.serviceWorker?.getRegistration();
      await registro?.update();
      registro?.waiting?.postMessage({ type: "SKIP_WAITING" });
    } catch {
      // Segue para o recarregamento mesmo assim.
    }
    window.location.reload();
  };

  const depois = () => {
    adiadoAte.current = Date.now() + REAVISAR_MS;
    setDisponivel(false);
  };

  const fecharDepois = () => {
    marcarVistas(NOVIDADES.map((n) => n.id));
    setNovidades(null);
  };

  if (novidades && modo === "depois") {
    return (
      <div className="ds-modal-layer" role="presentation">
        <div className="ds-modal novidades-modal" role="dialog" aria-modal="true" aria-labelledby="novidades-titulo">
          <header>
            <div>
              <p className="eyebrow">Plataforma atualizada</p>
              <h2 id="novidades-titulo">O que há de novo</h2>
            </div>
          </header>
          <div className="ds-modal-body">
            <ListaNovidades itens={novidades} />
          </div>
          <footer className="novidades-acoes">
            <button type="button" className="ds-button primary" onClick={fecharDepois} autoFocus>Entendi</button>
          </footer>
        </div>
      </div>
    );
  }

  if (!disponivel) return null;

  if (novidades) {
    return (
      <div className="ds-modal-layer" role="presentation">
        <div className="ds-modal novidades-modal" role="dialog" aria-modal="true" aria-labelledby="novidades-titulo">
          <header>
            <div>
              <p className="eyebrow">Nova versão</p>
              <h2 id="novidades-titulo">O que há de novo</h2>
            </div>
          </header>
          <div className="ds-modal-body">
            <ListaNovidades itens={novidades} />
          </div>
          <footer className="novidades-acoes">
            <button type="button" className="update-notice-later" onClick={() => setNovidades(null)} disabled={atualizando}>Agora não</button>
            <button type="button" className="ds-button primary" onClick={atualizar} disabled={atualizando} autoFocus>
              {atualizando ? "Atualizando…" : "Atualizar agora"}
            </button>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <span className="update-notice-dot" aria-hidden />
      <div>
        <b>Nova versão disponível</b>
        <small>Atualize para usar as últimas melhorias.</small>
      </div>
      <button type="button" className="update-notice-later" onClick={depois} disabled={atualizando}>Depois</button>
      <button type="button" className="ds-button primary compact" onClick={mostrarNovidades} disabled={atualizando}>
        {atualizando ? "Atualizando…" : "Atualizar"}
      </button>
    </div>
  );
}

function ListaNovidades({ itens }: { itens: Novidade[] }) {
  if (!itens.length) return <p className="novidades-vazio">Correções e melhorias internas, sem mudança no jeito de usar.</p>;
  return (
    <>
      {itens.map((n) => (
        <section key={n.id} className="novidades-item">
          <span className="novidades-area">{n.area}</span>
          <h3>{n.titulo}</h3>
          <ul>
            {n.itens.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ))}
    </>
  );
}
