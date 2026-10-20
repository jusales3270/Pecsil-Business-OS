import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acrescentarAoRastro, andamentoParaTela, conferenciaDaOrdem, decodificarPolyline, distanciaKm, rastreioParaCliente, restanteNaRota, consultasDeCoordenada, enderecoDoCliente, freteEhNosso, lerCoordenada,
  mesmoToken, motoristaParaTela, situacaoDoFleetbase,
} from "../lib/logistica/regras.mjs";

const mig = await readFile(new URL("../supabase/migrations/202610200001_logistica_entregas.sql", import.meta.url), "utf8");

test("logística: frete por conta do emitente ou próprio do remetente é o nosso caminhão", () => {
  assert.equal(freteEhNosso(0), true);
  assert.equal(freteEhNosso(3), true);
  assert.equal(freteEhNosso("1"), false, "FOB: o caminhão é do cliente");
  assert.equal(freteEhNosso(9), false, "sem frete");
});

test("logística: situação do Fleetbase vira a da entrega", () => {
  assert.equal(situacaoDoFleetbase("created"), "enviada");
  assert.equal(situacaoDoFleetbase("dispatched"), "enviada");
  assert.equal(situacaoDoFleetbase("started"), "a_caminho");
  assert.equal(situacaoDoFleetbase("driver_enroute"), "a_caminho", "atividade do motorista no caminho");
  assert.equal(situacaoDoFleetbase("completed"), "entregue");
  assert.equal(situacaoDoFleetbase("canceled"), "cancelada");
  assert.equal(situacaoDoFleetbase(""), null);
});

test("logística: endereço do cadastro numa linha e consultas de coordenada sem dado pessoal", () => {
  const c = { logradouro: "Rua A", numero: "10", bairro: "Centro", municipio: "Americana", uf: "SP", cep: "13465000", name: "Fulano", tax_id: "123" };
  assert.equal(enderecoDoCliente(c), "Rua A, 10 · Centro · Americana - SP · CEP 13465-000");
  const q = consultasDeCoordenada(c);
  assert.equal(q[0].street, "10 Rua A");
  assert.equal(q[0].postalcode, "13465-000", "o CEP do cadastro (só dígitos) vai formatado");
  assert.equal(q.at(-1).city, "Americana", "a última tentativa é a cidade");
  for (const x of q) assert.ok(!JSON.stringify(x).includes("Fulano") && !JSON.stringify(x).includes("123"), "nem nome nem documento");
  assert.deepEqual(consultasDeCoordenada({ municipio: "Americana" }), [], "sem UF não consulta");
  assert.deepEqual(lerCoordenada([{ lat: "-22.7", lon: "-47.3" }], q[0]), { lat: -22.7, lng: -47.3, precisao: "rua" });
  assert.equal(lerCoordenada([], q[0]), null);
});

test("logística: o motorista que vai para a tela não leva token, telefone nem e-mail", () => {
  const m = motoristaParaTela({ id: "driver_x", name: "João", token: "segredo", phone: "+55", email: "a@b", location: { type: "Point", coordinates: [-47.1, -22.8] },
    online: true, speed: 61.7, heading: 120, vehicle: { plate_number: "ABC1D23", make: "VW", model: "Delivery" } });
  assert.deepEqual(m.posicao, { lat: -22.8, lng: -47.1 });
  assert.equal(m.velocidade, 62);
  assert.equal(m.veiculo.placa, "ABC1D23");
  const texto = JSON.stringify(m);
  for (const proibido of ["segredo", "+55", "a@b"]) assert.ok(!texto.includes(proibido), proibido);
});

test("logística: conferência da ordem e andamento", () => {
  const c = conferenciaDaOrdem({ status: "started", started_at: "2026-10-20T09:21:05Z", driver_assigned: { name: "João", vehicle: { plate_number: "ABC1D23", make: "VW", model: "Delivery" } },
    tracking_statuses: [{ code: "CREATED", created_at: "x" }] }, { eta: { completion_at: "2026-10-20T11:00:00Z" } });
  assert.equal(c.situacao, "a_caminho");
  assert.equal(c.motorista, "João");
  assert.equal(c.veiculo, "ABC1D23 · VW Delivery");
  assert.equal(c.previsao, "2026-10-20T11:00:00Z");
  const fim = conferenciaDaOrdem({ status: "completed", tracking_statuses: [{ code: "COMPLETED", created_at: "2026-10-20T11:05:00Z" }] }, null);
  assert.equal(fim.entregue_em, "2026-10-20T11:05:00Z");
  const a = andamentoParaTela({ progress: { percentage: 40, remaining_distance_m: 1234.5 }, eta: { completion_at: "t" }, confidence: "low", warnings: ["calculated_route_used"], route: { coordinates: [] } });
  assert.equal(a.faltaM, 1235);
  assert.equal(a.estimativaEmLinhaReta, true);
});

