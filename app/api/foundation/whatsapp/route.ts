import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../lib/supabase/session";
import { registrarEnqueteDeTeste } from "../../../../lib/whatsapp/confirmar";
import { validarCanal } from "../../../../lib/whatsapp/contatos";
import { MODELOS } from "../../../../lib/sara/modelos";
import { lerConfigVigia, textoDaAgenda, validarConfig } from "../../../../lib/sara/central/vigia-config";
import { validarAvulso } from "../../../../lib/whatsapp/avulso";
import { apagarInstancia, configuracao, desconectar, enviarInterativo, enviarTexto, ErroEvolution, garantirWebhook, nomeDeInstancia, numeroWhatsApp, pedirQr, situacao } from "../../../../lib/whatsapp/evolution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fundação › WhatsApp (PLANO-WHATSAPP): os números da plataforma (canais). Só o proprietário (é infraestrutura,
 * como Banco e Autenticação). GET: os canais com a situação de cada um na Evolution, o comportamento (prompt) e o
 * modelo. POST: criar, alterar e remover canal; conectar (QR Code), desconectar e mensagem de teste de um canal.
 * Tudo na auditoria (o prompt não: só se mudou); o QR Code e a chave da Evolution nunca são gravados.
 */
const UUID = /^[0-9a-f-]{36}$/i;

async function dono() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access?.isOwner) return { erro: NextResponse.json({ error: "Os números do WhatsApp são do proprietário." }, { status: 403 }) } as const;
  const { data: org, error } = await session.supabase.rpc("current_organization_id");
  if (error || typeof org !== "string") return { erro: NextResponse.json({ error: "Empresa indisponível." }, { status: 503 }) } as const;
  return { sb: session.supabase as SupabaseClient, org } as const;
}

async function auditar(sb: SupabaseClient, evento: string, metadata: Record<string, unknown>) {
  try {
    const { data: perfil } = await sb.rpc("current_profile_id");
    const { data: p } = perfil ? await sb.from("profiles").select("id, organization_id, user_id").eq("id", perfil).maybeSingle() : { data: null };
    if (!p) return;
    const { error } = await createSupabaseAdminClient().from("audit_logs").insert({ organization_id: p.organization_id, actor_user_id: p.user_id, actor_profile_id: p.id,
      module_code: "core.whatsapp", event_type: evento, entity_type: "whatsapp_canal", entity_id: typeof metadata.canal === "string" && UUID.test(metadata.canal) ? metadata.canal : null, risk_level: "monitored", metadata });
    if (error) console.error("[whatsapp] auditoria", error.message);
  } catch (e) { console.error("[whatsapp] auditoria", e instanceof Error ? e.message : e); }
}

const falha = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "A Evolution não respondeu." }, { status: e instanceof ErroEvolution && e.status < 500 ? 400 : 503 });
type Linha = { id: string; instancia: string; nome: string; departamento: string | null; descricao: string | null; prompt: string | null; provedor: string; modelo: string | null; conexao: string; ativo: boolean; created_at: string };
const tabelaFaltando = (msg: string, code?: string) => code === "42P01" || /whatsapp_canais/.test(msg) && /does not exist|não existe/.test(msg);

