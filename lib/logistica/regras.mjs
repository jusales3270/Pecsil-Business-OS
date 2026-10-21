/**
 * Regras puras da Logística (docs/PLANO-LOGISTICA.md): tradução da situação do Fleetbase, endereço do
 * cliente, consulta de coordenada e o que pode ir para a tela. Sem rede e sem banco, para testar direto.
 */

/** Modalidade de frete da NF-e em que o caminhão é nosso: 0 (por conta do emitente) e 3 (próprio do remetente). */
export const FRETE_PROPRIO = new Set([0, 3]);
export const freteEhNosso = (modalidade) => FRETE_PROPRIO.has(Number(modalidade));

export const SITUACOES = {
  criada: "Criada",
  enviada: "Com a frota",
  a_caminho: "A caminho",
  entregue: "Entregue",
  falhou: "Não entregue",
  cancelada: "Cancelada",
};
export const ABERTAS = ["criada", "enviada", "a_caminho"];

/**
 * Situação da ordem no Fleetbase → situação da entrega. Criada e despachada ainda estão com a frota; iniciada
 * ou qualquer atividade do motorista no caminho é "a caminho"; concluída, cancelada e falha são finais.
 */
export function situacaoDoFleetbase(status) {
  const s = String(status ?? "").toLowerCase();
  if (!s) return null;
  if (s === "completed") return "entregue";
  if (s === "canceled" || s === "cancelled") return "cancelada";
  if (s === "failed" || s === "order_failed") return "falhou";
  if (s === "created" || s === "dispatched" || s === "preparing" || s === "pending") return "enviada";
  return "a_caminho";
}

