"use client";

import { useEffect, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Status, type StatusTone } from "../../../packages/design-system";
import { api, date, money, nomeMes } from "./comum";

/**
 * Fiscal › Apurações (N-07): o IRPJ e a CSLL do Lucro Presumido por trimestre (com a LC 224) e o PIS/COFINS por mês,
 * calculados a partir das notas de saída guardadas, e cada guia do portal conferida contra a apuração. A base pelas
 * notas é de competência (data de emissão); enquanto o escritório não confirmar o método, vale como estimativa.
 */
type Passo = { passo: string; valor: number };
type Mes = {
  competencia: string; notas: number; erro?: string;
  receita: { industria: number; servicos: number; exportacao: number; devolucoes: number } | null;
  pisCofins: { base: number; pis: number; cofins: number; memoria: Passo[]; aConferir: boolean } | null;
};
type Trimestre = {
  trimestre: number; fim: string; receita: number; limite: number | null; excesso: number; irpj: number; csllDevida: number; vencimento: string | null;
  deducao: { irpj: number; csll: number }; restituir: { irpj: number; csll: number }; memoria: Passo[];
};
type Guia = {
  id: string; tipo: string; valor: number; vencimento: string; codigo_receita: string | null; tributo: string | null; periodo_apuracao: string | null; document_id: string | null;
  conferencia: { situacao: "confere" | "diverge" | "sem_base" | "sem_codigo"; esperado: number | null; diferenca: number | null; motivos: string[] };
};
type Dados = { ano: number; hoje: string; regime: string; aviso: string | null; meses: Mes[]; trimestres: Trimestre[]; notasAno: string[]; aConferir: boolean; guias: Guia[]; semNotas: string[] };

const SITUACAO: Record<Guia["conferencia"]["situacao"], [string, StatusTone]> = {
  confere: ["Confere", "success"], diverge: ["Diverge", "danger"], sem_base: ["Sem base para conferir", "neutral"], sem_codigo: ["Sem código da receita", "attention"],
};
const mesCurto = (c: string) => nomeMes(c).replace(" de ", "/");

