"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Callout, Modal, Segmented, ZonaBotao, useEscolherArquivo } from "../../../packages/design-system";
import type { Nfe } from "../../../lib/almoxarifado/nfe-xml";
import { obsDoServico } from "../../../lib/fiscal/nfse";
import { TIPOS_ICMS } from "../../../lib/fiscal/icms-campos";
import { rotuloOC } from "../../../lib/compras/rotulo";
import { useSoltarArquivo } from "../../../app/components/enviar-arquivo";
import { type ACaminho, DIVISAO, Icone, UNIDADES, chamar, date, hoje, lerNotaArquivo, money, qtd, type NotaLidaResposta } from "./tipos";
import { BuscaMaterial, type MaterialEscolhido } from "./BuscaMaterial";

type Modo = "xml" | "manual";
type Dup = { numero: string; vencimento: string; valor: string };
type ItemManual = { produto: string; quantidade: string; unidade: string; valor: string; material: MaterialEscolhido | null };
const itemVazio = (): ItemManual => ({ produto: "", quantidade: "", unidade: "UN", valor: "", material: null });
/** Item da nota (XML) ligado a um material do catálogo; o fator converte a unidade da nota na do estoque. */
type Ligacao = { texto: string; material: MaterialEscolhido | null; origem: string | null; fator: string };
type Centro = { fundicao: boolean; usinagem: boolean; administrativo: boolean };
const centroDa = (divisao: string | null | undefined): Centro => ({ fundicao: divisao === "FUNDICAO", usinagem: divisao !== "FUNDICAO", administrativo: false });

