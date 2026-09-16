import { createClient } from "@supabase/supabase-js";

const cloudUrl = process.env.COMPRAS_CLOUD_URL || "https://vfnyyyzsicgiweisgamt.supabase.co";
const cloudKey = process.env.COMPRAS_CLOUD_KEY;

const prodUrl = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const prodServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Chaves nunca ficam no código: defina COMPRAS_CLOUD_KEY, a URL de destino e
// SUPABASE_SERVICE_ROLE_KEY no ambiente.
if (!cloudKey || !prodUrl || !prodServiceKey) {
  console.error("❌ Defina COMPRAS_CLOUD_KEY, SUPABASE_INTERNAL_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

console.log("==========================================================");
console.log("🚀 MIGRAÇÃO DE DADOS: SUPABASE CLOUD ➔ SUPABASE PRODUÇÃO");
console.log("==========================================================");
console.log(`Origem (Cloud):     ${cloudUrl}`);
console.log(`Destino (Produção): ${prodUrl}`);

const cloudClient = createClient(cloudUrl, cloudKey, { auth: { persistSession: false } });
const prodClient = createClient(prodUrl, prodServiceKey, { auth: { persistSession: false } });

// Helper para inserção em lote
async function batchUpsert(client, table, items, batchSize = 50) {
  if (!items || items.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const { error } = await client.from(table).upsert(batch, { onConflict: "id" });
    if (error) {
      throw new Error(`Erro inserindo lote na tabela ${table} (${i} a ${i + batch.length}): ${error.message}`);
    }
    inserted += batch.length;
  }
  return inserted;
}

async function run() {
  // 1. Obter organização ativa na produção
  console.log("\n1. Verificando organização no Supabase de Produção...");
  const { data: orgs, error: orgErr } = await prodClient.from("organizations").select("id, display_name").limit(1);
  if (orgErr) {
    throw new Error("Falha ao conectar no Supabase de Produção ou buscar organização: " + orgErr.message);
  }
  if (!orgs || orgs.length === 0) {
    throw new Error("Nenhuma organização encontrada na tabela organizations de produção.");
  }
  const organizationId = orgs[0].id;
  console.log(`✓ Organização vinculada: ${orgs[0].display_name} (${organizationId})`);

  // 2. Extrair dados da Nuvem (somente leitura)
  console.log("\n2. Extraindo dados do Supabase Cloud (somente leitura)...");
  const { data: cloudCotacoes, error: cotErr } = await cloudClient.from("cotacoes").select("*").order("id");
  if (cotErr) throw new Error("Erro ao ler cotacoes: " + cotErr.message);

  const { data: cloudProdutos, error: prodErr } = await cloudClient.from("cotacao_produtos").select("*").order("id");
  if (prodErr) throw new Error("Erro ao ler cotacao_produtos: " + prodErr.message);

  const { data: cloudCompras, error: compErr } = await cloudClient.from("compras").select("*").order("id");
  if (compErr) throw new Error("Erro ao ler compras: " + compErr.message);

  const { data: cloudNotifs, error: notErr } = await cloudClient.from("notificacoes").select("*").order("id");
  // Notificações podem não ser críticas se der erro
  if (notErr) console.warn("Aviso ao ler notificacoes cloud:", notErr.message);

  console.log(`✓ Cotações lidas do Cloud:         ${cloudCotacoes?.length || 0}`);
  console.log(`✓ Itens de Cotação lidos do Cloud: ${cloudProdutos?.length || 0}`);
  console.log(`✓ Compras lidas do Cloud:          ${cloudCompras?.length || 0}`);
  console.log(`✓ Notificações lidas do Cloud:     ${cloudNotifs?.length || 0}`);

  // 3. Preparar e enviar Cotações
  console.log("\n3. Migrando Cotações para Produção...");
  const cotacoesParaInserir = (cloudCotacoes || []).map((c) => ({
    id: c.id,
    organization_id: organizationId,
    fornecedor: c.fornecedor,
    divisao: c.divisao || "USINAGEM",
    status: c.status || "PENDENTE",
    user_id: c.user_id || "sistema",
    aprovado_por: c.aprovado_por || null,
    motivo_rejeicao: c.motivo_rejeicao || null,
    data_decisao: c.data_decisao || null,
    created_at: c.created_at || new Date().toISOString(),
    updated_at: c.updated_at || new Date().toISOString(),
    deleted_at: c.deleted_at || null,
    produto: c.produto || null,
    valor_unit: c.valor_unit != null ? Number(c.valor_unit) : null,
    quantidade: c.quantidade != null ? Number(c.quantidade) : null,
    unidade: c.unidade || null,
    icms: c.icms != null ? Number(c.icms) : 0,
    ipi: c.ipi != null ? Number(c.ipi) : 0,
    prazo: c.prazo || null,
    obs: c.obs || "",
  }));

  const cotacoesInseridas = await batchUpsert(prodClient, "cotacoes", cotacoesParaInserir);
  console.log(`✓ ${cotacoesInseridas} cotações migradas com sucesso.`);

  // 4. Preparar e enviar Produtos de Cotações
  console.log("\n4. Migrando Itens de Cotações para Produção...");
  // Filtrar apenas produtos cujas cotacoes foram migradas
  const cotacaoIds = new Set(cotacoesParaInserir.map((c) => c.id));
  const produtosValidos = (cloudProdutos || []).filter((p) => cotacaoIds.has(p.cotacao_id));

  const produtosParaInserir = produtosValidos.map((p) => ({
    id: p.id,
    cotacao_id: p.cotacao_id,
    produto: p.produto,
    valor_unit: Number(p.valor_unit) || 0,
    quantidade: Number(p.quantidade) || 0,
    unidade: p.unidade || "UN",
    icms: Number(p.icms) || 0,
    ipi: Number(p.ipi) || 0,
    prazo: p.prazo || "",
    obs: p.obs || "",
    status: p.status || "PENDENTE",
    motivo_rejeicao: p.motivo_rejeicao || null,
    created_at: p.created_at || new Date().toISOString(),
  }));

  const produtosInseridos = await batchUpsert(prodClient, "cotacao_produtos", produtosParaInserir);
  console.log(`✓ ${produtosInseridos} itens de cotação migrados com sucesso.`);

  // 5. Preparar e enviar Compras
  console.log("\n5. Migrando Compras Faturadas para Produção...");
  const comprasValidas = (cloudCompras || []).filter((cp) => cotacaoIds.has(cp.cotacao_id));

  const comprasParaInserir = comprasValidas.map((cp) => ({
    id: cp.id,
    organization_id: organizationId,
    cotacao_id: cp.cotacao_id,
    fornecedor: cp.fornecedor,
    produto: cp.produto,
    quantidade: Number(cp.quantidade) || 0,
    unidade: cp.unidade || "UN",
    valor_unit: Number(cp.valor_unit) || 0,
    total: Number(cp.total) || 0,
    nf: cp.nf || null,
    data_compra: cp.data_compra || new Date().toISOString().split("T")[0],
    obs: cp.obs || null,
    created_at: cp.created_at || new Date().toISOString(),
  }));

  const comprasInseridas = await batchUpsert(prodClient, "compras", comprasParaInserir);
  console.log(`✓ ${comprasInseridas} compras migradas com sucesso.`);

  // 6. Preparar e enviar Notificações
  if (cloudNotifs && cloudNotifs.length > 0) {
    console.log("\n6. Migrando Notificações para Produção...");
    const notifsValidas = cloudNotifs.filter((n) => !n.cotacao_id || cotacaoIds.has(n.cotacao_id));
    const notifsParaInserir = notifsValidas.map((n) => ({
      id: n.id,
      organization_id: organizationId,
      user_id: n.user_id || "sistema",
      cotacao_id: n.cotacao_id || null,
      tipo: n.tipo || "NOVA_COTACAO_PENDENTE",
      mensagem: n.mensagem || "",
      lida: Boolean(n.lida),
      created_at: n.created_at || new Date().toISOString(),
    }));

    const notifsInseridas = await batchUpsert(prodClient, "notificacoes_compras", notifsParaInserir);
    console.log(`✓ ${notifsInseridas} notificações migradas com sucesso.`);
  }

  // 7. Validação Final Direta em Produção
  console.log("\n==========================================================");
  console.log("🔍 VALIDAÇÃO DOS DADOS NO SUPABASE DE PRODUÇÃO:");
  console.log("==========================================================");

  const { count: countCot } = await prodClient.from("cotacoes").select("*", { count: "exact", head: true });
  const { count: countProd } = await prodClient.from("cotacao_produtos").select("*", { count: "exact", head: true });
  const { count: countComp } = await prodClient.from("compras").select("*", { count: "exact", head: true });
  const { count: countNotif } = await prodClient.from("notificacoes_compras").select("*", { count: "exact", head: true });

  console.log(`✓ Cotações em Produção:       ${countCot}`);
  console.log(`✓ Itens de Produtos:          ${countProd}`);
  console.log(`✓ Compras Faturadas:          ${countComp}`);
  console.log(`✓ Notificações:               ${countNotif}`);
  console.log("==========================================================");
  console.log("🎉 MIGRAÇÃO DE DADOS PARA PRODUÇÃO CONCLUÍDA COM SUCESSO!");
  console.log("==========================================================");
}

run().catch((err) => {
  console.error("❌ ERRO NA MIGRAÇÃO:", err);
  process.exit(1);
});
