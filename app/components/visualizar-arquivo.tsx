"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Carregando, Modal, Segmented } from "../../packages/design-system";

/**
 * Ver um arquivo sem sair da plataforma (janela por cima da tela). `url` devolve o conteúdo pela própria
 * plataforma (a rota confere a permissão e registra o acesso); `baixar` é o link de download.
 *   PDF e imagem → o próprio arquivo;
 *   XML de NF-e → o DANFE (com `danfe`: o PDF gerado pela plataforma), o resumo da nota e o XML formatado;
 *   XML de evento da NF-e (carta de correção, cancelamento) → o que o evento diz;
 *   outro tipo → aviso e o botão de baixar.
 * O XML nunca é interpretado como página: é lido como texto e mostrado como texto.
 */

type Conteudo =
  | { tipo: "pdf" | "imagem"; url: string }
  | { tipo: "xml"; texto: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "outro" };

const MOEDA = (v: string | null) => (v === null || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const DATA = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const DOC = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : v ?? "—";
};
const EVENTOS: Record<string, string> = { "110110": "Carta de correção", "110111": "Cancelamento", "110112": "Cancelamento por substituição", "210200": "Confirmação da operação", "210210": "Ciência da operação", "210220": "Desconhecimento da operação", "210240": "Operação não realizada" };
const FINALIDADE: Record<string, string> = { "1": "Normal", "2": "Complementar", "3": "Ajuste", "4": "Devolução" };

function tipoPelo(nome: string, contentType: string): Conteudo["tipo"] {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf" || contentType.includes("pdf")) return "pdf";
  if (["png", "jpg", "jpeg"].includes(ext) || contentType.startsWith("image/")) return "imagem";
  if (ext === "xml") return "xml";
  if (["txt", "csv"].includes(ext)) return "texto";
  return "outro";
}

