"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportDocument, ReportHeader } from "../../components/report-layout";
import { ROTULO_EXIGENCIA, ROTULO_GERAL, dataValida, type FichaEpi, type RelatorioEpi } from "../../../lib/rh/epi-relatorio";

/**
 * Relatório de EPIs (RH › Relatórios, 28/10/2026): comprova se cada colaborador está em dia com os EPIs
 * exigidos para a função, com as entregas do período e a assinatura de recebimento. Primeira folha com o
 * resumo; depois uma folha por colaborador (pode ser impressa e entregue em separado).
 */

type Filtros = { colaborador: string | null; item: string | null; setor: string | null; situacao: string | null; funcoesComExigencia: number };
type Estado =
  | { status: "loading" }
  | { status: "error"; mensagem: string }
  | { status: "ready"; relatorio: RelatorioEpi; filtros: Filtros; geradoEm: Date };

const data = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const METODO: Record<string, string> = { biometria: "biometria", papel: "papel" };
const recebimento = (e: { assinadoEm: string | null; metodo: string | null }) => (e.assinadoEm ? `Assinado em ${data(e.assinadoEm)}${e.metodo ? ` (${METODO[e.metodo] ?? e.metodo})` : ""}` : "Sem assinatura");

function RelatorioEpiPage() {
  const params = useSearchParams();
  const de = params.get("de") ?? "", ate = params.get("ate") ?? "";
  const valido = dataValida(de) && dataValida(ate) && de <= ate;
  const consulta = params.toString();
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  useEffect(() => {
    if (!valido) return;
    let ativo = true;
    fetch(`/api/rh/epi/relatorio?${consulta}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre na plataforma e gere o relatório de novo.");
        if (response.status === 403) throw new Error("Você não tem acesso à Saúde e segurança do RH.");
        if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "Não foi possível carregar as entregas de EPI agora.");
        return (await response.json()) as { relatorio: RelatorioEpi; filtros: Filtros };
      })
      .then(({ relatorio, filtros }) => { if (ativo) setEstado({ status: "ready", relatorio, filtros, geradoEm: new Date() }); })
      .catch((error: Error) => { if (ativo) setEstado({ status: "error", mensagem: error.message }); });
    return () => { ativo = false; };
  }, [consulta, valido]);

  const arquivo = valido ? `Pecsil - EPIs - ${data(de)} a ${data(ate)}`.replaceAll("/", "-") : "Pecsil - EPIs";
  if (!valido) return <ReportDocument fileTitle={arquivo} ready={false} printButton><p className="report-empty">Período inválido. Gere o relatório pela tela de Relatórios do RH.</p></ReportDocument>;
  if (estado.status !== "ready") {
    return <ReportDocument fileTitle={arquivo} ready={false} printButton><p className="report-empty">{estado.status === "loading" ? "Carregando as entregas de EPI…" : estado.mensagem}</p></ReportDocument>;
  }

  const { relatorio, filtros, geradoEm } = estado;
  const escolhidos = [filtros.colaborador && `Colaborador: ${filtros.colaborador}`, filtros.item && `EPI: ${filtros.item}`, filtros.setor && `Setor: ${filtros.setor}`,
    filtros.situacao && `Situação: ${ROTULO_GERAL[filtros.situacao as keyof typeof ROTULO_GERAL] ?? filtros.situacao}`].filter(Boolean).join(" · ");
  const subtitulo = `Período: ${data(relatorio.de)} a ${data(relatorio.ate)} · situação em ${data(relatorio.referencia)}${escolhidos ? ` · ${escolhidos}` : ""}`;
  const cabecalho = <ReportHeader title="Relatório de EPIs" subtitle={subtitulo} generatedAt={geradoEm} />;
  const { resumo } = relatorio;

  return (
    <ReportDocument fileTitle={arquivo} ready printButton>
      {relatorio.fichas.length !== 1 && <section className="report-section">
        {cabecalho}
        {relatorio.fichas.length === 0 ? <p className="report-empty">Nenhum colaborador com entrega de EPI ou EPI exigido nestes filtros.</p> : <>
          <table className="report-table">
            <thead>
              <tr className="report-band"><th colSpan={6}>Resumo · {resumo.colaboradores} {resumo.colaboradores === 1 ? "colaborador" : "colaboradores"}: {resumo.emDia} em dia, {resumo.pendentes} com pendência{resumo.semExigencias ? `, ${resumo.semExigencias} sem EPIs exigidos cadastrados` : ""}</th></tr>
              <tr><th className="report-left">Colaborador</th><th className="report-left">Setor</th><th className="report-left">Função</th><th>Entregas no período</th><th>Sem assinatura</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {relatorio.fichas.map((f) => (
                <tr key={f.id}>
                  <td className="report-left">{f.nome}{f.ativo ? "" : " (desligado)"}</td><td className="report-left">{f.setor ?? "—"}</td><td className="report-left">{f.funcao ?? "—"}</td>
                  <td>{f.entregas.length}</td><td>{f.semAssinatura || "—"}</td><td><b className={`epi-sit epi-sit-${f.situacao}`}>{f.situacao === "sem_exigencias" ? "Sem exigência" : ROTULO_GERAL[f.situacao]}</b></td>
                </tr>
              ))}
              <tr className="report-total"><td className="report-left" colSpan={3}>Total</td><td>{resumo.entregas}</td><td>{resumo.semAssinatura || "—"}</td><td /></tr>
            </tbody>
          </table>
          <p className="report-note">
            Situação na data de referência pelos EPIs exigidos para a função (RH › Saúde e segurança › Exigências por função): nunca entregue ou com a troca vencida é pendência,
            assim como entrega do período sem assinatura de recebimento.
            {resumo.semExigencias > 0 && ` "Sem exigência": a função ainda não tem a lista de EPIs exigidos; para esses colaboradores o relatório mostra as entregas, mas não afirma que estão em dia.`}
            {filtros.funcoesComExigencia === 0 && " Nenhuma função tem EPIs exigidos cadastrados até agora."}
          </p>
        </>}
      </section>}
      {relatorio.fichas.map((f) => <Ficha key={f.id} ficha={f} cabecalho={cabecalho} periodo={`${data(relatorio.de)} a ${data(relatorio.ate)}`} referencia={data(relatorio.referencia)} />)}
    </ReportDocument>
  );
}

function Ficha({ ficha: f, cabecalho, periodo, referencia }: { ficha: FichaEpi; cabecalho: React.ReactNode; periodo: string; referencia: string }) {
  return (
    <section className="report-section epi-ficha">
      {cabecalho}
      <div className={`epi-identificacao epi-id-${f.situacao}`}>
        <div><small>Colaborador</small><b>{f.nome}{f.ativo ? "" : " (desligado)"}</b></div>
        <div><small>Setor</small><b>{f.setor ?? "—"}</b></div>
        <div><small>Função</small><b>{f.funcao ?? "—"}</b></div>
        <div><small>Situação em {referencia}</small><b>{ROTULO_GERAL[f.situacao]}</b></div>
      </div>

      {f.exigencias.length ? (
        <table className="report-table">
          <thead>
            <tr className="report-band"><th colSpan={6}>EPIs exigidos para a função</th></tr>
            <tr><th className="report-left">EPI</th><th>CA</th><th>Troca a cada</th><th>Última entrega</th><th>Vence em</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {f.exigencias.map((e) => (
              <tr key={e.itemId}>
                <td className="report-left">{e.item}</td><td>{e.ca ?? "—"}</td><td>{e.validadeDias ? `${e.validadeDias} dias` : "—"}</td>
                <td>{data(e.ultima)}</td><td>{data(e.vence)}</td><td><b className={`epi-sit epi-ex-${e.situacao}`}>{ROTULO_EXIGENCIA[e.situacao]}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="epi-aviso">A função {f.funcao ? `"${f.funcao}"` : "deste colaborador"} ainda não tem EPIs exigidos cadastrados (RH › Saúde e segurança › Exigências por função). As entregas abaixo estão registradas, mas o relatório não afirma que o colaborador está em dia.</p>
      )}

      <table className="report-table">
        <thead>
          <tr className="report-band"><th colSpan={5}>Entregas no período ({periodo})</th></tr>
          <tr><th>Data</th><th className="report-left">EPI</th><th>CA</th><th>Qtd.</th><th>Recebimento</th></tr>
        </thead>
        <tbody>
          {f.entregas.length ? f.entregas.map((e) => (
            <tr key={e.id} className={e.assinadoEm ? undefined : "epi-sem-assinatura"}>
              <td>{data(e.entregueEm)}</td><td className="report-left">{e.item}</td><td>{e.ca ?? "—"}</td><td>{e.quantidade}</td><td>{recebimento(e)}</td>
            </tr>
          )) : <tr><td colSpan={5}>Nenhuma entrega no período.</td></tr>}
          {f.entregas.length > 0 && <tr className="report-total"><td className="report-left" colSpan={3}>{f.entregas.length} {f.entregas.length === 1 ? "entrega" : "entregas"}{f.semAssinatura ? ` · ${f.semAssinatura} sem assinatura` : ""}</td><td>{f.entregas.reduce((s, e) => s + e.quantidade, 0)}</td><td /></tr>}
        </tbody>
      </table>

      <div className="epi-assinaturas">
        <p>Responsável (RH / Segurança do Trabalho)</p>
        <p>Colaborador</p>
      </div>
    </section>
  );
}

export default function Page() {
  return <Suspense fallback={null}><RelatorioEpiPage /></Suspense>;
}
