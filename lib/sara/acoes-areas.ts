import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBR, link, termo, type Ferramenta, type Proposta } from "./base.ts";

/**
 * Mais ações da SARA por módulo (22/10/2026, OK do proprietário: as de baixo risco). Mesmo padrão das
 * primeiras (acoes.ts): `preparar` só confere e monta o cartão; `rodar` chama a MESMA função do banco que a
 * tela usa, com a sessão de quem permitiu (a função confere a permissão de novo). As de risco maior
 * (aprovar título, dar baixa, conciliar, cancelar, compra direta, confirmar recebimento, conferir documento)
 * só entram com o "sim" de quem responde pela área.
 */

const normal = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const inteiro = (v: unknown) => { const n = Number(String(v ?? "").replace(/\D/g, "")); return Number.isInteger(n) && n > 0 ? n : null; };
type Resolvido<T> = T | { erro: string };

// --- Compras: encaminhar itens a um fornecedor (ramo da cotação) -------------------------------------
type Ramo = { pedido: { id: string; numero: number }; itens: { id: string; produto: string; quantidade: number; unidade: string | null }[]; fornecedor: { id: string; nome: string } };

async function resolverRamo(sb: SupabaseClient, e: Record<string, unknown>): Promise<Resolvido<Ramo>> {
  const numero = inteiro(e.pedido);
  if (!numero) return { erro: "Diga o número do pedido de material." };
  const { data: ped } = await sb.from("material_requests").select("id, numero, status").eq("numero", numero).maybeSingle();
  if (!ped) return { erro: `O pedido nº ${numero} não foi encontrado (ou você não tem acesso a ele).` };
  if (["cancelada", "recebida"].includes(ped.status)) return { erro: `O pedido nº ${numero} já foi encerrado.` };
  const { data: itens } = await sb.from("material_request_items").select("id, produto, quantidade, unidade").eq("request_id", ped.id).order("ordem");
  const { data: estados } = await sb.rpc("compras_estado_itens", { p_pedido: ped.id });
  const comprado = new Set(((estados ?? []) as { item_id: string; estado: string }[]).filter((x) => x.estado === "comprado").map((x) => x.item_id));
  const abertos = (itens ?? []).filter((i) => !comprado.has(i.id));
  const pedidos = (Array.isArray(e.itens) ? e.itens : []).map(normal).filter(Boolean);
  const escolhidos = pedidos.length ? abertos.filter((i) => pedidos.some((p) => normal(i.produto).includes(p))) : abertos;
  if (!escolhidos.length) return { erro: `Nenhum item em aberto${pedidos.length ? " com essa descrição" : ""} no pedido nº ${numero}. Itens: ${(itens ?? []).map((i) => i.produto).join("; ") || "nenhum"}.` };
  const t = String(e.fornecedor ?? "").trim();
  if (t.length < 2) return { erro: "Diga o fornecedor (nome ou CNPJ)." };
  const digitos = t.replace(/\D/g, "");
  let q = sb.from("suppliers").select("id, name, trade_name").is("merged_into", null).eq("active", true).limit(6);
  q = digitos.length === 14 ? q.eq("tax_id", digitos) : q.or(`name.ilike.%${termo(t)}%,trade_name.ilike.%${termo(t)}%`);
  const { data: achados } = await q;
  const nome = (s: { name: string; trade_name: string | null }) => (s.trade_name?.trim() || s.name);
  const lista = achados ?? [];
  const exato = lista.filter((s) => normal(nome(s)) === normal(t) || normal(s.name) === normal(t));
  const um = exato.length === 1 ? exato[0] : lista.length === 1 ? lista[0] : null;
  if (!lista.length) return { erro: `O fornecedor "${t}" não está no cadastro. Cadastre em Compras › Fornecedores ou diga o CNPJ.` };
  if (!um) return { erro: `Achei mais de um fornecedor para "${t}": ${lista.map(nome).join("; ")}. Pergunte qual.` };
  return { pedido: { id: ped.id, numero: ped.numero }, itens: escolhidos, fornecedor: { id: um.id, nome: nome(um) } };
}

