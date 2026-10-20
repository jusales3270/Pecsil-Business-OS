"use client";

import { useEffect, useState } from "react";
import { Button, Callout } from "../../../packages/design-system";
import { type Origem, chamarLogistica, dataHora } from "./tipos";

/**
 * Origem das entregas: o pátio de onde o caminhão sai. É configuração da Logística (não um texto fixo no
 * código): o endereço é procurado no mapa e a pessoa confirma o ponto antes de salvar.
 */
type Achado = { lat: number; lng: number; nome: string };

export function OrigemConfig({ notify }: { notify: (m: string) => void }) {
  const [atual, setAtual] = useState<Origem | null>(null);
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [coord, setCoord] = useState("");
  const [achados, setAchados] = useState<Achado[]>([]);
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    let vivo = true;
    void chamarLogistica<{ origem: Origem | null }>("/api/logistica/entregas").then((r) => {
      if (!vivo || !r.ok || !r.data.origem) return;
      const o = r.data.origem;
      setAtual(o); setNome(o.origem_nome); setEndereco(o.origem_endereco); setCoord(`${o.origem_lat}, ${o.origem_lng}`);
    });
    return () => { vivo = false; };
  }, []);

  const procurar = async () => {
    setErro(""); setAchados([]);
    const r = await chamarLogistica<{ achados: Achado[] }>("/api/logistica/origem", { method: "POST", body: JSON.stringify({ procurar: endereco }) });
    if (!r.ok) { setErro(r.error); return; }
    if (!r.data.achados.length) { setErro("Não achei esse endereço. Confira ou informe a coordenada à mão."); return; }
    setAchados(r.data.achados);
  };
  const m = coord.replace(/\s/g, "").match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  const salvar = async () => {
    if (!m) return;
    setIndo(true);
    const r = await chamarLogistica<Origem>("/api/logistica/origem", { method: "POST", body: JSON.stringify({ nome, endereco, lat: Number(m[1]), lng: Number(m[2]) }) });
    setIndo(false);
    if (!r.ok) { setErro(r.error); return; }
    setAtual(r.data);
    notify("Origem das entregas salva.");
  };

  return (
    <>
      <div className="finance-page-head almox-head">
        <div>
          <p className="eyebrow">LOGÍSTICA · ORIGEM</p>
          <h1>De onde o caminhão sai</h1>
          <p>O pátio de saída das entregas. Toda entrega nova parte daqui; mudar a origem não mexe nas entregas que já estão com a frota.</p>
        </div>
      </div>
      {erro && <Callout variant="danger" title="Não deu">{erro}</Callout>}
      <section className="almox-bloco logi-form">
        <label className="logi-campo"><span>Nome</span><input value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Pátio da fábrica" /></label>
        <label className="logi-campo"><span>Endereço</span>
          <span className="logi-junto"><input value={endereco} maxLength={300} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, cidade - UF" />
            <Button variant="secondary" compact disabled={endereco.trim().length < 5} onClick={() => void procurar()}>Procurar no mapa</Button></span>
        </label>
        {achados.length > 0 && (
          <ul className="logi-escolhas" aria-label="Endereços encontrados">
            {achados.map((a) => <li key={`${a.lat},${a.lng}`}><button type="button" onClick={() => { setCoord(`${a.lat}, ${a.lng}`); setAchados([]); }}><b>{a.nome}</b><small>{a.lat.toFixed(5)}, {a.lng.toFixed(5)}</small></button></li>)}
          </ul>
        )}
        <label className="logi-campo"><span>Coordenada (latitude, longitude)</span><input value={coord} onChange={(e) => setCoord(e.target.value)} placeholder="-22.7395, -47.3317" /></label>
        <div className="logi-rodape">
          {atual?.updated_at && <small className="ti-nota">Salva por {atual.updated_by_nome ?? "—"} em {dataHora(atual.updated_at)}</small>}
          <Button disabled={indo || nome.trim().length < 2 || !m} onClick={() => void salvar()}>{indo ? "Salvando…" : "Salvar a origem"}</Button>
        </div>
      </section>
    </>
  );
}
