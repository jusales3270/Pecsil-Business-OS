"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Callout, Card, Modal, Status } from "../../packages/design-system";
import { useSoltarArquivo } from "./enviar-arquivo";

/**
 * Fundação › Documentos (Segundo Cérebro, Etapa 1): os documentos de cada setor, com a
 * mesma trava de permissão das telas. Os originais de extratos e notas entram sozinhos
 * (decisão D3); aqui também se envia documento à mão, nova versão e arquiva. O RH
 * continua na guarda dele (Recursos Humanos › Documentos).
 */

type Documento = {
  id: string; module_code: string; feature_code: string; title: string; category: string | null; original_name: string;
  mime_type: string | null; size_bytes: number; version: number; previous_id: string | null; source: string;
  entity_type: string | null; entity_id: string | null; uploaded_by_name: string | null; created_at: string;
};
type Setor = { modulo: string; rotulo: string };
type Lista = { documentos: Documento[]; setores: Setor[]; envio: Setor[]; isOwner: boolean };

const ORIGEM: Record<string, string> = { envio: "Enviado à mão", extrato: "Extrato bancário", nota: "Nota fiscal", recebimento: "Recebimento do Almoxarifado", coleta: "Coleta de arquivos" };
const LIGACAO: Record<string, string> = { fiscal_icms_entry: "ligado ao Painel do ICMS", receipt: "ligado ao recebimento" };
const quando = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const tamanho = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function DocumentosSetorView({ notify }: { notify: (msg: string) => void }) {
  const [setor, setSetor] = useState("");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState<"" | "sem-acesso" | string>("");
  const [enviando, setEnviando] = useState(false);
  const [historico, setHistorico] = useState<Documento | null>(null);
  const [arquivar, setArquivar] = useState<Documento | null>(null);
  const versaoInput = useRef<HTMLInputElement>(null);
  const [versaoDe, setVersaoDe] = useState<Documento | null>(null);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams();
    if (setor) params.set("setor", setor);
    if (busca.trim()) params.set("busca", busca.trim());
    const res = await fetch(`/api/documentos?${params}`, { cache: "no-store" }).catch(() => null);
    if (!res) { setErro("Sem conexão com o servidor."); return; }
    if (res.status === 403) { setErro("sem-acesso"); return; }
    if (!res.ok) { setErro("Não foi possível carregar os documentos."); return; }
    setErro("");
    setLista(await res.json());
  }, [setor, busca]);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  const enviarVersao = async (file: File | undefined) => {
    if (!file || !versaoDe) return;
    const corpo = new FormData();
    corpo.set("arquivo", file);
    const res = await fetch(`/api/documentos/${versaoDe.id}/versao`, { method: "POST", body: corpo, cache: "no-store" }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setVersaoDe(null);
    if (!res?.ok) { notify(body?.error ?? "Não foi possível guardar a nova versão."); return; }
    notify(body?.mensagem ?? "Nova versão guardada.");
    await carregar();
  };

  const rotulo = (modulo: string) => lista?.setores.find((s) => s.modulo === modulo)?.rotulo ?? modulo;

  return (
    <div className="doc-setor">
      <div className="page-head">
        <div>
          <p className="eyebrow">FUNDAÇÃO · DOCUMENTOS</p>
          <h1>Documentos dos setores</h1>
          <p>Os arquivos de cada setor, guardados na plataforma com a mesma permissão das telas. Os originais de extratos e notas entram sozinhos quando são lançados.</p>
        </div>
        {lista && lista.envio.length > 0 && <Button onClick={() => setEnviando(true)}>Enviar documento</Button>}
      </div>

      <Callout variant="info" title="Documentos de colaboradores">Ficam em Recursos Humanos › Documentos, com acesso só do RH.</Callout>

      {erro === "sem-acesso" ? (
        <Card className="md-card"><div className="user-admin-empty"><b>Nenhum setor liberado para você aqui</b><small>Seus documentos estão em Recursos Humanos › Documentos.</small></div></Card>
      ) : (
        <Card className="md-card">
          <div className="md-toolbar doc-filtros">
            <label className="doc-campo"><span>Setor</span>
              <select value={setor} onChange={(e) => setSetor(e.target.value)} aria-label="Setor">
                <option value="">Todos os meus setores</option>
                {(lista?.setores ?? []).map((s) => <option key={s.modulo} value={s.modulo}>{s.rotulo}</option>)}
              </select>
            </label>
            <input className="doc-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, título ou categoria" aria-label="Buscar documento" />
          </div>
          {erro && <p className="user-admin-error">{erro}</p>}
          {!lista && !erro && <p className="doc-vazio">Carregando…</p>}
          {lista && !lista.documentos.length && (
            <div className="user-admin-empty"><b>Nenhum documento {busca || setor ? "neste filtro" : "guardado ainda"}</b><small>Extratos e notas lançados passam a guardar o original aqui. Use &ldquo;Enviar documento&rdquo; para o resto.</small></div>
          )}
          <div className="doc-lista">
            {lista?.documentos.map((d) => {
              const podeMexer = lista.isOwner || lista.envio.some((s) => s.modulo === d.module_code);
              return (
                <article key={d.id} className="doc-item">
                  <div className="doc-principal">
                    <b title={d.original_name}>{d.title}</b>
                    <small>{d.original_name} · {tamanho(Number(d.size_bytes))}{d.version > 1 ? ` · versão ${d.version}` : ""}</small>
                    <small>{ORIGEM[d.source] ?? d.source}{d.entity_type && LIGACAO[d.entity_type] ? ` · ${LIGACAO[d.entity_type]}` : ""} · {d.uploaded_by_name ?? "—"} em {quando(d.created_at)}</small>
                  </div>
                  <div className="doc-marcas">
                    <Status tone="info">{rotulo(d.module_code)}</Status>
                    {d.category && <Status tone="neutral">{d.category}</Status>}
                  </div>
                  <div className="doc-acoes">
                    <a className="doc-link" href={`/api/documentos/${d.id}/baixar`} target="_blank" rel="noopener">Baixar</a>
                    {d.version > 1 && <button type="button" className="doc-link" onClick={() => setHistorico(d)}>Histórico</button>}
                    {podeMexer && <button type="button" className="doc-link" onClick={() => { setVersaoDe(d); setTimeout(() => versaoInput.current?.click(), 0); }}>Nova versão</button>}
                    {podeMexer && <button type="button" className="doc-link perigo" onClick={() => setArquivar(d)}>Arquivar</button>}
                  </div>
                </article>
              );
            })}
          </div>
          <input ref={versaoInput} type="file" hidden onChange={(e) => { void enviarVersao(e.target.files?.[0]); e.target.value = ""; }} />
        </Card>
      )}

      {enviando && lista && <EnviarDocumento setores={lista.envio} setorInicial={setor} onClose={() => setEnviando(false)} onFeito={async (msg) => { setEnviando(false); notify(msg); await carregar(); }} />}
      {historico && <Historico doc={historico} onClose={() => setHistorico(null)} />}
      {arquivar && (
        <Modal eyebrow="Documentos" title={`Arquivar "${arquivar.title}"?`} subtitle="Some da lista. O arquivo e o histórico continuam guardados." onClose={() => setArquivar(null)}>
          <div className="almox-form"><footer>
            <Button variant="secondary" onClick={() => setArquivar(null)}>Voltar</Button>
            <Button className="almox-perigo-cheio" onClick={async () => {
              const res = await fetch(`/api/documentos/${arquivar.id}/arquivar`, { method: "POST" }).catch(() => null);
              const body = await res?.json().catch(() => ({}));
              setArquivar(null);
              notify(res?.ok ? "Documento arquivado." : body?.error ?? "Não foi possível arquivar.");
              await carregar();
            }}>Arquivar</Button>
          </footer></div>
        </Modal>
      )}
    </div>
  );
}

