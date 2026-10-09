"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "../../packages/design-system";

/**
 * Modelo único dos relatórios gerados pela plataforma (PDF A4).
 *
 * Todo relatório novo usa estas peças: `ReportDocument` (barra de ações na
 * tela, documento claro, título do arquivo) e `ReportHeader` (logo da PecSil,
 * título, período e data de geração). O estilo está em
 * packages/design-system/report.css. O PDF sai pelo "Salvar como PDF" do
 * navegador, sem nada instalado no servidor.
 */

export function ReportDocument({ fileTitle, children, ready, sheetClassName = "", tip = "relatório" }: {
  fileTitle: string;
  children: ReactNode;
  ready: boolean;
  /** Classe a mais na folha (ex.: "oc-folha" para a Ordem de Compra em paisagem). */
  sheetClassName?: string;
  /** Como o documento é chamado na barra ("relatório", "ordem de compra"). */
  tip?: string;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const temaAnterior = root.dataset.theme;
    const tituloAnterior = document.title;
    // O documento é sempre claro, mesmo com o tema escuro ativo.
    root.dataset.theme = "light";
    // O título vira o nome sugerido do arquivo ao salvar como PDF. O título
    // padrão da aplicação é reaplicado pelo Next depois da montagem, então o
    // nosso é aplicado de novo quando o conteúdo fica pronto.
    document.title = fileTitle;
    return () => {
      if (temaAnterior) root.dataset.theme = temaAnterior;
      else delete root.dataset.theme;
      document.title = tituloAnterior;
    };
  }, [fileTitle, ready]);

  // Garante o título também na hora de imprimir.
  useEffect(() => {
    const aoImprimir = () => { document.title = fileTitle; };
    window.addEventListener("beforeprint", aoImprimir);
    return () => window.removeEventListener("beforeprint", aoImprimir);
  }, [fileTitle]);

  return (
    <div className="report-doc">
      <div className="report-toolbar">
        <p>Confira {tip === "relatório" ? "o" : "a"} {tip} e use <b>Baixar PDF</b>. Na janela que abrir, escolha &ldquo;Salvar como PDF&rdquo;.</p>
        <div>
          <Button variant="secondary" compact onClick={() => window.close()}>Fechar</Button>
          <Button compact disabled={!ready} onClick={() => window.print()}>Baixar PDF</Button>
        </div>
      </div>
      <div className={`report-sheet ${sheetClassName}`.trim()}>{children}</div>
    </div>
  );
}

export function ReportHeader({ title, subtitle, generatedAt }: { title: string; subtitle: string; generatedAt: Date }) {
  return (
    <header className="report-header">
      {/* eslint-disable-next-line @next/next/no-img-element -- impressão precisa da imagem direta, sem otimização */}
      <img src="/logo-pecsil.png" alt="Pecsil — Molds for Glass" />
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <p>Gerado em {generatedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}</p>
      </div>
    </header>
  );
}
