"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as LT from "leaflet";
import { Callout, Status } from "../../../packages/design-system";
import { acrescentarAoRastro } from "../../../lib/logistica/regras.mjs";
import { type AoVivo, type Entrega, type Motorista, SITUACAO, chamarLogistica, haQuanto, hora, km, useAgora } from "./tipos";

/**
 * O mapa ao vivo: o pátio de onde o caminhão sai, os destinos das entregas abertas e os caminhões, que andam
 * a cada leitura (5 s). Ao lado, as entregas na estrada com o andamento e a previsão de chegada. O trajeto feito
 * fica desenhado enquanto a tela está aberta. O mapa é OpenStreetMap.
 */
const LEITURA_MS = 5000;
/** Cores das linhas: azul forte (com contorno branco) para o que falta, cinza para o que já foi. O laranja e o
 * vermelho se confundem com as estradas do mapa. */
const ROTA = "#1d4ed8";
const FEITO = "#64748b";
const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function MapaAoVivo({ abrirEntregas }: { abrirEntregas: () => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const mapa = useRef<LT.Map | null>(null);
  const L = useRef<typeof LT | null>(null);
  const camadas = useRef<{ fixos: LT.LayerGroup; caminhoes: LT.LayerGroup; rastros: LT.LayerGroup } | null>(null);
  const rastros = useRef(new Map<string, [number, number][][]>());
  const marcadores = useRef(new Map<string, LT.Marker>());
  const enquadrado = useRef(false);
  const [dados, setDados] = useState<AoVivo | null>(null);
  const [erro, setErro] = useState("");
  const [foco, setFoco] = useState<string | null>(null);
  const agora = useAgora(5000);

  const ler = useCallback(async () => {
    if (document.hidden) return;
    const r = await chamarLogistica<AoVivo>("/api/logistica/ao-vivo");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void ler(); }, 0);
    const id = setInterval(() => { void ler(); }, LEITURA_MS);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [ler]);

  // Mapa: nasce uma vez (Leaflet só no navegador).
  useEffect(() => {
    let vivo = true;
    void import("leaflet").then((mod) => {
      if (!vivo || !caixa.current || mapa.current) return;
      const lf = (mod as unknown as { default?: typeof LT }).default ?? (mod as unknown as typeof LT);
      L.current = lf;
      const m = lf.map(caixa.current, { zoomControl: true, attributionControl: true }).setView([-22.74, -47.33], 9);
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      camadas.current = { fixos: lf.layerGroup().addTo(m), rastros: lf.layerGroup().addTo(m), caminhoes: lf.layerGroup().addTo(m) };
      mapa.current = m;
      setTimeout(() => m.invalidateSize(), 50);
    });
    const obs = new ResizeObserver(() => mapa.current?.invalidateSize());
    if (caixa.current) obs.observe(caixa.current);
    return () => { vivo = false; obs.disconnect(); mapa.current?.remove(); mapa.current = null; };
  }, []);

  const abertas = useMemo(() => (dados?.entregas ?? []).filter((e) => ["enviada", "a_caminho"].includes(e.situacao)), [dados]);
  const naEstrada = abertas.filter((e) => e.situacao === "a_caminho");
  const entregues = (dados?.entregas ?? []).filter((e) => e.situacao === "entregue");
  const motoristaDa = useCallback((e: Entrega): Motorista | undefined => (dados?.motoristas ?? []).find((m) => m.nome === e.motorista), [dados]);

  // Desenho: pátio, destinos, rotas, caminhões e o rastro de cada caminhão.
  useEffect(() => {
    const lf = L.current, m = mapa.current, c = camadas.current;
    if (!lf || !m || !c || !dados) return;
    c.fixos.clearLayers();
    const pontos: [number, number][] = [];
    if (dados.origem) {
      const o: [number, number] = [dados.origem.origem_lat, dados.origem.origem_lng];
      pontos.push(o);
      lf.marker(o, { icon: lf.divIcon({ className: "logi-pin", html: `<span class="logi-patio">PÁTIO</span>`, iconSize: [52, 22], iconAnchor: [26, 11] }) })
        .bindTooltip(escapar(dados.origem.origem_nome), { direction: "top" }).addTo(c.fixos);
    }
    for (const e of dados.entregas) {
      if (e.destino_lat === null || e.destino_lng === null || e.situacao === "cancelada") continue;
      const d: [number, number] = [e.destino_lat, e.destino_lng];
      if (["enviada", "a_caminho"].includes(e.situacao)) pontos.push(d);
      const cor = SITUACAO[e.situacao].cor;
      lf.marker(d, { icon: lf.divIcon({ className: "logi-pin", html: `<span class="logi-destino" style="--cor:${cor}">${e.numero}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .bindTooltip(`<b>${escapar(e.cliente_nome)}</b><br>Entrega ${e.numero} · ${SITUACAO[e.situacao].rotulo}`, { direction: "top" })
        .on("click", () => setFoco(e.id)).addTo(c.fixos);
      const trajeto = dados.andamento[e.id]?.trajeto ?? [];
      if (trajeto.length > 1) {
        const linha = trajeto.map(([lng, lat]) => [lat, lng] as [number, number]);
        lf.polyline(linha, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(c.fixos);
        lf.polyline(linha, { color: ROTA, weight: 5, opacity: 0.95 }).addTo(c.fixos);
      }
      // Sem a rota pela estrada, liga o caminhão ao destino com uma linha tracejada.
      const mot = e.situacao === "a_caminho" && trajeto.length < 2 ? motoristaDa(e) : undefined;
      if (mot?.posicao) lf.polyline([[mot.posicao.lat, mot.posicao.lng], d], { color: ROTA, weight: 3, dashArray: "6 8", opacity: 0.85 }).addTo(c.fixos);
    }

    const vistos = new Set<string>();
    for (const mot of dados.motoristas) {
      if (!mot.posicao) continue;
      vistos.add(mot.id);
      const p: [number, number] = [mot.posicao.lat, mot.posicao.lng];
      pontos.push(p);
      rastros.current.set(mot.id, acrescentarAoRastro(rastros.current.get(mot.id) ?? [], p));
      const html = `<span class="logi-caminhao${mot.online ? "" : " parado"}" style="--giro:${mot.direcao ?? 0}deg"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M12 3l6 16-6-3-6 3z" fill="currentColor"/></svg></span>`
        + `<span class="logi-placa">${escapar(mot.veiculo?.placa ?? mot.nome)}</span>`;
      const dica = `<b>${escapar(mot.nome)}</b>${mot.veiculo?.placa ? ` · ${escapar(mot.veiculo.placa)}` : ""}<br>${mot.velocidade !== null ? `${mot.velocidade} km/h · ` : ""}posição ${haQuanto(mot.atualizado, Date.now())}`;
      const ja = marcadores.current.get(mot.id);
      if (ja) { ja.setLatLng(p); ja.setIcon(lf.divIcon({ className: "logi-pin", html, iconSize: [34, 34], iconAnchor: [17, 17] })); ja.setTooltipContent(dica); }
      else marcadores.current.set(mot.id, lf.marker(p, { icon: lf.divIcon({ className: "logi-pin", html, iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1000 }).bindTooltip(dica, { direction: "top" }).addTo(c.caminhoes));
    }
    for (const [id, mk] of marcadores.current) if (!vistos.has(id)) { c.caminhoes.removeLayer(mk); marcadores.current.delete(id); }
    c.rastros.clearLayers();
    for (const [, trechos] of rastros.current) for (const t of trechos) if (t.length > 1) lf.polyline(t, { color: FEITO, weight: 4, opacity: 0.85 }).addTo(c.rastros);

    if (!enquadrado.current && pontos.length) {
      enquadrado.current = true;
      if (pontos.length === 1) m.setView(pontos[0], 12); else m.fitBounds(lf.latLngBounds(pontos), { padding: [40, 40], maxZoom: 13 });
    }
  }, [dados, motoristaDa]);

  const focar = (e: Entrega) => {
    setFoco(e.id);
    const mot = motoristaDa(e);
    const alvo = mot?.posicao ? [mot.posicao.lat, mot.posicao.lng] as [number, number] : e.destino_lat !== null && e.destino_lng !== null ? [e.destino_lat, e.destino_lng] as [number, number] : null;
    if (alvo) mapa.current?.flyTo(alvo, 13, { duration: 0.8 });
  };

  const online = (dados?.motoristas ?? []).filter((m) => m.online).length;

  return (
    <>
      <div className="finance-page-head almox-head">
        <div>
          <p className="eyebrow">LOGÍSTICA · AO VIVO</p>
          <h1>Caminhões na estrada</h1>
          <p>Posição dos motoristas a cada 5 segundos, os destinos das entregas abertas e a previsão de chegada. O trajeto feito aparece enquanto esta tela está aberta.</p>
        </div>
      </div>
      {erro && <Callout variant="danger" title="O mapa não atualizou">{erro}</Callout>}
      {dados && !dados.servico && <Callout variant="warning" title="Serviço de entregas desligado">O Fleetbase ainda não está ligado nesta instalação: o mapa mostra só o que já está gravado na plataforma.</Callout>}
      {dados && !dados.origem && <Callout variant="info" title="Falta a origem das entregas">Configure o pátio de onde o caminhão sai em Logística › Origem.</Callout>}
      <div className="logi-ao-vivo">
        <div className="logi-mapa" ref={caixa} role="region" aria-label="Mapa das entregas e dos caminhões" />
        <aside className="logi-lado">
          <div className="logi-resumo">
            <div><b>{naEstrada.length}</b><small>na estrada</small></div>
            <div><b>{abertas.length - naEstrada.length}</b><small>com a frota</small></div>
            <div><b>{entregues.length}</b><small>entregues em 12 h</small></div>
            <div><b>{online}</b><small>motoristas online</small></div>
          </div>
          {!dados ? <p className="ti-nota">Carregando…</p> : !abertas.length ? (
            <div className="logi-vazio"><b>Nenhuma entrega aberta</b><small>As entregas criadas em Logística › Entregas aparecem aqui quando vão para a frota.</small>
              <button type="button" className="ds-button secondary compact" onClick={abrirEntregas}>Abrir as entregas</button></div>
          ) : (
            <ul className="logi-lista">
              {abertas.map((e) => {
                const a = dados.andamento[e.id];
                const mot = motoristaDa(e);
                return (
                  <li key={e.id} className={foco === e.id ? "ativo" : ""}>
                    <button type="button" onClick={() => focar(e)}>
                      <span className="logi-linha1"><b>#{e.numero} · {e.cliente_nome}</b><Status tone={SITUACAO[e.situacao].tom}>{SITUACAO[e.situacao].rotulo}</Status></span>
                      <small>{[e.origem_rotulo, e.descricao].filter(Boolean).join(" · ")}</small>
                      {e.situacao === "a_caminho" && (
                        <>
                          <span className="logi-barra" aria-label={`${Math.round(a?.percentual ?? 0)}% do caminho`}><i style={{ width: `${Math.min(100, Math.max(3, a?.percentual ?? 0))}%` }} /></span>
                          <small>
                            {e.motorista ?? "Motorista"}{e.veiculo ? ` · ${e.veiculo}` : ""}{mot?.velocidade !== null && mot?.velocidade !== undefined ? ` · ${mot.velocidade} km/h` : ""}
                            {" · "}faltam {km(a?.faltaM)} · chega ~{hora(a?.chegada ?? e.previsao)}
                            {a?.estimativaEmLinhaReta ? " (estimativa em linha reta)" : a?.comTransito ? " (com o trânsito de agora)" : ""}
                          </small>
                          {mot && <small className="logi-sinal">posição {haQuanto(mot.atualizado, agora)}{mot.online ? "" : " · celular sem sinal agora"}</small>}
                        </>
                      )}
                      {e.situacao === "enviada" && <small>Aguardando o motorista sair{e.rastreio ? ` · rastreio ${e.rastreio}` : ""}</small>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {dados?.lidoEm && <p className="ti-nota">Atualizado {haQuanto(dados.lidoEm, agora)}.</p>}
        </aside>
      </div>
    </>
  );
}