const ENCAMINHAR_PARA_COTAR: Ferramenta = {
  nome: "encaminhar_para_cotar", rotulo: "preparou um encaminhamento para cotação", exige: ["compras.cotacoes"],
  descricao: "PREPARA o encaminhamento de itens de um pedido de material a um fornecedor, para ele cotar (fica 'aguardando preço'); a pessoa confirma no cartão. Sem itens: todos os que ainda não foram comprados. O link para o fornecedor responder é mandado pela tela do Compras.",
  esquema: {
    type: "object",
    properties: {
      pedido: { type: "integer", description: "Número do pedido de material." },
      fornecedor: { type: "string", description: "Nome do fornecedor no cadastro, ou o CNPJ." },
      itens: { type: "array", items: { type: "string" }, description: "Descrição (ou parte) de cada item; vazio = todos os itens em aberto." },
    },
    required: ["pedido", "fornecedor"],
  },
  acao: {
    nivel: "operar", modulos: ["compras"],
    preparar: async (sb, e) => {
      const r = await resolverRamo(sb, e);
      if ("erro" in r) return r;
      return { resumo: `Encaminhar ${r.itens.length === 1 ? "1 item" : `${r.itens.length} itens`} do pedido nº ${r.pedido.numero} a ${r.fornecedor.nome}, para cotar.`,
        detalhes: r.itens.map((i) => `${Number(i.quantidade).toLocaleString("pt-BR")} ${i.unidade ?? "UN"} · ${i.produto}`) };
    },
  },
  rodar: async (sb, e) => {
    const r = await resolverRamo(sb, e);
    if ("erro" in r) throw new Error(r.erro);
    const { error } = await sb.rpc("compras_ramo_criar", { p_pedido: r.pedido.id, p_itens: r.itens.map((i) => i.id), p_supplier: r.fornecedor.id });
    if (error) throw new Error(error.message);
    return { dados: { feito: `${r.itens.length === 1 ? "Item encaminhado" : `${r.itens.length} itens encaminhados`} a ${r.fornecedor.nome} (pedido nº ${r.pedido.numero}), aguardando preço. Mande o link pela tela, se quiser que ele responda por lá.` },
      fontes: [{ rotulo: "Compras › Cotações", link: link("compras", "cotacoes") }], abrir: { modulo: "compras", secao: "cotacoes", rotulo: "Compras › Cotações" } };
  },
};

// --- Compras: convidar o fornecedor a responder pelo link (compra assistida, 24/10) --------------------
/**
 * Os itens que já aguardam preço com esse fornecedor reaproveitam o encaminhamento aberto; os demais ganham
 * um encaminhamento novo. O link sai uma vez só, para quem permitiu: o banco guarda apenas o hash.
 */
async function ramoDoConvite(sb: SupabaseClient, r: Ramo): Promise<{ existente: string | null; novos: Ramo["itens"] }> {
  const { data } = await sb.from("compras_ramos").select("id, created_at, compras_ramo_itens(item_id)")
    .eq("material_request_id", r.pedido.id).eq("supplier_id", r.fornecedor.id).eq("situacao", "aguardando").order("created_at", { ascending: false });
  const ramos = (data ?? []) as { id: string; compras_ramo_itens: { item_id: string }[] }[];
  const jaAguardando = new Set(ramos.flatMap((x) => x.compras_ramo_itens.map((i) => i.item_id)));
  const novos = r.itens.filter((i) => !jaAguardando.has(i.id));
  const existente = ramos.find((x) => x.compras_ramo_itens.some((i) => r.itens.some((e) => e.id === i.item_id)))?.id ?? null;
  return { existente, novos };
}
const diasDoConvite = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 30 ? n : 7; };

