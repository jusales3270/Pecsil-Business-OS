"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { api, cnpjFormatado, curto, date, dataHora, hoje, money } from "./comum";

/**
 * Fiscal › Notas recebidas (SEFAZ). Tudo que a SEFAZ registrou contra o CNPJ da empresa, buscado
 * sozinho a cada rodada, ao lado da conferência "o governo tem e nós não": a nota já está no
 * Painel do ICMS? O material já foi recebido no Almoxarifado?
 */

type Nota = {
  id: string; chave: string; emitente_cnpj: string | null; emitente_nome: string | null; valor: number | null; emissao: string | null;
  tipo_nf: 0 | 1 | null; situacao: "autorizada" | "denegada" | "cancelada"; manifestacao: string; manifestacao_erro: string | null;
  document_id: string | null; no_painel: boolean; recebida: boolean; supplier_id: string | null; created_at: string;
};
type Busca = {
  dfe_ativo: boolean; ciencia_automatica: boolean; dfe_ultima_consulta: string | null; dfe_proxima_consulta: string | null;
  dfe_ultimo_status: string | null; cert_validade: string | null; ambiente: string;
};
type Dados = { notas: Nota[]; busca: Busca | null; podeOperar: boolean; podeConfigurar: boolean; transmissor: boolean; carregadoEm: number };
type Filtro = "todas" | "fora_do_painel" | "sem_xml" | "canceladas";

const SITUACAO: Record<Nota["situacao"], [string, "success" | "danger" | "attention"]> = {
  autorizada: ["Autorizada", "success"], cancelada: ["Cancelada", "danger"], denegada: ["Denegada", "attention"],
};