/** CEP do cadastro (só dígitos) → 99999-999; o que não tiver 8 dígitos volta como está. */
export const cepFormatado = (cep) => {
  const d = String(cep ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (cep ? String(cep) : "");
};

/** Endereço do cadastro do cliente numa linha (o mesmo texto vai para o Fleetbase e para a tela). */
export function enderecoDoCliente(c) {
  if (!c) return "";
  const rua = [c.logradouro, c.numero].filter(Boolean).join(", ");
  const partes = [rua, c.complemento, c.bairro, [c.municipio, c.uf].filter(Boolean).join(" - "), c.cep && `CEP ${cepFormatado(c.cep)}`];
  return partes.filter((x) => x && String(x).trim()).join(" · ");
}

/** O cadastro tem o suficiente para achar o ponto no mapa? */
export const enderecoCompleto = (c) => Boolean(c && c.municipio && c.uf && (c.logradouro || c.cep));

/**
 * Consultas ao Nominatim (OpenStreetMap), da mais precisa para a mais larga. Vai só o endereço comercial do
 * cadastro, nunca nome de pessoa nem documento.
 */
export function consultasDeCoordenada(c) {
  if (!enderecoCompleto(c)) return [];
  const base = { format: "jsonv2", limit: "1", countrycodes: "br", addressdetails: "0" };
  const lista = [];
  if (c.logradouro) {
    lista.push({ ...base, street: [c.numero, c.logradouro].filter(Boolean).join(" "), city: c.municipio, state: c.uf, country: "Brasil", ...(c.cep ? { postalcode: cepFormatado(c.cep) } : {}) });
    lista.push({ ...base, street: c.logradouro, city: c.municipio, state: c.uf, country: "Brasil" });
  }
  if (c.cep) lista.push({ ...base, postalcode: cepFormatado(c.cep), country: "Brasil" });
  lista.push({ ...base, city: c.municipio, state: c.uf, country: "Brasil" });
  return lista;
}

/** Resposta do Nominatim → coordenada, com o quanto ela é precisa (rua, CEP ou só a cidade). */
export function lerCoordenada(resposta, consulta) {
  const r = Array.isArray(resposta) ? resposta[0] : null;
  const lat = Number(r?.lat), lng = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const precisao = consulta?.street ? "rua" : consulta?.postalcode ? "cep" : "cidade";
  return { lat, lng, precisao };
}

// O Fleetbase cria o motorista no ponto 0,0 (no oceano) até o app mandar a primeira posição: isso é "sem posição".
const ponto = (loc) => {
  const c = loc?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]), lat = Number(c[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
};

/**
 * Motorista do Fleetbase → o que vai para a tela. O objeto original traz o token de acesso do motorista,
 * telefone e e-mail: nada disso passa daqui.
 */
export function motoristaParaTela(d) {
  if (!d || typeof d !== "object") return null;
  return {
    id: String(d.id ?? ""),
    nome: String(d.name ?? "Motorista"),
    posicao: ponto(d.location),
    online: Boolean(d.online),
    velocidade: Number.isFinite(Number(d.speed)) ? Math.round(Number(d.speed)) : null,
    direcao: Number.isFinite(Number(d.heading)) ? Math.round(Number(d.heading)) : null,
    atualizado: d.updated_at ?? null,
    veiculo: d.vehicle ? { placa: d.vehicle.plate_number ?? null, modelo: [d.vehicle.make, d.vehicle.model].filter(Boolean).join(" ") || null } : null,
  };
}

/** Ordem do Fleetbase (e o rastreio dela) → campos que a conferência grava na entrega. */
export function conferenciaDaOrdem(ordem, rastreio) {
  if (!ordem || typeof ordem !== "object") return null;
  const situacao = situacaoDoFleetbase(ordem.status);
  const passos = Array.isArray(ordem.tracking_statuses) ? ordem.tracking_statuses : [];
  const quando = (codigo) => passos.find((t) => String(t?.code ?? "").toUpperCase() === codigo)?.created_at ?? null;
  const veiculo = ordem.vehicle_assigned ?? ordem.driver_assigned?.vehicle ?? null;
  return {
    situacao,
    motorista: ordem.driver_assigned?.name ?? null,
    veiculo: veiculo ? [veiculo.plate_number, [veiculo.make, veiculo.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || null : null,
    previsao: rastreio?.eta?.completion_at ?? null,
    saiu_em: ordem.started_at ?? quando("STARTED"),
    entregue_em: situacao === "entregue" ? quando("COMPLETED") ?? ordem.updated_at ?? null : null,
  };
}

/** Polyline codificada (formato do Google) → pontos [lng, lat], como as coordenadas do Fleetbase. */
export function decodificarPolyline(texto, max = 4000) {
  const pontos = [];
  if (typeof texto !== "string" || !texto) return pontos;
  let i = 0, lat = 0, lng = 0;
  const proximo = () => {
    let r = 0, s = 0, b;
    do { if (i >= texto.length) return null; b = texto.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < texto.length && pontos.length < max) {
    const dLat = proximo(), dLng = proximo();
    if (dLat === null || dLng === null) break;
    lat += dLat; lng += dLng;
    pontos.push([lng / 1e5, lat / 1e5]);
  }
  return pontos;
}

/** Andamento da ordem para a tela: percentual, quanto falta, chegada e a rota pela estrada (sem dados do motorista). */
export function andamentoParaTela(rastreio) {
  if (!rastreio || typeof rastreio !== "object") return null;
  const coords = Array.isArray(rastreio.route?.coordinates) && rastreio.route.coordinates.length ? rastreio.route.coordinates : decodificarPolyline(rastreio.route?.polyline);
  return {
    percentual: Number(rastreio.progress?.percentage ?? 0),
    faltaM: Number.isFinite(Number(rastreio.progress?.remaining_distance_m)) ? Math.round(Number(rastreio.progress.remaining_distance_m)) : null,
    chegada: rastreio.eta?.completion_at ?? null,
    confianca: rastreio.confidence ?? null,
    provedor: rastreio.provider ?? null,
    comTransito: Boolean(rastreio.capabilities?.traffic) && Number.isFinite(Number(rastreio.route?.duration_in_traffic_s)),
    estimativaEmLinhaReta: Array.isArray(rastreio.warnings) && rastreio.warnings.includes("calculated_route_used"),
    trajeto: coords.slice(0, 2000),
  };
}

/** Distância em km entre dois pontos [lat, lng] (fórmula de haversine). */
export function distanciaKm(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Trajeto feito (o "rastro" do caminhão), em trechos. Um salto grande entre duas leituras (falha de GPS, celular
 * sem sinal por um tempo, aba parada) começa um trecho novo, em vez de ligar os dois pontos com uma reta falsa.
 */
export function acrescentarAoRastro(trechos, ponto, saltoKm = 3, maxPontos = 300) {
  const lista = trechos.map((t) => [...t]);
  const atual = lista.at(-1);
  const ultimo = atual?.at(-1);
  if (ultimo && ultimo[0] === ponto[0] && ultimo[1] === ponto[1]) return lista;
  if (!atual || (ultimo && distanciaKm(ultimo, ponto) > saltoKm)) lista.push([ponto]);
  else atual.push(ponto);
  let total = lista.reduce((s, t) => s + t.length, 0);
  while (total > maxPontos && lista.length) {
    const sobra = total - maxPontos;
    if (lista[0].length <= sobra) { total -= lista[0].length; lista.shift(); } else { lista[0] = lista[0].slice(sobra); total -= sobra; }
  }
  return lista;
}

/**
 * Quanto falta PELA ESTRADA, medido na rota já guardada ([lng, lat], do Fleetbase/Google) a partir da posição
 * atual do caminhão: acha o trecho da rota mais perto dele e soma o resto. Atualiza a cada leitura sem nenhuma
 * consulta nova ao serviço de rotas. Longe demais da rota (> 2 km: desvio ou rota velha), devolve null.
 */
export function restanteNaRota(trajeto, posicao, foraKm = 2) {
  if (!Array.isArray(trajeto) || trajeto.length < 2 || !posicao) return null;
  const pts = trajeto.map(([lng, lat]) => [lat, lng]);
  const p = [posicao.lat, posicao.lng];
  let melhor = { i: 0, d: Infinity, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    // Projeção no trecho (plano local: suficiente para poucos km).
    const kx = Math.cos(a[0] * Math.PI / 180);
    const ax = (b[1] - a[1]) * kx, ay = b[0] - a[0], px = (p[1] - a[1]) * kx, py = p[0] - a[0];
    const len2 = ax * ax + ay * ay;
    const t = len2 ? Math.max(0, Math.min(1, (px * ax + py * ay) / len2)) : 0;
    const proj = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = distanciaKm(p, proj);
    if (d < melhor.d) melhor = { i, d, t };
  }
  if (melhor.d > foraKm) return null;
  let total = 0, feito = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = distanciaKm(pts[i], pts[i + 1]);
    total += seg;
    if (i < melhor.i) feito += seg; else if (i === melhor.i) feito += seg * melhor.t;
  }
  if (!total) return null;
  // O que falta da rota, a partir do caminhão (para o mapa desenhar só o caminho à frente).
  const aFrente = [[posicao.lng, posicao.lat], ...trajeto.slice(melhor.i + 1)];
  return { faltaM: Math.round((total - feito) * 1000), percentual: Math.round((feito / total) * 100), aFrente };
}

/**
 * O que a página pública do cliente recebe (link de rastreio). Lista fechada: a entrega, a previsão, quanto falta e
 * a posição do caminhão SÓ enquanto ele está a caminho. Nunca o nome, o telefone ou a placa do motorista, nem o
 * número da ordem no Fleetbase.
 */
export function rastreioParaCliente(lido, posicao, andamento) {
  if (!lido || lido.situacao !== "aberto") return { situacao: lido?.situacao ?? "inexistente" };
  const e = lido.entrega ?? {};
  const aCaminho = e.etapa === "a_caminho";
  const destino = Number.isFinite(Number(e.destino_lat)) && Number.isFinite(Number(e.destino_lng)) && e.destino_lat !== null
    ? { lat: Number(e.destino_lat), lng: Number(e.destino_lng) } : null;
  return {
    situacao: "aberto",
    empresa: lido.empresa ?? null,
    expiraEm: lido.expira_em ?? null,
    numero: e.numero ?? null,
    cliente: e.cliente ?? null,
    descricao: e.descricao ?? null,
    endereco: e.destino_endereco ?? null,
    etapa: e.etapa ?? null,
    saiuEm: e.saiu_em ?? null,
    entregueEm: e.entregue_em ?? null,
    chegada: aCaminho ? (andamento?.chegada ?? e.previsao ?? null) : null,
    comTransito: aCaminho ? Boolean(andamento?.comTransito) : false,
    faltaM: aCaminho ? (andamento?.faltaM ?? null) : null,
    percentual: aCaminho ? (andamento?.percentual ?? null) : null,
    caminhao: aCaminho && posicao && Number.isFinite(posicao.lat) && Number.isFinite(posicao.lng) ? { lat: posicao.lat, lng: posicao.lng } : null,
    destino,
    rota: aCaminho && Array.isArray(andamento?.trajeto) ? andamento.trajeto.slice(0, 2000) : [],
  };
}

/** Comparação de texto em tempo constante (o token do aviso do Fleetbase). */
export function mesmoToken(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  if (!x || !y || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

/**
 * Endereço digitado à mão (origem, ponto do cliente) → o que dá para procurar. Tolera erro de digitação: além do
 * texto como veio, monta variações sem as palavras que mais atrapalham a busca (bairro digitado errado, "de",
 * "vila"…), só com a rua, o número e a cidade. O CEP, quando vem, é a âncora mais segura (ViaCEP).
 */
const PALAVRAS_FRACAS = new Set(["de", "da", "do", "das", "dos", "e", "vila", "vl", "jardim", "jd", "bairro", "parque", "pq", "residencial", "res", "conjunto", "cj"]);
const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export function analisarEndereco(texto) {
  const original = String(texto ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const cepBruto = original.match(/\b(\d{5})-?(\d{3})\b/);
  const cep = cepBruto ? `${cepBruto[1]}${cepBruto[2]}` : null;
  const semCep = (cepBruto ? original.replace(cepBruto[0], " ") : original).replace(/(?:CEP)?[\s,;.\-]+$/i, "").trim();
  const partes = semCep.split(",").map((p) => p.trim()).filter(Boolean);
  const rua = partes[0] ?? "";
  const numero = (semCep.match(/,\s*(\d{1,5})\b/) ?? semCep.match(/\b(\d{1,5})\b/))?.[1] ?? null;
  // Cidade e UF no fim: "Itu - SP", "Itu/SP", "Itu SP" ou só "Itu".
  let cidade = null, uf = null;
  const traco = semCep.lastIndexOf(" - ");
  const direita = traco >= 0 ? semCep.slice(traco + 3).trim() : (partes.length > 1 ? partes.at(-1) : "");
  if (/^[A-Za-z]{2}$/.test(direita) && traco >= 0) {
    uf = direita.toUpperCase();
    cidade = semCep.slice(0, traco).split(",").at(-1)?.trim() || null;
  } else if (direita) {
    const m = direita.match(/^(.*?)(?:\s*\/\s*|\s+)([A-Za-z]{2})$/);
    cidade = (m ? m[1] : direita).trim() || null;
    uf = m ? m[2].toUpperCase() : null;
  }
  if (cidade && /^\d+$/.test(cidade)) cidade = null;
  const limpar = (t) => semAcento(t).toLowerCase().replace(/[\/,\-]+/g, " ").split(/\s+/).filter((w) => w && !PALAVRAS_FRACAS.has(w)).join(" ");
  const ruaLimpa = limpar(numero ? rua.replace(new RegExp(`\\s*\\b${numero}$`), "") : rua);
  const variacoes = [...new Set([
    original,
    [ruaLimpa, numero, cidade && limpar(cidade), uf].filter(Boolean).join(" "),
    [ruaLimpa, cidade && limpar(cidade)].filter(Boolean).join(" "),
  ].filter((v) => v && v.length >= 5))];
  return { original, cep, rua: rua || null, numero, cidade, uf, variacoes };
}

/** Junta as sugestões de várias fontes: tira as repetidas (a menos de 30 m) e põe as mais precisas primeiro. */
const ORDEM_PRECISAO = { numero: 0, rua: 1, cep: 2, cidade: 3 };
export function juntarSugestoes(listas, cidade) {
  const alvo = cidade ? semAcento(cidade).toLowerCase() : null;
  const todas = listas.flat().filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng));
  const naCidade = (s) => (alvo && semAcento(s.nome).toLowerCase().includes(alvo) ? 0 : 1);
  // Cidade conhecida e com resultado nela: as de outras cidades saem (só confundem).
  if (alvo && todas.some((s) => naCidade(s) === 0)) for (let i = todas.length - 1; i >= 0; i--) if (naCidade(todas[i])) todas.splice(i, 1);
  todas.sort((a, b) => naCidade(a) - naCidade(b) || (ORDEM_PRECISAO[a.precisao] ?? 9) - (ORDEM_PRECISAO[b.precisao] ?? 9));
  const fica = [];
  for (const s of todas) if (!fica.some((f) => distanciaKm([f.lat, f.lng], [s.lat, s.lng]) < 0.03)) fica.push(s);
  return fica.slice(0, 6);
}