const CONVIDAR_FORNECEDOR: Ferramenta = {
  nome: "convidar_fornecedor", rotulo: "preparou um convite ao fornecedor", exige: ["compras.cotacoes"],
  descricao: "PREPARA o convite para um fornecedor cotar itens de um pedido de material pelo link (ele responde sem login e a resposta vira cotação ligada ao pedido); a pessoa confirma no cartão. Os itens entram em 'aguardando preço' com ele. O link aparece UMA vez no cartão, para a pessoa copiar e mandar (WhatsApp ou e-mail); se perder, prepare outro. Sem itens: todos os que ainda não foram comprados. Use compras_sugerir_fornecedores para saber a quem pedir.",
  esquema: {
    type: "object",
    properties: {
      pedido: { type: "integer", description: "Número do pedido de material." },
      fornecedor: { type: "string", description: "Nome do fornecedor no cadastro, ou o CNPJ." },
      itens: { type: "array", items: { type: "string" }, description: "Descrição (ou parte) de cada item; vazio = todos os itens em aberto." },
      dias: { type: "integer", description: "Quantos dias o link vale (padrão 7, máximo 30)." },
    },
    required: ["pedido", "fornecedor"],
  },
  acao: {
    nivel: "operar", modulos: ["compras"], soComPessoa: true,
    preparar: async (sb, e) => {
      const r = await resolverRamo(sb, e);
      if ("erro" in r) return r;
      return { resumo: `Gerar o link para ${r.fornecedor.nome} cotar ${r.itens.length === 1 ? "1 item" : `${r.itens.length} itens`} do pedido nº ${r.pedido.numero} (vale ${diasDoConvite(e.dias)} dias). O link aparece uma vez, aqui, para você mandar a ele.`,
        detalhes: r.itens.map((i) => `${Number(i.quantidade).toLocaleString("pt-BR")} ${i.unidade ?? "UN"} · ${i.produto}`) };
    },
  },
  rodar: async (sb, e) => {
    const r = await resolverRamo(sb, e);
    if ("erro" in r) throw new Error(r.erro);
    const { existente, novos } = await ramoDoConvite(sb, r);
    let ramo = existente;
    if (novos.length) {
      const { data, error } = await sb.rpc("compras_ramo_criar", { p_pedido: r.pedido.id, p_itens: novos.map((i) => i.id), p_supplier: r.fornecedor.id });
      if (error) throw new Error(error.message);
      ramo = (data as { id: string }).id;
    }
    const { data, error } = await sb.rpc("compras_convite_criar", { p_pedido: r.pedido.id, p_supplier: r.fornecedor.id, p_fornecedor: r.fornecedor.nome, p_dias: diasDoConvite(e.dias), p_ramo: ramo });
    if (error) throw new Error(error.message);
    const c = data as { codigo: string; expira_em: string };
    return { dados: { feito: `Convite criado para ${r.fornecedor.nome} (pedido nº ${r.pedido.numero}), válido até ${dataBR(c.expira_em)}. A resposta dele vira cotação ligada ao pedido.` },
      umaVez: { rotulo: `Link para ${r.fornecedor.nome}`, caminho: `/cotar/${c.codigo}` },
      fontes: [{ rotulo: "Compras › Pedidos almoxarifado", link: link("compras", "solicitacoes") }] };
  },
};

// --- Fiscal: pendência para o escritório contábil ------------------------------------------------------
async function competencia(sb: SupabaseClient, mes: unknown): Promise<Resolvido<{ id: string | null; rotulo: string | null }>> {
  const m = String(mes ?? "").trim();
  if (!m) return { id: null, rotulo: null };
  if (!/^\d{4}-\d{2}$/.test(m)) return { erro: "O mês da competência vai no formato AAAA-MM." };
  const { data } = await sb.from("fiscal_competencias").select("id").eq("competencia", `${m}-01`).maybeSingle();
  if (!data) return { erro: `A competência ${m.split("-").reverse().join("/")} ainda não foi aberta no portal. Abra a pendência sem competência ou abra o mês na tela.` };
  return { id: data.id, rotulo: m.split("-").reverse().join("/") };
}