/** XML com recuo, uma marca por linha (só para leitura). */
export function xmlFormatado(xml: string): string {
  const partes = xml.replace(/>\s*</g, ">\n<").split("\n");
  let nivel = 0;
  return partes.map((linha) => {
    const t = linha.trim();
    if (/^<\//.test(t)) nivel = Math.max(0, nivel - 1);
    const saida = `${"  ".repeat(nivel)}${t}`;
    if (/^<[^!?/][^>]*[^/]>$/.test(t) && !/^<[^>]+>[^<]*<\//.test(t)) nivel++;
    return saida;
  }).join("\n");
}

function ResumoXml({ texto }: { texto: string }) {
  const doc = useMemo(() => new DOMParser().parseFromString(texto, "application/xml"), [texto]);
  const um = (raiz: Element | Document | null | undefined, nome: string) => raiz?.getElementsByTagName(nome)[0] ?? null;
  const val = (raiz: Element | Document | null | undefined, nome: string) => um(raiz, nome)?.textContent?.trim() ?? null;
  const erro = doc.getElementsByTagName("parsererror").length > 0;
  const inf = um(doc, "infNFe");
  const evento = !inf ? um(doc, "infEvento") : null;
  if (erro || (!inf && !evento)) return null;

  if (evento) {
    const tp = val(evento, "tpEvento") ?? "";
    const chave = val(evento, "chNFe");
    return (
      <section className="arq-vis-resumo">
        <div className="arq-vis-cabeca"><b>{EVENTOS[tp] ?? `Evento ${tp}`}{chave ? ` da NF ${Number(chave.slice(25, 34))}` : ""}</b><small>Sequência {val(evento, "nSeqEvento") ?? "—"} · {DATA(val(evento, "dhEvento"))}{val(doc, "cStat") ? ` · situação na SEFAZ ${val(doc.getElementsByTagName("retEvento")[0] ?? doc, "cStat")}` : ""}</small></div>
        {(val(evento, "xCorrecao") || val(evento, "xJust")) && <p className="arq-vis-texto">{val(evento, "xCorrecao") ?? val(evento, "xJust")}</p>}
        {chave && <small className="arq-vis-chave">Chave da nota: {chave}</small>}
      </section>
    );
  }
  const ide = um(inf, "ide"), emit = um(inf, "emit"), dest = um(inf, "dest"), tot = um(inf, "ICMSTot"), prot = um(doc, "infProt");
  const itens = Array.from(inf!.getElementsByTagName("det")).map((d) => {
    const p = um(d, "prod");
    return { n: d.getAttribute("nItem") ?? "", desc: val(p, "xProd"), cfop: val(p, "CFOP"), ncm: val(p, "NCM"), q: val(p, "qCom"), u: val(p, "uCom"), v: val(p, "vProd"), ped: val(p, "xPed") };
  });
  const chave = inf!.getAttribute("Id")?.replace(/^NFe/, "") ?? null;
  return (
    <section className="arq-vis-resumo">
      <div className="arq-vis-cabeca">
        <b>NF-e {val(ide, "nNF") ?? "—"}{val(ide, "serie") ? ` · série ${val(ide, "serie")}` : ""} · {val(ide, "tpNF") === "0" ? "entrada" : "saída"}</b>
        <small>{DATA(val(ide, "dhEmi") ?? val(ide, "dEmi"))} · {val(ide, "natOp") ?? "—"} · finalidade {FINALIDADE[val(ide, "finNFe") ?? ""] ?? "—"}{prot ? ` · autorizada (${val(prot, "cStat")})` : " · sem protocolo de autorização"}</small>
      </div>
      <div className="arq-vis-partes">
        <div><small>Emitente</small><b>{val(emit, "xNome") ?? "—"}</b><span>{DOC(val(emit, "CNPJ") ?? val(emit, "CPF"))}{val(emit, "UF") ? ` · ${val(emit, "UF")}` : ""}</span></div>
        <div><small>Destinatário</small><b>{val(dest, "xNome") ?? "—"}</b><span>{DOC(val(dest, "CNPJ") ?? val(dest, "CPF") ?? val(dest, "idEstrangeiro"))}{val(dest, "UF") ? ` · ${val(dest, "UF")}` : ""}</span></div>
        <div><small>Valor da nota</small><b>{MOEDA(val(tot, "vNF"))}</b><span>Produtos {MOEDA(val(tot, "vProd"))} · ICMS {MOEDA(val(tot, "vICMS"))} · IPI {MOEDA(val(tot, "vIPI"))}{Number(val(tot, "vFrete")) ? ` · frete ${MOEDA(val(tot, "vFrete"))}` : ""}</span></div>
      </div>
      <div className="arq-vis-itens" role="table" aria-label="Itens da nota">
        <div className="cabeca" role="row"><span>#</span><span>Descrição</span><span>CFOP</span><span className="r">Qtd.</span><span className="r">Valor</span></div>
        {itens.map((i) => (
          <div role="row" key={i.n}>
            <span>{i.n}</span>
            <span className="desc">{i.desc ?? "—"}<small>NCM {i.ncm ?? "—"}{i.ped ? ` · pedido ${i.ped}` : ""}</small></span>
            <span>{i.cfop ?? "—"}</span>
            <span className="r">{i.q ? Number(i.q).toLocaleString("pt-BR") : "—"} {i.u ?? ""}</span>
            <span className="r">{MOEDA(i.v)}</span>
          </div>
        ))}
      </div>
      {chave && <small className="arq-vis-chave">Chave de acesso: {chave}</small>}
    </section>
  );
}

type Aba = "danfe" | "resumo" | "xml";

/** DANFE em PDF, buscado só quando a aba abre. */
function Danfe({ url, nome, onFalha }: { url: string; nome: string; onFalha: (m: string) => void }) {
  const [pdf, setPdf] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let objeto: string | null = null;
    (async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error || "O DANFE não pôde ser gerado agora."); }
        objeto = URL.createObjectURL(await r.blob());
        if (vivo) setPdf(objeto);
      } catch (e) {
        if (vivo) onFalha(e instanceof Error ? e.message : "O DANFE não pôde ser gerado agora.");
      }
    })();
    return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto); };
  }, [url, onFalha]);
  return pdf ? <iframe className="arq-vis-pdf" src={pdf} title={`DANFE de ${nome}`} /> : <div className="arq-vis-carregando"><Carregando /> Montando o DANFE…</div>;
}

