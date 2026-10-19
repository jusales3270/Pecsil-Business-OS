"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented, Status } from "../../../packages/design-system";
import { type Ativo, type Incidente, CATEGORIA_INCIDENTE, chamarTi, dataHora, duracao, segundosEntre, useAgora } from "./tipos";

/**
 * Histórico de quedas e falhas: o que o vigia externo registrou (com a causa provável pela regra
 * dele) e o que a TI registrou à mão. A TI confirma a causa — é o histórico de energia e de rede
 * que a fábrica não tinha.
 */
const PERIODOS = [{ value: "30", label: "30 dias" }, { value: "90", label: "90 dias" }, { value: "365", label: "1 ano" }] as const;

export function Incidentes({ ativos, onAviso }: { ativos: Ativo[]; onAviso: (mensagem: string) => void }) {
  const [dias, setDias] = useState<"30" | "90" | "365">("90");
  const [dados, setDados] = useState<{ incidentes: Incidente[]; podeRegistrar: boolean } | null>(null);
  const [erro, setErro] = useState("");
  const [abrir, setAbrir] = useState<Incidente | "novo" | null>(null);
  const [semAlarmes, setSemAlarmes] = useState(true);
  const agora = useAgora();

  const carregar = useCallback(async (d: string) => {
    const r = await chamarTi<{ incidentes: Incidente[]; podeRegistrar: boolean }>(`/api/ti/incidentes?dias=${d}`);
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(dias); }, 0); return () => clearTimeout(t); }, [carregar, dias]);

  const lista = useMemo(() => (dados?.incidentes ?? []).filter((i) => !semAlarmes || i.categoria !== "alarme_falso"), [dados, semAlarmes]);
  const porCategoria = useMemo(() => {
    const m = new Map<string, { n: number; seg: number }>();
    for (const i of lista) {
      const k = i.categoria ?? "a_confirmar";
      const x = m.get(k) ?? { n: 0, seg: 0 };
      m.set(k, { n: x.n + 1, seg: x.seg + segundosEntre(i.inicio, i.fim, agora) });
    }
    return [...m.entries()].sort((a, b) => b[1].seg - a[1].seg);
  }, [lista, agora]);
  const aConfirmar = lista.filter((i) => !i.confirmado_em).length;

  return (
    <>
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">TI · INCIDENTES</p><h1>Histórico de quedas</h1><p>Cada queda que o vigia externo percebe entra aqui sozinha, com a causa provável. Confirme a causa: é isso que mostra se o problema é energia, internet ou o servidor, e dá evidência para cobrar a concessionária ou a operadora.</p></div>
        {dados?.podeRegistrar && <Button onClick={() => setAbrir("novo")}>Registrar incidente</Button>}
      </div>
      <section className="almox-bloco">
        <div className="almox-filtros">
          <Segmented<"30" | "90" | "365"> options={PERIODOS} value={dias} onChange={setDias} compact ariaLabel="Período" />
          <label className="almox-marca"><input type="checkbox" checked={semAlarmes} onChange={(e) => setSemAlarmes(e.target.checked)} /><span>Esconder alarmes falsos</span></label>
        </div>
        {erro ? <div className="finance-empty almox-vazio"><b>{erro}</b><small /></div> : !dados ? <div className="finance-empty almox-vazio"><b>Carregando…</b><small /></div> : (
          <>
            {porCategoria.length > 0 && (
              <div className="ti-resumo-categorias">
                {porCategoria.map(([k, v]) => (
                  <span key={k} className={`ti-cat ${k}`}><b>{k === "a_confirmar" ? "A confirmar" : CATEGORIA_INCIDENTE[k] ?? k}</b> {v.n}× · {duracao(v.seg)} fora</span>
                ))}
                {aConfirmar > 0 && dados.podeRegistrar && <span className="ti-nota">{aConfirmar} sem causa confirmada pela TI.</span>}
              </div>
            )}
            {!lista.length ? <div className="finance-empty almox-vazio"><b>Nenhuma queda no período</b><small>O vigia acompanha o servidor a cada minuto e o backup todo dia.</small></div> : (
              <div className="vnd-tabela ti-incidentes" role="table" aria-label="Incidentes">
                <div className="cabeca" role="row"><span>Início</span><span>O que caiu</span><span className="r">Fora</span><span>Categoria</span><span>Causa</span></div>
                {lista.map((i) => (
                  <button type="button" role="row" key={i.id} onClick={() => setAbrir(i)}>
                    <span>{dataHora(i.inicio)}</span>
                    <span className="nome">{i.ti_ativos ? `#${i.ti_ativos.numero} · ${i.ti_ativos.nome}` : i.alvo_nome ?? i.alvo ?? "—"}<small>{i.origem === "vigia" ? "registrado pelo vigia" : "registrado pela TI"}</small></span>
                    <span className="r">{i.fim ? duracao(segundosEntre(i.inicio, i.fim, agora)) : <Status tone="danger">fora agora</Status>}</span>
                    <span>{i.categoria ? <Status tone={i.confirmado_em ? "info" : "neutral"}>{CATEGORIA_INCIDENTE[i.categoria] ?? i.categoria}{i.confirmado_em ? "" : " (provável)"}</Status> : <Status tone="attention">A confirmar</Status>}</span>
                    <span className="ti-causa">{i.causa ?? i.causa_vigia ?? "—"}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      {abrir && <FichaIncidente incidente={abrir === "novo" ? null : abrir} ativos={ativos} podeRegistrar={Boolean(dados?.podeRegistrar)}
        onClose={() => setAbrir(null)} onSalvo={(m) => { setAbrir(null); onAviso(m); void carregar(dias); }} />}
    </>
  );
}

const paraCampo = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  return p.replace(" ", "T");
};
const doCampo = (v: string) => (v ? new Date(`${v}:00-03:00`).toISOString() : null);

function FichaIncidente({ incidente, ativos, podeRegistrar, onClose, onSalvo }: {
  incidente: Incidente | null; ativos: Ativo[]; podeRegistrar: boolean; onClose: () => void; onSalvo: (mensagem: string) => void;
}) {
  const manual = !incidente || incidente.origem === "manual";
  const [categoria, setCategoria] = useState(incidente?.categoria ?? "");
  const [causa, setCausa] = useState(incidente?.causa ?? "");
  const [descricao, setDescricao] = useState(incidente?.descricao ?? "");
  const [ativoId, setAtivoId] = useState(incidente?.ativo_id ?? "");
  const [alvoNome, setAlvoNome] = useState(incidente?.alvo_nome ?? "");
  const [inicio, setInicio] = useState(paraCampo(incidente?.inicio ?? null));
  const [fim, setFim] = useState(paraCampo(incidente?.fim ?? null));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const agora = useAgora();

  const salvar = async () => {
    setErro("");
    if (!categoria) return setErro("Escolha a categoria.");
    if (manual && !inicio) return setErro("Informe quando começou.");
    setSalvando(true);
    const r = await chamarTi("/api/ti/incidentes", {
      method: "POST",
      body: JSON.stringify({ id: incidente?.id, categoria, causa, descricao, ativo_id: ativoId || null, alvo_nome: alvoNome, inicio: manual ? doCampo(inicio) : undefined, fim: manual ? doCampo(fim) : undefined }),
    });
    setSalvando(false);
    if (!r.ok) return setErro(r.error);
    onSalvo(incidente ? "Causa confirmada." : "Incidente registrado.");
  };

  const titulo = incidente ? incidente.ti_ativos?.nome ?? incidente.alvo_nome ?? "Incidente" : "Registrar incidente";
  return (
    <Modal eyebrow={incidente ? (incidente.origem === "vigia" ? "TI · queda registrada pelo vigia" : "TI · incidente") : "TI · novo incidente"} title={titulo}
      subtitle={incidente ? `${dataHora(incidente.inicio)} → ${incidente.fim ? dataHora(incidente.fim) : "ainda fora"} · ${duracao(segundosEntre(incidente.inicio, incidente.fim, agora))}` : "Para o que o vigia não vê: um computador, um coletor, a impressora, a rede de um setor."}
      onClose={onClose}>
      <div className="almox-form ti-form">
        {incidente?.causa_vigia && <p className="almox-obs"><b>O vigia deduziu:</b> {incidente.causa_vigia}. É uma regra (sinal do servidor × resposta de fora), não uma confirmação.</p>}
        {incidente?.confirmado_em && <p className="ti-nota">Confirmado por {incidente.confirmado_por_nome} em {dataHora(incidente.confirmado_em)}.</p>}
        <fieldset className="ti-campos" disabled={!podeRegistrar}>
          <div className="almox-campos">
            <label><span>Categoria</span>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Escolha…</option>
                {Object.entries(CATEGORIA_INCIDENTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="ti-campo-3"><span>Causa</span><input value={causa} maxLength={500} onChange={(e) => setCausa(e.target.value)} placeholder="Ex.: queda de energia no bairro; operadora sem sinal" /></label>
            {manual && <label className="ti-campo-2"><span>O que caiu</span><input value={alvoNome} maxLength={120} onChange={(e) => setAlvoNome(e.target.value)} placeholder="Se não estiver no inventário" /></label>}
            {manual && <label><span>Início</span><input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>}
            {manual && <label><span>Fim</span><input type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} /></label>}
            <label className={manual ? "almox-largo" : "ti-campo-4"}><span>Equipamento do inventário</span>
              <select value={ativoId} onChange={(e) => setAtivoId(e.target.value)}>
                <option value="">Nenhum</option>
                {ativos.filter((a) => a.situacao !== "baixado" || a.id === ativoId).map((a) => <option key={a.id} value={a.id}>#{a.numero} · {a.nome}</option>)}
              </select>
            </label>
            <label className="almox-largo"><span>O que foi feito</span><textarea rows={3} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
          </div>
        </fieldset>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button variant="secondary" onClick={onClose}>{podeRegistrar ? "Cancelar" : "Fechar"}</Button>
          {podeRegistrar && <Button onClick={() => void salvar()} disabled={salvando} aria-busy={salvando}>{salvando ? "Salvando…" : incidente ? "Confirmar causa" : "Registrar"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}
