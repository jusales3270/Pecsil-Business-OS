#!/usr/bin/env node
/**
 * Simulador de rota para testar a Logística SEM motorista de verdade (docs/PLANO-LOGISTICA.md).
 * Só funciona contra o Fleetbase LOCAL (recusa qualquer endereço que não seja localhost).
 *
 *   node scripts/fleetbase-simular-rota.mjs [ordem] [--passos=40] [--intervalo=2000] [--sem-concluir]
 *
 * Sem `ordem`, usa a mais recente ainda não concluída. Garante um caminhão e um motorista de teste, designa,
 * despacha e inicia a ordem, manda posições de GPS do pátio até o cliente PELA ROTA DA ESTRADA (a que o
 * Fleetbase calculou; sem ela, em linha reta), com velocidade e direção, e, no fim, conclui. A cada mudança, avisa a plataforma em /api/logistica/aviso (como o webhook do Fleetbase faria).
 *
 * Variáveis: FLEETBASE_API_URL e FLEETBASE_API_KEY (ou o arquivo ~/fleetbase-frota/.credenciais-locais),
 * PLATAFORMA_URL (padrão http://localhost:3000) e FLEETBASE_AVISO_TOKEN (para o aviso).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { decodificarPolyline, distanciaKm } from "../lib/logistica/regras.mjs";

const args = process.argv.slice(2);
const opc = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const ordemPedida = args.find((a) => !a.startsWith("--"));
const passos = Math.max(5, Number(opc.passos) || 40);
const intervalo = Math.max(500, Number(opc.intervalo) || 2000);

const env = { ...process.env };
for (const arq of [".env.local", `${homedir()}/fleetbase-frota/.credenciais-locais`]) {
  if (!existsSync(arq)) continue;
  for (const l of readFileSync(arq, "utf8").split("\n")) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) { const k = l.slice(0, i).trim(); if (!env[k]) env[k] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""); }
  }
}
const BASE = (env.FLEETBASE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const CHAVE = env.FLEETBASE_API_KEY || env.FB_API_KEY;
const PLATAFORMA = (env.PLATAFORMA_URL || "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error(`Recusado: o simulador só roda contra o Fleetbase local (veio ${BASE}).`); process.exit(1); }
if (!CHAVE) { console.error("Falta FLEETBASE_API_KEY."); process.exit(1); }

async function fb(caminho, init = {}) {
  const r = await fetch(`${BASE}/v1${caminho}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${CHAVE}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${caminho} → ${r.status} ${JSON.stringify(j?.errors ?? j).slice(0, 200)}`);
  return j;
}
async function avisar(ordem, etapa) {
  if (!env.FLEETBASE_AVISO_TOKEN) return;
  try {
    const r = await fetch(`${PLATAFORMA}/api/logistica/aviso?t=${encodeURIComponent(env.FLEETBASE_AVISO_TOKEN)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: `order.${etapa}`, data: { id: ordem } }),
    });
    console.log(`  aviso à plataforma (${etapa}): ${r.status}`);
  } catch { console.log("  aviso à plataforma: sem resposta (a tela confere sozinha a cada 10 s)"); }
}
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ponto = (loc) => ({ lat: Number(loc.coordinates[1]), lng: Number(loc.coordinates[0]) });
const rumo = (a, b) => { const y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180); const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };

const ordens = await fb("/orders?limit=50&sort=-created_at");
const ordem = ordemPedida ? await fb(`/orders/${ordemPedida}`) : (Array.isArray(ordens) ? ordens : []).find((o) => !["completed", "canceled"].includes(o.status));
if (!ordem) { console.error("Nenhuma ordem aberta no Fleetbase local. Crie uma entrega na plataforma primeiro."); process.exit(1); }
console.log(`Ordem ${ordem.id} (${ordem.tracking_number?.tracking_number ?? "sem rastreio"}) · situação ${ordem.status}`);

let veiculo = (await fb("/vehicles?limit=50")).find((v) => v.plate_number === "SIM1A23");
if (!veiculo) veiculo = await fb("/vehicles", { method: "POST", body: { make: "Volkswagen", model: "Delivery 11.180 (simulado)", year: "2021", plate_number: "SIM1A23" } });
// Ordem que já tem motorista: anda com ele; senão, usa (ou cria) o motorista simulado.
let motorista = ordem.driver_assigned?.id ? await fb(`/drivers/${ordem.driver_assigned.id}`)
  : (await fb("/drivers?limit=50")).find((d) => d.email === "simulador@pecsil-teste.local");
if (!motorista) motorista = await fb("/drivers", { method: "POST", body: { name: "Motorista Simulado", email: "simulador@pecsil-teste.local", phone: "+5519900001111", password: `Sim!${Date.now()}`, vehicle: veiculo.id, status: "active" } });
console.log(`Caminhão ${veiculo.plate_number} · ${motorista.name}`);

const origem = ponto(ordem.payload.pickup.location), destino = ponto(ordem.payload.dropoff.location);
if (ordem.status === "created") {
  await fb(`/orders/${ordem.id}`, { method: "PUT", body: { driver: motorista.id, vehicle: veiculo.id } });
  await fb(`/orders/${ordem.id}/dispatch`, { method: "POST" });
  console.log("Despachada.");
  await avisar(ordem.id, "dispatched");
}
await fb(`/drivers/${motorista.id}/toggle-online`, { method: "POST", body: { online: true } }).catch(() => {});
await fb(`/drivers/${motorista.id}/track`, { method: "POST", body: { latitude: origem.lat, longitude: origem.lng, speed: 0, heading: rumo(origem, destino) } });
await espera(intervalo);
if (!["started"].includes(ordem.status)) { await fb(`/orders/${ordem.id}/start`, { method: "POST" }).catch((e) => console.log(`  início: ${e.message}`)); console.log("Saiu do pátio."); await avisar(ordem.id, "started"); }

// Coleta feita no pátio: a próxima parada é o cliente (no app do motorista, é o "coletado, saindo").
await fb(`/orders/${ordem.id}/set-destination/${ordem.payload.dropoff.id}`, { method: "POST" }).catch((e) => console.log(`  destino: ${e.message}`));
// O caminho: a rota pela estrada que o Fleetbase devolve (polyline do Google); sem ela, a reta até o cliente.
const rastreio = await fb(`/orders/${ordem.id}/tracker`).catch(() => null);
const estrada = decodificarPolyline(rastreio?.route?.polyline).map(([lng, lat]) => [lat, lng]);
const caminho = estrada.length > 1 ? estrada : [[origem.lat, origem.lng], [destino.lat, destino.lng]];
console.log(estrada.length > 1 ? `Andando pela estrada (${estrada.length} pontos da rota).` : "Sem rota da estrada: andando em linha reta.");
// Pontos igualmente espaçados ao longo do caminho.
const acumulado = [0];
for (let i = 1; i < caminho.length; i++) acumulado.push(acumulado[i - 1] + distanciaKm(caminho[i - 1], caminho[i]));
const total = acumulado.at(-1) || 1;
const noCaminho = (km) => {
  let i = acumulado.findIndex((d) => d >= km);
  if (i <= 0) return caminho[Math.max(0, i)];
  const t = (km - acumulado[i - 1]) / Math.max(1e-9, acumulado[i] - acumulado[i - 1]);
  return [caminho[i - 1][0] + (caminho[i][0] - caminho[i - 1][0]) * t, caminho[i - 1][1] + (caminho[i][1] - caminho[i - 1][1]) * t];
};
let anterior = caminho[0];
for (let i = 1; i <= passos; i++) {
  const [lat, lng] = noCaminho((total * i) / passos);
  const velocidade = i === passos ? 0 : Math.round(55 + Math.sin(i) * 20);
  await fb(`/drivers/${motorista.id}/track`, { method: "POST", body: { latitude: lat, longitude: lng, speed: velocidade, heading: Math.round(rumo({ lat: anterior[0], lng: anterior[1] }, { lat, lng })) } });
  anterior = [lat, lng];
  process.stdout.write(`\r  posição ${i}/${passos} · ${velocidade} km/h   `);
  await espera(intervalo);
}
console.log("\nChegou ao cliente.");
if (!opc["sem-concluir"]) {
  await fb(`/orders/${ordem.id}/complete`, { method: "POST" }).catch((e) => console.log(`  conclusão: ${e.message}`));
  console.log("Entrega concluída.");
  await avisar(ordem.id, "completed");
}
