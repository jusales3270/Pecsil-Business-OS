"use client";

import { useState } from "react";
import { Button, Callout } from "../../../packages/design-system";
import { type Prioridade, type Regras, PRIORIDADE, PRIORIDADES, chamarTi, dataHora } from "./tipos";

/** Categorias e prazos dos chamados: decisão do supervisor de TI (quem aprova chamados). */
export function RegrasChamados({ regras, onSalvo }: { regras: Regras; onSalvo: (mensagem: string) => void }) {
  const [categorias, setCategorias] = useState(regras.categorias.join("\n"));
  const [prazos, setPrazos] = useState<Record<Prioridade, string>>(() => Object.fromEntries(PRIORIDADES.map((p) => [p, String(regras.prazos_h[p])])) as Record<Prioridade, string>);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setErro("");
    const lista = categorias.split("\n").map((c) => c.trim()).filter(Boolean);
    if (!lista.length) return setErro("Informe ao menos uma categoria.");
    setSalvando(true);
    const r = await chamarTi("/api/ti/regras", { method: "PUT", body: JSON.stringify({ categorias: lista, prazos: Object.fromEntries(PRIORIDADES.map((p) => [p, Number(prazos[p])])) }) });
    setSalvando(false);
    if (!r.ok) return setErro(r.error);
    onSalvo("Regras dos chamados salvas.");
  };

  return (
    <>
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">TI · REGRAS</p><h1>Categorias e prazos dos chamados</h1><p>Quem abre um chamado escolhe a categoria e a prioridade; o prazo para resolver sai daqui. Mudar os prazos vale para os chamados novos e para os que a TI reclassificar.</p></div>
      </div>
      {regras.revisado_em
        ? <Callout variant="success" title="Revisado">Por {regras.revisado_por_nome ?? "—"} em {dataHora(regras.revisado_em)}.</Callout>
        : <Callout variant="warning" title="Provisório">Estas categorias e prazos foram postos na implantação do módulo. Quem decide é o supervisor de TI: revise e salve.</Callout>}
      <section className="almox-bloco">
        <div className="almox-form ti-form">
          <div className="ti-regras">
            <label><span>Categorias (uma por linha)</span><textarea rows={12} value={categorias} onChange={(e) => setCategorias(e.target.value)} /></label>
            <fieldset className="ti-prazos">
              <legend className="almox-rotulo">Prazo para resolver (horas corridas)</legend>
              {PRIORIDADES.map((p) => (
                <label key={p}><span>{PRIORIDADE[p].label}</span><input type="number" min={1} max={720} step={1} value={prazos[p]} onChange={(e) => setPrazos({ ...prazos, [p]: e.target.value })} /></label>
              ))}
            </fieldset>
          </div>
          {erro && <p className="almox-erro" role="alert">{erro}</p>}
          <footer><Button onClick={() => void salvar()} disabled={salvando} aria-busy={salvando}>{salvando ? "Salvando…" : "Salvar regras"}</Button></footer>
        </div>
      </section>
    </>
  );
}
