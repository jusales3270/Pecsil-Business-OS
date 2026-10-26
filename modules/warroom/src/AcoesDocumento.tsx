"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Modal } from "../../../packages/design-system";

/**
 * Abrir, imprimir e enviar um documento em PDF da SARA central (War Room › Conselho: Crescimento e Documentos).
 * Enviar: a uma pessoa da empresa pela plataforma (sino e "Documentos para você") ou a qualquer contato das listas
 * do WhatsApp (pessoas da empresa, fornecedores, clientes). O clique em Enviar é a confirmação; contato de fora
 * pede uma confirmação a mais. Só quem criou o documento envia.
 */
type Contato = { contato: string; nome: string; final: string; lista: "interna" | "externa"; canal: string };
type Destinos = { pessoas: { id: string; nome: string }[]; whatsapp: Contato[] };

const pdf = (id: string) => `/api/sara/documentos/${id}/pdf`;
// Safari e iPhone/iPad não imprimem o PDF de dentro de um quadro: lá ele abre numa aba, com o Imprimir do sistema.
const semQuadro = () => /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent) || /iPad|iPhone|iPod/.test(navigator.userAgent);

function imprimir(id: string) {
  if (semQuadro()) { window.open(pdf(id), "_blank", "noopener"); return; }
  document.querySelector("iframe.doc-imprimir")?.remove();
  const quadro = document.createElement("iframe");
  quadro.className = "doc-imprimir";
  quadro.title = "Imprimir o documento";
  quadro.setAttribute("aria-hidden", "true");
  quadro.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  quadro.onload = () => {
    try { quadro.contentWindow?.focus(); quadro.contentWindow?.print(); } catch { window.open(pdf(id), "_blank", "noopener"); }
  };
  quadro.src = pdf(id);
  document.body.appendChild(quadro);
}

export function AcoesDocumento({ id, numero, titulo, podeEnviar, onEnviado }: { id: string; numero: string; titulo: string; podeEnviar: boolean; onEnviado?: () => void }) {
  const [enviar, setEnviar] = useState(false);
  return (
    <div className="doc-acoes">
      <a className="ds-button secondary compact" href={pdf(id)} target="_blank" rel="noopener noreferrer">Abrir o PDF ↗</a>
      <Button type="button" variant="secondary" compact onClick={() => imprimir(id)}>Imprimir</Button>
      {podeEnviar && <Button type="button" variant="secondary" compact onClick={() => setEnviar(true)}>Enviar…</Button>}
      {enviar && <EnviarDocumento id={id} numero={numero} titulo={titulo} onClose={() => setEnviar(false)} onEnviado={onEnviado} />}
    </div>
  );
}

function EnviarDocumento({ id, numero, titulo, onClose, onEnviado }: { id: string; numero: string; titulo: string; onClose: () => void; onEnviado?: () => void }) {
  const [destinos, setDestinos] = useState<Destinos | null>(null);
  const [canal, setCanal] = useState<"plataforma" | "whatsapp">("plataforma");
  const [para, setPara] = useState("");
  const [confirmaFora, setConfirmaFora] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");

  useEffect(() => {
    let vivo = true;
    void fetch(`/api/sara/documentos/${id}/enviar`, { cache: "no-store" }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => null) })).then(({ ok, j }) => {
      if (!vivo) return;
      if (!ok || !j) setErro(j?.error ?? "Não foi possível carregar para quem enviar."); else setDestinos(j as Destinos);
    }).catch(() => vivo && setErro("Não foi possível carregar para quem enviar."));
    return () => { vivo = false; };
  }, [id]);

  const contato = canal === "whatsapp" ? destinos?.whatsapp.find((c) => c.contato === para) : undefined;
  const fora = contato?.lista === "externa";
  const pronto = Boolean(para) && (!fora || confirmaFora) && !enviando && !feito;

  const trocarCanal = (c: "plataforma" | "whatsapp") => { setCanal(c); setPara(""); setConfirmaFora(false); setErro(""); };
  const mandar = async (e: FormEvent) => {
    e.preventDefault();
    if (!pronto) return;
    setEnviando(true); setErro("");
    const r = await fetch(`/api/sara/documentos/${id}/enviar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canal, para }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setEnviando(false);
    if (!r?.ok) { setErro(j?.error ?? "Não foi possível enviar agora."); return; }
    setFeito(String(j?.feito ?? "Enviado.")); onEnviado?.();
  };

  const internos = destinos?.whatsapp.filter((c) => c.lista === "interna") ?? [];
  const externos = destinos?.whatsapp.filter((c) => c.lista === "externa") ?? [];
  return (
    <Modal eyebrow={`Documento ${numero}`} title="Enviar o documento" subtitle={titulo} onClose={onClose}>
      <form className="almox-form doc-envio" onSubmit={mandar}>
        <fieldset className="doc-envio-canal">
          <legend>Por onde</legend>
          <label><input type="radio" name="canal" checked={canal === "plataforma"} onChange={() => trocarCanal("plataforma")} /> Pela plataforma <small>aviso no sino e em &ldquo;Documentos para você&rdquo;</small></label>
          <label><input type="radio" name="canal" checked={canal === "whatsapp"} onChange={() => trocarCanal("whatsapp")} /> Pelo WhatsApp <small>chega como PDF no celular</small></label>
        </fieldset>
        {!destinos && !erro && <p className="vigia-vazio">Carregando para quem enviar…</p>}
        {destinos && canal === "plataforma" && (
          <label><span>Para quem (pessoa da empresa)</span>
            <span className="doc-envio-select">
              <select value={para} onChange={(e) => setPara(e.target.value)} required>
                <option value="">Escolha a pessoa</option>
                {destinos.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </span>
          </label>
        )}
        {destinos && canal === "whatsapp" && (destinos.whatsapp.length ? (
          <label><span>Para quem (listas do WhatsApp)</span>
            <span className="doc-envio-select">
              <select value={para} onChange={(e) => { setPara(e.target.value); setConfirmaFora(false); }} required>
                <option value="">Escolha o contato</option>
                {internos.length > 0 && <optgroup label="Pessoas da empresa">{internos.map((c) => <option key={c.contato} value={c.contato}>{c.nome} · final {c.final}</option>)}</optgroup>}
                {externos.length > 0 && <optgroup label="Contatos de fora (fornecedores, clientes)">{externos.map((c) => <option key={c.contato} value={c.contato}>{c.nome} · final {c.final}</option>)}</optgroup>}
              </select>
            </span>
          </label>
        ) : <p className="vigia-vazio">Nenhum contato nas listas do WhatsApp. O proprietário cadastra em Fundação › WhatsApp.</p>)}
        {fora && (
          <label className="doc-envio-fora">
            <input type="checkbox" checked={confirmaFora} onChange={(e) => setConfirmaFora(e.target.checked)} />
            <span>{contato?.nome} é de fora da empresa. Confirmo que este documento pode sair para ele.</span>
          </label>
        )}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        {feito && <p className="doc-envio-feito" role="status">{feito}</p>}
        <footer>
          <Button type="button" variant="ghost" onClick={onClose}>{feito ? "Fechar" : "Cancelar"}</Button>
          {!feito && <Button type="submit" disabled={!pronto}>{enviando ? "Enviando…" : "Enviar"}</Button>}
        </footer>
      </form>
    </Modal>
  );
}
