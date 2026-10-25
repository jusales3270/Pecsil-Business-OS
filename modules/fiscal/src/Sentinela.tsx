"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Status } from "../../../packages/design-system";
import { atuais } from "../../../lib/contabil/parametros";
import { api, date, dataHora, hoje } from "./comum";
import { CONFIANCA, NovaVigencia, Valor, type Linha, type Tese } from "./Parametros";

/**
 * Fiscal › Parâmetros legais › Sentinela (N-02): o que as fontes oficiais publicaram e pode mudar uma regra.
 * O que vem do modelo aparece como "Sugestão do modelo", com a confiança; nada muda sem uma pessoa aprovar
 * (só os dados de API oficial, como Selic e feriados, entram sozinhos). Desenho em PLANO-CONTABIL-FISCAL §4.
 */

type Proposta = {
  id: string; fonte_id: string | null; tipo: "parametro" | "tese" | "sinal"; chave: string | null; tese_id: string | null; titulo: string; resumo: string | null;
  valor_proposto: unknown; vigente_de: string | null; norma: string | null; url: string; trecho: string | null; confianca: "alta" | "media" | "baixa";
  origem: "modelo" | "regra"; modelo: string | null; avisos: string[]; chaves_triagem: string[]; situacao: "aberta" | "aprovada" | "recusada" | "aplicada";
  decidida_por_nome: string | null; decidida_em: string | null; nota: string | null; horas_ate_proposta: number | null; created_at: string;
};
type Fonte = {
  id: string; nome: string; url: string; nivel: "fonte_oficial" | "tribunal" | "dado_api" | "imprensa"; cadencia_min: number; silencio_horas: number; ativa: boolean; nota: string | null;
  ultima_coleta_em: string | null; ultimo_item_em: string | null; ultimo_erro: string | null; coletas: number; itens: number;
};
type Rodada = { id: string; iniciada_em: string; terminada_em: string | null; situacao: string; fontes: number; itens_novos: number; relevantes: number; propostas: number; automaticos: number; extracoes: number };
type Config = { enviar_decisoes: boolean; janela_dias: number; max_extracoes_dia: number; updated_at: string | null; updated_by_name: string | null };
type Dados = { propostas: Proposta[]; fontes: Fonte[]; rodadas: Rodada[]; config: Config | null; podeCurar: boolean; podeConfigurar: boolean };

const TIPO: Record<Proposta["tipo"], string> = { parametro: "Parâmetro", tese: "Tese", sinal: "Sinal" };
const NIVEL: Record<Fonte["nivel"], string> = { fonte_oficial: "Fonte oficial", tribunal: "Tribunal", dado_api: "Dado de API (automático)", imprensa: "Imprensa (só sinal)" };
const DECISAO: Record<Proposta["situacao"], { rotulo: string; tom: "attention" | "success" | "neutral" | "danger" }> = {
  aberta: { rotulo: "Aberta", tom: "attention" }, aplicada: { rotulo: "Aplicada", tom: "success" }, aprovada: { rotulo: "Vista", tom: "neutral" }, recusada: { rotulo: "Recusada", tom: "danger" },
};
const horas = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : Infinity);

/** Situação de cada fonte: desligada, com erro, em silêncio (sem item novo além do normal) ou em dia. */
export function situacaoDaFonte(f: Fonte): { rotulo: string; tom: "success" | "danger" | "attention" | "neutral" } {
  if (!f.ativa) return { rotulo: "Desligada", tom: "neutral" };
  if (!f.ultima_coleta_em) return { rotulo: "Aguardando a 1ª coleta", tom: "neutral" };
  if (f.ultimo_erro) return { rotulo: "Erro na última coleta", tom: "danger" };
  if (f.nivel !== "dado_api" && horas(f.ultimo_item_em ?? f.ultima_coleta_em) > f.silencio_horas) return { rotulo: "Em silêncio", tom: "attention" };
  return { rotulo: "Em dia", tom: "success" };
}