const PENDENCIA_ESCRITORIO: Ferramenta = {
  nome: "pendencia_para_o_escritorio", rotulo: "preparou uma pendência para o escritório", exige: ["fiscal.escritorio"],
  descricao: "PREPARA uma pendência para o escritório contábil no Portal do escritório (uma pergunta ou um pedido, com assunto e texto, de um mês ou sem mês); a pessoa confirma no cartão. O escritório é avisado.",
  esquema: {
    type: "object",
    properties: {
      assunto: { type: "string", description: "Assunto curto." },
      texto: { type: "string", description: "A mensagem para o escritório, como a pessoa falou." },
      mes: { type: "string", description: "Competência AAAA-MM, se for de um mês." },
    },
    required: ["assunto", "texto"],
  },
  acao: {
    nivel: "operar", modulos: ["fiscal"],
    preparar: async (sb, e) => {
      const assunto = String(e.assunto ?? "").trim(), texto = String(e.texto ?? "").trim();
      if (assunto.length < 3 || texto.length < 3) return { erro: "Falta o assunto ou a mensagem." };
      const c = await competencia(sb, e.mes);
      if ("erro" in c) return c;
      return { resumo: `Abrir pendência para o escritório contábil: ${assunto.slice(0, 160)}${c.rotulo ? ` (competência ${c.rotulo})` : ""}.`, detalhes: [texto.slice(0, 600)] };
    },
  },
  rodar: async (sb, e) => {
    const c = await competencia(sb, e.mes);
    if ("erro" in c) throw new Error(c.erro);
    const { error } = await sb.rpc("fiscal_portal_pendencia_abrir", { p_competencia: c.id, p_assunto: String(e.assunto ?? "").trim().slice(0, 160), p_texto: String(e.texto ?? "").trim().slice(0, 4000) });
    if (error) throw new Error(error.message);
    return { dados: { feito: "Pendência aberta. O escritório contábil foi avisado." }, fontes: [{ rotulo: "Fiscal › Escritório contábil", link: link("fiscal", "Escritório contábil") }] };
  },
};

// --- RH: incluir no quadro de terceiros ---------------------------------------------------------------
const INCLUIR_TERCEIRO: Ferramenta = {
  nome: "incluir_terceiro", rotulo: "preparou a inclusão de um terceiro", exige: ["rh.terceiros"],
  descricao: "PREPARA a inclusão de um prestador no quadro de terceiros (ele passa a aparecer na Portaria); a pessoa confirma no cartão.",
  esquema: { type: "object", properties: { nome: { type: "string", description: "Nome completo do terceiro." } }, required: ["nome"] },
  acao: {
    nivel: "operar", modulos: ["rh"],
    preparar: async (sb, e) => {
      const nome = String(e.nome ?? "").replace(/\s+/g, " ").trim();
      if (nome.length < 2 || nome.length > 80) return { erro: "Diga o nome do terceiro (2 a 80 letras)." };
      const { data } = await sb.from("terceiros_quadro").select("id").eq("ativo", true).ilike("nome", nome).limit(1);
      if (data?.length) return { erro: `${nome} já está no quadro de terceiros.` };
      return { resumo: `Incluir ${nome} no quadro de terceiros.`, detalhes: ["A Portaria passa a ver o nome ao registrar a entrada."] };
    },
  },
  rodar: async (sb, e) => {
    const { data, error } = await sb.rpc("rh_terceiro_incluir", { p_nome: String(e.nome ?? "") });
    if (error) throw new Error(error.message);
    return { dados: { feito: `${(data as { nome?: string } | null)?.nome ?? "Terceiro"} incluído no quadro. A Portaria foi avisada.` }, fontes: [{ rotulo: "RH › Colaboradores (Terceiros)", link: link("rh", "Colaboradores") }] };
  },
};

