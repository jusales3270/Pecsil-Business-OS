"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Modal, Segmented, Status } from "../../packages/design-system";
import { DocumentosLigados } from "./documentos-ligados";
import { DIVISAO, Icone, UNIDADES, chamar, date, money, qtd } from "../../modules/almoxarifado/src/tipos";
import { rotuloOC } from "../../lib/compras/rotulo";

/**
 * Compras diretas: compra sem cotação, autorizada fora da plataforma, que nasce
 * aprovada como OC nº N (mesma sequência das cotações). A mesma lista, com os
 * mesmos números, no Compras e no Almoxarifado:
 *  - a nota chegou: o Almoxarifado lança "Nota sem pedido" com "É compra direta" e a OC nasce pronta;
 *  - pedido ao Compras: "Nova compra direta" registra a OC, que vai para "A caminho".
 */

export type CompraDireta = {
  id: number;
  fornecedor: string;
  divisao: string | null;
  autorizadoPor: string | null;
  criadaEm: string;
  observacao: string | null;
  prazoEntrega: string | null;
  freteTipo: string | null;
  despesas: number;
  pelaNota: boolean;
  total: number;
  itens: { produto: string; quantidade: number; unidade: string | null; valorUnit: number }[];
  notas: { id: string; numero: number; nf: string; serie: string | null; valor: number; recebidaEm: string; por: string | null }[];
};

type Filtro = "todas" | "caminho" | "recebidas";
/** Valor da compra: o das notas, quando já chegaram (é o que se paga); antes, o da OC. */
const valorDe = (c: CompraDireta) => (c.notas.length ? c.notas.reduce((acc, n) => acc + n.valor, 0) : c.total + c.despesas);
const diaDe = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const numero = (texto: string) => {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
};

/** Última OC vista nesta lista (por pessoa e navegador): o que veio depois aparece como "Nova". */
const lerVista = (chave: string) => { try { const v = localStorage.getItem(chave); return v === null ? null : Number(v) || 0; } catch { return null; } };
const gravarVista = (chave: string, id: number) => { try { localStorage.setItem(chave, String(id)); } catch { /* sem armazenamento: sem marca de nova */ } };

