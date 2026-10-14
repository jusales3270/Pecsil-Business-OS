import { NextResponse } from "next/server";
import { requireUserSession } from "../../../lib/supabase/session";

export const dynamic = "force-dynamic";

const FONTES = new Set(["acao", "evento", "login", "tela"]);
type Linha = {
  fonte: string; quando: string; pessoa_id: string | null; pessoa_nome: string | null; pessoa_email: string | null; modulo: string; acao: string;
  resumo: string; entidade_tipo: string | null; entidade_id: string | null; risco: string; detalhes: Record<string, unknown> | null;
};

/**
 * Fundação › Auditoria: a trilha unificada — ações (quem lançou, alterou, excluiu, aprovou),
 * eventos do negócio, entradas no sistema e telas abertas. Proprietário ou Fundação › Auditoria
 * (o banco confere). Filtros: dias ou desde/ate, pessoa, modulo, fonte, busca, entidade (o caminho
 * de um registro). ?formato=csv exporta.
 */
export async function GET(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const p = new URL(request.url).searchParams;
  const dias = Math.min(Math.max(Number(p.get("dias")) || 30, 1), 400);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(p.get("ate") ?? "") ? new Date(`${p.get("ate")}T23:59:59-03:00`) : new Date();
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(p.get("desde") ?? "") ? new Date(`${p.get("desde")}T00:00:00-03:00`) : new Date(ate.getTime() - dias * 86_400_000);
  const fonte = p.get("fonte");
  const pessoa = p.get("pessoa");
  const csv = p.get("formato") === "csv";
  const { data, error } = await session.supabase.rpc("auditoria_trilha", {
    p_desde: desde.toISOString(), p_ate: ate.toISOString(),
    p_pessoa: pessoa && /^[0-9a-f-]{36}$/i.test(pessoa) ? pessoa : null,
    p_modulo: (p.get("modulo") ?? "").slice(0, 40) || null,
    p_fonte: fonte && FONTES.has(fonte) ? fonte : null,
    p_busca: (p.get("busca") ?? "").slice(0, 80) || null,
    p_entidade: (p.get("entidade") ?? "").slice(0, 80) || null,
    p_limite: csv ? 2000 : 400,
    // Os usuários temporários dos testes ficam fora, salvo pedido explícito (?testes=1).
    p_incluir_testes: p.get("testes") === "1",
  });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "Sem permissão para a auditoria." : error.message }, { status: error.code === "42501" ? 403 : 400 });
  const linhas = (data ?? []) as Linha[];

  if (csv) {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const corpo = [
      ["Quando", "Pessoa", "E-mail", "Fonte", "Módulo", "Ação", "Resumo", "Registro", "Detalhes"].map(esc).join(";"),
      ...linhas.map((l) => [
        new Date(l.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), l.pessoa_nome ?? "sistema", l.pessoa_email ?? "", l.fonte, l.modulo, l.acao, l.resumo,
        l.entidade_id ? `${l.entidade_tipo ?? ""} ${l.entidade_id}` : "", l.detalhes ? JSON.stringify(l.detalhes) : "",
      ].map(esc).join(";")),
    ].join("\r\n");
    return new NextResponse(`﻿${corpo}`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="auditoria-${desde.toISOString().slice(0, 10)}-a-${ate.toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  }

  const { data: pessoas } = await session.supabase.rpc("auditoria_ultimos_acessos");
  const { data: perfis } = await session.supabase.from("profiles").select("id, full_name, email").order("full_name");
  return NextResponse.json({
    linhas,
    desde: desde.toISOString(), ate: ate.toISOString(),
    pessoas: (perfis ?? []).filter((x) => !String(x.email ?? "").endsWith("@pecsil-teste.local")),
    ultimos: pessoas ?? [],
  });
}
