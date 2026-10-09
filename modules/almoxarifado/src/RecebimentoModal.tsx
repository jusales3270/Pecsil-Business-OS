"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Modal, Segmented } from "../../../packages/design-system";
import type { Nfe } from "../../../lib/almoxarifado/nfe-xml";
import { useSoltarArquivo } from "../../../app/components/enviar-arquivo";
import { type ACaminho, DIVISAO, Icone, chamar, date, hoje, lerNotaArquivo, money, qtd, type NotaLidaResposta } from "./tipos";

type Modo = "xml" | "manual";
type Dup = { numero: string; vencimento: string; valor: string };

const numero = (texto: string) => {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
};
const campoValor = (valor: number) => (valor ? valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

/**
 * Recebimento: o almoxarife confere o material e lança a nota — anexando o XML
 * (tudo preenchido) ou digitando. Ao confirmar, o banco cria a conta a pagar,
 * abate a previsão da compra, lança no Painel do ICMS e avisa o Financeiro.
 */
export function RecebimentoModal({ compra, inicial, onClose, onFeito }: { compra: ACaminho | null; inicial?: NotaLidaResposta; onClose: () => void; onFeito: (mensagem: string) => void }) {
  const [modo, setModo] = useState<Modo>("xml");
  const [xml, setXml] = useState<string | null>(null);
  const [doPdf, setDoPdf] = useState(false);
  const [nfe, setNfe] = useState<Nfe | null>(null);
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState("");
  const arquivo = useRef<HTMLInputElement>(null);

  // Campos da nota (preenchidos pelo XML ou digitados).
  const [fornecedor, setFornecedor] = useState(compra?.fornecedor ?? "");
  const [nf, setNf] = useState("");
  const [serie, setSerie] = useState("");
  const [chave, setChave] = useState("");
  const [emissao, setEmissao] = useState("");
  const [valor, setValor] = useState("");
  const [base, setBase] = useState("");
  const [icms, setIcms] = useState("");
  const [ipi, setIpi] = useState("");
  const [dups, setDups] = useState<Dup[]>([{ numero: "1", vencimento: compra?.previsaoVencimento ?? "", valor: "" }]);
  const [divisao, setDivisao] = useState<string>(compra?.divisao ?? "USINAGEM");

  // Conferência.
  const [recebidoEm, setRecebidoEm] = useState(hoje());
  const [conferido, setConferido] = useState(false);
  const [encerra, setEncerra] = useState(true);
  const [divergencia, setDivergencia] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const faltaReceber = compra ? Math.max(0, compra.totalComprado - compra.jaRecebido) : 0;

  /** Preenche a nota a partir do que o servidor leu (XML ou DANFE em PDF). */
  const aplicar = (lida: NotaLidaResposta) => {
    if (lida.jaRecebida) { setErro(`Esta nota já foi recebida (recebimento #${lida.jaRecebida.numero}, ${date(lida.jaRecebida.em)}).`); return; }
    const n = lida.nfe;
    setXml(lida.xml);
    setDoPdf(lida.origem === "pdf");
    setNfe(n);
    if (!compra) setFornecedor(n.emitente.fantasia || lida.fornecedor?.nome || n.emitente.nome);
    setNf(n.numero); setSerie(n.serie); setChave(n.chave); setEmissao(n.emissao);
    setValor(campoValor(n.valorNota)); setBase(campoValor(n.baseIcms)); setIcms(campoValor(n.icms)); setIpi(campoValor(n.ipi));
    setDups(n.duplicatas.length
      ? n.duplicatas.map((d) => ({ numero: d.numero, vencimento: d.vencimento, valor: campoValor(d.valor) }))
      : [{ numero: "1", vencimento: compra?.previsaoVencimento ?? "", valor: campoValor(n.valorNota) }]);
    if (compra) setEncerra(n.valorNota >= faltaReceber * 0.98);
    const avisos: string[] = [];
    if (lida.origem === "pdf") avisos.push("Nota lida do DANFE em PDF: confira valores e vencimentos (do PDF, as parcelas só vêm quando somam o total da nota).");
    if (compra?.cnpj && n.emitente.cnpj && compra.cnpj !== n.emitente.cnpj) avisos.push(`O CNPJ da nota (${n.emitente.nome}) é diferente do fornecedor da compra (${compra.fornecedor}).`);
    if (compra && Math.abs(n.valorNota - faltaReceber) > Math.max(1, faltaReceber * 0.02)) avisos.push(`A nota vale ${money(n.valorNota)} e a compra ${money(faltaReceber)}${n.ipi ? ` (a compra pode não incluir IPI de ${money(n.ipi)})` : ""}.`);
    setAviso(avisos.join(" "));
  };

  const lerArquivo = async (file: File | undefined) => {
    if (!file) return;
    setErro(""); setAviso(""); setLendo(true);
    const res = await lerNotaArquivo(file);
    setLendo(false);
    if (!res.ok) { setErro(res.error); return; }
    aplicar(res.data);
  };
  const { arrastando, soltar } = useSoltarArquivo((lista) => void lerArquivo(lista[0]), !lendo);

  // Nota já lida antes de abrir (botão "Enviar nota" do Almoxarifado).
  useEffect(() => {
    if (!inicial) return;
    const t = setTimeout(() => aplicar(inicial), 0);
    return () => clearTimeout(t);
    // só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const somaDups = useMemo(() => dups.reduce((acc, d) => acc + (numero(d.valor) || 0), 0), [dups]);
  const mudarDup = (index: number, campo: keyof Dup, texto: string) => setDups((atual) => atual.map((d, i) => (i === index ? { ...d, [campo]: texto } : d)));

  const confirmar = async () => {
    setErro("");
    const total = numero(valor);
    if (!fornecedor.trim()) { setErro("Informe o fornecedor."); return; }
    if (!nf.trim()) { setErro("Informe o número da nota."); return; }
    if (!(total > 0)) { setErro("Informe o valor total da nota."); return; }
    if (dups.some((d) => !d.vencimento || !(numero(d.valor) > 0))) { setErro("Cada vencimento precisa de data e valor."); return; }
    if (Math.abs(somaDups - total) > 0.05) { setErro(`Os vencimentos somam ${money(somaDups)} e a nota ${money(total)}. Ajuste antes de confirmar.`); return; }
    if (!conferido) { setErro("Confirme que conferiu o material recebido."); return; }
    if (divergencia && motivo.trim().length < 3) { setErro("Descreva a divergência."); return; }
    setSalvando(true);
    const res = await chamar<{ numero: number; revisar: string }>("/api/almoxarifado/recebimentos", {
      method: "POST",
      body: JSON.stringify({
        cotacao_id: compra?.cotacaoId ?? null,
        fornecedor: fornecedor.trim(),
        fantasia: nfe?.emitente.fantasia ?? "",
        cnpj: nfe?.emitente.cnpj ?? "",
        nf_numero: nf.trim(), nf_serie: serie.trim(), nf_chave: chave.replace(/\D/g, ""),
        emissao: emissao || null, recebido_em: recebidoEm,
        valor_total: total, base_icms: numero(base) || 0, icms: numero(icms) || 0, ipi: numero(ipi) || 0,
        xml, divisao, encerra_pedido: compra ? encerra : true,
        divergencia, divergencia_motivo: divergencia ? motivo.trim() : "", observacao: observacao.trim(),
        itens: (nfe?.itens ?? []).map((item) => ({ descricao: item.descricao, quantidade: item.quantidade, unidade: item.unidade, valor_total: item.valorTotal })),
        duplicatas: dups.map((d) => ({ numero: d.numero, vencimento: d.vencimento, valor: numero(d.valor) })),
      }),
    });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    onFeito(`Recebimento #${res.data.numero} gravado. A conta a pagar foi para o Financeiro${res.data.revisar ? ` (para revisar: ${res.data.revisar})` : ""}.`);
  };

  const titulo = compra ? `Receber compra de ${compra.fornecedor}` : "Nota sem pedido de compra";
  const subtitulo = compra
    ? `Cotação #${compra.cotacaoId}${compra.pedidoNumero ? ` · pedido #${compra.pedidoNumero}` : ""} · comprado em ${date(compra.compradoEm)} · ${money(faltaReceber)} a receber`
    : "Material que chegou sem cotação no sistema. O Compras é avisado e a conta vai com \"revisar\".";

  return (
    <Modal eyebrow="Almoxarifado · recebimento" title={titulo} subtitle={subtitulo} onClose={onClose}>
      <div className="almox-form almox-receber">
        <Segmented<Modo> options={[{ value: "xml", label: "Anexar a nota (XML ou PDF)" }, { value: "manual", label: "Digitar a nota" }]} value={modo} onChange={(m) => { setModo(m); setErro(""); }} ariaLabel="Como lançar a nota" />

        {modo === "xml" && !nfe && (
          <div className={`almox-arquivo ${arrastando ? "on" : ""}`} {...soltar}>
            <input ref={arquivo} type="file" accept=".xml,.pdf,text/xml,application/xml,application/pdf" onChange={(event) => { void lerArquivo(event.target.files?.[0]); event.target.value = ""; }} hidden />
            <button type="button" onClick={() => arquivo.current?.click()} disabled={lendo}>
              <Icone nome="nota" size={26} />
              <b>{lendo ? "Lendo a nota…" : "Arraste aqui o XML da NF-e ou o DANFE em PDF, ou clique para escolher"}</b>
              <small>Fornecedor, número, valores, ICMS e IPI vêm preenchidos (do XML, também os vencimentos). Nota de serviço ou de papel: use &ldquo;Digitar a nota&rdquo;.</small>
            </button>
          </div>
        )}

        {aviso && <Callout variant="warning" title="Confira antes de confirmar">{aviso}</Callout>}

        {(modo === "manual" || nfe) && (
          <>
            {nfe && (
              <p className="almox-nfe-resumo">
                <Icone nome="check" size={16} /> NF-e {nfe.numero} · série {nfe.serie} · {nfe.emitente.nome}{nfe.emitente.cnpj.length === 14 ? ` · CNPJ ${nfe.emitente.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}` : ""} · emitida em {date(nfe.emissao)}{doPdf ? " · lida do PDF" : ""}
                <button type="button" className="almox-link" onClick={() => { setNfe(null); setXml(null); setDoPdf(false); setAviso(""); }}>trocar arquivo</button>
              </p>
            )}
            <div className="almox-campos">
              <label className="almox-largo"><span>Fornecedor</span><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} readOnly={Boolean(compra)} /></label>
              <label><span>Número da NF *</span><input value={nf} onChange={(e) => setNf(e.target.value)} readOnly={Boolean(nfe)} /></label>
              <label><span>Série</span><input value={serie} onChange={(e) => setSerie(e.target.value)} readOnly={Boolean(nfe)} /></label>
              <label><span>Emissão</span><input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} readOnly={Boolean(nfe)} /></label>
              <label><span>Valor total da nota *</span><input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              <label><span>Base do ICMS</span><input value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              <label><span>Valor do ICMS</span><input value={icms} onChange={(e) => setIcms(e.target.value)} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              <label><span>IPI</span><input value={ipi} onChange={(e) => setIpi(e.target.value)} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              {!compra && (
                <label><span>Divisão (centro)</span>
                  <select value={divisao} onChange={(e) => setDivisao(e.target.value)}>{["USINAGEM", "FUNDICAO"].map((d) => <option key={d} value={d}>{DIVISAO[d]}</option>)}</select>
                </label>
              )}
              {!nfe && <label className="almox-largo"><span>Chave de acesso (opcional, 44 dígitos)</span><input value={chave} onChange={(e) => setChave(e.target.value)} inputMode="numeric" /></label>}
            </div>

            <div className="almox-bloco-interno">
              <p className="almox-rotulo">Vencimentos (vão para o Contas a pagar)</p>
              <div className="almox-dups" role="table">
                {dups.map((d, index) => (
                  <div key={index} role="row">
                    <input value={d.numero} onChange={(e) => mudarDup(index, "numero", e.target.value)} aria-label={`Parcela ${index + 1}`} placeholder="Nº" />
                    <input type="date" value={d.vencimento} onChange={(e) => mudarDup(index, "vencimento", e.target.value)} aria-label={`Vencimento ${index + 1}`} />
                    <input value={d.valor} onChange={(e) => mudarDup(index, "valor", e.target.value)} inputMode="decimal" placeholder="0,00" aria-label={`Valor ${index + 1}`} />
                    <button type="button" className="almox-icone-botao" onClick={() => setDups((atual) => (atual.length > 1 ? atual.filter((_, i) => i !== index) : atual))} aria-label={`Remover vencimento ${index + 1}`}><Icone nome="lixo" size={16} /></button>
                  </div>
                ))}
                <div className="almox-dups-rodape">
                  <button type="button" className="almox-adicionar" onClick={() => setDups((atual) => [...atual, { numero: String(atual.length + 1), vencimento: "", valor: "" }])}><Icone nome="mais" size={16} /> Vencimento</button>
                  <span className={Math.abs(somaDups - (numero(valor) || 0)) > 0.05 ? "neg" : ""}>Soma {money(somaDups)}</span>
                </div>
              </div>
            </div>

            {(compra || nfe) && (
              <div className="almox-conferencia">
                {compra && (
                  <div>
                    <p className="almox-rotulo">Comprado</p>
                    {compra.itens.map((item, index) => <p key={index} className="almox-item"><b>{qtd(item.quantidade)} {item.unidade}</b> {item.produto}<em>{money(item.total)}</em></p>)}
                  </div>
                )}
                {nfe && (
                  <div>
                    <p className="almox-rotulo">Na nota</p>
                    {nfe.itens.map((item) => <p key={item.numero} className="almox-item"><b>{qtd(item.quantidade)} {item.unidade}</b> {item.descricao}<em>{money(item.valorTotal)}</em></p>)}
                  </div>
                )}
              </div>
            )}

            <div className="almox-campos">
              <label><span>Recebido em</span><input type="date" value={recebidoEm} max={hoje()} onChange={(e) => setRecebidoEm(e.target.value)} /></label>
              <label className="almox-largo"><span>Observação</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" /></label>
            </div>
            <label className="almox-marca"><input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} /> <span>Conferi o material recebido com a nota</span></label>
            {compra && <label className="almox-marca"><input type="checkbox" checked={encerra} onChange={(e) => setEncerra(e.target.checked)} /> <span>Pedido completo — não falta mais material desta compra</span></label>}
            <label className="almox-marca"><input type="checkbox" checked={divergencia} onChange={(e) => setDivergencia(e.target.checked)} /> <span>Veio diferente do pedido (quantidade, item ou valor)</span></label>
            {divergencia && <label className="almox-largo"><span>O que veio diferente</span><textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: vieram 4 brocas em vez de 5" /></label>}
          </>
        )}

        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          {(modo === "manual" || nfe) && <Button type="button" onClick={() => void confirmar()} disabled={salvando}>{salvando ? "Gravando…" : "Confirmar recebimento"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}
