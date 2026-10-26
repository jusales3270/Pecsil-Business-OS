"use client";

import { useEffect, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Segmented } from "../../../packages/design-system";
import { caixa, parcelaDoSaldoIcms, simular, type Impostos, type Premissas } from "../../../lib/contabil/reforma";
import { lerNumeroBr } from "../../../lib/numero-br";
import { api, date, money } from "./comum";

/**
 * Fiscal › Simulador da reforma (N-11): uma venda (um orçamento ou um valor com a máscara de impostos) de 2026 a
 * 2033, com IPI zero e PIS/COFINS extintos em 2027, a CBS da Resolução do Senado e a troca do ICMS pelo IBS de
 * 2029 a 2033; mais o caixa com o split payment e o saldo de ICMS. Tudo é estimativa: as premissas vêm dos
 * parâmetros legais e quem usa pode trocá-las aqui (nada é gravado).
 */

type Mascara = { id: string; codigo: string; descricao: string; cfop: string | null; icms_aliquota: number | null; icms_reducao_base: number | null; ipi_aliquota: number | null; pis_aliquota: number | null; cofins_aliquota: number | null; pis_cofins_exclui_icms: boolean };
type Orcamento = { id: string; numero: number | null; data: string | null; situacao: string; treino: boolean; cliente: string | null; mascaraId: string | null; prazo: number | null; condicao: string | null; total: number };
type Dados = { orcamentos: Orcamento[]; mascaras: Mascara[]; premissas: Premissas; aConferir: boolean; fontes: string[] };

