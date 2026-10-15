"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { CAMPOS_PERCENTUAL, SITUACAO_MASCARA, cargaEfetivaIcms, ehSaida, faltandoNaMascara, mascaraDoBanco, situacaoDaMascara, type Mascara, type SituacaoMascara } from "../../../lib/fiscal/mascaras";
import { api, dataHora } from "./comum";

/**
 * Fiscal › Máscaras de impostos: o código interno de cada operação (CFOP) e como cada imposto sai,
 * mais a alíquota do IPI por NCM. O orçamento sugere a máscara pelo estado do cliente e a nota
 * nasce com ela. Os percentuais vêm das notas emitidas pelo GRV e o contador confirma.
 */

type Ncm = { ncm: string; descricao: string | null; ipi_aliquota: number | null; updated_by_name: string | null; updated_at: string };
type Dados = { mascaras: Mascara[]; ncms: Ncm[]; ncmsEmUso: { ncm: string; produtos: number }[]; podeEditar: boolean };
type Aba = "saidas" | "entradas" | "ncm";

const TOM: Record<SituacaoMascara, "danger" | "attention" | "success"> = { incompleta: "danger", a_confirmar: "attention", confirmada: "success" };
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`);
const ncmFmt = (n: string) => (n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : n);
const ORIGEM: Record<Mascara["origem_dados"], string> = { grv: "Máscara do GRV", nota: "Tirado de nota emitida", contador: "Informado pelo contador", manual: "Digitado aqui" };

export function MascarasImpostos({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("saidas");
  const [aberta, setAberta] = useState<Mascara | null>(null);

  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/fiscal/mascaras");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados({ ...r.data, mascaras: r.data.mascaras.map((m) => mascaraDoBanco(m as unknown as Record<string, unknown>)), ncms: r.data.ncms.map((n) => ({ ...n, ipi_aliquota: n.ipi_aliquota === null ? null : Number(n.ipi_aliquota) })) });
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const saidas = useMemo(() => (dados?.mascaras ?? []).filter(ehSaida), [dados]);
  const entradas = useMemo(() => (dados?.mascaras ?? []).filter((m) => !ehSaida(m)), [dados]);
  const ncmLista = useMemo(() => {
    const porNcm = new Map((dados?.ncms ?? []).map((n) => [n.ncm, n]));
    const todos = new Set([...(dados?.ncmsEmUso ?? []).map((n) => n.ncm), ...porNcm.keys()]);
    return [...todos].map((ncm) => ({ ncm, produtos: dados?.ncmsEmUso.find((n) => n.ncm === ncm)?.produtos ?? 0, registro: porNcm.get(ncm) ?? null }))
      .sort((a, b) => b.produtos - a.produtos || a.ncm.localeCompare(b.ncm));
  }, [dados]);
  const contagem = (s: SituacaoMascara) => saidas.filter((m) => situacaoDaMascara(m) === s).length;
  const ncmSemIpi = ncmLista.filter((n) => n.produtos > 0 && (n.registro?.ipi_aliquota ?? null) === null).length;

  const lista = aba === "saidas" ? saidas : entradas;
  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · MÁSCARAS</p><h1>Máscaras de impostos</h1><p>O código de cada operação e como cada imposto sai. O orçamento sugere a máscara pelo estado do cliente e a nota nasce com ela. Os percentuais vêm das notas emitidas; o contador confirma.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          <KpiGrid>
            <Kpi label="Saídas confirmadas" value={`${contagem("confirmada")} de ${saidas.length}`} caption="Conferidas com o contador" tone="green" onOpen={() => setAba("saidas")} />
            <Kpi label="A confirmar" value={String(contagem("a_confirmar"))} caption="Com números, falta o contador" tone="amber" onOpen={() => setAba("saidas")} />
            <Kpi label="Incompletas" value={String(contagem("incompleta"))} caption="O orçamento avisa em vez de calcular" tone="red" onOpen={() => setAba("saidas")} />
            <Kpi label="NCM sem IPI" value={String(ncmSemIpi)} caption="NCMs de produtos sem alíquota" tone="neutral" onOpen={() => setAba("ncm")} />
          </KpiGrid>
          <div className="almox-filtros">
            <Segmented<Aba> options={[{ value: "saidas", label: `Saídas · ${saidas.length}` }, { value: "entradas", label: `Entradas · ${entradas.length}` }, { value: "ncm", label: `IPI por NCM · ${ncmLista.length}` }]} value={aba} onChange={setAba} ariaLabel="Lista" compact />
          </div>
          {aba !== "ncm" ? (
            <section className="almox-bloco">
              {aba === "entradas" && <p className="fiscal-nota-ajuda">As máscaras de entrada são do recebimento de notas; o orçamento usa só as de saída.</p>}
              <div className="vnd-tabela msk-tabela" role="table" aria-label="Máscaras de impostos">
                <div className="cabeca" role="row"><span>Código</span><span>CFOP</span><span>Descrição</span><span>ICMS</span><span>IPI</span><span>PIS / COFINS</span><span>Situação</span></div>
                {lista.map((m) => {
                  const s = situacaoDaMascara(m);
                  const carga = cargaEfetivaIcms(m);
                  return (
                    <button type="button" role="row" key={m.id} onClick={() => setAberta(m)} className={m.ativo ? "" : "msk-inativa"}>
                      <span className="vnd-codigo">{m.codigo}</span>
                      <span>{m.cfop}</span>
                      <span className="nome">{m.descricao}<small>{m.ufs.length ? `Para ${m.ufs.join(", ")}` : m.situacao_tributaria ?? "—"}{m.ativo ? "" : " · desativada"}</small></span>
                      <span>{m.icms_cst ?? "—"} · {pct(m.icms_aliquota)}{m.icms_reducao_base ? <small> red. {pct(m.icms_reducao_base)}{carga !== null ? ` (carga ${pct(carga)})` : ""}</small> : null}</span>
                      <span>{m.ipi_cst ?? "—"} · {m.ipi_aliquota !== null ? pct(m.ipi_aliquota) : "pelo NCM"}</span>
                      <span>{m.pis_cst ?? "—"} {pct(m.pis_aliquota)} / {m.cofins_cst ?? "—"} {pct(m.cofins_aliquota)}</span>
                      <span><Status tone={TOM[s]}>{SITUACAO_MASCARA[s]}</Status></span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <IpiPorNcm key={ncmLista.map((n) => `${n.ncm}:${n.registro?.updated_at ?? ""}`).join("|")} lista={ncmLista} podeEditar={dados.podeEditar} notify={notify} onFeito={() => void carregar()} />
          )}
        </>
      )}
      {aberta && dados && <EditorMascara mascara={aberta} podeEditar={dados.podeEditar} onClose={() => setAberta(null)} onFeito={(m) => { setAberta(null); notify(m); void carregar(); }} />}
    </div>
  );
}

type Campo = { campo: keyof Mascara; rotulo: string; ajuda?: string; largo?: boolean };
const BLOCOS: { titulo: string; campos: Campo[] }[] = [
  { titulo: "Operação", campos: [
    { campo: "descricao", rotulo: "Descrição", largo: true }, { campo: "cfop", rotulo: "CFOP" }, { campo: "natureza", rotulo: "Natureza da operação (na nota)", largo: true },
    { campo: "ufs", rotulo: "Estados de destino", ajuda: "Ex.: PE ou RJ, RS. Vazio: qualquer estado" }, { campo: "situacao_tributaria", rotulo: "Situação tributária (texto do GRV)", largo: true },
  ] },
  { titulo: "ICMS", campos: [
    { campo: "icms_cst", rotulo: "CST", ajuda: "00 tributada · 20 com redução · 41 não tributada · 50 suspensão · 51 diferimento" },
    { campo: "icms_aliquota", rotulo: "Alíquota (%)" }, { campo: "icms_reducao_base", rotulo: "Redução da base (%)" }, { campo: "icms_diferimento", rotulo: "Diferimento (%)" },
  ] },
  { titulo: "IPI", campos: [
    { campo: "ipi_enquadramento", rotulo: "Enquadramento", ajuda: "999 tributação normal · 108 suspensão" }, { campo: "ipi_cst", rotulo: "CST", ajuda: "50 tributada · 51 alíquota zero · 53 não tributada · 55 suspensão" },
    { campo: "ipi_aliquota", rotulo: "Alíquota (%)", ajuda: "Vazio: usa a alíquota do NCM do produto" },
  ] },
  { titulo: "PIS e COFINS", campos: [
    { campo: "pis_cst", rotulo: "CST do PIS" }, { campo: "pis_aliquota", rotulo: "Alíquota do PIS (%)" },
    { campo: "cofins_cst", rotulo: "CST da COFINS" }, { campo: "cofins_aliquota", rotulo: "Alíquota da COFINS (%)" },
  ] },
  { titulo: "IBS e CBS (reforma)", campos: [
    { campo: "ibs_cbs_cst", rotulo: "CST" }, { campo: "cclasstrib", rotulo: "Classificação (cClassTrib)" }, { campo: "ibs_aliquota", rotulo: "IBS (%)" }, { campo: "cbs_aliquota", rotulo: "CBS (%)" },
  ] },
  { titulo: "Outros", campos: [
    { campo: "conta_plano", rotulo: "Conta do plano" }, { campo: "conta_plano_descricao", rotulo: "Descrição da conta", largo: true },
    { campo: "obs_nota", rotulo: "Texto na observação da nota (base legal)", largo: true },
  ] },
];

const paraTexto = (m: Mascara, c: keyof Mascara) => {
  const v = m[c];
  if (Array.isArray(v)) return v.join(", ");
  if (v === null || v === undefined) return "";
  if ((CAMPOS_PERCENTUAL as readonly string[]).includes(c as string)) return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return String(v);
};

function EditorMascara({ mascara: m, podeEditar, onClose, onFeito }: { mascara: Mascara; podeEditar: boolean; onClose: () => void; onFeito: (m: string) => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(BLOCOS.flatMap((b) => b.campos).map(({ campo }) => [campo, paraTexto(m, campo)])));
  const [excluiIcms, setExcluiIcms] = useState(m.pis_cofins_exclui_icms);
  const [ativo, setAtivo] = useState(m.ativo);
  const [origem, setOrigem] = useState<Mascara["origem_dados"]>(m.origem_dados);
  const [obs, setObs] = useState(m.observacao_interna ?? "");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const faltando = faltandoNaMascara(m);
  const situacao = situacaoDaMascara(m);
  const mudou = BLOCOS.flatMap((b) => b.campos).some(({ campo }) => form[campo] !== paraTexto(m, campo)) || excluiIcms !== m.pis_cofins_exclui_icms || ativo !== m.ativo || origem !== m.origem_dados || obs !== (m.observacao_interna ?? "");

  const enviar = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    setErro("");
    const r = await api(`/api/fiscal/mascaras/${m.id}`, { method: "PUT", body: JSON.stringify(corpo) });
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(ok);
  };
  const salvar = (e: React.FormEvent) => {
    e.preventDefault();
    void enviar({ ...form, pis_cofins_exclui_icms: excluiIcms, ativo, origem_dados: origem, observacao_interna: obs }, `Máscara ${m.codigo} salva.${m.confirmada_em ? " Se mudou algum número, ela volta a \"a confirmar\"." : ""}`);
  };

  return (
    <Modal eyebrow={`FISCAL · MÁSCARA ${m.codigo}`} title={`${m.codigo} · ${m.descricao}`} subtitle={<>{SITUACAO_MASCARA[situacao]}{m.confirmada_em ? ` por ${m.confirmada_por_nome ?? "—"} em ${dataHora(m.confirmada_em)}` : ""} · {ORIGEM[m.origem_dados]}{m.updated_by_name ? ` · alterada por ${m.updated_by_name} em ${dataHora(m.updated_at)}` : ""}</>} onClose={onClose}>
      <form className="almox-form msk-editor" onSubmit={salvar}>
        {ehSaida(m) && faltando.length > 0 && <Callout variant="warning" title="Falta para calcular">{faltando.join(", ")}. Enquanto faltar, o orçamento avisa em vez de calcular.</Callout>}
        {m.observacao_interna && <Callout variant="info" title="Anotação">{m.observacao_interna}</Callout>}
        <fieldset disabled={!podeEditar || ocupado} className="msk-blocos">
          {BLOCOS.map((b) => (
            <section key={b.titulo} className="almox-bloco-interno">
              <p className="almox-rotulo">{b.titulo}</p>
              <div className="fiscal-campos nfe-campos">
                {b.campos.map(({ campo, rotulo, ajuda, largo }) => (
                  <label key={campo} className={largo ? "nfe-largo" : ""}>
                    <span>{rotulo}{ajuda ? <small> · {ajuda}</small> : null}</span>
                    <input value={form[campo]} onChange={(e) => setForm((f) => ({ ...f, [campo]: e.target.value }))} inputMode={(CAMPOS_PERCENTUAL as readonly string[]).includes(campo) ? "decimal" : undefined} />
                  </label>
                ))}
                {b.titulo === "PIS e COFINS" && (
                  <label className="nfe-check"><input type="checkbox" checked={excluiIcms} onChange={(e) => setExcluiIcms(e.target.checked)} /><span>Tirar o ICMS da base do PIS e da COFINS</span></label>
                )}
              </div>
            </section>
          ))}
          <section className="almox-bloco-interno">
            <p className="almox-rotulo">Controle</p>
            <div className="fiscal-campos nfe-campos">
              <label><span>De onde vieram os números</span>
                <select value={origem} onChange={(e) => setOrigem(e.target.value as Mascara["origem_dados"])}>{Object.entries(ORIGEM).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label className="nfe-check"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /><span>Ativa (aparece para escolher)</span></label>
              <label className="nfe-cheio"><span>Anotação interna</span><input value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} /></label>
            </div>
          </section>
        </fieldset>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          {podeEditar && !mudou && situacao === "a_confirmar" && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => void enviar({ confirmar: true }, `Máscara ${m.codigo} marcada como confirmada com o contador.`)}>Confirmada com o contador</Button>}
          {podeEditar && !mudou && situacao === "confirmada" && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => void enviar({ confirmar: false }, `Máscara ${m.codigo} voltou para "a confirmar".`)}>Tirar a confirmação</Button>}
          {podeEditar && <Button type="submit" disabled={ocupado || !mudou}>{ocupado ? "Salvando…" : "Salvar"}</Button>}
        </footer>
      </form>
    </Modal>
  );
}

function IpiPorNcm({ lista, podeEditar, notify, onFeito }: { lista: { ncm: string; produtos: number; registro: Ncm | null }[]; podeEditar: boolean; notify: (m: string) => void; onFeito: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(lista.map((n) => [n.ncm, n.registro?.ipi_aliquota === null || n.registro?.ipi_aliquota === undefined ? "" : String(n.registro.ipi_aliquota).replace(".", ",")])));
  const [novo, setNovo] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const gravar = async (ncm: string) => {
    setOcupado(ncm);
    const r = await api("/api/fiscal/ncm", { method: "PUT", body: JSON.stringify({ ncm, ipi_aliquota: valores[ncm] ?? "" }) });
    setOcupado(null);
    notify(r.ok ? `IPI do NCM ${ncmFmt(ncm)} gravado.` : r.error);
    if (r.ok) onFeito();
  };
  return (
    <section className="almox-bloco">
      <p className="fiscal-nota-ajuda">A alíquota do IPI segue a TIPI pelo NCM. Quando a máscara não tem alíquota própria, o orçamento e a nota usam a daqui. Os NCMs dos produtos cadastrados aparecem sozinhos.</p>
      {lista.length ? (
        <div className="vnd-tabela msk-ncm" role="table" aria-label="IPI por NCM">
          <div className="cabeca" role="row"><span>NCM</span><span className="r">Produtos</span><span>Alíquota do IPI (%)</span><span>Alterado</span><span /></div>
          {lista.map((n) => (
            <div role="row" key={n.ncm}>
              <span className="vnd-codigo">{ncmFmt(n.ncm)}</span>
              <span className="r">{n.produtos}</span>
              <span><input className="msk-input" inputMode="decimal" aria-label={`IPI do NCM ${n.ncm}`} value={valores[n.ncm] ?? ""} disabled={!podeEditar} placeholder="sem alíquota" onChange={(e) => setValores((v) => ({ ...v, [n.ncm]: e.target.value }))} /></span>
              <span>{n.registro?.updated_by_name ? `${n.registro.updated_by_name} · ${dataHora(n.registro.updated_at)}` : "—"}</span>
              <span>{podeEditar && <Button compact variant="secondary" disabled={ocupado !== null} onClick={() => void gravar(n.ncm)}>{ocupado === n.ncm ? "Gravando…" : "Gravar"}</Button>}</span>
            </div>
          ))}
        </div>
      ) : <div className="finance-empty"><b>Nenhum NCM ainda</b><small>Os NCMs aparecem quando os produtos forem cadastrados com NCM.</small></div>}
      {podeEditar && (
        <div className="msk-ncm-novo">
          <input className="msk-input" inputMode="numeric" aria-label="Novo NCM" placeholder="Outro NCM (8 dígitos)" value={novo} onChange={(e) => setNovo(e.target.value.replace(/\D/g, "").slice(0, 8))} />
          <Button compact variant="secondary" disabled={novo.length !== 8} onClick={() => { setValores((v) => ({ ...v, [novo]: v[novo] ?? "" })); void (async () => { const r = await api("/api/fiscal/ncm", { method: "PUT", body: JSON.stringify({ ncm: novo, ipi_aliquota: "" }) }); notify(r.ok ? `NCM ${ncmFmt(novo)} incluído: informe a alíquota.` : r.error); if (r.ok) { setNovo(""); onFeito(); } })(); }}>Incluir NCM</Button>
        </div>
      )}
    </section>
  );
}