export function NotasRecebidas({ notify }: { notify: (m: string) => void }) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lancar, setLancar] = useState<Nota | null>(null);

  const carregar = useCallback(async (f: Filtro) => {
    const r = await api<Omit<Dados, "carregadoEm">>(`/api/fiscal/dfe?filtro=${f}`);
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados({ ...r.data, carregadoEm: Date.now(), notas: r.data.notas.map((n) => ({ ...n, valor: n.valor === null ? null : Number(n.valor) })) });
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(filtro); }, 0); return () => clearTimeout(t); }, [carregar, filtro]);

  const notas = useMemo(() => dados?.notas ?? [], [dados]);
  const busca = dados?.busca ?? null;
  const pronta = Boolean(dados?.transmissor && busca?.cert_validade && busca.dfe_ativo);
  const foraDoPainel = notas.filter((n) => n.situacao === "autorizada" && !n.no_painel).length;
  const semXml = notas.filter((n) => n.situacao === "autorizada" && !n.document_id).length;
  const canceladas = notas.filter((n) => n.situacao === "cancelada").length;

  const buscarAgora = async () => {
    setOcupado("buscar");
    const r = await api<{ consultou: boolean; motivo?: string; documentos: number; notasNovas: number; xmlGuardados: number; ciencias: number; erros: number }>("/api/fiscal/dfe/buscar", { method: "POST" });
    setOcupado(null);
    if (!r.ok) { notify(r.error); void carregar(filtro); return; }
    const d = r.data;
    notify(!d.consultou ? (d.motivo ?? "Nada a consultar agora.")
      : `${d.documentos} ${d.documentos === 1 ? "documento" : "documentos"} da SEFAZ · ${d.notasNovas} ${d.notasNovas === 1 ? "nota nova" : "notas novas"}${d.xmlGuardados ? ` · ${d.xmlGuardados} XML guardado(s)` : ""}${d.ciencias ? ` · ciência em ${d.ciencias}` : ""}${d.erros ? ` · ${d.erros} com erro` : ""}.`);
    void carregar(filtro);
  };

  const darCiencia = async (n: Nota) => {
    setOcupado(n.id);
    const r = await api<{ mensagem: string }>(`/api/fiscal/dfe/${n.id}/ciencia`, { method: "POST" });
    setOcupado(null);
    notify(r.ok ? r.data.mensagem : r.error);
    void carregar(filtro);
  };

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · SEFAZ</p><h1>Notas recebidas</h1><p>Notas que a SEFAZ registra contra o CNPJ da empresa, buscadas sozinhas. Confira o que ainda não está no Painel do ICMS nem foi recebido no Almoxarifado.</p></div>
        {(dados?.podeOperar || dados?.podeConfigurar) && pronta && (
          <div className="icms-acoes"><Button variant="secondary" onClick={() => void buscarAgora()} disabled={ocupado === "buscar"}>{ocupado === "buscar" ? "Consultando a SEFAZ…" : "Buscar agora"}</Button></div>
        )}
      </div>

      {dados && !dados.transmissor && <Callout variant="warning" title="Transmissor ainda não instalado">A busca na SEFAZ depende do transmissor de NF-e no servidor. Enquanto ele não for instalado, esta lista fica parada.</Callout>}
      {dados?.transmissor && busca && !busca.cert_validade && <Callout variant="info" title="Falta o certificado digital">O proprietário envia o certificado A1 da empresa em Fiscal › Configuração. Sem ele, a SEFAZ não entrega as notas.</Callout>}
      {dados?.transmissor && busca?.cert_validade && !busca.dfe_ativo && <Callout variant="info" title="Busca automática desligada">Ligue em Fiscal › Configuração › Notas recebidas.</Callout>}
      {pronta && busca && (
        <p className="fiscal-dfe-estado">
          Última consulta: <b>{dataHora(busca.dfe_ultima_consulta)}</b>{busca.dfe_ultimo_status ? ` · ${busca.dfe_ultimo_status}` : ""}
          {busca.dfe_proxima_consulta && new Date(busca.dfe_proxima_consulta).getTime() > (dados?.carregadoEm ?? 0) ? <> · a SEFAZ libera nova consulta às <b>{dataHora(busca.dfe_proxima_consulta).slice(-5)}</b></> : null}
          {busca.ciencia_automatica ? " · ciência automática ligada" : " · ciência manual"}
        </p>
      )}
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}

      {dados && (
        <>
          {filtro === "todas" && (
            <KpiGrid>
              <Kpi label="Notas na SEFAZ" value={String(notas.length)} caption={curto(notas.reduce((a, n) => a + (n.valor ?? 0), 0))} tone="blue" />
              <Kpi label="Fora do Painel do ICMS" value={String(foraDoPainel)} caption="Autorizadas e ainda não lançadas" tone={foraDoPainel ? "amber" : "neutral"} onOpen={() => setFiltro("fora_do_painel")} />
              <Kpi label="Sem o XML completo" value={String(semXml)} caption="Falta a ciência da operação" tone={semXml ? "purple" : "neutral"} onOpen={() => setFiltro("sem_xml")} />
              <Kpi label="Canceladas" value={String(canceladas)} caption="Pelo emitente, na SEFAZ" tone={canceladas ? "red" : "neutral"} onOpen={() => setFiltro("canceladas")} />
            </KpiGrid>
          )}

          <div className="almox-filtros">
            <Segmented<Filtro> options={[{ value: "todas", label: "Todas" }, { value: "fora_do_painel", label: "Fora do painel" }, { value: "sem_xml", label: "Sem XML" }, { value: "canceladas", label: "Canceladas" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
          </div>

          <section className="almox-bloco">
            {notas.length ? (
              <div className="fiscal-dfe-tabela" role="table">
                <div className="cabeca" role="row">
                  <span>Emissão</span><span>Emitente</span><span className="r">Valor</span><span>Situação</span>
                  <span className="c" title="Já está no Painel do ICMS">No painel</span><span className="c" title="Material recebido no Almoxarifado">Recebida</span><span />
                </div>
                {notas.map((n) => (
                  <div role="row" key={n.id}>
                    <span>{date(n.emissao)}</span>
                    <span className="nome" title={n.chave}>
                      {n.emitente_nome ?? "Emitente não informado"}
                      <small>{cnpjFormatado(n.emitente_cnpj)}{n.supplier_id ? " · no cadastro" : " · fora do cadastro"}{n.tipo_nf === 0 ? " · nota de entrada do emitente" : ""}</small>
                      {n.manifestacao_erro && <small className="fiscal-erro">Ciência: {n.manifestacao_erro}</small>}
                    </span>
                    <span className="r">{n.valor === null ? "—" : money(n.valor)}</span>
                    <span><Status tone={SITUACAO[n.situacao][1]}>{SITUACAO[n.situacao][0]}</Status></span>
                    <span className="c">{n.no_painel ? <Status tone="success">Sim</Status> : n.situacao === "autorizada" ? <Status tone="attention">Não</Status> : "—"}</span>
                    <span className="c">{n.recebida ? <Status tone="success">Sim</Status> : <Status tone="neutral">Não</Status>}</span>
                    <span className="fiscal-dfe-acoes">
                      {n.document_id && <a className="almox-link" href={`/api/documentos/${n.document_id}/baixar`} target="_blank" rel="noreferrer">XML</a>}
                      {dados.podeOperar && n.situacao === "autorizada" && !n.document_id && n.manifestacao === "nenhuma" && (
                        <button type="button" className="almox-link" disabled={ocupado === n.id} onClick={() => void darCiencia(n)}>{ocupado === n.id ? "Enviando…" : "Dar ciência"}</button>
                      )}
                      {n.situacao === "autorizada" && !n.document_id && n.manifestacao === "ciencia" && <small>XML a caminho</small>}
                      {dados.podeOperar && n.situacao === "autorizada" && n.document_id && !n.no_painel && (
                        <button type="button" className="almox-link" onClick={() => setLancar(n)}>Lançar no painel</button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="finance-empty">
                <b>{filtro === "todas" ? "Nenhuma nota recebida da SEFAZ ainda" : "Nenhuma nota neste filtro"}</b>
                <small>{filtro === "todas" ? "Com o certificado enviado e a busca ligada, as notas emitidas contra o CNPJ da empresa aparecem aqui sozinhas." : "Troque o filtro para ver as demais."}</small>
              </div>
            )}
          </section>
        </>
      )}

      {lancar && <LancarModal nota={lancar} onClose={() => setLancar(null)} onFeito={(msg) => { setLancar(null); notify(msg); void carregar(filtro); }} />}
    </div>
  );
}

function LancarModal({ nota, onClose, onFeito }: { nota: Nota; onClose: () => void; onFeito: (msg: string) => void }) {
  const [mes, setMes] = useState((nota.emissao ?? hoje()).slice(0, 7));
  const [recebida, setRecebida] = useState(hoje());
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const confirmar = async (event: React.FormEvent) => {
    event.preventDefault();
    setEnviando(true); setErro("");
    const r = await api<{ mensagem: string }>(`/api/fiscal/dfe/${nota.id}/painel`, { method: "POST", body: JSON.stringify({ mes, recebida }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(r.data.mensagem);
  };
  return (
    <Modal eyebrow="NOTAS RECEBIDAS" title="Lançar no Painel do ICMS" subtitle={`${nota.emitente_nome ?? cnpjFormatado(nota.emitente_cnpj)}${nota.valor === null ? "" : ` · ${money(nota.valor)}`}`} onClose={onClose}>
      <form className="almox-form" onSubmit={confirmar}>
        <div className="almox-campos">
          <label><span>Mês do painel</span><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} required /></label>
          <label><span>Recebida em</span><input type="date" value={recebida} onChange={(e) => setRecebida(e.target.value)} required /></label>
        </div>
        <p className="fiscal-nota-ajuda">A nota entra com o que o XML traz (valor, base, ICMS e IPI). Centro e tipo ficam para completar no painel.</p>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button type="submit" disabled={enviando}>{enviando ? "Lançando…" : "Lançar no painel"}</Button>
        </footer>
      </form>
    </Modal>
  );
}