export function ComprasDiretas({ eyebrow, texto, painel, podeRegistrar = false, podeAbrirOC = false, acaoExtra, notify }: {
  eyebrow: string;
  /** Onde a lista está (cada painel guarda o que já foi visto). */
  painel: "compras" | "almoxarifado";
  texto: string;
  /** Compras: registrar a compra direta pedida pelo diretor (caminho B). */
  podeRegistrar?: boolean;
  /** PDF da Ordem de Compra (para o fornecedor): só no Compras. */
  podeAbrirOC?: boolean;
  /** Almoxarifado: o botão "Nota sem pedido", por onde nasce a compra direta da nota. */
  acaoExtra?: ReactNode;
  notify?: (mensagem: string) => void;
}) {
  const [itens, setItens] = useState<CompraDireta[] | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<CompraDireta | null>(null);
  const [nova, setNova] = useState(false);
  const [vistaAntes, setVistaAntes] = useState<number | null | undefined>(undefined);

  const carregar = useCallback(async () => {
    const res = await chamar<{ items: CompraDireta[] }>("/api/compras/diretas");
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    // Primeira vez: nada aparece como nova. Depois, as OCs acima da última vista ficam marcadas nesta abertura.
    const chave = `compras_diretas_vista_${painel}`;
    const maior = res.data.items.reduce((m, c) => Math.max(m, c.id), 0);
    const antes = lerVista(chave);
    setVistaAntes((atual) => (atual === undefined ? antes ?? maior : atual));
    gravarVista(chave, Math.max(maior, antes ?? 0));
    setItens(res.data.items.map((c) => ({ ...c, total: Number(c.total), despesas: Number(c.despesas), notas: c.notas.map((n) => ({ ...n, valor: Number(n.valor) })) })));
  }, [painel]);
  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase().replace(/^(oc\s*(n[ºo°]?)?\s*|#)/, "");
    return (itens ?? []).filter((c) => {
      if (filtro === "caminho" && c.notas.length) return false;
      if (filtro === "recebidas" && !c.notas.length) return false;
      if (!termo) return true;
      return String(c.id) === termo || c.fornecedor.toLowerCase().includes(termo) || c.notas.some((n) => n.nf.includes(termo))
        || (c.autorizadoPor ?? "").toLowerCase().includes(termo);
    });
  }, [itens, filtro, busca]);
  const autorizadores = useMemo(() => [...new Set((itens ?? []).map((c) => c.autorizadoPor).filter((n): n is string => Boolean(n)))], [itens]);

  return (
    <div className="almox-modulo">
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">{eyebrow}</p><h1>Compras diretas</h1><p>{texto}</p></div>
        {(podeRegistrar || acaoExtra) && (
          <div className="almox-acoes-topo">
            {acaoExtra}
            {podeRegistrar && <Button onClick={() => setNova(true)}><Icone nome="mais" size={16} /> Nova compra direta</Button>}
          </div>
        )}
      </div>

      <div className="almox-filtros">
        <Segmented<Filtro> options={[{ value: "todas", label: `Todas · ${(itens ?? []).length}` }, { value: "caminho", label: `A caminho · ${(itens ?? []).filter((c) => !c.notas.length).length}` }, { value: "recebidas", label: `Recebidas · ${(itens ?? []).filter((c) => c.notas.length).length}` }]} value={filtro} onChange={setFiltro} ariaLabel="Situação" />
        <input className="almox-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº da OC, fornecedor ou NF" aria-label="Buscar compra direta" />
      </div>

      {erro ? <div className="finance-empty almox-vazio"><b>{erro}</b><small>Tente de novo em instantes.</small></div>
        : !itens ? <div className="finance-empty almox-vazio"><b>Carregando…</b></div>
        : !lista.length ? (
          <div className="finance-empty almox-vazio">
            <b>{itens.length ? "Nenhuma compra direta neste filtro" : "Nenhuma compra direta ainda"}</b>
            <small>A compra direta nasce quando o Almoxarifado lança a nota sem pedido marcando &ldquo;É compra direta&rdquo;, ou quando o Compras registra uma compra pedida pela diretoria.</small>
          </div>
        ) : (
          <section className="almox-bloco">
            <div className="almox-tabela" role="table" aria-label="Compras diretas">
              <div className="cabeca" role="row"><span>OC</span><span>Fornecedor</span><span>Data</span><span>NF</span><span className="valor">Valor</span><span>Autorizada por</span><span>Situação</span></div>
              {lista.map((c) => (
                <button type="button" role="row" key={c.id} onClick={() => setAberta(c)}>
                  <span><b>{rotuloOC(c.id)}</b></span>
                  <span className="nome">{c.fornecedor}</span>
                  <span>{date(diaDe(c.criadaEm))}</span>
                  <span>{c.notas.length ? c.notas.map((n) => n.nf).join(", ") : "—"}</span>
                  <span className="valor">{money(valorDe(c))}</span>
                  <span>{c.autorizadoPor ?? "—"}</span>
                  <span className="marcas">
                    {typeof vistaAntes === "number" && c.id > vistaAntes && <Status tone="attention">Nova</Status>}
                    {c.notas.length ? <Status tone="success">Recebida</Status> : <Status tone="info">A caminho</Status>}
                    <Status tone="neutral">{c.pelaNota ? "Pela nota" : "Pelo Compras"}</Status>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

      {aberta && <DetalheCompraDireta compra={aberta} podeAbrirOC={podeAbrirOC} onClose={() => setAberta(null)} />}
      {nova && (
        <NovaCompraDireta
          autorizadores={autorizadores}
          onClose={() => setNova(false)}
          onCriada={(id) => {
            setNova(false);
            notify?.(`${rotuloOC(id)} registrada. A OC já pode ir para o fornecedor; o Almoxarifado vê a compra em "A caminho".`);
            void carregar();
            if (podeAbrirOC) window.open(`/relatorios/ordem-compra?id=${id}`, "_blank", "noopener");
          }}
        />
      )}
    </div>
  );
}

function DetalheCompraDireta({ compra: c, podeAbrirOC, onClose }: { compra: CompraDireta; podeAbrirOC: boolean; onClose: () => void }) {
  return (
    <Modal eyebrow="Compra direta" title={`${rotuloOC(c.id)} · ${c.fornecedor}`}
      subtitle={`${c.pelaNota ? "Gerada pela nota recebida no Almoxarifado" : "Registrada pelo Compras"} em ${date(diaDe(c.criadaEm))} · autorizada por ${c.autorizadoPor ?? "—"}`} onClose={onClose}>
      <div className="almox-detalhe">
        <dl>
          <div><dt>Valor da OC</dt><dd><b>{money(c.total + c.despesas)}</b>{c.despesas > 0 ? ` (com frete e despesas de ${money(c.despesas)})` : ""}</dd></div>
          <div><dt>Divisão</dt><dd>{c.divisao ? DIVISAO[c.divisao] ?? c.divisao : "—"}</dd></div>
          <div><dt>Situação</dt><dd>{c.notas.length ? "Recebida" : "A caminho"}</dd></div>
          {c.prazoEntrega && <div><dt>Entrega</dt><dd>{date(c.prazoEntrega)}</dd></div>}
          {c.notas.map((n) => (
            <div key={n.id} className="largo"><dt>Nota recebida</dt><dd>NF {n.nf}{n.serie ? `/${n.serie}` : ""} · {money(n.valor)} · recebida em {date(n.recebidaEm)}{n.por ? ` por ${n.por}` : ""} (recebimento #{n.numero})</dd></div>
          ))}
          {c.observacao && <div className="largo"><dt>Observação</dt><dd>{c.observacao}</dd></div>}
        </dl>
        {c.itens.length > 0 && (
          <div className="almox-pedido-itens">
            {c.itens.map((item, index) => <p key={index}><b>{qtd(Number(item.quantidade))} {item.unidade ?? ""}</b> {item.produto}<em className="valor">{money(Number(item.quantidade) * Number(item.valorUnit))}</em></p>)}
          </div>
        )}
        {/* Os documentos da nota (XML, DANFE) ficam ligados ao recebimento; sem nota, os que citam a OC. */}
        {c.notas.length ? c.notas.map((n) => <DocumentosLigados key={n.id} tipo="recebimento" id={n.id} />) : <DocumentosLigados tipo="cotacao" id={String(c.id)} />}
        <footer>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {podeAbrirOC && <Button onClick={() => window.open(`/relatorios/ordem-compra?id=${c.id}`, "_blank", "noopener")}><Icone nome="nota" size={16} /> Ordem de compra</Button>}
        </footer>
      </div>
    </Modal>
  );
}

type Linha = { produto: string; quantidade: string; unidade: string; valor: string };
const vazia = (): Linha => ({ produto: "", quantidade: "", unidade: "UN", valor: "" });

function NovaCompraDireta({ autorizadores, onClose, onCriada }: { autorizadores: string[]; onClose: () => void; onCriada: (id: number) => void }) {
  const [fornecedor, setFornecedor] = useState("");
  const [fornecedores, setFornecedores] = useState<string[]>([]);
  const [divisao, setDivisao] = useState<"USINAGEM" | "FUNDICAO">("USINAGEM");
  const [autorizado, setAutorizado] = useState(autorizadores[0] ?? "");
  const [linhas, setLinhas] = useState<Linha[]>([vazia()]);
  const [freteTipo, setFreteTipo] = useState<"CIF" | "FOB" | "SEM">("CIF");
  const [frete, setFrete] = useState("");
  const [entrega, setEntrega] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Sugestão do cadastro de fornecedores (quem não vê o cadastro digita o nome).
  useEffect(() => {
    let vivo = true;
    void chamar<{ suppliers: { name: string }[] }>("/api/compras/fornecedores").then((res) => { if (vivo && res.ok) setFornecedores(res.data.suppliers.map((s) => s.name)); });
    return () => { vivo = false; };
  }, []);

  const mudar = (index: number, campo: keyof Linha, valor: string) => setLinhas((atual) => atual.map((linha, i) => (i === index ? { ...linha, [campo]: valor } : linha)));
  const total = linhas.reduce((acc, l) => acc + (numero(l.quantidade) || 0) * (numero(l.valor) || 0), 0);

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    const itens = linhas.filter((l) => l.produto.trim());
    if (!fornecedor.trim()) { setErro("Informe o fornecedor."); return; }
    if (!autorizado.trim()) { setErro("Informe quem autorizou a compra direta."); return; }
    if (!itens.length) { setErro("Informe ao menos um item."); return; }
    if (itens.some((l) => !(numero(l.quantidade) > 0) || !(numero(l.valor) >= 0) || !l.valor.trim())) { setErro("Toda linha precisa de quantidade e valor unitário."); return; }
    setSalvando(true);
    setErro("");
    const res = await chamar<{ id: number }>("/api/compras/diretas", {
      method: "POST",
      body: JSON.stringify({
        fornecedor: fornecedor.trim(), divisao, autorizado_por: autorizado.trim(),
        frete_tipo: freteTipo, frete_valor: numero(frete) || 0, prazo_entrega: entrega || null, observacao: observacao.trim(),
        itens: itens.map((l) => ({ produto: l.produto.trim(), quantidade: numero(l.quantidade), unidade: l.unidade, valor_unit: numero(l.valor) })),
      }),
    });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    onCriada(res.data.id);
  };

  return (
    <Modal eyebrow="Compras · compra direta" title="Nova compra direta" subtitle={'Compra autorizada sem cotação. Ela nasce aprovada como OC, vira previsão a pagar e aparece para o Almoxarifado em "A caminho".'} onClose={onClose}>
      <form className="almox-form" onSubmit={salvar}>
        <div className="almox-campos">
          <label className="almox-largo"><span>Fornecedor *</span><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} list="diretas-fornecedores" autoFocus /></label>
          <label><span>Autorizada por *</span><input value={autorizado} onChange={(e) => setAutorizado(e.target.value)} list="diretas-autorizadores" placeholder="Quem autorizou" /></label>
          <label><span>Divisão</span>
            <Segmented<"USINAGEM" | "FUNDICAO"> options={[{ value: "USINAGEM", label: "Usinagem" }, { value: "FUNDICAO", label: "Fundição" }]} value={divisao} onChange={setDivisao} ariaLabel="Divisão" />
          </label>
        </div>
        <datalist id="diretas-fornecedores">{fornecedores.map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="diretas-autorizadores">{autorizadores.map((n) => <option key={n} value={n} />)}</datalist>

        <div className="almox-itens-form" role="table" aria-label="Itens da compra">
          <div className="cabeca" role="row"><span>Material</span><span>Quantidade</span><span>Unidade</span><span>Valor unitário (R$)</span><span /></div>
          {linhas.map((linha, index) => (
            <div key={index} role="row">
              <input value={linha.produto} onChange={(e) => mudar(index, "produto", e.target.value)} placeholder="Ex.: Broca HSS 10 mm" aria-label={`Material ${index + 1}`} />
              <input value={linha.quantidade} onChange={(e) => mudar(index, "quantidade", e.target.value)} inputMode="decimal" placeholder="0" aria-label={`Quantidade ${index + 1}`} />
              <select value={linha.unidade} onChange={(e) => mudar(index, "unidade", e.target.value)} aria-label={`Unidade ${index + 1}`}>
                {UNIDADES.map((u) => <option key={u}>{u}</option>)}
              </select>
              <input value={linha.valor} onChange={(e) => mudar(index, "valor", e.target.value)} inputMode="decimal" placeholder="0,00" aria-label={`Valor unitário ${index + 1}`} />
              <button type="button" className="almox-icone-botao" onClick={() => setLinhas((atual) => (atual.length > 1 ? atual.filter((_, i) => i !== index) : [vazia()]))} aria-label={`Remover item ${index + 1}`}><Icone nome="lixo" size={16} /></button>
            </div>
          ))}
          <button type="button" className="almox-adicionar" onClick={() => setLinhas((atual) => [...atual, vazia()])}><Icone nome="mais" size={16} /> Adicionar item</button>
        </div>

        <div className="almox-campos">
          <label><span>Frete</span>
            <select value={freteTipo} onChange={(e) => setFreteTipo(e.target.value as "CIF" | "FOB" | "SEM")}>
              <option value="CIF">CIF (fornecedor paga)</option><option value="FOB">FOB (nós pagamos)</option><option value="SEM">Sem frete</option>
            </select>
          </label>
          <label><span>Valor do frete</span><input value={frete} onChange={(e) => setFrete(e.target.value)} inputMode="decimal" placeholder="0,00" /></label>
          <label><span>Entrega prevista</span><input type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} /></label>
          <label><span>Total dos itens</span><input value={money(total)} readOnly tabIndex={-1} /></label>
          <label className="almox-largo"><span>Observação (sai na OC)</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" /></label>
        </div>

        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando ? "Registrando…" : "Registrar e gerar a OC"}</Button>
        </footer>
      </form>
    </Modal>
  );
}
