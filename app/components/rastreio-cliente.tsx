"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as LT from "leaflet";

/**
 * Link de rastreio do cliente (docs/PLANO-LOGISTICA.md §3): a entrega, a previsão de chegada e, enquanto está a
 * caminho, o caminhão no mapa com a rota à frente. Sem dados do motorista. O nome da empresa vem da configuração
 * fiscal: nenhuma empresa fica fixa no código. Atualiza a cada 30 s.
 */
type Rastreio = {
  situacao: "aberto" | "cancelado" | "expirado" | "inexistente";
  empresa?: string | null; expiraEm?: string | null; numero?: number | null; cliente?: string | null; descricao?: string | null; endereco?: string | null;
  etapa?: "enviada" | "a_caminho" | "entregue" | "falhou" | "cancelada" | "criada" | null; saiuEm?: string | null; entregueEm?: string | null;
  chegada?: string | null; comTransito?: boolean; faltaM?: number | null; percentual?: number | null;
  caminhao?: { lat: number; lng: number } | null; destino?: { lat: number; lng: number } | null; rota?: [number, number][];
};

const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "");
const dia = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const km = (m?: number | null) => (m === null || m === undefined ? "" : m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`);

const ETAPAS = [
  { id: "enviada", rotulo: "Programada para entrega" },
  { id: "a_caminho", rotulo: "Saiu para entrega" },
  { id: "entregue", rotulo: "Entregue" },
] as const;

export function RastreioCliente({ codigo }: { codigo: string }) {
  const [r, setR] = useState<Rastreio | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const mapa = useRef<LT.Map | null>(null);
  const L = useRef<typeof LT | null>(null);
  const camada = useRef<LT.LayerGroup | null>(null);
  const enquadrado = useRef(false);

  useEffect(() => {
    let vivo = true;
    const ler = () => fetch(`/api/rastreio/${encodeURIComponent(codigo)}`, { cache: "no-store" })
      .then((x) => x.json()).catch(() => ({ situacao: "inexistente" }))
      .then((d: Rastreio) => { if (vivo) setR(d); });
    void ler();
    const id = setInterval(() => { if (!document.hidden) void ler(); }, 30_000);
    return () => { vivo = false; clearInterval(id); };
  }, [codigo]);

  const comMapa = Boolean(r?.situacao === "aberto" && r.destino);
  useEffect(() => {
    if (!comMapa || !caixa.current || mapa.current) return;
    let vivo = true;
    void import("leaflet").then((mod) => {
      if (!vivo || !caixa.current || mapa.current) return;
      const lf = (mod as unknown as { default?: typeof LT }).default ?? (mod as unknown as typeof LT);
      L.current = lf;
      mapa.current = lf.map(caixa.current, { zoomControl: true }).setView([-22.9, -47.06], 11);
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa.current);
      camada.current = lf.layerGroup().addTo(mapa.current);
      setR((x) => (x ? { ...x } : x));
    });
    return () => { vivo = false; mapa.current?.remove(); mapa.current = null; };
  }, [comMapa]);

  useEffect(() => {
    const lf = L.current, m = mapa.current, c = camada.current;
    if (!lf || !m || !c || !r || r.situacao !== "aberto") return;
    c.clearLayers();
    const pontos: [number, number][] = [];
    if (r.rota && r.rota.length > 1) {
      const linha = r.rota.map(([lng, lat]) => [lat, lng] as [number, number]);
      lf.polyline(linha, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(c);
      lf.polyline(linha, { color: "#1d4ed8", weight: 5, opacity: 0.95 }).addTo(c);
    }
    if (r.destino) {
      pontos.push([r.destino.lat, r.destino.lng]);
      lf.marker([r.destino.lat, r.destino.lng], { icon: lf.divIcon({ className: "logi-pin", html: '<span class="logi-destino" style="--cor:#10b981">✓</span>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(c);
    }
    if (r.caminhao) {
      pontos.push([r.caminhao.lat, r.caminhao.lng]);
      lf.marker([r.caminhao.lat, r.caminhao.lng], { icon: lf.divIcon({ className: "logi-pin", html: '<span class="logi-caminhao"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M1 6h13v10H1zM14 9h4l3 3v4h-7z" fill="currentColor"/></svg></span>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(c);
    }
    if (!enquadrado.current && pontos.length) {
      enquadrado.current = true;
      if (pontos.length === 1) m.setView(pontos[0], 14); else m.fitBounds(lf.latLngBounds(pontos), { padding: [40, 40], maxZoom: 14 });
    }
  }, [r]);

  if (!r) return <main className="cotar rastreio"><p className="cotar-carregando">Abrindo o rastreio…</p></main>;
  if (r.situacao !== "aberto") {
    const msg = {
      cancelado: ["Link cancelado", "Este link de rastreio foi cancelado. Se tiver dúvida, fale com quem enviou."],
      expirado: ["Link vencido", "O prazo deste link terminou. Peça um novo a quem enviou."],
      inexistente: ["Link inválido", "Confira se o endereço foi copiado inteiro ou peça um novo link."],
    }[r.situacao];
    return <main className="cotar rastreio"><section className="cotar-cartao"><h1>{msg[0]}</h1><p>{msg[1]}</p></section></main>;
  }

  const ordem = ["enviada", "a_caminho", "entregue"];
  const atual = r.etapa === "falhou" ? -1 : ordem.indexOf(r.etapa ?? "enviada");
  return (
    <main className="cotar rastreio">
      <section className="cotar-cartao">
        <p className="eyebrow">{r.empresa ?? "Rastreio da entrega"}</p>
        <h1>{r.etapa === "entregue" ? "Entrega concluída" : r.etapa === "a_caminho" ? "Sua entrega está a caminho" : r.etapa === "falhou" ? "Entrega não concluída" : "Entrega programada"}</h1>
        <p>Entrega nº {r.numero} para {r.cliente}{r.descricao ? ` · ${r.descricao}` : ""}</p>
        {r.etapa === "a_caminho" && r.chegada && (
          <div className="rastreio-chegada">
            <b>Chega por volta das {hora(r.chegada)}</b>
            <small>{r.faltaM !== null && r.faltaM !== undefined ? `faltam ${km(r.faltaM)} · ` : ""}{r.comTransito ? "previsão com o trânsito de agora" : "previsão aproximada"}</small>
          </div>
        )}
        {r.etapa === "entregue" && <div className="rastreio-chegada ok"><b>Entregue {r.entregueEm ? `em ${dia(r.entregueEm)} às ${hora(r.entregueEm)}` : ""}</b></div>}
        {r.etapa === "falhou" && <div className="rastreio-chegada falhou"><b>A entrega não foi concluída</b><small>Quem enviou este link vai entrar em contato.</small></div>}
        <ol className="rastreio-etapas" aria-label="Etapas da entrega">
          {ETAPAS.map((e, i) => <li key={e.id} className={i <= atual ? "feita" : ""}><i aria-hidden />{e.rotulo}{e.id === "a_caminho" && r.saiuEm ? <small>{hora(r.saiuEm)}</small> : null}</li>)}
        </ol>
      </section>
      {comMapa && <section className="cotar-cartao rastreio-mapa-cartao"><div className="rastreio-mapa" ref={caixa} role="region" aria-label="Mapa da entrega" />{r.endereco && <p>{r.endereco}</p>}</section>}
      <p className="rastreio-nota">Esta página atualiza sozinha. O link vale até {dia(r.expiraEm)}.</p>
    </main>
  );
}