export function VisualizarArquivo({ nome, url, baixar, danfe, detalhe, onFechar }: { nome: string; url: string; baixar: string; danfe?: string; detalhe?: string; onFechar: () => void }) {
  const [conteudo, setConteudo] = useState<Conteudo | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba | null>(null);
  const [falhaDanfe, setFalhaDanfe] = useState("");
  const aoFalharDanfe = useCallback((m: string) => { setFalhaDanfe(m); setAba("resumo"); }, []);

  useEffect(() => {
    let vivo = true;
    let objeto: string | null = null;
    (async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error || "Não foi possível abrir o arquivo."); }
        const tipo = tipoPelo(nome, r.headers.get("content-type") ?? "");
        if (tipo === "pdf" || tipo === "imagem") { objeto = URL.createObjectURL(await r.blob()); if (vivo) setConteudo({ tipo, url: objeto }); }
        else if (tipo === "xml" || tipo === "texto") { const texto = await r.text(); if (vivo) setConteudo({ tipo, texto }); }
        else if (vivo) setConteudo({ tipo: "outro" });
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível abrir o arquivo.");
      }
    })();
    return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto); };
  }, [url, nome]);

  const resumo = conteudo?.tipo === "xml" ? <ResumoXml texto={conteudo.texto} /> : null;
  // NF-e com o DANFE disponível abre no DANFE; evento e XML que não é nota abrem no resumo (ou no XML).
  const ehNfe = conteudo?.tipo === "xml" && /<(\w+:)?infNFe[\s>]/.test(conteudo.texto);
  const abas: Aba[] = conteudo?.tipo === "xml" ? [...(ehNfe && danfe ? ["danfe" as const] : []), ...(resumo ? ["resumo" as const] : []), "xml"] : [];
  const atual: Aba = aba ?? abas[0] ?? "xml";
  const ROTULO: Record<Aba, string> = { danfe: "DANFE", resumo: "Resumo", xml: "XML" };
  return (
    <Modal eyebrow="Visualizar arquivo" title={nome} subtitle={detalhe} onClose={onFechar}>
      <div className="arq-visualizar">
        {!conteudo && !erro && <div className="arq-vis-carregando"><Carregando /> Abrindo o arquivo…</div>}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        {conteudo?.tipo === "pdf" && <iframe className="arq-vis-pdf" src={conteudo.url} title={nome} />}
        {conteudo?.tipo === "imagem" && <img className="arq-vis-imagem" src={conteudo.url} alt={nome} />}
        {conteudo?.tipo === "xml" && (
          <>
            {abas.length > 1 && <Segmented<Aba> options={abas.map((a) => ({ value: a, label: ROTULO[a] }))} value={atual} onChange={setAba} ariaLabel="Como ver o arquivo" compact />}
            {falhaDanfe && atual !== "danfe" && <p className="arq-vis-aviso">{falhaDanfe}</p>}
            {atual === "danfe" && danfe && <Danfe url={danfe} nome={nome} onFalha={aoFalharDanfe} />}
            {atual === "resumo" && resumo}
            {atual === "xml" && <pre className="arq-vis-codigo">{xmlFormatado(conteudo.texto)}</pre>}
          </>
        )}
        {conteudo?.tipo === "texto" && <pre className="arq-vis-codigo">{conteudo.texto}</pre>}
        {conteudo?.tipo === "outro" && <p className="arq-vis-aviso">Este tipo de arquivo não pode ser mostrado aqui. Baixe para abrir no programa certo.</p>}
        <footer>
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          <a className="ds-button primary" href={baixar} download>Baixar arquivo</a>
        </footer>
      </div>
    </Modal>
  );
}