// --- TI: inventário, incidente e atendimento de chamado ------------------------------------------------
const TIPOS_ATIVO = ["servidor", "estacao", "notebook", "rede", "coletor_cnc", "impressora", "nobreak", "camera", "sistema", "outro"];
const CAMPOS_ATIVO = ["local", "responsavel", "fabricante", "modelo", "numero_serie", "patrimonio", "ip", "sistema_operacional", "observacao"] as const;
const ROTULO_CAMPO: Record<(typeof CAMPOS_ATIVO)[number], string> = { local: "Local", responsavel: "Responsável", fabricante: "Fabricante", modelo: "Modelo", numero_serie: "Número de série",
  patrimonio: "Patrimônio", ip: "IP", sistema_operacional: "Sistema operacional", observacao: "Observação" };

const CADASTRAR_EQUIPAMENTO: Ferramenta = {
  nome: "cadastrar_equipamento", rotulo: "preparou o cadastro de um equipamento", exige: ["ti.ativos"],
  descricao: "PREPARA o cadastro de um equipamento no inventário de TI; a pessoa confirma no cartão. Tipo: servidor, estacao (computador de mesa), notebook, rede, coletor_cnc, impressora, nobreak, camera, sistema ou outro.",
  esquema: {
    type: "object",
    properties: {
      nome: { type: "string" }, tipo: { type: "string", enum: TIPOS_ATIVO }, critico: { type: "boolean", description: "Se a parada dele para a fábrica." },
      ...Object.fromEntries(CAMPOS_ATIVO.map((c) => [c, { type: "string" }])),
    },
    required: ["nome", "tipo"],
  },
  acao: {
    nivel: "operar", modulos: ["ti"],
    preparar: async (_sb, e) => {
      if (String(e.nome ?? "").trim().length < 2) return { erro: "Diga o nome do equipamento." };
      if (!TIPOS_ATIVO.includes(String(e.tipo))) return { erro: `Tipo inválido. Use: ${TIPOS_ATIVO.join(", ")}.` };
      return { resumo: `Cadastrar no inventário de TI: ${String(e.nome).trim().slice(0, 120)} (${e.tipo}${e.critico ? ", crítico" : ""}).`,
        detalhes: CAMPOS_ATIVO.filter((c) => String(e[c] ?? "").trim()).map((c) => `${ROTULO_CAMPO[c]}: ${String(e[c]).trim().slice(0, 120)}`) };
    },
  },
  rodar: async (sb, e) => {
    const p = { nome: String(e.nome ?? ""), tipo: String(e.tipo ?? ""), critico: e.critico === true, situacao: "em_uso",
      ...Object.fromEntries(CAMPOS_ATIVO.map((c) => [c, String(e[c] ?? "").trim() || null])) };
    const { data, error } = await sb.rpc("ti_salvar_ativo", { p });
    if (error) throw new Error(error.message);
    return { dados: { feito: `Equipamento #${(data as { numero?: number } | null)?.numero ?? ""} cadastrado no inventário de TI.` }, fontes: [{ rotulo: "TI › Inventário", link: link("ti", "Inventário") }] };
  },
};

