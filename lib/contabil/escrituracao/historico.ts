import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { codigoChave, lerEscrituracaoEcd } from "./ecd";

/**
 * Importa a ECD de um exercício fechado como histórico do plano (N-04 passos 2 e 3), com a chave de serviço DEPOIS
 * de a rota conferir fiscal.contabilidade operar (ou pelo script do proprietário). Antes de gravar qualquer coisa:
 * a ECD tem de ser da própria empresa (mesmo CNPJ da Configuração fiscal) e toda conta usada tem de existir, analítica,
 * no plano. Grava o referencial da Receita, a abertura do exercício e cada lançamento do escritório; o que já entrou
 * (mesmo número da ECD) não entra de novo.
 */
const LOTE = 400;

export type ResultadoImportacao = { ano: string; referencial: number; abertura: number; lancamentos: number; jaExistiam: number; partidas: number; fim: string; avisos: string[] };

async function contasDoPlano(admin: SupabaseClient, plano: string) {
  const contas: { id: string; codigo: string; tipo: string }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from("contabil_contas").select("id, codigo, tipo").eq("plano_id", plano).order("codigo").range(de, de + 999);
    if (error) throw new Error(error.message);
    contas.push(...(data ?? []));
    if (!data || data.length < 1000) return contas;
  }
}

export async function importarEcd(admin: SupabaseClient, org: string, plano: string, texto: string, autor: { id: string | null; nome: string | null }): Promise<ResultadoImportacao> {
  const e = lerEscrituracaoEcd(texto);
  if (!e.inicio || !e.fim || !e.lancamentos.length) throw new Error("O arquivo não parece uma ECD com lançamentos (registros 0000, I200 e I250).");
  if (e.avisos.length) throw new Error(`A ECD tem problemas: ${e.avisos.join(" ")}`);
  const { data: cfg } = await admin.from("fiscal_config").select("cnpj").eq("organization_id", org).maybeSingle();
  if (codigoChave(cfg?.cnpj ?? "") !== codigoChave(e.empresa.cnpj ?? "")) throw new Error(`Esta ECD é do CNPJ ${e.empresa.cnpj ?? "?"} e a empresa é ${cfg?.cnpj ?? "sem CNPJ na Configuração fiscal"}.`);
  const contas = await contasDoPlano(admin, plano);
  const porChave = new Map(contas.map((c) => [codigoChave(c.codigo), c]));
  const usadas = new Set([...e.saldosIniciais.map((s) => s.codigo), ...e.lancamentos.flatMap((l) => l.partidas.map((p) => p.codigo))]);
  const faltam = [...usadas].filter((c) => porChave.get(codigoChave(c))?.tipo !== "analitica");
  if (faltam.length) throw new Error(`${faltam.length} conta(s) da ECD não estão no plano como analíticas: ${faltam.slice(0, 8).join(", ")}${faltam.length > 8 ? "…" : ""}. Nada foi gravado.`);
  const id = (codigo: string) => porChave.get(codigoChave(codigo))!.id;
  const ano = e.inicio.slice(0, 4);

  const itensRef = [...e.referencial].filter(([c]) => porChave.has(codigoChave(c))).map(([c, referencial]) => ({ conta_id: id(c), referencial }));
  const { data: nRef, error: eRef } = await admin.rpc("contabil_plano_referencial", { p_org: org, p_plano: plano, p_itens: itensRef, p_autor: autor.id, p_autor_nome: autor.nome });
  if (eRef) throw new Error(`Referencial: ${eRef.message}`);

  const lote = [
    { data: e.abertura ?? e.inicio, historico: `Saldos de abertura do exercício de ${ano} (ECD do escritório)`, origem_tipo: "abertura", origem_ref: `ecd:${ano}:abertura`, encerramento: false,
      partidas: e.saldosIniciais.map((s) => ({ conta_id: id(s.codigo), lado: s.lado, valor: s.valor })) },
    ...e.lancamentos.map((l) => ({ data: l.data, historico: l.historico, origem_tipo: "historico_ecd", origem_ref: `ecd:${ano}:${l.numero}`, encerramento: l.encerramento,
      partidas: l.partidas.map((p) => ({ conta_id: id(p.codigo), lado: p.lado, valor: p.valor })) })),
  ].filter((l) => l.partidas.length >= 2);
  // O que já entrou (mesmo número da ECD) fica de fora antes de ir ao banco: com o ano já fechado, o banco recusaria
  // a tentativa antes de ver que é repetida.
  const ja = new Set<string>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from("contabil_lancamentos").select("origem_ref").eq("plano_id", plano).like("origem_ref", `ecd:${ano}:%`).order("origem_ref").range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) ja.add(x.origem_ref as string);
    if (!data || data.length < 1000) break;
  }
  const novos = lote.filter((l) => !ja.has(l.origem_ref));
  let gravados = 0;
  for (let i = 0; i < novos.length; i += LOTE) {
    const { data, error } = await admin.rpc("contabil_importar_lote", { p_org: org, p_plano: plano, p_lote: novos.slice(i, i + LOTE), p_autor: autor.id, p_autor_nome: autor.nome });
    if (error) throw new Error(`Lote ${i / LOTE + 1} de ${Math.ceil(novos.length / LOTE)}: ${error.message}`);
    gravados += Number(data ?? 0);
  }
  const abertura = lote[0]?.origem_tipo === "abertura" ? 1 : 0;
  return {
    ano, referencial: Number(nRef ?? 0), abertura, lancamentos: e.lancamentos.length, jaExistiam: lote.length - gravados,
    partidas: e.lancamentos.reduce((s, l) => s + l.partidas.length, 0), fim: e.fim, avisos: e.avisos,
  };
}