const numero = (texto: string) => {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
};
const campoValor = (valor: number) => (valor ? valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

/**
 * Recebimento: o almoxarife confere o material e lança a nota — anexando o XML
 * (tudo preenchido) ou digitando. Ao confirmar, o banco cria a conta a pagar,
 * abate a previsão da compra, lança no Painel do ICMS (com centro e tipo) e avisa o Financeiro.
 * Nota sem pedido marcada como compra direta: a OC nasce pronta para o Compras, com o mesmo número.
 */
export function RecebimentoModal({ compra, inicial, arquivoInicial, modoInicial = "xml", onClose, onFeito }: { compra: ACaminho | null; inicial?: NotaLidaResposta; arquivoInicial?: File | null; modoInicial?: Modo; onClose: () => void; onFeito: (mensagem: string) => void }) {
  const [modo, setModo] = useState<Modo>(modoInicial);
  // Arquivo da nota (XML ou DANFE): guardado em Documentos › Almoxarifado depois de confirmar (D3).
  const [arquivoNota, setArquivoNota] = useState<File | null>(arquivoInicial ?? null);
  const [xml, setXml] = useState<string | null>(null);
  const [doPdf, setDoPdf] = useState(false);
  const [nfe, setNfe] = useState<Nfe | null>(null);
  const [ligacoes, setLigacoes] = useState<Record<number, Ligacao>>({});
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState("");

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
  // Compra direta (só na nota sem pedido): vem marcada; desmarca para remessa, conserto, devolução ou amostra.
  const [compraDireta, setCompraDireta] = useState(!compra);
  const [autorizado, setAutorizado] = useState("");
  const [autorizadores, setAutorizadores] = useState<string[]>([]);
  // Painel do ICMS: a linha entra completa, sem digitar de novo lá.
  const [centro, setCentro] = useState<Centro>(() => centroDa(compra?.divisao ?? "USINAGEM"));
  const [centroTocado, setCentroTocado] = useState(false);
  const [tipo, setTipo] = useState("Material");
  // Compra direta digitada (sem XML): os itens da nota, como na "Nova compra direta" do Compras. Viram os itens da OC.
  const [itensManuais, setItensManuais] = useState<ItemManual[]>([itemVazio()]);
  // Enquanto a pessoa não digita o valor da nota nem o vencimento, eles acompanham o total dos itens (+ IPI).
  const [valorTocado, setValorTocado] = useState(false);
  const [dupTocada, setDupTocada] = useState(false);

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

  /** De-para do fornecedor: os códigos da nota que já foram ligados a um material chegam ligados. */
  const sugerirMateriais = async (n: Nfe) => {
    const cnpj = n.emitente.cnpj?.replace(/\D/g, "") ?? "";
    const codigos = n.itens.map((i) => i.codigo).filter(Boolean);
    if (cnpj.length !== 14 || !codigos.length) return;
    const r = await chamar<{ ligacoes: Record<string, { material: MaterialEscolhido; fator: number }> }>(`/api/almoxarifado/depara?cnpj=${cnpj}&codigos=${encodeURIComponent(codigos.join(","))}`);
    if (!r.ok) return;
    setLigacoes((atual) => {
      const novo = { ...atual };
      for (const item of n.itens) {
        const l = item.codigo ? r.data.ligacoes[item.codigo.trim().toUpperCase()] : undefined;
        if (l && !novo[item.numero]?.material) novo[item.numero] = { texto: l.material.descricao, material: l.material, origem: "pelo código do fornecedor", fator: String(l.fator).replace(".", ",") };
      }
      return novo;
    });
  };
  const ligar = (numeroItem: number, mudanca: Partial<Ligacao>) =>
    setLigacoes((atual) => {
      const base: Ligacao = atual[numeroItem] ?? { texto: "", material: null, origem: null, fator: "1" };
      return { ...atual, [numeroItem]: { ...base, ...mudanca } };
    });

  /** Preenche a nota a partir do que o servidor leu (NF-e ou NFS-e; XML ou PDF). */
  const aplicar = (lida: NotaLidaResposta) => {
    if (lida.jaRecebida) { setErro(`Esta nota já foi recebida (recebimento #${lida.jaRecebida.numero}, ${date(lida.jaRecebida.em)}).`); return; }
    const n = lida.nfe;
    setXml(lida.xml);
    setDoPdf(lida.origem === "pdf");
    setNfe(n);
    setLigacoes({});
    void sugerirMateriais(n);
    // Nota de serviço (NFS-e): sem ICMS/IPI; entra no Painel do ICMS com tipo "Serviço".
    if (lida.modelo === "nfse") setTipo("Serviço");
    if (lida.modelo === "nfse" && lida.servico) setObservacao((o) => o || obsDoServico(lida.servico!, lida.origem === "pdf"));
    if (!compra) setFornecedor(n.emitente.fantasia || lida.fornecedor?.nome || n.emitente.nome);
    setNf(n.numero); setSerie(n.serie); setChave(n.chave); setEmissao(n.emissao);
    setValor(campoValor(n.valorNota)); setBase(campoValor(n.baseIcms)); setIcms(campoValor(n.icms)); setIpi(campoValor(n.ipi));
    setDups(n.duplicatas.length
      ? n.duplicatas.map((d) => ({ numero: d.numero, vencimento: d.vencimento, valor: campoValor(d.valor) }))
      : [{ numero: "1", vencimento: compra?.previsaoVencimento ?? "", valor: campoValor(n.valorNota) }]);
    if (compra) setEncerra(n.valorNota >= faltaReceber * 0.98);
    const avisos: string[] = [];
    if (lida.modelo === "nfse") avisos.push(`Nota de serviço (NFS-e)${lida.origem === "pdf" ? " lida do PDF: confira número, data e valor" : ""}. Sem ICMS nem IPI; o ISS vai na observação.${lida.camposNaoLidos.length ? ` Não lido: ${lida.camposNaoLidos.join(", ")}.` : ""}`);
    else if (lida.origem === "pdf") avisos.push("Nota lida do DANFE em PDF: confira valores e vencimentos (do PDF, as parcelas só vêm quando somam o total da nota).");
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
    setArquivoNota(file);
    aplicar(res.data);
  };
  const seletor = useEscolherArquivo((a) => void lerArquivo(a[0]));
  const { arrastando, soltar } = useSoltarArquivo((lista) => void lerArquivo(lista[0]), !lendo);

  // Nota já lida antes de abrir (botão "Enviar nota" do Almoxarifado).
  useEffect(() => {
    if (!inicial) return;
    const t = setTimeout(() => aplicar(inicial), 0);
    return () => clearTimeout(t);
    // só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quem costuma autorizar compra direta (das compras diretas já lançadas), para sugerir.
  useEffect(() => {
    if (compra) return;
    let vivo = true;
    void chamar<{ items: { autorizadoPor: string | null }[] }>("/api/compras/diretas").then((res) => {
      if (!vivo || !res.ok) return;
      const nomes = [...new Set(res.data.items.map((c) => c.autorizadoPor).filter((n): n is string => Boolean(n)))];
      setAutorizadores(nomes);
      setAutorizado((atual) => atual || nomes[0] || "");
    });
    return () => { vivo = false; };
  }, [compra]);
  const mudarDivisao = (nova: string) => { setDivisao(nova); if (!centroTocado) setCentro(centroDa(nova)); };
  const marcarCentro = (campo: keyof Centro, valor: boolean) => { setCentroTocado(true); setCentro((atual) => ({ ...atual, [campo]: valor })); };

  const totalItens = (linhas: ItemManual[]) => Math.round(linhas.reduce((acc, l) => acc + (numero(l.quantidade) || 0) * (numero(l.valor) || 0), 0) * 100) / 100;
  /** Valor da nota e parcela única seguem os itens (+ IPI) até a pessoa mexer neles. */
  const seguirItens = (linhas: ItemManual[], ipiTexto: string) => {
    const total = totalItens(linhas) + (numero(ipiTexto) || 0);
    if (!(total > 0)) return;
    if (!valorTocado) setValor(campoValor(total));
    if (!dupTocada) setDups((atual) => (atual.length === 1 ? [{ ...atual[0], valor: campoValor(total) }] : atual));
  };
  const mudarItem = (index: number, campo: "quantidade" | "unidade" | "valor", texto: string) => {
    const linhas = itensManuais.map((l, i) => (i === index ? { ...l, [campo]: texto } : l));
    setItensManuais(linhas);
    seguirItens(linhas, ipi);
  };
  const itensDigitados = !nfe && !compra && compraDireta;

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
    const direta = !compra && compraDireta;
    if (direta && !autorizado.trim()) { setErro("Informe quem autorizou a compra direta (ou desmarque se não for compra)."); return; }
    const linhasManuais = itensDigitados ? itensManuais.filter((l) => l.produto.trim()) : [];
    if (itensDigitados && !linhasManuais.length) { setErro("Informe os itens da nota: eles viram os itens da OC."); return; }
    if (linhasManuais.some((l) => !(numero(l.quantidade) > 0) || !l.valor.trim() || !(numero(l.valor) >= 0))) { setErro("Todo item precisa de quantidade e valor unitário."); return; }
    if (!centro.fundicao && !centro.usinagem && !centro.administrativo) { setErro("Marque o centro da nota (Fundição, Usinagem ou Administrativo)."); return; }
    setSalvando(true);
    const res = await chamar<{ id: string; numero: number; revisar: string; oc: number | null }>("/api/almoxarifado/recebimentos", {
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
        tipo, centro,
        compra_direta: direta, autorizado_por: direta ? autorizado.trim() : "",
        itens: nfe
          ? nfe.itens.map((item) => {
              const l = ligacoes[item.numero];
              return {
                descricao: item.descricao, quantidade: item.quantidade, unidade: item.unidade, valor_total: item.valorTotal,
                codigo: item.codigo, cfop: item.cfop, material_id: l?.material?.id ?? null, fator: l?.material ? numero(l.fator) || 1 : null,
              };
            })
          : linhasManuais.map((l) => ({ descricao: l.produto.trim(), quantidade: numero(l.quantidade), unidade: l.unidade, valor_total: Math.round(numero(l.quantidade) * numero(l.valor) * 100) / 100, material_id: l.material?.id ?? null })),
        duplicatas: dups.map((d) => ({ numero: d.numero, vencimento: d.vencimento, valor: numero(d.valor) })),
      }),
    });
    if (!res.ok) { setSalvando(false); setErro(res.error); return; }
    // O original da nota fica guardado, ligado ao recebimento. Se falhar, o recebimento já está gravado.
    let original = "";
    if (arquivoNota && res.data.id) {
      const corpo = new FormData();
      corpo.set("arquivo", arquivoNota);
      corpo.set("setor", "almoxarifado");
      corpo.set("origem", "recebimento");
      corpo.set("entidadeTipo", "receipt");
      corpo.set("entidadeId", res.data.id);
      corpo.set("titulo", `NF ${nf.trim()}${serie.trim() ? `/${serie.trim()}` : ""} · ${fornecedor.trim()} (recebimento #${res.data.numero})`);
      corpo.set("categoria", "Nota fiscal recebida");
      const doc = await fetch("/api/documentos", { method: "POST", body: corpo, cache: "no-store" }).catch(() => null);
      original = doc?.ok ? " A nota original ficou em Documentos." : " A nota original não foi guardada em Documentos; envie por lá se precisar.";
    }
    setSalvando(false);
    const oc = res.data.oc ? `${rotuloOC(res.data.oc)} gerada como compra direta: o Compras já recebeu a OC preenchida. ` : "";
    onFeito(`${oc}Recebimento #${res.data.numero} gravado. A conta a pagar foi para o Financeiro${res.data.revisar ? ` (para revisar: ${res.data.revisar})` : ""} e a nota entrou no Painel do ICMS como ${tipo}.${original}`);
  };

  const titulo = compra ? `Receber compra de ${compra.fornecedor}` : "Nota sem pedido de compra";
  const subtitulo = compra
    ? `${rotuloOC(compra.cotacaoId)}${compra.direta ? " · compra direta" : ""}${compra.pedidoNumero ? ` · pedido #${compra.pedidoNumero}` : ""} · comprado em ${date(compra.compradoEm)} · ${money(faltaReceber)} a receber`
    : "Material que chegou sem cotação no sistema. Se a compra foi autorizada pela diretoria, deixe \"É compra direta\" marcado: a OC nasce pronta para o Compras.";

  return (
    <Modal eyebrow="Almoxarifado · recebimento" title={titulo} subtitle={subtitulo} onClose={onClose}>
      <div className="almox-form almox-receber">
        <Segmented<Modo> options={[{ value: "xml", label: "Anexar a nota (XML ou PDF)" }, { value: "manual", label: "Digitar a nota" }]} value={modo} onChange={(m) => { setModo(m); setErro(""); }} ariaLabel="Como lançar a nota" />

        {modo === "xml" && !nfe && (
          <div className={`almox-arquivo ${arrastando ? "on" : ""}`} {...soltar}>
            <input {...seletor.inputProps} accept=".xml,.pdf,text/xml,application/xml,application/pdf" />
            <button type="button" onClick={seletor.abrir} disabled={lendo || seletor.abrindo} aria-busy={lendo || seletor.abrindo}>
              <Icone nome="nota" size={26} />
              <b>{lendo ? "Lendo a nota…" : "Arraste aqui o XML ou o PDF da nota, ou clique para escolher"}</b>
              <small>Nota de produto (NF-e/DANFE) ou de serviço (NFS-e). Fornecedor, número e valores vêm preenchidos; da NF-e também ICMS, IPI e vencimentos. Nota de papel: use &ldquo;Digitar a nota&rdquo;.</small>
              {!lendo && <ZonaBotao abrindo={seletor.abrindo} rotulo="Escolher a nota" />}
            </button>
          </div>
        )}

        {aviso && <Callout variant="warning" title="Confira antes de confirmar">{aviso}</Callout>}

        {(modo === "manual" || nfe) && (
          <>
            {nfe && (
              <p className="almox-nfe-resumo">
                <Icone nome="check" size={16} /> NF-e {nfe.numero} · série {nfe.serie} · {nfe.emitente.nome}{nfe.emitente.cnpj.length === 14 ? ` · CNPJ ${nfe.emitente.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}` : ""} · emitida em {date(nfe.emissao)}{doPdf ? " · lida do PDF" : ""}
                <button type="button" className="almox-link" onClick={() => { setNfe(null); setXml(null); setDoPdf(false); setAviso(""); setArquivoNota(null); }}>trocar arquivo</button>
              </p>
            )}
            <div className="almox-campos">
              <label className="almox-largo"><span>Fornecedor</span><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} readOnly={Boolean(compra)} /></label>
              <label><span>Número da NF *</span><input value={nf} onChange={(e) => setNf(e.target.value)} readOnly={Boolean(nfe)} /></label>
              <label><span>Série</span><input value={serie} onChange={(e) => setSerie(e.target.value)} readOnly={Boolean(nfe)} /></label>
              <label><span>Emissão</span><input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} readOnly={Boolean(nfe)} /></label>
              <label><span>Valor total da nota *</span><input value={valor} onChange={(e) => { setValor(e.target.value); setValorTocado(true); }} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              <label><span>Base do ICMS</span><input value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              <label><span>Valor do ICMS</span><input value={icms} onChange={(e) => setIcms(e.target.value)} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              <label><span>IPI</span><input value={ipi} onChange={(e) => { setIpi(e.target.value); if (itensDigitados) seguirItens(itensManuais, e.target.value); }} inputMode="decimal" placeholder="0,00" readOnly={Boolean(nfe)} /></label>
              {!compra && (
                <label><span>Divisão</span>
                  <select value={divisao} onChange={(e) => mudarDivisao(e.target.value)}>{["USINAGEM", "FUNDICAO"].map((d) => <option key={d} value={d}>{DIVISAO[d]}</option>)}</select>
                </label>
              )}
              {!nfe && <label className="almox-largo"><span>Chave de acesso (opcional, 44 dígitos)</span><input value={chave} onChange={(e) => setChave(e.target.value)} inputMode="numeric" /></label>}
            </div>

            {!compra && (
              <div className="almox-bloco-interno almox-direta">
                <label className="almox-marca"><input type="checkbox" checked={compraDireta} onChange={(e) => setCompraDireta(e.target.checked)} /> <span><b>É compra direta (gerar OC)</b> · compra autorizada sem cotação. Desmarque para remessa, conserto, devolução ou amostra.</span></label>
                {compraDireta && (
                  <div className="almox-campos">
                    <label><span>Autorizada por *</span><input value={autorizado} onChange={(e) => setAutorizado(e.target.value)} list="recebimento-autorizadores" placeholder="Quem autorizou" /></label>
                    <datalist id="recebimento-autorizadores">{autorizadores.map((n) => <option key={n} value={n} />)}</datalist>
                  </div>
                )}
                {itensDigitados && (
                  <div className="almox-itens-form" role="table" aria-label="Itens da nota">
                    <p className="almox-rotulo">Itens da nota (viram os itens da OC)</p>
                    <div className="cabeca" role="row"><span>Material</span><span>Quantidade</span><span>Unidade</span><span>Valor unitário (R$)</span><span /></div>
                    {itensManuais.map((linha, index) => (
                      <div key={index} role="row">
                        <BuscaMaterial valor={linha.produto} material={linha.material} ariaLabel={`Material ${index + 1}`} placeholder="Código ou nome: broca HSS 10, 2-01-00893…"
                          onDigitar={(v) => { const linhas = itensManuais.map((l, i) => (i === index ? { ...l, produto: v, material: null } : l)); setItensManuais(linhas); seguirItens(linhas, ipi); }}
                          onEscolher={(m) => { const linhas = itensManuais.map((l, i) => (i === index ? { ...l, produto: m.descricao, material: m, unidade: UNIDADES.includes(m.unidade) ? m.unidade : l.unidade } : l)); setItensManuais(linhas); }} />
                        <input value={linha.quantidade} onChange={(e) => mudarItem(index, "quantidade", e.target.value)} inputMode="decimal" placeholder="0" aria-label={`Quantidade ${index + 1}`} />
                        <select value={linha.unidade} onChange={(e) => mudarItem(index, "unidade", e.target.value)} aria-label={`Unidade ${index + 1}`}>
                          {UNIDADES.map((u) => <option key={u}>{u}</option>)}
                        </select>
                        <input value={linha.valor} onChange={(e) => mudarItem(index, "valor", e.target.value)} inputMode="decimal" placeholder="0,00" aria-label={`Valor unitário ${index + 1}`} />
                        <button type="button" className="almox-icone-botao" onClick={() => { const linhas = itensManuais.length > 1 ? itensManuais.filter((_, i) => i !== index) : [itemVazio()]; setItensManuais(linhas); seguirItens(linhas, ipi); }} aria-label={`Remover item ${index + 1}`}><Icone nome="lixo" size={16} /></button>
                      </div>
                    ))}
                    <div className="almox-dups-rodape">
                      <button type="button" className="almox-adicionar" onClick={() => setItensManuais((atual) => [...atual, itemVazio()])}><Icone nome="mais" size={16} /> Adicionar item</button>
                      <span>Total dos itens {money(totalItens(itensManuais))}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="almox-bloco-interno">
              <p className="almox-rotulo">Painel do ICMS (a nota entra lá com isto)</p>
              <div className="almox-icms">
                <label><span>Tipo</span>
                  <select value={tipo} onChange={(e) => setTipo(e.target.value)}>{[...new Set([...TIPOS_ICMS, tipo])].map((t) => <option key={t}>{t}</option>)}</select>
                </label>
                <fieldset>
                  <legend>Centro</legend>
                  <label className="almox-marca"><input type="checkbox" checked={centro.fundicao} onChange={(e) => marcarCentro("fundicao", e.target.checked)} /> <span>Fundição</span></label>
                  <label className="almox-marca"><input type="checkbox" checked={centro.usinagem} onChange={(e) => marcarCentro("usinagem", e.target.checked)} /> <span>Usinagem</span></label>
                  <label className="almox-marca"><input type="checkbox" checked={centro.administrativo} onChange={(e) => marcarCentro("administrativo", e.target.checked)} /> <span>Administrativo</span></label>
                </fieldset>
              </div>
            </div>

            <div className="almox-bloco-interno">
              <p className="almox-rotulo">Vencimentos (vão para o Contas a pagar)</p>
              <div className="almox-dups" role="table">
                {dups.map((d, index) => (
                  <div key={index} role="row">
                    <input value={d.numero} onChange={(e) => mudarDup(index, "numero", e.target.value)} aria-label={`Parcela ${index + 1}`} placeholder="Nº" />
                    <input type="date" value={d.vencimento} onChange={(e) => mudarDup(index, "vencimento", e.target.value)} aria-label={`Vencimento ${index + 1}`} />
                    <input value={d.valor} onChange={(e) => { mudarDup(index, "valor", e.target.value); setDupTocada(true); }} inputMode="decimal" placeholder="0,00" aria-label={`Valor ${index + 1}`} />
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
                    {nfe.itens.map((item) => {
                      const l = ligacoes[item.numero];
                      const unidadeDiferente = l?.material && l.material.unidade.toUpperCase() !== (item.unidade ?? "").toUpperCase();
                      return (
                        <div key={item.numero} className="almox-item-nota">
                          <p className="almox-item"><b>{qtd(item.quantidade)} {item.unidade}</b> {item.descricao}{item.codigo ? <span className="almox-item-cod"> · cód. {item.codigo}</span> : null}<em>{money(item.valorTotal)}</em></p>
                          <BuscaMaterial valor={l?.texto ?? ""} material={l?.material ?? null} origem={l?.origem ?? null} ariaLabel={`Material do catálogo para o item ${item.numero}`}
                            placeholder="Ligar a um material do catálogo (opcional)"
                            onDigitar={(v) => ligar(item.numero, { texto: v, material: null, origem: null })}
                            onEscolher={(m) => ligar(item.numero, { texto: m.descricao, material: m, origem: null, fator: m.unidade.toUpperCase() === (item.unidade ?? "").toUpperCase() ? "1" : (l?.fator ?? "1") })} />
                          {unidadeDiferente && (
                            <label className="almox-fator"><span>1 {item.unidade} =</span>
                              <input value={l!.fator} onChange={(e) => ligar(item.numero, { fator: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" aria-label={`Quantos ${l!.material!.unidade} vêm em 1 ${item.unidade}`} />
                              <span>{l!.material!.unidade}</span>
                            </label>
                          )}
                        </div>
                      );
                    })}
                    {nfe.itens.length > 0 && <p className="almox-nota-ajuda">Ligar ao material é opcional e não trava o recebimento. Ligado uma vez, o próximo recebimento deste fornecedor já chega ligado.</p>}
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