const CATEGORIAS_INCIDENTE = ["energia", "internet", "rede", "servidor", "estacao", "sistema", "backup", "alarme_falso", "outro"];
/** "2026-10-22T08:30" (horário de Brasília) → ISO com o fuso. */
const horaSP = (v: unknown) => { const s = String(v ?? "").trim(); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00-03:00` : null; };
async function equipamento(sb: SupabaseClient, ref: unknown): Promise<Resolvido<{ id: string; nome: string } | null>> {
  const t = String(ref ?? "").trim();
  if (!t) return null;
  const n = /^#?\d+$/.test(t) ? inteiro(t) : null;
  const { data } = n ? await sb.from("ti_ativos").select("id, nome").eq("numero", n).limit(2) : await sb.from("ti_ativos").select("id, nome").ilike("nome", `%${termo(t)}%`).limit(3);
  if (!data?.length) return { erro: `O equipamento "${t}" não está no inventário.` };
  if (data.length > 1) return { erro: `Mais de um equipamento para "${t}": ${data.map((x) => x.nome).join("; ")}. Pergunte qual.` };
  return data[0];
}

const REGISTRAR_INCIDENTE: Ferramenta = {
  nome: "registrar_incidente", rotulo: "preparou o registro de uma queda", exige: ["ti.saude"],
  descricao: "PREPARA o registro de uma queda ou incidente de TI (energia, internet, rede, servidor, estação, sistema, backup, alarme falso, outro), com início, fim se já voltou e a causa; a pessoa confirma no cartão. Use a ferramenta periodo/hoje para as datas; horários de Brasília.",
  esquema: {
    type: "object",
    properties: {
      categoria: { type: "string", enum: CATEGORIAS_INCIDENTE }, causa: { type: "string" },
      inicio: { type: "string", description: "AAAA-MM-DDTHH:MM (Brasília)." }, fim: { type: "string", description: "AAAA-MM-DDTHH:MM, se já voltou." },
      equipamento: { type: "string", description: "Nome ou número do equipamento, se houver." }, descricao: { type: "string" },
    },
    required: ["categoria", "causa", "inicio"],
  },
  acao: {
    nivel: "operar", modulos: ["ti"],
    preparar: async (sb, e) => {
      if (!CATEGORIAS_INCIDENTE.includes(String(e.categoria))) return { erro: `Categoria inválida. Use: ${CATEGORIAS_INCIDENTE.join(", ")}.` };
      if (String(e.causa ?? "").trim().length < 3) return { erro: "Descreva a causa." };
      const ini = horaSP(e.inicio), fim = e.fim ? horaSP(e.fim) : null;
      if (!ini) return { erro: "Diga quando começou (data e hora)." };
      if (e.fim && !fim) return { erro: "O fim vai como data e hora." };
      if (fim && fim < ini) return { erro: "O fim não pode ser antes do início." };
      const eq = await equipamento(sb, e.equipamento);
      if (eq && "erro" in eq) return eq;
      const quando = (x: string) => `${dataBR(x)} ${x.slice(11, 16)}`;
      return { resumo: `Registrar incidente de TI (${e.categoria}): ${String(e.causa).trim().slice(0, 160)}.`,
        detalhes: [`Início: ${quando(ini)}${fim ? ` · fim: ${quando(fim)}` : " · ainda sem fim"}`, ...(eq ? [`Equipamento: ${eq.nome}`] : []), ...(e.descricao ? [String(e.descricao).slice(0, 300)] : [])] };
    },
  },
  rodar: async (sb, e) => {
    const eq = await equipamento(sb, e.equipamento);
    if (eq && "erro" in eq) throw new Error(eq.erro);
    const { error } = await sb.rpc("ti_salvar_incidente", { p: { categoria: e.categoria, causa: String(e.causa ?? ""), inicio: horaSP(e.inicio), fim: e.fim ? horaSP(e.fim) : null,
      ativo_id: eq?.id ?? null, descricao: String(e.descricao ?? "").trim() || null } });
    if (error) throw new Error(error.message);
    return { dados: { feito: "Incidente registrado no histórico de quedas da TI." }, fontes: [{ rotulo: "TI › Incidentes", link: link("ti", "Incidentes") }] };
  },
};

const ACOES_CHAMADO: Record<string, string> = { comentar: "Responder", assumir: "Assumir", aguardar: "Pôr em espera", resolver: "Resolver", reclassificar: "Reclassificar" };
const PRIORIDADES = ["baixa", "normal", "alta", "urgente"];
async function chamado(sb: SupabaseClient, ref: unknown) {
  const n = inteiro(ref);
  if (!n) return { erro: "Diga o número do chamado." } as const;
  const { data } = await sb.from("ti_chamados").select("id, numero, titulo, situacao").eq("numero", n).maybeSingle();
  return data ?? ({ erro: `O chamado nº ${n} não foi encontrado.` } as const);
}

const ATENDER_CHAMADO: Ferramenta = {
  nome: "atender_chamado_ti", rotulo: "preparou o atendimento de um chamado", exige: ["ti.chamados"],
  descricao: "PREPARA um passo no atendimento de um chamado de TI (para quem é da TI): comentar (responder a quem abriu), assumir, aguardar (com o que falta), resolver (com o que foi feito) ou reclassificar (prioridade/categoria); a pessoa confirma no cartão.",
  esquema: {
    type: "object",
    properties: {
      chamado: { type: "integer", description: "Número do chamado." }, acao: { type: "string", enum: Object.keys(ACOES_CHAMADO) },
      texto: { type: "string", description: "A mensagem, o que falta ou o que foi feito." }, prioridade: { type: "string", enum: PRIORIDADES }, categoria: { type: "string" },
    },
    required: ["chamado", "acao"],
  },
  acao: {
    nivel: "operar", modulos: ["ti"],
    preparar: async (sb, e) => {
      const c = await chamado(sb, e.chamado);
      if ("erro" in c) return { erro: c.erro };
      const acao = String(e.acao);
      if (!ACOES_CHAMADO[acao]) return { erro: `Ação inválida. Use: ${Object.keys(ACOES_CHAMADO).join(", ")}.` };
      if (["comentar", "aguardar", "resolver"].includes(acao) && String(e.texto ?? "").trim().length < 3) return { erro: acao === "resolver" ? "Descreva o que foi feito." : acao === "aguardar" ? "Diga o que falta para continuar." : "Escreva a mensagem." };
      if (!["aberto", "em_atendimento", "aguardando"].includes(c.situacao)) return { erro: `O chamado nº ${c.numero} está encerrado (${c.situacao}).` };
      const extra = acao === "reclassificar" ? [e.prioridade ? `prioridade ${e.prioridade}` : "", e.categoria ? `categoria ${e.categoria}` : ""].filter(Boolean).join(", ") : "";
      if (acao === "reclassificar" && !extra) return { erro: "Diga a prioridade ou a categoria nova." };
      return { resumo: `${ACOES_CHAMADO[acao]} o chamado nº ${c.numero} (${c.titulo.slice(0, 100)})${extra ? `: ${extra}` : ""}.`, detalhes: e.texto ? [String(e.texto).trim().slice(0, 600)] : [] };
    },
  },
  rodar: async (sb, e) => {
    const c = await chamado(sb, e.chamado);
    if ("erro" in c) throw new Error(c.erro);
    const extra = String(e.acao) === "reclassificar" ? { ...(e.prioridade ? { prioridade: e.prioridade } : {}), ...(e.categoria ? { categoria: e.categoria } : {}) } : {};
    const { error } = await sb.rpc("ti_chamado_acao", { p_chamado: c.id, p_acao: String(e.acao), p_texto: String(e.texto ?? ""), p_extra: extra });
    if (error) throw new Error(error.message);
    return { dados: { feito: `Chamado nº ${c.numero}: ${ACOES_CHAMADO[String(e.acao)].toLowerCase()} — feito.${["comentar", "resolver", "assumir", "aguardar"].includes(String(e.acao)) ? " Quem abriu foi avisado." : ""}` },
      fontes: [{ rotulo: "TI › Chamados", link: link("ti", "Chamados") }] };
  },
};

// --- Produção: entrada de produção (peças prontas para faturar) ----------------------------------------
type Entrada = { orcamento: number; item: { id: string; descricao: string; quantidade: number }; produzido: number };
async function resolverEntrada(sb: SupabaseClient, e: Record<string, unknown>): Promise<Resolvido<Entrada>> {
  const numero = inteiro(e.orcamento);
  if (!numero) return { erro: "Diga o número do orçamento." };
  const { data: q } = await sb.from("sales_quotes").select("id, numero, situacao").eq("numero", numero).eq("treino", false).maybeSingle();
  if (!q) return { erro: `O orçamento nº ${numero} não foi encontrado.` };
  if (q.situacao !== "ganho") return { erro: `O orçamento nº ${numero} não está ganho: entrada de produção só em orçamento ganho.` };
  const { data: itens } = await sb.from("sales_quote_items").select("id, descricao, quantidade").eq("quote_id", q.id).order("ordem");
  const t = normal(e.item);
  const cand = (itens ?? []).filter((i) => !t || normal(i.descricao).includes(t));
  if (!cand.length) return { erro: `Nenhum item com essa descrição no orçamento nº ${numero}. Itens: ${(itens ?? []).map((i) => i.descricao).join("; ")}.` };
  if (cand.length > 1) return { erro: `O orçamento nº ${numero} tem mais de um item${t ? " com essa descrição" : ""}: ${cand.map((i) => i.descricao).join("; ")}. Pergunte qual.` };
  const { data: feitas } = await sb.from("production_entries").select("quantidade").eq("quote_item_id", cand[0].id);
  return { orcamento: numero, item: cand[0], produzido: (feitas ?? []).reduce((s, x) => s + Number(x.quantidade), 0) };
}

const ENTRADA_DE_PRODUCAO: Ferramenta = {
  nome: "entrada_de_producao", rotulo: "preparou uma entrada de produção", exige: ["producao.entrada"],
  descricao: "PREPARA a entrada de produção de um item de orçamento ganho (peças prontas: o Fiscal é avisado para faturar); a pessoa confirma no cartão. Diga o orçamento, o item (se tiver mais de um) e a quantidade.",
  esquema: {
    type: "object",
    properties: { orcamento: { type: "integer" }, item: { type: "string", description: "Descrição (ou parte) do item." }, quantidade: { type: "number" }, observacao: { type: "string" } },
    required: ["orcamento", "quantidade"],
  },
  acao: {
    nivel: "operar", modulos: ["producao", "comercial"],
    preparar: async (sb, e): Promise<Proposta | { erro: string }> => {
      const r = await resolverEntrada(sb, e);
      if ("erro" in r) return r;
      const q = Number(e.quantidade);
      if (!(q > 0)) return { erro: "Diga a quantidade produzida." };
      const cabe = Number(r.item.quantidade) - r.produzido;
      if (q > cabe) return { erro: `Passa do pedido: ${r.produzido} de ${r.item.quantidade} já produzidas; cabem mais ${cabe}.` };
      return { resumo: `Dar entrada de ${q.toLocaleString("pt-BR")} peça(s) de ${r.item.descricao} (orçamento nº ${r.orcamento}).`,
        detalhes: [`Já produzidas: ${r.produzido} de ${r.item.quantidade}.`, "O Fiscal é avisado de que há peças para faturar.", ...(e.observacao ? [String(e.observacao).slice(0, 300)] : [])] };
    },
  },
  rodar: async (sb, e) => {
    const r = await resolverEntrada(sb, e);
    if ("erro" in r) throw new Error(r.erro);
    const { error } = await sb.rpc("producao_entrada_registrar", { p_item: r.item.id, p_quantidade: Number(e.quantidade), p_observacao: String(e.observacao ?? "").trim() || null });
    if (error) throw new Error(error.message);
    return { dados: { feito: `Entrada de produção registrada (orçamento nº ${r.orcamento}). O Fiscal foi avisado.` }, fontes: [{ rotulo: "Produção › Entrada de produção", link: link("producao", "Entrada de produção") }] };
  },
};

export const ACOES_AREAS: Ferramenta[] = [ENCAMINHAR_PARA_COTAR, CONVIDAR_FORNECEDOR, PENDENCIA_ESCRITORIO, INCLUIR_TERCEIRO, CADASTRAR_EQUIPAMENTO, REGISTRAR_INCIDENTE, ATENDER_CHAMADO, ENTRADA_DE_PRODUCAO];

/** Nome de cada ação para quem lê (quadro de limites das guias). */
export const ROTULO_DAS_ACOES: Record<string, string> = {
  encaminhar_para_cotar: "Encaminhar itens para cotar", convidar_fornecedor: "Convidar fornecedor a cotar pelo link", pendencia_para_o_escritorio: "Abrir pendência para o escritório", incluir_terceiro: "Incluir terceiro no quadro",
  cadastrar_equipamento: "Cadastrar equipamento", registrar_incidente: "Registrar incidente de TI", atender_chamado_ti: "Atender chamado de TI", entrada_de_producao: "Dar entrada de produção",
};
