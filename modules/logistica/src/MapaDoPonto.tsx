"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as LT from "leaflet";

/**
 * Mapa para marcar um ponto com exatidão (a origem das entregas, o ponto de um cliente): o alfinete vai para a
 * sugestão escolhida e a pessoa arrasta (ou clica) até o lugar certo — o portão do pátio, a doca do cliente.
 * A visão de satélite ajuda a achar o lugar quando o endereço só chega à rua.
 */
export type Ponto = { lat: number; lng: number };
const RUAS = { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 };
const SATELITE = { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "Imagens &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 19 };

export function MapaDoPonto({ ponto, aoMover, centroPadrao }: { ponto: Ponto | null; aoMover: (p: Ponto) => void; centroPadrao?: Ponto }) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<LT.Map | null>(null);
  const L = useRef<typeof LT | null>(null);
  const alfinete = useRef<LT.Marker | null>(null);
  const camada = useRef<LT.TileLayer | null>(null);
  const mover = useRef(aoMover);
  const [satelite, setSatelite] = useState(true);
  const [pronto, setPronto] = useState(false);
  useEffect(() => { mover.current = aoMover; }, [aoMover]);

  // Nasce uma vez (Leaflet só no navegador).
  useEffect(() => {
    let vivo = true;
    void import("leaflet").then((mod) => {
      if (!vivo || !caixa.current || mapa.current) return;
      const lf = (mod as unknown as { default?: typeof LT }).default ?? (mod as unknown as typeof LT);
      L.current = lf;
      const inicio = ponto ?? centroPadrao ?? { lat: -23.26, lng: -47.3 };
      const m = lf.map(caixa.current, { zoomControl: true }).setView([inicio.lat, inicio.lng], ponto ? 18 : 13);
      m.on("click", (e: LT.LeafletMouseEvent) => mover.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
      mapa.current = m;
      setPronto(true);
      setTimeout(() => m.invalidateSize(), 50);
    });
    const obs = new ResizeObserver(() => mapa.current?.invalidateSize());
    if (caixa.current) obs.observe(caixa.current);
    return () => { vivo = false; obs.disconnect(); mapa.current?.remove(); mapa.current = null; alfinete.current = null; camada.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o mapa nasce uma vez; ponto e camada têm efeitos próprios
  }, []);

  // Ruas ou satélite.
  useEffect(() => {
    const lf = L.current, m = mapa.current;
    if (!pronto || !lf || !m) return;
    camada.current?.remove();
    const c = satelite ? SATELITE : RUAS;
    camada.current = lf.tileLayer(c.url, { maxZoom: c.maxZoom, attribution: c.attribution }).addTo(m);
  }, [satelite, pronto]);

  // O alfinete segue o ponto; arrastar devolve a coordenada nova.
  useEffect(() => {
    const lf = L.current, m = mapa.current;
    if (!pronto || !lf || !m) return;
    if (!ponto) { alfinete.current?.remove(); alfinete.current = null; return; }
    if (!alfinete.current) {
      const icone = lf.divIcon({ className: "", html: '<div class="logi-alfinete" aria-hidden="true"></div>', iconSize: [28, 28], iconAnchor: [14, 28] });
      alfinete.current = lf.marker([ponto.lat, ponto.lng], { draggable: true, icon: icone, keyboard: true, title: "Arraste até o lugar exato" }).addTo(m);
      alfinete.current.on("dragend", () => { const p = alfinete.current!.getLatLng(); mover.current({ lat: p.lat, lng: p.lng }); });
      m.setView([ponto.lat, ponto.lng], Math.max(m.getZoom(), 18));
    } else {
      const atual = alfinete.current.getLatLng();
      if (Math.abs(atual.lat - ponto.lat) > 1e-7 || Math.abs(atual.lng - ponto.lng) > 1e-7) {
        alfinete.current.setLatLng([ponto.lat, ponto.lng]);
        if (!m.getBounds().contains([ponto.lat, ponto.lng])) m.setView([ponto.lat, ponto.lng], Math.max(m.getZoom(), 17));
      }
    }
  }, [ponto, pronto]);

  return (
    <div className="logi-mapa-ponto">
      <div ref={caixa} className="logi-mapa-ponto-caixa" aria-label="Mapa: clique ou arraste o alfinete até o lugar exato" />
      <div className="logi-mapa-ponto-camadas" role="group" aria-label="Tipo de mapa">
        <button type="button" className={satelite ? "on" : ""} aria-pressed={satelite} onClick={() => setSatelite(true)}>Satélite</button>
        <button type="button" className={!satelite ? "on" : ""} aria-pressed={!satelite} onClick={() => setSatelite(false)}>Ruas</button>
      </div>
    </div>
  );
}