test("logística: rota do Google (polyline) vira pontos no mapa e a previsão diz quando tem trânsito", () => {
  // Exemplo oficial do formato: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
  assert.deepEqual(decodificarPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  assert.deepEqual(decodificarPolyline(""), []);
  assert.deepEqual(decodificarPolyline("_p~iF"), [], "texto cortado não inventa ponto");
  const a = andamentoParaTela({ provider: "google_routes", capabilities: { traffic: true }, route: { coordinates: [], polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", duration_in_traffic_s: 4140 }, warnings: [] });
  assert.equal(a.trajeto.length, 3);
  assert.equal(a.comTransito, true);
  assert.equal(a.estimativaEmLinhaReta, false);
});

test("logística: o trajeto feito se interrompe num salto, em vez de desenhar uma reta falsa", () => {
  assert.ok(Math.abs(distanciaKm([-22.7395, -47.3317], [-22.9057, -47.0610]) - 33.4) < 1, "Americana → Campinas em linha reta");
  let t = acrescentarAoRastro([], [-22.7395, -47.3317]);
  t = acrescentarAoRastro(t, [-22.7400, -47.3300]);
  t = acrescentarAoRastro(t, [-22.7400, -47.3300]);
  assert.equal(t.length, 1); assert.equal(t[0].length, 2, "ponto repetido não entra");
  t = acrescentarAoRastro(t, [-22.9057, -47.0610]);
  assert.equal(t.length, 2, "o salto de 30 km abre um trecho novo");
  let longo = [];
  for (let i = 0; i < 320; i++) longo = acrescentarAoRastro(longo, [-22.7 - i * 0.0005, -47.3]);
  assert.equal(longo.reduce((s, x) => s + x.length, 0), 300, "guarda só os 300 pontos mais recentes");
});

test("logística: quanto falta pela estrada, medido na rota guardada com a posição de agora", () => {
  // Rota em L: 10 km para o leste e 10 km para o norte (aprox.), em [lng, lat].
  const rota = [[-47.0, -23.0], [-46.902, -23.0], [-46.902, -22.910]];
  const inicio = restanteNaRota(rota, { lat: -23.0, lng: -47.0 });
  assert.ok(inicio.percentual === 0 && Math.abs(inicio.faltaM - 20_000) < 400, JSON.stringify(inicio));
  const meio = restanteNaRota(rota, { lat: -23.0005, lng: -46.902 });
  assert.ok(Math.abs(meio.percentual - 50) <= 1 && Math.abs(meio.faltaM - 10_000) < 400, JSON.stringify(meio));
  assert.deepEqual(meio.aFrente[0], [-46.902, -23.0005], "a rota à frente começa no caminhão");
  assert.deepEqual(meio.aFrente.at(-1), [-46.902, -22.910], "e termina no cliente");
  assert.ok(!meio.aFrente.some(([lng]) => lng === -47.0), "sem o trecho que já ficou para trás");
  assert.equal(restanteNaRota(rota, { lat: -23.2, lng: -47.0 }), null, "longe da rota: não chuta");
  assert.equal(restanteNaRota([], { lat: -23, lng: -47 }), null);
});

test("logística: a página do cliente não recebe motorista, placa nem a ordem do Fleetbase", () => {
  const lido = { situacao: "aberto", empresa: "Empresa X", expira_em: "t", entrega: { numero: 7, cliente: "Cliente", descricao: "2 moldes", etapa: "a_caminho",
    destino_lat: -22.9, destino_lng: -47.06, destino_endereco: "Rua A" }, servidor: { ordem: "order_segredo", motorista: "João da Silva" } };
  const p = rastreioParaCliente(lido, { lat: -22.8, lng: -47.2 }, { chegada: "2026-10-20T11:00:00Z", comTransito: true, faltaM: 16300, percentual: 55, trajeto: [[-47.2, -22.8], [-47.06, -22.9]] });
  assert.equal(p.numero, 7);
  assert.deepEqual(p.caminhao, { lat: -22.8, lng: -47.2 });
  assert.equal(p.faltaM, 16300);
  const texto = JSON.stringify(p);
  for (const proibido of ["order_segredo", "João", "motorista", "placa", "veiculo"]) assert.ok(!texto.includes(proibido), proibido);
  const fim = rastreioParaCliente({ ...lido, entrega: { ...lido.entrega, etapa: "entregue" } }, { lat: -22.9, lng: -47.06 }, null);
  assert.equal(fim.caminhao, null, "entregue: o caminhão some da página");
  assert.deepEqual(rastreioParaCliente({ situacao: "expirado" }), { situacao: "expirado" });
});

test("logística: token do aviso comparado em tempo constante", () => {
  assert.equal(mesmoToken("abc", "abc"), true);
  assert.equal(mesmoToken("abc", "abd"), false);
  assert.equal(mesmoToken("", ""), false, "vazio nunca confere");
});

test("logística: escrita só por funções, conferência só pelo servidor", () => {
  assert.match(mig, /revoke insert, update, delete on public\.logistica_config, public\.logistica_locais, public\.logistica_entregas from anon, authenticated/);
  assert.match(mig, /revoke all on function public\.logistica_conferir\(uuid, text, jsonb\) from public, anon, authenticated;\s*grant execute on function public\.logistica_conferir\(uuid, text, jsonb\) to service_role;/);
  for (const t of ["logistica_config", "logistica_locais", "logistica_entregas"]) {
    assert.match(mig, new RegExp(`alter table public\\.${t} enable row level security`), t);
  }
  assert.match(mig, /'logistica'\)\s*\n\s*order by e\.occurred_at desc limit 60/, "o Segundo Cérebro pulsa com a Logística");
});
