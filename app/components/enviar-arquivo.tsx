"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "../../packages/design-system";

/**
 * Enviar arquivo dentro de um módulo: a pessoa escolhe (ou arrasta) o arquivo, a
 * plataforma lê e mostra o que entendeu, e só grava no "Confirmar". No confirmar o
 * MESMO arquivo vai de novo ao servidor, que lê outra vez — nada do que o navegador
 * mostrou é usado para gravar.
 *
 * O endpoint recebe multipart com `arquivo` e `acao` (analisar | confirmar) e
 * responde JSON; erro vem em `{ error }`.
 */
export function EnviarArquivo<T>({
  rotulo, titulo, descricao, aceita, endpoint, renderPrevia, podeConfirmar, textoConfirmar = "Confirmar e gravar", onConcluido, multiplo = false, extras,
}: {
  /** Aceita vários arquivos de uma vez (todos vão no campo `arquivo`). */
  multiplo?: boolean;
  /** Campos a mais no envio (ex.: mês de competência). */
  extras?: Record<string, string>;
  rotulo: string;
  titulo: string;
  descricao: string;
  aceita: string;
  endpoint: string;
  renderPrevia: (dados: T) => ReactNode;
  podeConfirmar: (dados: T) => boolean;
  textoConfirmar?: string;
  onConcluido: (mensagem: string) => Promise<void> | void;
}) {
  const [aberto, setAberto] = useState(false);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [analise, setAnalise] = useState<T | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<"analisar" | "confirmar" | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const fechar = () => { setAberto(false); setArquivos([]); setAnalise(null); setErro(""); setOcupado(null); };

  const enviar = async (lista: File[], acao: "analisar" | "confirmar") => {
    const corpo = new FormData();
    for (const f of lista) corpo.append("arquivo", f);
    corpo.set("acao", acao);
    for (const [k, v] of Object.entries(extras ?? {})) corpo.set(k, v);
    try {
      const res = await fetch(endpoint, { method: "POST", body: corpo, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false as const, error: json?.error === "FORBIDDEN" ? "Sem permissão para enviar este arquivo." : json?.error === "FINANCE_UNAVAILABLE" ? "O servidor não respondeu; tente de novo." : json?.error || "Não foi possível ler o arquivo." };
      return { ok: true as const, data: json };
    } catch {
      return { ok: false as const, error: "Sem conexão com o servidor." };
    }
  };

  const escolher = async (lista: FileList | File[] | null | undefined) => {
    const escolhidos = Array.from(lista ?? []).slice(0, multiplo ? 40 : 1);
    if (!escolhidos.length) return;
    setArquivos(escolhidos); setAnalise(null); setErro(""); setOcupado("analisar");
    const r = await enviar(escolhidos, "analisar");
    setOcupado(null);
    if (!r.ok) { setErro(r.error); return; }
    setAnalise(r.data as T);
  };

  const confirmar = async () => {
    if (!arquivos.length) return;
    setErro(""); setOcupado("confirmar");
    const r = await enviar(arquivos, "confirmar");
    setOcupado(null);
    if (!r.ok) { setErro(r.error); return; }
    fechar();
    await onConcluido(String((r.data as { mensagem?: string }).mensagem ?? "Arquivo gravado."));
  };

  return (
    <>
      <Button variant="secondary" compact onClick={() => setAberto(true)}>{rotulo}</Button>
      {aberto && (
        <Modal eyebrow="Enviar arquivo" title={titulo} subtitle={arquivos.length === 1 ? arquivos[0].name : arquivos.length ? `${arquivos.length} arquivos` : undefined} onClose={fechar}>
          <div className="almox-form arq-envio">
            {!analise && (
              <div
                className={`arq-zona ${arrastando ? "on" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => input.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastando(false); void escolher(e.dataTransfer.files); }}
              >
                <b>{ocupado === "analisar" ? (arquivos.length > 1 ? `Lendo ${arquivos.length} arquivos…` : "Lendo o arquivo…") : multiplo ? "Arraste os arquivos aqui ou clique para escolher" : "Arraste o arquivo aqui ou clique para escolher"}</b>
                <small>{descricao}</small>
                <input ref={input} type="file" accept={aceita} multiple={multiplo} hidden onChange={(e) => { void escolher(e.target.files); e.target.value = ""; }} />
              </div>
            )}
            {analise && <div className="arq-previa">{renderPrevia(analise)}</div>}
            {erro && <p className="almox-erro" role="alert">{erro}</p>}
            <footer>
              <Button variant="secondary" onClick={fechar} disabled={ocupado === "confirmar"}>Cancelar</Button>
              {analise && <Button variant="secondary" onClick={() => { setAnalise(null); setArquivos([]); setErro(""); }} disabled={!!ocupado}>{multiplo ? "Outros arquivos" : "Outro arquivo"}</Button>}
              {analise && <Button onClick={() => void confirmar()} disabled={!!ocupado || !podeConfirmar(analise)}>{ocupado === "confirmar" ? "Gravando…" : textoConfirmar}</Button>}
            </footer>
          </div>
        </Modal>
      )}
    </>
  );
}
