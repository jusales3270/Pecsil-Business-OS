import "server-only";

import { analisarEndereco, juntarSugestoes } from "./regras.mjs";

/**
 * Procura um endereço digitado à mão (a origem, o ponto do cliente) em várias fontes ao mesmo tempo e devolve
 * sugestões para a pessoa escolher e ajustar no mapa. Vai a cada serviço só o endereço comercial.
 *  - ViaCEP: quando há CEP, dá a rua, o bairro e a cidade oficiais (âncora contra erro de digitação);
 *  - Photon (OpenStreetMap, tolera erro de digitação) e Nominatim (OpenStreetMap, texto exato);
 *  - Google Geocoding: só se a API estiver ativada na chave (GOOGLE_MAPS_API_KEY); traz o número da casa.
 * Nenhuma fonte grava nada: a coordenada final é a que a pessoa confirma (e pode arrastar) no mapa.
 */
export type Sugestao = { lat: number; lng: number; nome: string; precisao: "numero" | "rua" | "cep" | "cidade"; fonte: string };

const UA = { "user-agent": "BusinessOS-Logistica/1.0 (entregas com frota propria)", "accept-language": "pt-BR" };
const pedir = async (url: string) => {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

type Photon = { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[] };
async function photon(q: string, perto?: { lat: number; lng: number } | null): Promise<Sugestao[]> {
  const p = new URLSearchParams({ q, limit: "5", lang: "default" });
  if (perto) { p.set("lat", String(perto.lat)); p.set("lon", String(perto.lng)); }
  const d = (await pedir(`https://photon.komoot.io/api/?${p}`)) as Photon | null;
  return (d?.features ?? []).filter((f) => f.properties.countrycode === "BR").map((f) => {
    const x = f.properties;
    const rua = x.street ?? (x.osm_key === "highway" ? x.name : null);
    return {
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], fonte: "OpenStreetMap",
      precisao: x.housenumber ? "numero" : rua ? "rua" : x.postcode ? "cep" : "cidade",
      nome: [rua ? `${rua}${x.housenumber ? `, ${x.housenumber}` : ""}` : x.name, x.district, x.city, x.state, x.postcode].filter(Boolean).join(", "),
    } satisfies Sugestao;
  });
}

async function nominatim(params: Record<string, string>, precisao: Sugestao["precisao"]): Promise<Sugestao[]> {
  const d = (await pedir(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: "jsonv2", limit: "3", countrycodes: "br", ...params })}`)) as { lat: string; lon: string; display_name: string; type?: string }[] | null;
  return (d ?? []).map((x) => ({ lat: Number(x.lat), lng: Number(x.lon), nome: x.display_name, precisao: x.type === "house" ? "numero" : precisao, fonte: "OpenStreetMap" }));
}

async function google(q: string): Promise<Sugestao[]> {
  const chave = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!chave) return [];
  const d = (await pedir(`https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address: q, region: "br", language: "pt-BR", key: chave })}`)) as
    { status?: string; results?: { formatted_address: string; geometry: { location: { lat: number; lng: number }; location_type: string }; types: string[] }[] } | null;
  if (d?.status !== "OK") return []; // API não ativada na chave, sem resultado ou cota: segue com as outras fontes
  return (d.results ?? []).slice(0, 3).map((r) => ({
    lat: r.geometry.location.lat, lng: r.geometry.location.lng, nome: r.formatted_address, fonte: "Google",
    precisao: r.geometry.location_type === "ROOFTOP" || r.types.includes("street_address") || r.types.includes("premise") ? "numero" : r.types.includes("route") ? "rua" : r.types.includes("postal_code") ? "cep" : "cidade",
  }));
}

export async function procurarEndereco(texto: string, perto?: { lat: number; lng: number } | null): Promise<Sugestao[]> {
  const e = analisarEndereco(texto);
  // CEP: a rua e a cidade oficiais entram como mais uma variação (corrige o que foi digitado errado).
  let oficial: string | null = null;
  let cidade = e.cidade as string | null;
  if (e.cep) {
    const v = (await pedir(`https://viacep.com.br/ws/${e.cep}/json/`)) as { logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean } | null;
    if (v && !v.erro && v.localidade) {
      oficial = [v.logradouro, e.numero, v.localidade, v.uf].filter(Boolean).join(" ");
      cidade = v.localidade;
    }
  }
  const variacoes = [...new Set([...(oficial ? [oficial] : []), ...e.variacoes])] as string[];
  const listas = await Promise.all([
    google(oficial ? `${oficial}, ${e.cep}` : e.original),
    ...variacoes.slice(0, 3).map((v) => photon(v, perto)),
    nominatim({ q: oficial ?? e.original }, "rua"),
  ]);
  return juntarSugestoes(listas, cidade) as Sugestao[];
}