const pct = (v: number, casas = 2) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`;
const variacao = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const numero = (t: string) => lerNumeroBr(t);
const comAliquota = (m: Mascara) => m.icms_aliquota !== null || m.pis_aliquota !== null || m.ipi_aliquota !== null;

export function SimuladorReforma() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [origem, setOrigem] = useState<"orcamento" | "valor">("orcamento");
  const [orcId, setOrcId] = useState<string>("");
  const [valorLivre, setValorLivre] = useState("10.000,00");
  const [mascaraId, setMascaraId] = useState<string>("");
  const [manter, setManter] = useState<"receita" | "preco">("receita");
  const [prazo, setPrazo] = useState("30");
  const [cbs, setCbs] = useState("");
  const [ibs, setIbs] = useState("");
  const [saldoIcms, setSaldoIcms] = useState("");
  // Alíquotas à mão: para quem não vê as máscaras (a credencial manda) ou quer testar outra combinação.
  const [mao, setMao] = useState({ icms: "18", reducao: "0", ipi: "0", pis: "0,65", cofins: "3", excluiIcms: true });

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await api<Dados>("/api/fiscal/reforma");
      if (!r.ok) { setErro(r.error); return; }
      setDados(r.data);
      setCbs(String(r.data.premissas.cbsReferencia * 100).replace(".", ","));
      setIbs(String(r.data.premissas.ibsReferencia * 100).replace(".", ","));
      const o = r.data.orcamentos[0];
      if (o) { setOrcId(o.id); if (o.prazo) setPrazo(String(o.prazo)); } else setOrigem("valor");
      setMascaraId((o?.mascaraId && r.data.mascaras.some((m) => m.id === o.mascaraId) ? o.mascaraId : r.data.mascaras.find(comAliquota)?.id) ?? "");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const orc = dados?.orcamentos.find((o) => o.id === orcId) ?? null;
  const aMao = mascaraId === "mao" || !(dados?.mascaras.some(comAliquota) ?? false);
  const mascara = aMao ? null : dados?.mascaras.find((m) => m.id === mascaraId) ?? null;
  const valor = origem === "orcamento" ? orc?.total ?? 0 : numero(valorLivre);
  const premissas: Premissas | null = dados ? { ...dados.premissas, cbsReferencia: numero(cbs) / 100, ibsReferencia: numero(ibs) / 100 } : null;
  const imp: Impostos | null = aMao ? { icms: numero(mao.icms), reducaoBaseIcms: numero(mao.reducao), ipi: numero(mao.ipi), pis: numero(mao.pis), cofins: numero(mao.cofins), pisCofinsExcluiIcms: mao.excluiIcms } : mascara ? { icms: Number(mascara.icms_aliquota ?? 0), reducaoBaseIcms: Number(mascara.icms_reducao_base ?? 0), ipi: Number(mascara.ipi_aliquota ?? 0), pis: Number(mascara.pis_aliquota ?? 0), cofins: Number(mascara.cofins_aliquota ?? 0), pisCofinsExcluiIcms: mascara.pis_cofins_exclui_icms } : null;
  const anos = premissas && imp && valor > 0 ? simular(valor, imp, premissas, manter) : [];
  const a26 = anos[0], a27 = anos.find((a) => a.ano === 2027), a33 = anos.find((a) => a.ano === 2033);
  const cx = anos.length ? caixa(anos, Math.max(0, Math.round(numero(prazo)))) : null;

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · REFORMA</p><h1>Simulador da reforma</h1><p>Uma venda de 2026 a 2033: IPI zero e PIS/COFINS extintos em 2027, a CBS que o Senado fixar e a troca do ICMS pelo IBS de 2029 a 2033. Para o preço do orçamento e para o caixa. Nada aqui é gravado.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && premissas && (
        <>
          <Callout variant="warning" title="Estimativa">As alíquotas de 2027 em diante ainda não existem: a CBS sai por Resolução do Senado (até 15/12/2026) e o IBS de referência é o do Comitê Gestor. Premissas dos Parâmetros legais{dados.aConferir ? ", ainda a conferir pelo contador" : ""}: {dados.fontes.join("; ")}.</Callout>
          <section className="almox-bloco rf-entradas">
            <div className="rf-linha">
              <Segmented<"orcamento" | "valor"> options={[{ value: "orcamento", label: "Orçamento" }, { value: "valor", label: "Valor livre" }]} value={origem} onChange={setOrigem} ariaLabel="Origem" compact />
              {origem === "orcamento" ? (
                <label className="pcf-mes rf-largo"><span>Orçamento</span>
                  <select value={orcId} onChange={(e) => { const o = dados.orcamentos.find((x) => x.id === e.target.value); setOrcId(e.target.value); if (o?.mascaraId) setMascaraId(o.mascaraId); if (o?.prazo) setPrazo(String(o.prazo)); }} disabled={!dados.orcamentos.length}>
                    {!dados.orcamentos.length && <option value="">Nenhum orçamento que você possa ver</option>}
                    {dados.orcamentos.map((o) => <option key={o.id} value={o.id}>{o.treino ? "T-" : "nº "}{o.numero ?? "—"} · {o.cliente ?? "sem cliente"} · {money(o.total)}{o.treino ? " · treino" : ""}</option>)}
                  </select>
                </label>
              ) : (
                <label className="pcf-mes"><span>Valor dos produtos (R$)</span><input className="rf-num" inputMode="decimal" value={valorLivre} onChange={(e) => setValorLivre(e.target.value)} /></label>
              )}
              <label className="pcf-mes rf-largo"><span>Máscara de impostos</span>
                <select value={aMao ? "mao" : mascaraId} onChange={(e) => setMascaraId(e.target.value)}>
                  {dados.mascaras.filter(comAliquota).map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.descricao}</option>)}
                  <option value="mao">Alíquotas à mão</option>
                </select>
              </label>
            </div>
            {aMao && (
              <div className="rf-linha">
                {([["icms", "ICMS (%)"], ["reducao", "Redução da base do ICMS (%)"], ["ipi", "IPI (%)"], ["pis", "PIS (%)"], ["cofins", "COFINS (%)"]] as const).map(([k, rotulo]) => (
                  <label key={k} className="pcf-mes"><span>{rotulo}</span><input className="rf-num" inputMode="decimal" value={mao[k]} onChange={(e) => setMao((m) => ({ ...m, [k]: e.target.value }))} /></label>
                ))}
                <label className="nfe-check"><input type="checkbox" checked={mao.excluiIcms} onChange={(e) => setMao((m) => ({ ...m, excluiIcms: e.target.checked }))} /><span>PIS/COFINS sem o ICMS na base</span></label>
              </div>
            )}
            {aMao && !dados.mascaras.some(comAliquota) && <p className="fiscal-nota-ajuda">Você não vê as máscaras de impostos (quem vê: Configuração fiscal, NF-e ou Orçamentos). Informe as alíquotas da venda.</p>}
            <div className="rf-linha">
              <Segmented<"receita" | "preco"> options={[{ value: "receita", label: "Manter a receita líquida" }, { value: "preco", label: "Manter o preço dos produtos" }]} value={manter} onChange={setManter} ariaLabel="O que manter" compact />
              <label className="pcf-mes"><span>Prazo do cliente (dias)</span><input className="rf-num" inputMode="numeric" value={prazo} onChange={(e) => setPrazo(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
              <label className="pcf-mes"><span>CBS de referência (%)</span><input className="rf-num" inputMode="decimal" value={cbs} onChange={(e) => setCbs(e.target.value)} /></label>
              <label className="pcf-mes"><span>IBS de referência (%)</span><input className="rf-num" inputMode="decimal" value={ibs} onChange={(e) => setIbs(e.target.value)} /></label>
              <Button variant="secondary" compact onClick={() => { setCbs(String(dados.premissas.cbsReferencia * 100).replace(".", ",")); setIbs(String(dados.premissas.ibsReferencia * 100).replace(".", ",")); }}>Voltar às premissas</Button>
            </div>
            {mascara && <p className="fiscal-nota-ajuda">Máscara {mascara.codigo} (CFOP {mascara.cfop ?? "—"}): ICMS {Number(mascara.icms_aliquota ?? 0).toLocaleString("pt-BR")}%{mascara.icms_reducao_base ? ` com ${Number(mascara.icms_reducao_base).toLocaleString("pt-BR")}% de redução da base` : ""}, IPI {Number(mascara.ipi_aliquota ?? 0).toLocaleString("pt-BR")}%, PIS {Number(mascara.pis_aliquota ?? 0).toLocaleString("pt-BR")}% e COFINS {Number(mascara.cofins_aliquota ?? 0).toLocaleString("pt-BR")}%{mascara.pis_cofins_exclui_icms ? " (sem o ICMS na base)" : ""}. Em 2027–2028 a CBS é a de referência menos 0,1 ponto; o IBS é 0,1%. De 2029 a 2032 o ICMS fica em {Object.values(premissas.fatorIcms).map((f) => pct(f, 0)).join(", ")} e o IBS sobe na mesma proporção.</p>}
            {orc && origem === "orcamento" && <p className="fiscal-nota-ajuda">Orçamento de {date(orc.data)} · condição de pagamento: {orc.condicao ?? "não informada"}. Carga = tributos na nota sobre o total da nota.</p>}
          </section>
          {anos.length > 0 && a26 && a27 && a33 && cx && (
            <>
              <KpiGrid>
                <Kpi label="Nota em 2026" value={money(a26.totalNota)} caption={`Produtos ${money(a26.produtos)} + IPI ${money(a26.ipi)}; CBS e IBS só destacados`} tone="neutral" />
                <Kpi label="Nota em 2027" value={money(a27.totalNota)} caption={`${variacao(a27.variacaoNota)} · IPI zero, sem PIS/COFINS, CBS ${money(a27.cbs)} por fora`} tone={a27.variacaoNota > 0 ? "amber" : "green"} />
                <Kpi label="Nota em 2033" value={money(a33.totalNota)} caption={`${variacao(a33.variacaoNota)} · sem ICMS; CBS ${money(a33.cbs)} e IBS ${money(a33.ibs)}`} tone={a33.variacaoNota > 0 ? "amber" : "green"} />
                <Kpi label={manter === "receita" ? "Receita líquida (mantida)" : "Receita líquida em 2027"} value={money(a27.receitaLiquida)} caption={manter === "receita" ? "O preço dos produtos muda para a empresa receber o mesmo" : `${variacao(a27.receitaLiquida / a26.receitaLiquida - 1)} sobre 2026, com o mesmo preço dos produtos`} tone="neutral" />
              </KpiGrid>
              <section className="almox-bloco">
                <h3 className="ctb-titulo">Ano a ano</h3>
                <div className="vnd-tabela rf-tabela" role="table" aria-label="Venda ano a ano">
                  <div className="cabeca" role="row"><span>Ano</span><span className="r">Produtos</span><span className="r">ICMS</span><span className="r">IPI</span><span className="r">PIS/COFINS</span><span className="r">CBS</span><span className="r">IBS</span><span className="r">Total da nota</span><span className="r">Variação</span><span className="r">Carga</span></div>
                  {anos.map((a) => (
                    <div role="row" key={a.ano} className={a.ano === 2027 ? "rf-destaque" : undefined}>
                      <span className="nome">{a.ano}{a.ano === 2026 ? <small>CBS/IBS só destacados</small> : a.ano <= 2028 ? <small>IPI zero; CBS do Senado</small> : a.ano < 2033 ? <small>ICMS em {pct(premissas.fatorIcms[a.ano] ?? 0, 0)}</small> : <small>sem ICMS</small>}</span>
                      <span className="r">{money(a.produtos)}</span>
                      <span className="r">{money(a.icms)}</span>
                      <span className="r">{a.ipi ? money(a.ipi) : "—"}</span>
                      <span className="r">{a.pis + a.cofins ? money(a.pis + a.cofins) : "—"}</span>
                      <span className={`r${a.ibsCbsNaNota ? "" : " rf-informativo"}`}>{money(a.cbs)}</span>
                      <span className={`r${a.ibsCbsNaNota ? "" : " rf-informativo"}`}>{money(a.ibs)}</span>
                      <span className="r">{money(a.totalNota)}</span>
                      <span className="r">{a.ano === 2026 ? "—" : variacao(a.variacaoNota)}</span>
                      <span className="r">{pct(a.cargaSobreNota, 1)}</span>
                    </div>
                  ))}
                </div>
                <p className="fiscal-nota-ajuda">{manter === "receita" ? "Mantendo a receita líquida: o valor dos produtos muda para a empresa ficar com o mesmo de 2026 depois do ICMS e do PIS/COFINS. " : "Mantendo o preço dos produtos: a receita líquida muda com o tributo \"por dentro\". "}CBS e IBS são calculados sobre a receita líquida (LC 214, art. 12) e, de 2027 em diante, somam na nota, como o IPI hoje. Para o cliente que é contribuinte, CBS e IBS viram crédito.</p>
              </section>
              <section className="almox-bloco">
                <h3 className="ctb-titulo">Caixa da venda: hoje × 2027 com split payment</h3>
                <div className="rf-caixa">
                  <div><b>Hoje (2026)</b><span>Recebe {money(cx.hoje.recebe)} em {cx.hoje.recebeEm} dias.</span><span>Paga {money(cx.hoje.paga)} de tributos cerca de {cx.hoje.pagaEm} dias depois da nota.</span>{cx.financiaHoje > 0 ? <span className="rf-alerta">A empresa banca {money(cx.tributoFinanciadoHoje)} de tributo por {cx.financiaHoje} dias antes de receber.</span> : <span>Recebe antes de pagar os tributos.</span>}</div>
                  <div><b>2027 com split payment</b><span>O cliente paga {money(a27.totalNota)}; {money(cx.split.retidoNoPagamento)} de CBS/IBS saem direto no pagamento.</span><span>Entram {money(cx.split.recebe)} em {cx.split.recebeEm} dias; o ICMS ({money(cx.split.paga)}) segue como hoje.</span>{cx.financiaHoje > 0 ? <span>O tributo bancado antes de receber cai para {money(cx.tributoFinanciado2027)} (só o ICMS).</span> : <span>Os créditos da empresa voltam pela apuração.</span>}</div>
                </div>
                <p className="fiscal-nota-ajuda">Split payment: opcional em 2027 (testes desde 15/10/2026); a obrigatoriedade está sinalizada para 2028, ainda sem ato. Conta simplificada: o IBS/CBS da nota inteira sai no pagamento.</p>
              </section>
            </>
          )}
          {!anos.length && <div className="finance-empty"><b>Escolha um orçamento com valor e uma máscara com alíquotas</b></div>}
          <section className="almox-bloco">
            <h3 className="ctb-titulo">Saldo credor de ICMS em 2032</h3>
            <div className="rf-linha">
              <label className="pcf-mes"><span>Saldo credor estimado (R$)</span><input className="rf-num" inputMode="decimal" placeholder="0,00" value={saldoIcms} onChange={(e) => setSaldoIcms(e.target.value)} /></label>
              {numero(saldoIcms) > 0 && <p className="rf-saldo">Vira crédito de IBS em 240 parcelas de {money(parcelaDoSaldoIcms(numero(saldoIcms)))} por mês, corrigidas pelo IPCA, depois da homologação pelo Estado (até 5 anos a partir de 2033; silêncio = homologado).</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
