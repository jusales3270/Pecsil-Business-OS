"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout } from "../../../packages/design-system";
import { MapaDoPonto, type Ponto } from "./MapaDoPonto";
import { type Origem, chamarLogistica, dataHora } from "./tipos";

/**
 * Origem das entregas: o pátio de onde o caminhão sai. É configuração da Logística (não um texto fixo no
 * código). O endereço vem do cadastro da empresa ou é digitado; a busca tolera erro de digitação e devolve
 * sugestões; a coordenada exata é a do alfinete, que a pessoa arrasta no mapa (com satélite) até o portão.
 */
type Achado = { lat: number; lng: number; nome: string; precisao: "numero" | "rua" | "cep" | "cidade"; fonte: string };
const PRECISAO: Record<Achado["precisao"], string> = { numero: "no número", rua: "na rua", cep: "no CEP", cidade: "só a cidade" };

export function OrigemConfig({ notify }: { notify: (m: string) => void }) {
  const [atual, setAtual] = useState<Origem | null>(null);
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [ponto, setPonto] = useState<Ponto | null>(null);
  const [achados, setAchados] = useState<Achado[]>([]);
  const [escolhido, setEscolhido] = useState<Achado | null>(null);
  const [erro, setErro] = useState("");
  const [procurando, setProcurando] = useState(false);
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    let vivo = true;
    void chamarLogistica<{ origem: Origem | null }>("/api/logistica/entregas").then((r) => {
      if (!vivo || !r.ok || !r.data.origem) return;
      const o = r.data.origem;
      setAtual(o); setNome(o.origem_nome); setEndereco(o.origem_endereco); setPonto({ lat: Number(o.origem_lat), lng: Number(o.origem_lng) });
    });
    void chamarLogistica<{ empresa: string | null }>("/api/logistica/origem").then((r) => { if (vivo && r.ok) setEmpresa(r.data.empresa); });
    return () => { vivo = false; };
  }, []);

  const procurar = async (texto = endereco) => {
    setErro(""); setAchados([]); setEscolhido(null); setProcurando(true);
    const r = await chamarLogistica<{ achados: Achado[] }>("/api/logistica/origem", { method: "POST", body: JSON.stringify({ procurar: texto, perto: ponto }) });
    setProcurando(false);
    if (!r.ok) { setErro(r.error); return; }
    if (!r.data.achados.length) { setErro("Não achei esse endereço. Confira a cidade (ou informe o CEP) e procure de novo, ou marque o ponto direto no mapa."); return; }
    setAchados(r.data.achados);
    escolher(r.data.achados[0]);
  };
  const escolher = (a: Achado) => { setEscolhido(a); setPonto({ lat: a.lat, lng: a.lng }); };
  const usarEmpresa = () => { if (!empresa) return; setEndereco(empresa); if (!nome.trim()) setNome("Pátio da fábrica"); void procurar(empresa); };
  const aoMover = useCallback((p: Ponto) => { setPonto(p); }, []);

  const salvar = async () => {
    if (!ponto) return;
    setIndo(true);
    const r = await chamarLogistica<Origem>("/api/logistica/origem", { method: "POST", body: JSON.stringify({ nome, endereco, lat: Number(ponto.lat.toFixed(7)), lng: Number(ponto.lng.toFixed(7)) }) });
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
          <span className="logi-junto">
            <input value={endereco} maxLength={300} onChange={(e) => setEndereco(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && endereco.trim().length >= 5) { e.preventDefault(); void procurar(); } }} placeholder="Rua, número, bairro, cidade - UF, CEP" />
            <Button variant="secondary" compact disabled={procurando || endereco.trim().length < 5} onClick={() => void procurar()}>{procurando ? "Procurando…" : "Procurar no mapa"}</Button>
          </span>
        </label>
        {empresa && endereco !== empresa && (
          <p className="ti-nota">Endereço da empresa no cadastro: <b>{empresa}</b> · <button type="button" className="logi-link" onClick={usarEmpresa}>Usar este endereço</button></p>
        )}
        {achados.length > 0 && (
          <ul className="logi-escolhas" role="listbox" aria-label="Endereços encontrados">
            {achados.map((a) => (
              <li key={`${a.lat},${a.lng}`}>
                <button type="button" role="option" aria-selected={escolhido === a} className={escolhido === a ? "on" : ""} onClick={() => escolher(a)}>
                  <b>{a.nome}</b><small>achado {PRECISAO[a.precisao]} · {a.fonte}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {escolhido && escolhido.precisao !== "numero" && (
          <Callout variant="warning" title={`O endereço foi achado ${PRECISAO[escolhido.precisao]}, não no número`}>Arraste o alfinete (ou clique no mapa) até o portão do pátio: a coordenada salva é a do alfinete.</Callout>
        )}
        <MapaDoPonto ponto={ponto} aoMover={aoMover} />
        <p className="ti-nota">{ponto ? <>Coordenada do alfinete: <b>{ponto.lat.toFixed(6)}, {ponto.lng.toFixed(6)}</b>. Arraste ou clique no mapa para ajustar.</> : "Procure o endereço ou clique no mapa para marcar o ponto."}</p>
        <div className="logi-rodape">
          {atual?.updated_at && <small className="ti-nota">Salva por {atual.updated_by_nome ?? "—"} em {dataHora(atual.updated_at)}</small>}
          <Button disabled={indo || nome.trim().length < 2 || !ponto} onClick={() => void salvar()}>{indo ? "Salvando…" : "Salvar a origem"}</Button>
        </div>
      </section>
    </>
  );
}
