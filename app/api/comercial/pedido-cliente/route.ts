import { NextResponse } from "next/server";
import { linhasDoPdf, PdfInvalido, textoDoPdf } from "../../../../lib/arquivos/pdf-texto";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { candidatos, clienteDoPedido, lerPedido, type Cliente, type Produto } from "../../../../lib/comercial/pedido-cliente";
import { perguntar } from "../../../../lib/decisao/client";
import type { Resposta } from "../../../../lib/decisao/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 15_000_000;
const UUID = /^[0-9a-f-]{36}$/i;
const LETRAS = "abcde";

/**
 * Pedido do cliente → itens do orçamento (C-05). POST multipart com o PDF do pedido (ou "texto"
 * colado): lê as linhas por regra, devolve os candidatos de cada uma e, se o uso do Clef estiver
 * ligado, a sugestão dele entre os candidatos (só descrições vão ao modelo). Nada é gravado aqui.
 * PATCH: grava o de-para (código do cliente → produto) das linhas que a pessoa confirmou.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  let linhas: string[] = [];
  if (arquivo instanceof File && arquivo.size) {
    if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo acima de 15 MB." }, { status: 413 });
    try {
      const paginas = await textoDoPdf(new Uint8Array(await arquivo.arrayBuffer()), 30);
      linhas = paginas.flatMap((p) => linhasDoPdf(p).map((l) => l.map((i) => i.s).join(" | ")));
    } catch (e) {
      if (e instanceof PdfInvalido) return NextResponse.json({ error: `${e.message} Se for foto ou PDF escaneado, cole o texto do pedido.` }, { status: 400 });
      throw e;
    }
  } else {
    linhas = String(form?.get("texto") ?? "").slice(0, 200_000).split(/\r?\n/).map((l) => l.replace(/\t/g, " | "));
  }
  const pedido = lerPedido(linhas);
  if (!pedido.itens.length) return NextResponse.json({ ...pedido, itens: [], aviso: "Não encontrei linhas de item no formato do pedido (item, descrição, quantidade, unidade, preço, entrega, valor). Inclua os itens à mão." });

  // Catálogo inteiro em páginas (o Supabase devolve no máximo 1.000 linhas por consulta).
  const produtos: Produto[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await guard.supabase.from("products").select("id, codigo, descricao, unidade, tipo_peca, nome_cliente, desenho_codigo").eq("ativo", true).order("codigo").range(de, de + 999);
    if (error) return NextResponse.json({ error: "Não foi possível ler o catálogo." }, { status: 500 });
    produtos.push(...((data ?? []) as Produto[]));
    if (!data || data.length < 1000) break;
  }

  // Cliente do pedido, por regra (CNPJ do cadastro, senão o nome escrito no pedido).
  const [{ data: clientes }, { data: fiscal }] = await Promise.all([
    guard.supabase.from("customers").select("id, name, tax_id").eq("active", true).is("merged_into", null).limit(2000),
    guard.supabase.from("fiscal_config").select("cnpj").maybeSingle(),
  ]);
  const doPedido = clienteDoPedido(linhas, (clientes ?? []) as Cliente[], (fiscal as { cnpj?: string } | null)?.cnpj ?? null);
  const cliente = doPedido ? { id: doPedido.cliente.id, nome: doPedido.cliente.name, motivo: doPedido.motivo } : null;

  let clef: "nao_consultado" | "ok" | "desligado" | "indisponivel" = "nao_consultado";
  const itens = [];
  for (const linha of pedido.itens) {
    const lista = candidatos(linha, produtos);
    let sugestao: { produtoId: string | null; confianca: number; faixa: string; julgamentoId: string } | null = null;
    // O Clef só desempata quando a regra não casou pelo de-para e há mais de um candidato.
    if ((clef === "nao_consultado" || clef === "ok") && lista.length > 1 && lista[0].motivo !== "de_para") {
      const criterios: Record<string, string> = Object.fromEntries(lista.map((c, i) => [LETRAS[i], c.produto.descricao]));
      criterios.nenhum = "nenhum destes produtos";
      const r = await perguntar(guard.supabase, {
        uso: "comercial.pedido_produto", entidade: { tipo: "pedido_cliente_linha", id: `${pedido.cabecalho.numero ?? "pedido"}:${linha.item}`.slice(0, 80) },
        estado: `Peça pedida pelo cliente: ${linha.descricao}`,
        perguntas: { produto: { type: "choice", instructions: "Qual produto do catálogo é a peça pedida? O código do cliente traz o tipo da peça (2 letras), o artigo (6 dígitos) e o material no fim.", criteria: criterios } },
      });
      if (r.status === "ok") {
        clef = "ok";
        const escolha = (r.respostas.produto as Extract<Resposta, { type: "choice" }>).escolha;
        const idx = LETRAS.indexOf(escolha);
        sugestao = { produtoId: idx >= 0 ? lista[idx]?.produto.id ?? null : null, confianca: r.confianca, faixa: r.faixa, julgamentoId: r.julgamentoId };
      } else if (r.status === "indisponivel" || r.status === "bloqueado") clef = "indisponivel";
      else clef = "desligado";
    }
    itens.push({ ...linha, candidatos: lista.map((c) => ({ id: c.produto.id, codigo: c.produto.codigo, descricao: c.produto.descricao, unidade: c.produto.unidade, motivo: c.motivo, explicacao: c.explicacao })), clef: sugestao });
  }
  return NextResponse.json({ ...pedido, cabecalho: { ...pedido.cabecalho, cliente }, itens, clef: clef === "nao_consultado" ? "desligado" : clef });
}

export async function PATCH(request: Request) {
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { pares?: { produto: string; codigo: string; julgamentoId?: string | null; aceitouClef?: boolean | null }[] } | null;
  const pares = (corpo?.pares ?? []).filter((p) => UUID.test(p.produto) && p.codigo).slice(0, 200);
  const resultado: Record<string, number> = {};
  for (const p of pares) {
    const { data, error } = await guard.supabase.rpc("comercial_produto_de_para", { p_product: p.produto, p_codigo: p.codigo });
    const k = error ? "erro" : String(data);
    resultado[k] = (resultado[k] ?? 0) + 1;
    // O que a pessoa decidiu sobre a sugestão do Clef (mede o acerto do modelo).
    if (p.julgamentoId && UUID.test(p.julgamentoId)) {
      await guard.supabase.rpc("ai_judgment_decide", { p_id: p.julgamentoId, p_outcome: p.aceitouClef ? "aceita" : "corrigida", p_note: p.aceitouClef ? null : "Comercial escolheu outro produto do catálogo." });
    }
  }
  return NextResponse.json({ ok: true, resultado });
}
