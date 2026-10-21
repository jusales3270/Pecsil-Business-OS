import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../supabase/admin";
import { FleetbaseErro, fleetbase, fleetbaseConfigurado } from "./fleetbase";
import { procurarEndereco } from "./geocodificar";
import { ABERTAS, cepFormatado, conferenciaDaOrdem, consultasDeCoordenada, enderecoCompleto, enderecoDoCliente, lerCoordenada } from "./regras.mjs";

/**
 * Lado do servidor da Logística (docs/PLANO-LOGISTICA.md): manda a entrega ao Fleetbase (local da origem e do
 * cliente, ordem) e confere as entregas abertas lendo as ordens com a nossa chave. A escrita no banco passa
 * pelas funções da migração 202610200001: com a sessão de quem opera, ou com a chave de serviço só na conferência.
 */

type Cliente = { id: string; name: string; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; uf: string | null; cep: string | null };
type Entrega = { id: string; organization_id: string; numero: number; customer_id: string; cliente_nome: string; descricao: string; origem_rotulo: string | null;
  situacao: string; fleetbase_ordem: string | null };

/** Coordenada de um endereço pelo Nominatim (OpenStreetMap): vai só o endereço comercial do cadastro. */
export async function coordenadaDoEndereco(c: Cliente) {
  for (const q of consultasDeCoordenada(c)) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams(q as Record<string, string>)}`, {
        headers: { "user-agent": "BusinessOS-Logistica/1.0 (entregas com frota propria)", "accept-language": "pt-BR" },
        signal: AbortSignal.timeout(10_000), cache: "no-store",
      });
      if (!r.ok) continue;
      const achado = lerCoordenada(await r.json(), q);
      if (achado) return achado;
    } catch { /* tenta a próxima consulta */ }
    await new Promise((ok) => setTimeout(ok, 1100)); // política do Nominatim: no máximo 1 consulta por segundo
  }
  // Segunda tentativa: a busca que tolera erro de digitação (CEP pelo ViaCEP, Photon), só se achar a rua.
  const texto = enderecoDoCliente(c);
  if (texto) {
    const s = (await procurarEndereco(texto)).find((x) => x.precisao === "numero" || x.precisao === "rua");
    if (s) return { lat: s.lat, lng: s.lng, precisao: s.precisao === "numero" ? "numero" : "rua" };
  }
  return null;
}

/**
 * O endereço da própria empresa (cadastro do Fiscal), só o endereço, para a origem das entregas. Lido com a chave
 * de serviço porque a configuração fiscal é do Fiscal; quem chama já confere a permissão da Logística.
 */
export async function enderecoDaEmpresa(org: string): Promise<string | null> {
  const { data: f } = await createSupabaseAdminClient().from("fiscal_config").select("logradouro, numero, bairro, municipio, uf, cep").eq("organization_id", org).maybeSingle();
  if (!f?.logradouro) return null;
  const cep = String(f.cep ?? "").replace(/\D/g, "");
  return [[f.logradouro, f.numero].filter(Boolean).join(", "), f.bairro, [f.municipio, f.uf].filter(Boolean).join(" - "), cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null].filter(Boolean).join(", ");
}

/** Erro do banco ou do Fleetbase → resposta clara para a tela. */
export function respostaDeErro(error: unknown, padrao: string) {
  if (error instanceof FleetbaseErro) return NextResponse.json({ error: error.message }, { status: error.status >= 500 ? 503 : 400 });
  const e = error as { code?: string; message?: string };
  if (e?.code === "P0001" || e?.code === "42501") return NextResponse.json({ error: e.message }, { status: e.code === "42501" ? 403 : 400 });
  console.error("Logística:", e?.message ?? error);
  return NextResponse.json({ error: padrao }, { status: 500 });
}

/**
 * Manda uma entrega "criada" ao Fleetbase: garante o local da origem e o do cliente (geocodificando o endereço
 * na primeira vez), cria a ordem e grava o número da ordem e o rastreio. Se algo falhar, grava o erro para a
 * pessoa tentar de novo.
 */
export async function enviarAoFleetbase(sb: SupabaseClient, entregaId: string) {
  const { data: e, error } = await sb.from("logistica_entregas").select("*").eq("id", entregaId).maybeSingle<Entrega>();
  if (error) throw error;
  if (!e) throw Object.assign(new Error("Entrega não encontrada."), { code: "P0001" });
  if (e.situacao !== "criada") return e;
  const falhar = async (msg: string) => {
    const r = await sb.rpc("logistica_registrar_envio", { p_id: e.id, p_ordem: null, p_rastreio: null, p_erro: msg });
    if (r.error) throw r.error;
    return r.data as Entrega;
  };
  if (!fleetbaseConfigurado()) return falhar("O serviço de entregas (Fleetbase) ainda não está ligado nesta instalação.");

  const { data: cfg } = await sb.from("logistica_config").select("*").maybeSingle<{ origem_nome: string; origem_endereco: string; origem_lat: number; origem_lng: number; fleetbase_local: string | null }>();
  if (!cfg) return falhar("Configure a origem das entregas (o pátio de onde o caminhão sai) antes de enviar.");

  try {
    let origem = cfg.fleetbase_local;
    if (!origem) {
      origem = (await fleetbase.criarLocal({ nome: cfg.origem_nome, endereco: cfg.origem_endereco || cfg.origem_nome, lat: cfg.origem_lat, lng: cfg.origem_lng })).id;
      const s = await sb.rpc("logistica_salvar_origem", { p: { nome: cfg.origem_nome, endereco: cfg.origem_endereco, lat: cfg.origem_lat, lng: cfg.origem_lng, fleetbase_local: origem } });
      if (s.error) throw s.error;
    }

    const { data: cli } = await sb.from("customers").select("id, name, logradouro, numero, complemento, bairro, municipio, uf, cep").eq("id", e.customer_id).maybeSingle<Cliente>();
    if (!cli) return falhar("Cliente não encontrado no cadastro.");
    const endereco = enderecoDoCliente(cli);
    let { data: local } = await sb.from("logistica_locais").select("lat, lng, endereco, fleetbase_local").eq("customer_id", cli.id).maybeSingle<{ lat: number; lng: number; endereco: string; fleetbase_local: string | null }>();
    if (!local || (local.endereco !== endereco && endereco)) {
      if (!enderecoCompleto(cli)) return falhar("O cadastro do cliente está sem endereço (município, UF e rua ou CEP). Complete o cadastro ou marque o ponto no mapa.");
      const achado = await coordenadaDoEndereco(cli);
      if (!achado) return falhar("Não achei o endereço do cliente no mapa. Confira o cadastro ou marque o ponto à mão.");
      const s = await sb.rpc("logistica_salvar_local", { p_customer: cli.id, p_endereco: endereco, p_lat: achado.lat, p_lng: achado.lng, p_fonte: "geocodificado", p_fleetbase: null });
      if (s.error) throw s.error;
      local = { lat: achado.lat, lng: achado.lng, endereco, fleetbase_local: null };
    }
    let destino = local.fleetbase_local;
    if (!destino) {
      destino = (await fleetbase.criarLocal({ nome: cli.name, endereco: local.endereco || endereco, municipio: cli.municipio, uf: cli.uf, cep: cepFormatado(cli.cep), lat: local.lat, lng: local.lng })).id;
      const s = await sb.rpc("logistica_salvar_local", { p_customer: cli.id, p_endereco: local.endereco, p_lat: local.lat, p_lng: local.lng,
        p_fonte: "geocodificado", p_fleetbase: destino });
      if (s.error) throw s.error;
    }

    const ordem = await fleetbase.criarOrdem({
      origem, destino,
      notas: [e.origem_rotulo, e.descricao].filter(Boolean).join(" · "),
      meta: { entrega_id: e.id, entrega_numero: e.numero, origem: e.origem_rotulo ?? "avulsa" },
    });
    const r = await sb.rpc("logistica_registrar_envio", { p_id: e.id, p_ordem: ordem.id, p_rastreio: ordem.tracking_number?.tracking_number ?? null, p_erro: null,
      p_lat: local.lat, p_lng: local.lng, p_endereco: local.endereco || endereco });
    if (r.error) throw r.error;
    return r.data as Entrega;
  } catch (err) {
    if (err instanceof FleetbaseErro) return falhar(err.message);
    throw err;
  }
}

/**
 * Rastreio (rota e previsão) de uma ordem, guardado 3 minutos por ordem. O Fleetbase refaz o cálculo a cada
 * posição nova do motorista, e cada cálculo é uma consulta paga ao Google: sem esta guarda, o mapa aberto
 * gastaria a cota do dia em minutos. A posição do caminhão continua chegando a cada leitura.
 */
const GUARDA_RASTREIO_MS = 180_000;
const rastreios = new Map<string, { em: number; valor: Record<string, unknown> | null }>();
export async function rastreioGuardado(ordem: string) {
  const agora = Date.now();
  const ja = rastreios.get(ordem);
  if (ja && agora - ja.em < GUARDA_RASTREIO_MS) return ja.valor;
  const valor = await fleetbase.rastreio(ordem).catch(() => ja?.valor ?? null);
  rastreios.set(ordem, { em: agora, valor });
  if (rastreios.size > 500) for (const [k, v] of rastreios) if (agora - v.em > GUARDA_RASTREIO_MS) rastreios.delete(k);
  return valor;
}

let ultimaConferencia = 0;

/**
 * Confere as entregas abertas com o Fleetbase (no máximo a cada 10 s por processo). Lê cada ordem pela nossa
 * chave e grava pela chave de serviço, porque quem só vê as entregas também dispara a conferência ao abrir o
 * mapa. Nunca lança: a tela segue com o que já está gravado.
 */
export async function conferirAbertas(forcar = false, ordens?: string[]) {
  if (!fleetbaseConfigurado()) return;
  if (!forcar && Date.now() - ultimaConferencia < 10_000) return;
  ultimaConferencia = Date.now();
  try {
    const adm = createSupabaseAdminClient();
    let q = adm.from("logistica_entregas").select("organization_id, fleetbase_ordem, situacao").not("fleetbase_ordem", "is", null).limit(200);
    q = ordens?.length ? q.in("fleetbase_ordem", ordens) : q.in("situacao", ABERTAS);
    const { data } = await q;
    for (const e of (data ?? []) as { organization_id: string; fleetbase_ordem: string; situacao: string }[]) {
      try {
        const ordem = await fleetbase.ordem(e.fleetbase_ordem);
        const rastreio = ["started"].includes(String(ordem.status)) || e.situacao === "a_caminho" ? await rastreioGuardado(e.fleetbase_ordem) : null;
        const c = conferenciaDaOrdem(ordem, rastreio);
        if (c) await adm.rpc("logistica_conferir", { p_org: e.organization_id, p_ordem: e.fleetbase_ordem, p: c });
      } catch (err) {
        console.error("Logística: falha ao conferir a ordem", e.fleetbase_ordem, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("Logística: conferência interrompida", err instanceof Error ? err.message : err);
  }
}

type Veiculo = { id: string; placa: string; marca: string | null; modelo: string | null; ano: number | null; ativo: boolean; fleetbase_veiculo: string | null };
type Motorista = { id: string; nome: string; veiculo_id: string | null; ativo: boolean; fleetbase_motorista: string | null };

/** Espelha o veículo no Fleetbase e grava o id de lá (ou o erro, para tentar de novo). Nunca lança. */
export async function espelharVeiculo(sb: SupabaseClient, v: Veiculo) {
  if (!fleetbaseConfigurado()) return;
  try {
    const r = await fleetbase.salvarVeiculo(v.fleetbase_veiculo, { placa: v.placa, marca: v.marca, modelo: v.modelo, ano: v.ano });
    await sb.rpc("logistica_registrar_frota", { p_tipo: "veiculo", p_id: v.id, p_fleetbase: r.id ?? v.fleetbase_veiculo, p_erro: null });
  } catch (err) {
    await sb.rpc("logistica_registrar_frota", { p_tipo: "veiculo", p_id: v.id, p_fleetbase: null, p_erro: err instanceof Error ? err.message : "Falha no serviço de entregas." });
  }
}

/** Espelha o motorista no Fleetbase (só o nome e o veículo de costume) e grava o id de lá. Nunca lança. */
export async function espelharMotorista(sb: SupabaseClient, m: Motorista) {
  if (!fleetbaseConfigurado()) return;
  try {
    let veiculo: string | null = null;
    if (m.veiculo_id) {
      const { data } = await sb.from("logistica_veiculos").select("fleetbase_veiculo").eq("id", m.veiculo_id).maybeSingle<{ fleetbase_veiculo: string | null }>();
      veiculo = data?.fleetbase_veiculo ?? null;
    }
    const r = await fleetbase.salvarMotorista(m.fleetbase_motorista, { nome: m.nome, veiculo, ativo: m.ativo });
    await sb.rpc("logistica_registrar_frota", { p_tipo: "motorista", p_id: m.id, p_fleetbase: r.id ?? m.fleetbase_motorista, p_erro: null });
  } catch (err) {
    await sb.rpc("logistica_registrar_frota", { p_tipo: "motorista", p_id: m.id, p_fleetbase: null, p_erro: err instanceof Error ? err.message : "Falha no serviço de entregas." });
  }
}

/**
 * Designa o motorista cadastrado na plataforma a uma entrega já com a frota e despacha a ordem para ele (vai ao
 * celular). O veículo é o de costume do motorista. A conferência traz o nome e a placa de volta para a entrega.
 */
export async function designarMotorista(sb: SupabaseClient, entregaId: string, motoristaId: string) {
  const { data: e } = await sb.from("logistica_entregas").select("id, situacao, fleetbase_ordem").eq("id", entregaId).maybeSingle<{ id: string; situacao: string; fleetbase_ordem: string | null }>();
  if (!e) throw Object.assign(new Error("Entrega não encontrada."), { code: "P0001" });
  if (e.situacao !== "enviada" || !e.fleetbase_ordem) throw Object.assign(new Error("Só dá para designar o motorista de uma entrega que está com a frota e ainda não saiu."), { code: "P0001" });
  const { data: m } = await sb.from("logistica_motoristas").select("id, ativo, fleetbase_motorista, veiculo_id, logistica_veiculos(fleetbase_veiculo, ativo)")
    .eq("id", motoristaId).maybeSingle<{ id: string; ativo: boolean; fleetbase_motorista: string | null; logistica_veiculos: { fleetbase_veiculo: string | null; ativo: boolean } | null }>();
  if (!m || !m.ativo) throw Object.assign(new Error("Motorista não encontrado ou desativado."), { code: "P0001" });
  if (!m.fleetbase_motorista) throw Object.assign(new Error("Este motorista ainda não está no serviço de entregas: abra a Frota e salve o cadastro dele de novo."), { code: "P0001" });
  const veiculo = m.logistica_veiculos?.ativo ? m.logistica_veiculos.fleetbase_veiculo : null;
  await fleetbase.designar(e.fleetbase_ordem, m.fleetbase_motorista, veiculo);
  await conferirAbertas(true, [e.fleetbase_ordem]);
}