export function Sentinela({ parametros, teses, notify, onMudou }: { parametros: Linha[]; teses: Tese[]; notify: (m: string) => void; onMudou: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<Proposta | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/fiscal/sentinela");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const abertas = useMemo(() => (dados?.propostas ?? []).filter((p) => p.situacao === "aberta"), [dados]);
  const decididas = useMemo(() => (dados?.propostas ?? []).filter((p) => p.situacao !== "aberta").slice(0, 30), [dados]);
  const comProblema = (dados?.fontes ?? []).filter((f) => ["danger", "attention"].includes(situacaoDaFonte(f).tom)).length;
  const tempos = (dados?.propostas ?? []).map((p) => p.horas_ate_proposta).filter((h): h is number => h !== null).slice(0, 30).sort((a, b) => a - b);
  const mediana = tempos.length ? tempos[Math.floor(tempos.length / 2)] : null;
  const ultima = dados?.rodadas[0];

  const rodar = async () => {
    setRodando(true);
    const r = await api<{ fontes: number; itensNovos: number; propostas: number; automaticos: number; erros: { fonte: string }[] }>("/api/fiscal/sentinela", { method: "POST", body: JSON.stringify({ acao: "rodar" }) });
    setRodando(false);
    if (!r.ok) { notify(r.error); return; }
    notify(`Coleta feita: ${r.data.fontes} fontes, ${r.data.itensNovos} itens novos, ${r.data.propostas} propostas, ${r.data.automaticos} atualizações automáticas${r.data.erros.length ? `, ${r.data.erros.length} com erro` : ""}.`);
    void carregar(); onMudou();
  };
  const depois = (m: string) => { notify(m); setAberta(null); void carregar(); onMudou(); };

  if (erro) return <div className="finance-empty almox-vazio"><b>{erro}</b></div>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;
  return (
    <section className="almox-bloco">
      <p className="fiscal-nota-ajuda">A Sentinela lê as fontes oficiais (Receita, Comitê Gestor do IBS, Senado, Diário Oficial de SP, CONFAZ, eSocial, tribunais) e propõe o que muda. O que vier do modelo é sugestão: só vale depois de uma pessoa conferir na norma e aprovar. Selic, IPCA, INPC e feriados vêm de API oficial e entram sozinhos.</p>
      <KpiGrid>
        <Kpi label="Propostas abertas" value={String(abertas.filter((p) => p.tipo !== "sinal").length)} caption="Parâmetros e teses para aprovar" tone="amber" />
        <Kpi label="Sinais" value={String(abertas.filter((p) => p.tipo === "sinal").length)} caption="Pode mudar: conferir" tone="neutral" />
        <Kpi label="Fontes com problema" value={`${comProblema} de ${dados.fontes.filter((f) => f.ativa).length}`} caption="Erro ou silêncio fora do normal" tone={comProblema ? "red" : "green"} />
        <Kpi label="Até a proposta" value={mediana === null ? "—" : `${mediana.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`} caption="Mediana entre a publicação e a proposta" tone="neutral" />
      </KpiGrid>
      <div className="pcf-sentinela-barra">
        <span className="fiscal-nota-ajuda">{ultima ? `Última rodada: ${dataHora(ultima.iniciada_em)} · ${ultima.fontes} fontes · ${ultima.itens_novos} itens novos · ${ultima.propostas} propostas · ${ultima.automaticos} automáticas` : "Ainda não houve rodada."}</span>
        {dados.podeCurar && <Button compact variant="secondary" disabled={rodando} onClick={() => void rodar()}>{rodando ? "Coletando… (pode levar alguns minutos)" : "Coletar agora"}</Button>}
      </div>

      <p className="almox-rotulo">Abertas</p>
      {abertas.length ? (
        <div className="vnd-tabela pcf-propostas" role="table" aria-label="Propostas abertas">
          <div className="cabeca" role="row"><span>Tipo</span><span>Assunto</span><span>Origem</span><span>Recebida</span></div>
          {abertas.map((p) => (
            <button type="button" role="row" key={p.id} onClick={() => setAberta(p)}>
              <span><Status tone={p.tipo === "sinal" ? "neutral" : "attention"}>{TIPO[p.tipo]}</Status></span>
              <span className="nome">{p.titulo}<small>{dados.fontes.find((f) => f.id === p.fonte_id)?.nome ?? p.fonte_id ?? ""}{p.chave ? ` · ${parametros.find((x) => x.chave === p.chave)?.titulo ?? p.chave}` : ""}</small></span>
              <span>{p.origem === "modelo" ? <span className="pcf-modelo">Sugestão do modelo · {CONFIANCA[p.confianca].replace("Confiança ", "")}</span> : "Regra da Sentinela"}</span>
              <span>{dataHora(p.created_at)}</span>
            </button>
          ))}
        </div>
      ) : <div className="finance-empty"><b>Nada aberto</b><small>Quando uma fonte publicar algo que mexe nas regras, aparece aqui.</small></div>}

      <p className="almox-rotulo">Fontes</p>
      <div className="vnd-tabela pcf-fontes-tabela" role="table" aria-label="Fontes da Sentinela">
        <div className="cabeca" role="row"><span>Fonte</span><span>Tipo</span><span>Última coleta</span><span>Último item novo</span><span>Situação</span></div>
        {dados.fontes.map((f) => {
          const s = situacaoDaFonte(f);
          return (
            <div role="row" key={f.id}>
              <span className="nome">{f.nome}<small>{f.ultimo_erro ?? f.nota ?? `a cada ${f.cadencia_min >= 1440 ? `${Math.round(f.cadencia_min / 1440)} dia(s)` : f.cadencia_min >= 60 ? `${Math.round(f.cadencia_min / 60)} h` : `${f.cadencia_min} min`}`}</small></span>
              <span>{NIVEL[f.nivel]}</span>
              <span>{dataHora(f.ultima_coleta_em)}</span>
              <span>{dataHora(f.ultimo_item_em)}</span>
              <span><Status tone={s.tom}>{s.rotulo}</Status></span>
            </div>
          );
        })}
      </div>

      {decididas.length > 0 && (
        <>
          <p className="almox-rotulo">Decididas</p>
          <div className="vnd-tabela pcf-propostas" role="table" aria-label="Propostas decididas">
            {decididas.map((p) => (
              <button type="button" role="row" key={p.id} onClick={() => setAberta(p)}>
                <span><Status tone={DECISAO[p.situacao].tom}>{DECISAO[p.situacao].rotulo}</Status></span>
                <span className="nome">{p.titulo}<small>{p.decidida_por_nome ? `por ${p.decidida_por_nome}` : ""}{p.nota ? ` · ${p.nota}` : ""}</small></span>
                <span>{p.origem === "modelo" ? "Sugestão do modelo" : "Regra da Sentinela"}</span>
                <span>{dataHora(p.decidida_em ?? p.created_at)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {dados.podeConfigurar && dados.config && <ConfigSentinela config={dados.config} onFeito={(m) => { notify(m); void carregar(); }} />}
      {aberta && <DetalheProposta proposta={aberta} parametros={parametros} teses={teses} fonte={dados.fontes.find((f) => f.id === aberta.fonte_id) ?? null} podeCurar={dados.podeCurar} onClose={() => setAberta(null)} onFeito={depois} />}
    </section>
  );
}

function DetalheProposta({ proposta: p, parametros, teses, fonte, podeCurar, onClose, onFeito }: { proposta: Proposta; parametros: Linha[]; teses: Tese[]; fonte: Fonte | null; podeCurar: boolean; onClose: () => void; onFeito: (m: string) => void }) {
  const [recusando, setRecusando] = useState(false);
  const [nota, setNota] = useState("");
  const [abrirVigencia, setAbrirVigencia] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const atual = p.chave ? (atuais(parametros, hoje()).find((x) => x.chave === p.chave) as Linha | undefined) : undefined;
  const tese = p.tese_id ? teses.find((t) => t.id === p.tese_id) : undefined;
  const aplicaDireto = (p.tipo === "parametro" && p.valor_proposto && p.vigente_de) || p.tipo === "tese";
  const enviar = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true); setErro("");
    const r = await api("/api/fiscal/sentinela", { method: "POST", body: JSON.stringify(corpo) });
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(ok);
  };
  if (abrirVigencia && atual) return <NovaVigencia base={atual} preenchido={{ norma: p.norma, url: p.url, trecho: p.trecho, vigente_de: p.vigente_de, proposta_id: p.id }} onClose={() => setAbrirVigencia(false)} onFeito={onFeito} />;
  return (
    <Modal eyebrow={`FISCAL · SENTINELA · ${TIPO[p.tipo].toUpperCase()}`} title={p.titulo} subtitle={<>{fonte?.nome ?? p.fonte_id} · {dataHora(p.created_at)} · {DECISAO[p.situacao].rotulo}{p.decidida_por_nome ? ` por ${p.decidida_por_nome} em ${dataHora(p.decidida_em)}` : ""}</>} onClose={onClose}>
      <div className="almox-form pcf-detalhe">
        {p.origem === "modelo"
          ? <Callout variant="info" title={`Sugestão do modelo · ${CONFIANCA[p.confianca]}`}>Leitura automática do texto público da fonte{p.modelo ? ` (${p.modelo})` : ""}. Confira na norma antes de aprovar: o modelo sugere, quem decide é você.</Callout>
          : <Callout variant="info" title="Apontado pela regra da Sentinela">O texto cita assuntos que mexem nas regras. Abra a fonte e veja se muda algo.</Callout>}
        {p.avisos.length > 0 && <Callout variant="warning" title="Atenção">{p.avisos.join(" · ")}</Callout>}
        {p.resumo && <section className="almox-bloco-interno"><p className="almox-rotulo">O que muda</p><p>{p.resumo}</p></section>}
        <section className="almox-bloco-interno">
          <p className="almox-rotulo">Fonte</p>
          <p className="pcf-fonte">{p.norma && <><b>{p.norma}</b><br /></>}<a href={p.url} target="_blank" rel="noreferrer noopener">{p.url}</a></p>
          {p.trecho && <blockquote className="pcf-trecho">{p.trecho}</blockquote>}
          {p.vigente_de && <p className="fiscal-nota-ajuda">Vale a partir de {date(p.vigente_de)}.</p>}
        </section>
        {p.tipo === "parametro" && atual && (
          <div className="pcf-comparar">
            <section className="almox-bloco-interno"><p className="almox-rotulo">Valor atual · {atual.titulo}</p><Valor valor={atual.valor} /></section>
            <section className="almox-bloco-interno"><p className="almox-rotulo">Valor proposto</p>{p.valor_proposto ? <Valor valor={p.valor_proposto} /> : <p className="fiscal-nota-ajuda">O texto não trouxe os números: abra a nova vigência e preencha pela norma.</p>}</section>
          </div>
        )}
        {p.tipo === "tese" && tese && (
          <section className="almox-bloco-interno"><p className="almox-rotulo">Tese {tese.tribunal} {tese.tema} · {tese.titulo}</p>
            <p className="fiscal-nota-ajuda">Hoje: {tese.situacao.replace(/_/g, " ")}{tese.modulacao ? ` · ${tese.modulacao}` : ""}</p>
            {p.valor_proposto ? <Valor valor={p.valor_proposto} /> : <p className="fiscal-nota-ajuda">Sem mudança de situação: aprovar só junta a fonte à tese.</p>}
          </section>
        )}
        {p.tipo === "sinal" && p.chaves_triagem.length > 0 && <p className="fiscal-nota-ajuda">Pode mexer em: {p.chaves_triagem.map((c) => parametros.find((x) => x.chave === c)?.titulo ?? c).join(", ")}.</p>}
        {recusando && <label className="nfe-cheio"><span>Por que recusa</span><input value={nota} maxLength={1000} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: não muda a regra da empresa" autoFocus /></label>}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          {podeCurar && p.situacao === "aberta" && !recusando && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => setRecusando(true)}>{p.tipo === "sinal" ? "Não muda nada" : "Recusar"}</Button>}
          {podeCurar && p.situacao === "aberta" && recusando && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => void enviar({ acao: "recusar", id: p.id, nota }, "Proposta recusada.")}>Confirmar</Button>}
          {podeCurar && p.situacao === "aberta" && p.tipo === "sinal" && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => void enviar({ acao: "aprovar", id: p.id }, "Sinal marcado como visto.")}>Visto</Button>}
          {podeCurar && p.situacao === "aberta" && p.tipo === "parametro" && !aplicaDireto && atual && <Button type="button" disabled={ocupado} onClick={() => setAbrirVigencia(true)}>Abrir nova vigência</Button>}
          {podeCurar && p.situacao === "aberta" && aplicaDireto && <Button type="button" disabled={ocupado} onClick={() => void enviar({ acao: "aprovar", id: p.id }, p.tipo === "tese" ? "Tese atualizada." : "Nova vigência aplicada; a anterior fecha na véspera.")}>{ocupado ? "Gravando…" : "Conferi na norma: aprovar"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}

function ConfigSentinela({ config, onFeito }: { config: Config; onFeito: (m: string) => void }) {
  const [enviar, setEnviar] = useState(config.enviar_decisoes);
  const [ocupado, setOcupado] = useState(false);
  const salvar = async () => {
    setOcupado(true);
    const r = await api("/api/fiscal/sentinela", { method: "POST", body: JSON.stringify({ acao: "config", config: { enviar_decisoes: enviar } }) });
    setOcupado(false);
    onFeito(r.ok ? (enviar ? "Propostas passam a ir para quem responde pelo Fiscal em Decisões para você." : "Envio por Decisões para você desligado.") : r.error);
  };
  return (
    <section className="almox-bloco-interno pcf-config">
      <p className="almox-rotulo">Configuração (proprietário)</p>
      <label className="nfe-check"><input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} /><span>Enviar as propostas com valor e as de tese a quem responde pelo Fiscal, em &quot;Decisões para você&quot; (aprovar ali aplica na hora)</span></label>
      <p className="fiscal-nota-ajuda">Até {config.max_extracoes_dia} leituras pelo modelo por dia; itens com mais de {config.janela_dias} dias entram só como histórico.{config.updated_by_name ? ` Alterado por ${config.updated_by_name} em ${dataHora(config.updated_at)}.` : ""}</p>
      <div><Button compact variant="secondary" disabled={ocupado || enviar === config.enviar_decisoes} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Salvar"}</Button></div>
    </section>
  );
}
