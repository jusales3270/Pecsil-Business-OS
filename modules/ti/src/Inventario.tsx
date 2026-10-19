"use client";

import { useMemo, useState } from "react";
import { Button, Modal, Status } from "../../../packages/design-system";
import { type Ativo, SITUACAO_ATIVO, TIPO_ATIVO, chamarTi } from "./tipos";

/** Inventário de TI: servidores, computadores, rede, coletores das CNCs e sistemas. */
export function Inventario({ ativos, podeEditar, onSalvo }: { ativos: Ativo[]; podeEditar: boolean; onSalvo: (mensagem: string) => void }) {
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [baixados, setBaixados] = useState(false);
  const [editar, setEditar] = useState<Ativo | "novo" | null>(null);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return ativos.filter((a) => (baixados || a.situacao !== "baixado") && (!tipo || a.tipo === tipo)
      && (!t || [a.nome, a.local, a.ip, a.modelo, a.responsavel, a.patrimonio, String(a.numero)].some((v) => v && v.toLowerCase().includes(t))));
  }, [ativos, tipo, busca, baixados]);

  return (
    <>
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">TI · INVENTÁRIO</p><h1>Equipamentos e sistemas</h1><p>O que a TI mantém de pé: servidores, computadores, rede, coletores das CNCs e sistemas. Os marcados como críticos são os que param a fábrica se caírem.</p></div>
        {podeEditar && <Button onClick={() => setEditar("novo")}>Cadastrar equipamento</Button>}
      </div>
      <section className="almox-bloco">
        <div className="almox-filtros">
          <select className="almox-busca ti-filtro" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(TIPO_ATIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="almox-marca"><input type="checkbox" checked={baixados} onChange={(e) => setBaixados(e.target.checked)} /><span>Mostrar baixados</span></label>
          <input className="almox-busca" placeholder="Buscar nome, local, IP…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {!lista.length ? (
          <div className="finance-empty almox-vazio"><b>{ativos.length ? "Nada neste filtro" : "Inventário vazio"}</b><small>{ativos.length ? "Mude o tipo ou a busca." : podeEditar ? "Comece pelo servidor, pelos coletores das CNCs e pelos computadores que param a fábrica." : "A TI ainda não cadastrou os equipamentos."}</small></div>
        ) : (
          <div className="vnd-tabela ti-ativos" role="table" aria-label="Inventário de TI">
            <div className="cabeca" role="row"><span>Nº</span><span>Equipamento</span><span>Tipo</span><span>Local</span><span>IP</span><span>Situação</span></div>
            {lista.map((a) => (
              <button type="button" role="row" key={a.id} onClick={() => setEditar(a)}>
                <span>#{a.numero}</span>
                <span className="nome">{a.nome}{a.critico && <em className="ti-critico">crítico</em>}<small>{[a.fabricante, a.modelo].filter(Boolean).join(" ") || a.sistema_operacional || "—"}</small></span>
                <span>{TIPO_ATIVO[a.tipo] ?? a.tipo}</span>
                <span>{a.local ?? "—"}</span>
                <span className="ti-mono">{a.ip ?? "—"}</span>
                <span><Status tone={SITUACAO_ATIVO[a.situacao]?.tone ?? "neutral"}>{SITUACAO_ATIVO[a.situacao]?.label ?? a.situacao}</Status></span>
              </button>
            ))}
          </div>
        )}
      </section>
      {editar && <FichaAtivo ativo={editar === "novo" ? null : editar} podeEditar={podeEditar} onClose={() => setEditar(null)} onSalvo={(m) => { setEditar(null); onSalvo(m); }} />}
    </>
  );
}

const CAMPOS: [keyof Ativo, string, number][] = [
  ["local", "Local", 120], ["responsavel", "Responsável (nome)", 120], ["fabricante", "Fabricante", 80], ["modelo", "Modelo", 120],
  ["numero_serie", "Número de série", 80], ["patrimonio", "Patrimônio / etiqueta", 40], ["ip", "IP", 60], ["sistema_operacional", "Sistema operacional", 80],
];

function FichaAtivo({ ativo, podeEditar, onClose, onSalvo }: { ativo: Ativo | null; podeEditar: boolean; onClose: () => void; onSalvo: (mensagem: string) => void }) {
  const [f, setF] = useState<Partial<Ativo>>(() => ativo ?? { tipo: "estacao", situacao: "em_uso", critico: false });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const muda = (k: keyof Ativo, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  const salvar = async () => {
    setErro("");
    if (!f.nome || f.nome.trim().length < 2) return setErro("Informe o nome do equipamento.");
    setSalvando(true);
    const r = await chamarTi<{ numero: number }>("/api/ti/ativos", { method: "POST", body: JSON.stringify(f) });
    setSalvando(false);
    if (!r.ok) return setErro(r.error);
    onSalvo(ativo ? `Equipamento #${r.data.numero} atualizado.` : `Equipamento #${r.data.numero} cadastrado.`);
  };

  return (
    <Modal eyebrow={ativo ? `TI · equipamento #${ativo.numero}` : "TI · novo equipamento"} title={ativo?.nome ?? "Cadastrar equipamento"} onClose={onClose}>
      <div className="almox-form ti-form ti-ficha">
        <fieldset className="ti-campos" disabled={!podeEditar}>
        <div className="almox-campos">
          <label className="ti-campo-2"><span>Nome</span><input value={f.nome ?? ""} maxLength={120} onChange={(e) => muda("nome", e.target.value)} placeholder="Ex.: innovait-server, PC do Compras" /></label>
          <label><span>Tipo</span><select value={f.tipo} onChange={(e) => muda("tipo", e.target.value)}>{Object.entries(TIPO_ATIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span>Situação</span><select value={f.situacao} onChange={(e) => muda("situacao", e.target.value)}>{Object.entries(SITUACAO_ATIVO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          {CAMPOS.map(([k, rotulo, max]) => (
            <label key={k}><span>{rotulo}</span><input value={(f[k] as string | null) ?? ""} maxLength={max} onChange={(e) => muda(k, e.target.value)} /></label>
          ))}
          <label className="almox-largo"><span>Observação</span><textarea rows={3} maxLength={1000} value={f.observacao ?? ""} onChange={(e) => muda("observacao", e.target.value)} /></label>
        </div>
        <label className="almox-marca"><input type="checkbox" checked={Boolean(f.critico)} onChange={(e) => muda("critico", e.target.checked)} /><span>Crítico: se cair, para a fábrica ou o sistema</span></label>
        </fieldset>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button variant="secondary" onClick={onClose}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
          {podeEditar && <Button onClick={() => void salvar()} disabled={salvando} aria-busy={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}