export function Apuracoes({ notify }: { notify: (m: string) => void }) {
  const anoAtual = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [memoria, setMemoria] = useState<{ titulo: string; passos: Passo[] } | null>(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await api<Dados>(`/api/fiscal/apuracoes?ano=${ano}`);
      if (!r.ok) { setErro(r.error); notify(r.error); return; }
      setErro(""); setDados(r.data);
    }, 0);
    return () => clearTimeout(t);
  }, [ano, notify]);
  // Só a resposta do ano escolhido vale (a do ano anterior pode chegar depois).
  const d = dados && dados.ano === ano ? dados : null;

  const comNotas = (d?.meses ?? []).filter((m) => m.receita);
  const receitaAno = comNotas.reduce((s, m) => s + (m.receita!.industria + m.receita!.servicos - m.receita!.devolucoes), 0);
  const irpjCsll = (d?.trimestres ?? []).reduce((s, t) => s + t.irpj + t.csllDevida, 0);
  const pisCofins = comNotas.reduce((s, m) => s + (m.pisCofins ? m.pisCofins.pis + m.pisCofins.cofins : 0), 0);
  const divergentes = (d?.guias ?? []).filter((g) => g.conferencia.situacao === "diverge").length;

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · APURAÇÕES</p><h1>Apurações do Lucro Presumido</h1><p>IRPJ e CSLL por trimestre (com a LC 224) e PIS/COFINS por mês, a partir das notas de saída, e cada guia do escritório conferida contra o cálculo.</p></div>
      </div>
      <div className="almox-filtros">
        <label className="pcf-mes"><span>Ano</span>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))}>{[anoAtual, anoAtual - 1].map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </label>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!d && !erro && <div className="finance-empty almox-vazio"><small>Calculando…</small></div>}
      {d && (
        <>
          {d.regime !== "presumido" && <Callout variant="warning" title="O perfil da empresa não está como Lucro Presumido">Esta tela calcula o Presumido. Confira o regime em Parâmetros legais › Perfil da empresa.</Callout>}
          <Callout variant="info" title="Base pelas notas de saída (competência), a confirmar com o escritório">A receita é somada pela data de emissão das notas guardadas na plataforma (vendas e industrialização pelo CFOP, exportação fora do PIS/COFINS, devoluções de venda descontadas, sem IPI). Se o escritório apura pelo recebimento, a base é outra: o método foi pedido ao escritório.</Callout>
          {d.semNotas.length > 0 && <Callout variant="warning" title={`${d.semNotas.length} ${d.semNotas.length === 1 ? "mês sem notas de saída" : "meses sem notas de saída"}`}>{d.semNotas.map(mesCurto).join(", ")}. Os XMLs das notas emitidas entram pela Coleta de arquivos (Fiscal) ou por Documentos › Fiscal. Trimestre com mês faltando não é calculado.</Callout>}
          {d.aConferir && <Callout variant="info" title="Percentuais ainda a conferir">Os percentuais do Presumido e o limite da LC 224 estão nos Parâmetros legais como rascunho até o contador conferir.</Callout>}
          {d.notasAno.map((n) => <Callout key={n} variant="info" title="Ajuste anual">{n}</Callout>)}
          {d.aviso && <p className="fiscal-nota-ajuda">{d.aviso}</p>}

          <KpiGrid>
            <Kpi label="Receita pelas notas" value={money(receitaAno)} caption={`${comNotas.length} de ${d.meses.length} meses com notas`} tone="neutral" />
            <Kpi label="IRPJ + CSLL" value={money(irpjCsll)} caption={`${d.trimestres.length} trimestre(s) completo(s)`} tone="neutral" />
            <Kpi label="PIS + COFINS" value={money(pisCofins)} caption="Cumulativos (0,65% e 3%)" tone="neutral" />
            <Kpi label="Guias" value={String(d.guias.length)} caption={divergentes ? `${divergentes} com divergência` : "conferidas contra a apuração"} tone={divergentes ? "amber" : "green"} />
          </KpiGrid>

          <section className="almox-bloco">
            <h3 className="ctb-titulo">IRPJ e CSLL por trimestre</h3>
            {d.trimestres.length ? (
              <div className="vnd-tabela apu-tri" role="table" aria-label="IRPJ e CSLL por trimestre">
                <div className="cabeca" role="row"><span>Trimestre</span><span className="r">Receita</span><span className="r">Acima do limite (LC 224)</span><span className="r">IRPJ</span><span className="r">CSLL</span><span>Vencimento</span><span /></div>
                {d.trimestres.map((t) => (
                  <div role="row" key={t.trimestre}>
                    <span className="nome">{t.trimestre}º trimestre{(t.restituir.irpj > 0 || t.restituir.csll > 0) && <small>A restituir: {money(t.restituir.irpj + t.restituir.csll)}</small>}</span>
                    <span className="r">{money(t.receita)}</span>
                    <span className="r">{t.limite === null ? "—" : money(t.excesso)}</span>
                    <span className="r">{money(t.irpj)}</span>
                    <span className="r">{money(t.csllDevida)}</span>
                    <span>{date(t.vencimento)}</span>
                    <span><Button variant="ghost" compact onClick={() => setMemoria({ titulo: `${t.trimestre}º trimestre de ${d.ano}`, passos: t.memoria })}>Memória de cálculo</Button></span>
                  </div>
                ))}
              </div>
            ) : <div className="finance-empty"><b>Nenhum trimestre completo</b><small>O cálculo começa quando os três meses do 1º trimestre tiverem as notas de saída.</small></div>}
          </section>

          <section className="almox-bloco">
            <h3 className="ctb-titulo">PIS e COFINS por mês</h3>
            <div className="vnd-tabela apu-mes" role="table" aria-label="PIS e COFINS por mês">
              <div className="cabeca" role="row"><span>Mês</span><span className="r">Notas</span><span className="r">Receita</span><span className="r">Exportação</span><span className="r">Base</span><span className="r">PIS</span><span className="r">COFINS</span></div>
              {d.meses.map((m) => (
                <div role="row" key={m.competencia}>
                  <span className="nome">{mesCurto(m.competencia)}{m.erro && <small className="ctb-alerta">{m.erro}</small>}</span>
                  <span className="r">{m.notas || "—"}</span>
                  <span className="r">{m.receita ? money(m.receita.industria + m.receita.servicos) : "—"}</span>
                  <span className="r">{m.receita?.exportacao ? money(m.receita.exportacao) : "—"}</span>
                  <span className="r">{m.pisCofins ? money(m.pisCofins.base) : "—"}</span>
                  <span className="r">{m.pisCofins ? money(m.pisCofins.pis) : "—"}</span>
                  <span className="r">{m.pisCofins ? money(m.pisCofins.cofins) : "—"}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="almox-bloco">
            <h3 className="ctb-titulo">Guias conferidas</h3>
            {d.guias.length ? (
              <div className="vnd-tabela apu-guias" role="table" aria-label="Guias conferidas">
                <div className="cabeca" role="row"><span>Guia</span><span>Período</span><span className="r">Valor</span><span className="r">Apuração</span><span>Situação</span></div>
                {d.guias.map((g) => (
                  <div role="row" key={g.id}>
                    <span className="nome">{g.tipo}{g.codigo_receita ? ` · ${g.codigo_receita}` : ""}{g.tributo ? ` · ${g.tributo}` : ""}<small>Vence {date(g.vencimento)}</small></span>
                    <span>{date(g.periodo_apuracao)}</span>
                    <span className="r">{money(Number(g.valor))}</span>
                    <span className="r">{g.conferencia.esperado === null ? "—" : money(g.conferencia.esperado)}</span>
                    <span className="ctb-situacao"><Status tone={SITUACAO[g.conferencia.situacao][1]}>{SITUACAO[g.conferencia.situacao][0]}</Status>
                      {g.conferencia.motivos.map((m) => <small key={m} className="ctb-evidencia">{m}</small>)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="finance-empty"><b>Nenhuma guia no ano</b><small>As guias que o escritório envia pelo Portal do contador (DARF com o código da receita) aparecem aqui conferidas.</small></div>}
          </section>
        </>
      )}
      {memoria && (
        <Modal eyebrow="APURAÇÕES · MEMÓRIA DE CÁLCULO" title={memoria.titulo} onClose={() => setMemoria(null)}>
          <div className="vnd-tabela apu-memoria" role="table" aria-label="Memória de cálculo">
            {memoria.passos.map((p, i) => <div role="row" key={i}><span className="nome">{p.passo}</span><span className="r">{money(p.valor)}</span></div>)}
          </div>
        </Modal>
      )}
    </div>
  );
}