export async function GET() {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const { data, error } = await d.sb.from("whatsapp_canais").select("id, instancia, nome, departamento, descricao, prompt, provedor, modelo, conexao, ativo, created_at").order("created_at");
  if (error) return NextResponse.json({ error: tabelaFaltando(error.message, error.code) ? "As tabelas dos números ainda não foram criadas no banco (migração 202610240002)." : error.message }, { status: 500 });
  // Movimento dos últimos 7 dias por número (W3). Sem a tabela ainda (antes da migração 0003), fica sem números.
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: mov } = await d.sb.from("whatsapp_mensagens").select("canal_id, situacao, motivo").eq("direcao", "entrada").gte("created_at", desde).limit(5000);
  const movimento = new Map<string, { respondidas: number; ignoradas: number; fora_da_lista: number; falhas: number }>();
  for (const m of (mov ?? []) as { canal_id: string; situacao: string; motivo: string | null }[]) {
    const x = movimento.get(m.canal_id) ?? { respondidas: 0, ignoradas: 0, fora_da_lista: 0, falhas: 0 };
    if (m.situacao === "respondida") x.respondidas++; else if (m.situacao === "ignorada") { x.ignoradas++; if (m.motivo === "fora_da_lista") x.fora_da_lista++; } else if (m.situacao === "falhou") x.falhas++;
    movimento.set(m.canal_id, x);
  }
  const canais = await Promise.all(((data ?? []) as Linha[]).map(async (c) => {
    const sit = c.conexao === "whatsapp_web" ? await situacao(c.instancia) : { estado: "api_oficial", numero: null, nome: null };
    // Número conectado: a Evolution tem de avisar a plataforma das mensagens (W3); liga se não estiver ligado.
    const recebimento = sit.estado === "conectado" && c.ativo ? await garantirWebhook(c.instancia) : null;
    return { ...c, situacao: sit, recebimento,
      movimento: movimento.get(c.id) ?? { respondidas: 0, ignoradas: 0, fora_da_lista: 0, falhas: 0 } };
  }));
  // Envios agendados: os que ainda vão sair e os 20 últimos (só o proprietário lê).
  const { data: agendados } = await d.sb.from("whatsapp_agendados").select("id, canal_id, para_nome, quando, texto, documentos, situacao, tentativas, erro, enviado_em")
    .order("quando", { ascending: false }).limit(60);
  // Vigia (03/11/2026): a configuração, a lista de transmissão e os contatos que podem entrar nela ou receber avulso.
  const [cfg, { data: lista }, { data: contatos }] = await Promise.all([
    lerConfigVigia(d.sb),
    d.sb.from("sara_vigia_transmissao").select("contato_id"),
    d.sb.from("whatsapp_contatos").select("id, lista, numero, nome, canal_id, profile_id, profiles:profiles!whatsapp_contatos_profile_id_fkey(full_name), whatsapp_canais(nome)").eq("ativo", true).order("nome").limit(500),
  ]);
  const vigia = { config: cfg, agenda: textoDaAgenda(cfg), transmissao: ((lista ?? []) as { contato_id: string }[]).map((x) => x.contato_id),
    contatos: ((contatos ?? []) as unknown as { id: string; lista: string; numero: string; nome: string | null; profile_id: string | null; profiles: { full_name: string | null } | null; whatsapp_canais: { nome: string } | null }[])
      .map((c) => ({ id: c.id, lista: c.lista, nome: c.nome || c.profiles?.full_name || `final ${c.numero.slice(-4)}`, pessoa: c.profiles?.full_name ?? null, final: c.numero.slice(-4), canal: c.whatsapp_canais?.nome ?? "" })) };
  return NextResponse.json({ canais, modelos: MODELOS, configurada: Boolean(configuracao()), vigia,
    agendados: ((agendados ?? []) as { situacao: string; texto: string | null; documentos: string[] }[]).map((x) => ({ ...x, texto: x.texto ? x.texto.slice(0, 200) : null, documentos: x.documentos.length })) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const d = await dono();
  if ("erro" in d) return d.erro;
  const e = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const acao = String(e.acao ?? "");
  const id = String(e.canal ?? "");

  if (acao === "salvar_vigia") {
    const cfg = validarConfig(e.config);
    if ("erro" in cfg) return NextResponse.json({ error: cfg.erro }, { status: 400 });
    const pedidos = Array.isArray(e.transmissao) ? [...new Set(e.transmissao.map(String).filter((x) => UUID.test(x)))].slice(0, 100) : [];
    const admin = createSupabaseAdminClient();
    const { data: eu } = await d.sb.rpc("current_profile_id");
    const { data: perfil } = eu ? await d.sb.from("profiles").select("full_name").eq("id", eu).maybeSingle() : { data: null };
    // Só pessoas da empresa (lista interna, com perfil): as credenciais delas decidem o que cada uma recebe.
    const { data: validos, error: eValidos } = pedidos.length ? await admin.from("whatsapp_contatos")
      .select("id, profiles:profiles!whatsapp_contatos_profile_id_fkey!inner(organization_id, status, access_expires_at), whatsapp_canais!inner(organization_id, ativo, conexao)")
      .eq("organization_id", d.org).in("id", pedidos).eq("lista", "interna").not("profile_id", "is", null).eq("ativo", true)
      .eq("profiles.organization_id", d.org).eq("profiles.status", "active").or(`access_expires_at.is.null,access_expires_at.gt.${new Date().toISOString()}`, { referencedTable: "profiles" })
      .eq("whatsapp_canais.organization_id", d.org).eq("whatsapp_canais.ativo", true).eq("whatsapp_canais.conexao", "whatsapp_web") : { data: [], error: null };
    if (eValidos) return NextResponse.json({ error: "Não foi possível validar os contatos da empresa." }, { status: 503 });
    const ok = ((validos ?? []) as { id: string }[]).map((x) => x.id);
    if (ok.length < pedidos.length) return NextResponse.json({ error: "A lista de transmissão aceita só pessoas da empresa (lista interna, ativas)." }, { status: 400 });
    const { error: e1 } = await admin.from("sara_vigia_config").upsert({ organization_id: d.org, ...cfg, updated_at: new Date().toISOString(), updated_by_name: perfil?.full_name ?? null });
    if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });
    const { error: e2 } = await admin.from("sara_vigia_transmissao").delete().eq("organization_id", d.org).not("contato_id", "in", `(${ok.length ? ok.join(",") : "00000000-0000-0000-0000-000000000000"})`);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
    if (ok.length) {
      const { error: e3 } = await admin.from("sara_vigia_transmissao").upsert(ok.map((contato_id) => ({ contato_id, organization_id: d.org })), { onConflict: "contato_id", ignoreDuplicates: true });
      if (e3) return NextResponse.json({ error: e3.message }, { status: 400 });
    }
    await auditar(d.sb, "whatsapp.vigia_configurada", { dias: cfg.dias, hora: cfg.hora, whatsapp: cfg.whatsapp, transmissao: ok.length });
    return NextResponse.json({ ok: true, agenda: textoDaAgenda(cfg) });
  }

  if (acao === "enviar_avulso") {
    const v = validarAvulso(e, Date.now());
    if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { data: eu } = await d.sb.rpc("current_profile_id");
    const { data: perfil } = eu ? await d.sb.from("profiles").select("full_name").eq("id", eu).maybeSingle() : { data: null };
    const { data: contatos, error: eContatos } = await admin.from("whatsapp_contatos")
      .select("id, lista, canal_id, nome, numero, profile_id, profiles:profiles!whatsapp_contatos_profile_id_fkey(full_name, organization_id, status, access_expires_at), whatsapp_canais!inner(organization_id, ativo, conexao)")
      .eq("organization_id", d.org).in("id", v.contatos).eq("ativo", true).eq("whatsapp_canais.organization_id", d.org)
      .eq("whatsapp_canais.ativo", true).eq("whatsapp_canais.conexao", "whatsapp_web");
    if (eContatos) return NextResponse.json({ error: "Não foi possível validar os contatos da empresa." }, { status: 503 });
    type Contato = { id: string; lista: string; canal_id: string; nome: string | null; numero: string; profiles: { full_name: string | null; organization_id: string; status: string; access_expires_at: string | null } | null };
    const lista = ((contatos ?? []) as unknown as Contato[]).filter((c) => c.lista === "externa" || Boolean(c.profiles && c.profiles.organization_id === d.org && c.profiles.status === "active" && (!c.profiles.access_expires_at || Date.parse(c.profiles.access_expires_at) > Date.now())));
    if (lista.length !== v.contatos.length) return NextResponse.json({ error: "Algum número escolhido não está mais ativo." }, { status: 400 });
    const { error } = await admin.from("whatsapp_agendados").insert(lista.map((c) => ({ organization_id: d.org, canal_id: c.canal_id, contato_id: c.id,
      para_nome: (c.nome || c.profiles?.full_name || `final ${c.numero.slice(-4)}`).slice(0, 120), quando: v.quando, texto: v.texto, criado_por: eu, criado_por_nome: `Envio avulso · ${perfil?.full_name ?? "proprietário"}`.slice(0, 120) })));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await auditar(d.sb, "whatsapp.envio_avulso", { para: lista.length, quando: v.quando, tamanho: v.texto.length });
    return NextResponse.json({ ok: true, agendados: lista.length });
  }

  if (acao === "cancelar_agendado") {
    const ag = String(e.agendado ?? "");
    if (!UUID.test(ag)) return NextResponse.json({ error: "Envio não encontrado." }, { status: 404 });
    const { data: org, error: eOrg } = await d.sb.rpc("current_organization_id");
    if (eOrg || !org) return NextResponse.json({ error: "Empresa indisponível." }, { status: 503 });
    // Só o que ainda não saiu, na empresa do proprietário autenticado.
    const { data, error } = await createSupabaseAdminClient().from("whatsapp_agendados").update({ situacao: "cancelado" }).eq("organization_id", org).eq("id", ag).eq("situacao", "agendado").select("id, para_nome").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Esse envio já saiu ou já foi cancelado." }, { status: 409 });
    await auditar(d.sb, "whatsapp.agendado_cancelado", { agendado: ag, para: data.para_nome });
    return NextResponse.json({ ok: true });
  }

  if (acao === "salvar_canal") {
    const v = validarCanal(e);
    if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });
    if (UUID.test(id)) {
      const { data: antes } = await d.sb.from("whatsapp_canais").select("prompt").eq("id", id).maybeSingle();
      const { error } = await d.sb.from("whatsapp_canais").update(v).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const promptAlterado = (antes?.prompt ?? null) !== v.prompt;
      await auditar(d.sb, "whatsapp.canal_alterado", { canal: id, nome: v.nome, modelo: v.modelo, prompt_alterado: promptAlterado, ...(promptAlterado ? { prompt_antes: antes?.prompt ?? null, prompt_depois: v.prompt } : {}) });
      return NextResponse.json({ ok: true, id });
    }
    // Número novo: a instância nasce aqui com nome fixo; a Evolution cria na hora do QR Code.
    const { data: todos } = await d.sb.from("whatsapp_canais").select("instancia");
    const instancia = nomeDeInstancia(v.nome, ((todos ?? []) as { instancia: string }[]).map((x) => x.instancia));
    const { data: eu } = await d.sb.rpc("current_profile_id");
    const conexao = e.conexao === "api_oficial" ? "api_oficial" : "whatsapp_web";
    const { data, error } = await d.sb.from("whatsapp_canais").insert({ ...v, instancia, conexao, organization_id: d.org, criado_por: eu }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await auditar(d.sb, "whatsapp.canal_criado", { canal: data.id, instancia, nome: v.nome, modelo: v.modelo, com_prompt: Boolean(v.prompt), conexao });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (!UUID.test(id)) return NextResponse.json({ error: "Número da plataforma não encontrado." }, { status: 404 });
  const { data: canal } = await d.sb.from("whatsapp_canais").select("id, organization_id, instancia, nome, conexao, ativo").eq("id", id).maybeSingle();
  if (!canal) return NextResponse.json({ error: "Número da plataforma não encontrado." }, { status: 404 });
  if (canal.conexao !== "whatsapp_web" && ["conectar", "desconectar", "teste", "teste_interativo"].includes(acao)) return NextResponse.json({ error: "A conexão pela API oficial ainda não está pronta (etapa W5)." }, { status: 400 });

  try {
    if (acao === "conectar") {
      const r = await pedirQr(canal.instancia);
      // O recebimento fica ligado desde já (a instância existe depois do QR pedido).
      await garantirWebhook(canal.instancia).catch(() => null);
      if (r.conectado) return NextResponse.json({ conectado: true });
      await auditar(d.sb, "whatsapp.qr_pedido", { canal: id, instancia: canal.instancia });
      return NextResponse.json({ conectado: false, qr: r.qr });
    }
    if (acao === "desconectar") {
      await desconectar(canal.instancia);
      await auditar(d.sb, "whatsapp.desconectado", { canal: id, instancia: canal.instancia });
      return NextResponse.json({ ok: true });
    }
    if (acao === "teste") {
      const n = numeroWhatsApp(e.numero);
      if ("erro" in n) return NextResponse.json({ error: n.erro }, { status: 400 });
      const texto = String(e.texto ?? "").trim().slice(0, 500) || `Teste do WhatsApp "${canal.nome}" do Pecsil Business OS.`;
      const r = await enviarTexto(canal.instancia, n.numero, texto);
      // Só os 4 últimos dígitos na auditoria.
      await auditar(d.sb, "whatsapp.teste_enviado", { canal: id, para: `…${n.numero.slice(-4)}`, mensagem: r.id });
      return NextResponse.json({ ok: true, id: r.id });
    }
    if (acao === "teste_interativo") {
      // Botões, lista e enquete com a mesma pergunta: mostra o que o WhatsApp entrega pelo chip (Baileys) e, quando a
      // pessoa toca ou vota, o que volta à plataforma (aparece no movimento do número). Nada é feito com a escolha.
      const n = numeroWhatsApp(e.numero);
      if ("erro" in n) return NextResponse.json({ error: n.erro }, { status: 400 });
      const opcoes = [{ id: "sim", texto: "Sim" }, { id: "nao", texto: "Não" }];
      const resultados: { forma: string; ok: boolean; erro?: string }[] = [];
      await enviarTexto(canal.instancia, n.numero, "Teste de botões, lista e enquete do Pecsil Business OS. Toque numa opção de cada uma: é só teste, nada será feito. Na enquete, só o primeiro voto vale.");
      for (const [forma, pergunta] of [["botoes", "Teste 1 de 3 (botões): confirma o envio da OC nº 0000?"], ["lista", "Teste 2 de 3 (lista): confirma o envio da OC nº 0000?"],
        ["enquete", "Teste 3 de 3 (enquete): confirma o envio da OC nº 0000?"]] as const) {
        try {
          const r = await enviarInterativo(canal.instancia, forma, n.numero, pergunta, opcoes);
          // A enquete do teste tem a mesma trava das confirmações: só o primeiro voto vale.
          if (forma === "enquete") await registrarEnqueteDeTeste(createSupabaseAdminClient(), canal, n.numero, r.id);
          resultados.push({ forma, ok: true });
        }
        catch (err) { resultados.push({ forma, ok: false, erro: err instanceof Error ? err.message.slice(0, 160) : "sem resposta" }); }
      }
      await auditar(d.sb, "whatsapp.teste_interativo", { canal: id, para: `…${n.numero.slice(-4)}`, resultados });
      return NextResponse.json({ ok: true, resultados });
    }
    if (acao === "ativar" || acao === "desativar") {
      const { error } = await d.sb.from("whatsapp_canais").update({ ativo: acao === "ativar" }).eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await auditar(d.sb, `whatsapp.canal_${acao === "ativar" ? "ativado" : "desativado"}`, { canal: id, nome: canal.nome });
      return NextResponse.json({ ok: true });
    }
    if (acao === "remover") {
      // Tira o aparelho conectado e apaga a instância na Evolution; as listas do canal saem junto (cascade).
      if (canal.conexao === "whatsapp_web" && configuracao()) await apagarInstancia(canal.instancia);
      const { error } = await d.sb.from("whatsapp_canais").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await auditar(d.sb, "whatsapp.canal_removido", { canal: id, instancia: canal.instancia, nome: canal.nome });
      return NextResponse.json({ ok: true });
    }
  } catch (err) { return falha(err); }
  return NextResponse.json({ error: "Ação não informada." }, { status: 400 });
}