function EnviarDocumento({ setores, setorInicial, onClose, onFeito }: { setores: Setor[]; setorInicial: string; onClose: () => void; onFeito: (msg: string) => Promise<void> }) {
  const [setor, setSetor] = useState(setores.some((s) => s.modulo === setorInicial) ? setorInicial : setores[0]?.modulo ?? "");
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { arrastando, soltar } = useSoltarArquivo((lista) => setArquivo(lista[0] ?? null), !salvando);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arquivo) { setErro("Escolha o arquivo."); return; }
    if (arquivo.size > 9_500_000) { setErro("O arquivo passa de 9,5 MB."); return; }
    setSalvando(true);
    const corpo = new FormData();
    corpo.set("arquivo", arquivo);
    corpo.set("setor", setor);
    if (titulo.trim()) corpo.set("titulo", titulo.trim());
    if (categoria.trim()) corpo.set("categoria", categoria.trim());
    const res = await fetch("/api/documentos", { method: "POST", body: corpo, cache: "no-store" }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setSalvando(false);
    if (!res?.ok) { setErro(body?.error ?? "Não foi possível guardar o documento."); return; }
    await onFeito(body?.mensagem ?? "Documento guardado.");
  };

  return (
    <Modal eyebrow="Documentos" title="Enviar documento" subtitle="O arquivo fica guardado no setor escolhido, visível só para quem tem acesso a ele." onClose={onClose}>
      <form className="almox-form" onSubmit={enviar}>
        <div className={`almox-arquivo ${arrastando ? "on" : ""}`} {...soltar}>
          <input ref={input} type="file" hidden onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={salvando}>
            <b>{arquivo ? arquivo.name : "Arraste o arquivo aqui ou clique para escolher"}</b>
            <small>PDF, planilha, Word, imagem, XML… até 9,5 MB.</small>
          </button>
        </div>
        <div className="almox-campos">
          <label><span>Setor</span>
            <select value={setor} onChange={(e) => setSetor(e.target.value)}>{setores.map((s) => <option key={s.modulo} value={s.modulo}>{s.rotulo}</option>)}</select>
          </label>
          <label className="almox-largo"><span>Título (opcional)</span><input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Contrato de manutenção do forno 2026" maxLength={200} /></label>
          <label><span>Categoria (opcional)</span><input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex.: Contrato" maxLength={60} /></label>
        </div>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando || !arquivo}>{salvando ? "Guardando…" : "Guardar documento"}</Button>
        </footer>
      </form>
    </Modal>
  );
}

function Historico({ doc, onClose }: { doc: Documento; onClose: () => void }) {
  const [versoes, setVersoes] = useState<Documento[] | null>(null);
  useEffect(() => {
    let ativo = true;
    fetch(`/api/documentos?historico=${doc.id}`, { cache: "no-store" }).then((r) => r.json()).then((b) => { if (ativo) setVersoes(b.versoes ?? []); }).catch(() => { if (ativo) setVersoes([]); });
    return () => { ativo = false; };
  }, [doc.id]);
  return (
    <Modal eyebrow="Documentos · histórico" title={doc.title} subtitle="Todas as versões guardadas, da mais recente para a mais antiga." onClose={onClose}>
      <div className="doc-versoes">
        {!versoes && <p className="doc-vazio">Carregando…</p>}
        {versoes?.map((v) => (
          <p key={v.id}><b>Versão {v.version}</b> · {v.original_name} · {tamanho(Number(v.size_bytes))} · {v.uploaded_by_name ?? "—"} em {quando(v.created_at)} · <a className="doc-link" href={`/api/documentos/${v.id}/baixar`} target="_blank" rel="noopener">Baixar</a></p>
        ))}
      </div>
    </Modal>
  );
}
