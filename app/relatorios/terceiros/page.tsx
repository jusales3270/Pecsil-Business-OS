"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportDocument, ReportHeader } from "../../components/report-layout";
import { formatarData, formatarHoras, type RelatorioTerceiros } from "../../../lib/rh/terceiros-core";

/**
 * Relatório mensal de horas dos terceiros, para o RH fechar o mês e enviar ao
 * Financeiro. As horas são a soma dos apontamentos da Portaria, exatamente
 * como registrados (decisão do proprietário em 27/09/2026).
 */

type Estado =
  | { status: "loading" }
  | { status: "error"; mensagem: string }
  | { status: "ready"; relatorio: RelatorioTerceiros; geradoEm: Date };

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function nomeDoMes(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
}

function RelatorioTerceirosPage() {
  const mes = useSearchParams().get("mes") ?? "";
  const valido = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  useEffect(() => {
    if (!valido) return;
    let ativo = true;
    fetch(`/api/rh/terceiros?mes=${mes}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre na plataforma e gere o relatório de novo.");
        if (response.status === 403) throw new Error("Você não tem acesso aos terceiros no RH.");
        if (!response.ok) throw new Error("Não foi possível carregar os apontamentos agora.");
        return (await response.json()) as { relatorio: RelatorioTerceiros };
      })
      .then(({ relatorio }) => { if (ativo) setEstado({ status: "ready", relatorio, geradoEm: new Date() }); })
      .catch((error: Error) => { if (ativo) setEstado({ status: "error", mensagem: error.message }); });
    return () => { ativo = false; };
  }, [mes, valido]);

  const titulo = "Relatório de horários · Terceiros";
  const periodo = valido ? `Período: ${formatarData(`${mes}-01`)} a ${formatarData(estado.status === "ready" ? estado.relatorio.fim : `${mes}-01`)}` : "";
  const arquivo = valido ? `PecSil - Terceiros - ${nomeDoMes(mes)}` : "PecSil - Terceiros";

  if (!valido) {
    return <ReportDocument fileTitle={arquivo} ready={false}><p className="report-empty">Mês inválido. Gere o relatório pela tela de Relatórios do RH.</p></ReportDocument>;
  }
  if (estado.status !== "ready") {
    return (
      <ReportDocument fileTitle={arquivo} ready={false}>
        <p className="report-empty">{estado.status === "loading" ? "Carregando os apontamentos…" : estado.mensagem}</p>
      </ReportDocument>
    );
  }

  const { relatorio, geradoEm } = estado;
  const cabecalho = <ReportHeader title={titulo} subtitle={`${periodo} · ${nomeDoMes(mes)}`} generatedAt={geradoEm} />;

  return (
    <ReportDocument fileTitle={arquivo} ready>
      {relatorio.pessoas.length === 0 && (
        <section className="report-section">
          {cabecalho}
          <p className="report-empty">Nenhum apontamento de terceiros em {nomeDoMes(mes)}.</p>
        </section>
      )}

      {relatorio.pessoas.map((pessoa) => (
        <section className="report-section" key={pessoa.nome}>
          {cabecalho}
          <table className="report-table">
            <thead>
              <tr className="report-band"><th colSpan={5}>Colaborador: {pessoa.nome}</th></tr>
              <tr><th>Data</th><th>Dia</th><th>Entrada</th><th>Saída</th><th>Horas no dia</th></tr>
            </thead>
            <tbody>
              {pessoa.linhas.map((linha, i) => (
                <tr key={`${linha.data}-${linha.entrada}-${i}`} className={linha.situacao === "contabilizada" ? undefined : "report-muted"}>
                  <td>{formatarData(linha.data)}</td>
                  <td>{linha.dia}</td>
                  <td>{linha.entrada}</td>
                  <td>{linha.saida ?? "—"}</td>
                  <td>{linha.minutos !== null ? formatarHoras(linha.minutos) : linha.situacao === "sem-saida" ? "sem saída" : "não contabilizada*"}</td>
                </tr>
              ))}
              <tr className="report-total">
                <td className="report-left" colSpan={4}>Total do colaborador</td>
                <td>{formatarHoras(pessoa.totalMinutos)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}

      {relatorio.pessoas.length > 0 && (
        <section className="report-section">
          {cabecalho}
          <table className="report-table">
            <thead>
              <tr className="report-band"><th colSpan={2}>Resumo geral</th></tr>
              <tr><th className="report-left">Colaborador</th><th>Total de horas</th></tr>
            </thead>
            <tbody>
              {relatorio.pessoas.map((pessoa) => (
                <tr key={pessoa.nome}><td className="report-left">{pessoa.nome}</td><td>{formatarHoras(pessoa.totalMinutos)}</td></tr>
              ))}
              <tr className="report-total"><td className="report-left">Total geral</td><td>{formatarHoras(relatorio.totalMinutos)}</td></tr>
            </tbody>
          </table>
          <p className="report-note">
            Horas somadas como a Portaria calculou em cada passagem, sem correção.
            {relatorio.naoContabilizadas > 0 && ` * ${relatorio.naoContabilizadas} ${relatorio.naoContabilizadas === 1 ? "passagem teve" : "passagens tiveram"} a saída registrada em outro dia; a Portaria não calcula essas horas e elas não entram na soma.`}
            {relatorio.semSaida > 0 && ` ${relatorio.semSaida} ${relatorio.semSaida === 1 ? "passagem está" : "passagens estão"} sem saída e não entraram na soma.`}
          </p>
        </section>
      )}
    </ReportDocument>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RelatorioTerceirosPage />
    </Suspense>
  );
}
