import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { guardarOriginal } from "../../../../../lib/documentos/guardar";
import { PdfInvalido } from "../../../../../lib/arquivos/pdf-texto";
import { XlsxInvalido } from "../../../../../lib/arquivos/xlsx";
import { ROTULO_CATEGORIA } from "../../../../../lib/finance/extrato-classificar";
import {
  ExtratoNaoReconhecido, SEM_BAIXA, buscarBaixasLivres, casarComBaixas, chavesJaImportadas, conferirSaldos,
  contaDoExtrato, lerExtratoDoArquivo, montarLotes, prepararLancamentos, resumoPorCategoria,
} from "../../../../../lib/finance/extrato-carga";
import { ExtratoPdfInvalido } from "../../../../../lib/finance/extrato-itau-pdf";
import { PlanilhaInvalida } from "../../../../../lib/finance/extrato-planilha";
import { OfxInvalido } from "../../../../../lib/finance/ofx-parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 9_500_000;
const LEITURA = [ExtratoNaoReconhecido, PdfInvalido, XlsxInvalido, OfxInvalido, PlanilhaInvalida, ExtratoPdfInvalido];

/**
 * Financeiro › Bancos e conciliação › "Enviar extrato".
 *   acao=analisar  → lê o arquivo, confere os saldos e mostra o que vai acontecer (nada é gravado);
 *   acao=confirmar → lê o MESMO arquivo de novo (nunca confia em dados vindos do navegador) e grava.
 * O arquivo original fica guardado no setor Financeiro (decisão D3 do proprietário, 10/10/2026),
 * ligado ao registro do envio (nome, tamanho, sha256, resumo).
 */
export async function POST(request: Request) {
  const guard = await requireFeature("financeiro.bancos", "operar");
  if ("error" in guard) return guard.error;

  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const acao = String(form?.get("acao") ?? "analisar");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Escolha o arquivo do extrato." }, { status: 400 });
  if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo grande demais (máximo 9,5 MB)." }, { status: 413 });
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const sha256 = createHash("sha256").update(dados).digest("hex");

  let extrato;
  try {
    extrato = await lerExtratoDoArquivo(dados);
  } catch (e) {
    if (LEITURA.some((C) => e instanceof C)) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    console.error("Falha ao ler extrato", e);
    return NextResponse.json({ error: "Não consegui ler este arquivo." }, { status: 400 });
  }

  const conferencia = conferirSaldos(extrato);
  const saldoConfere = conferencia.divergentes.length === 0 && !extrato.saldoCorridoDivergente;
  const conta = contaDoExtrato(extrato);
  const lancamentos = prepararLancamentos(extrato);
  try {
    const { contaId, existentes } = await chavesJaImportadas(guard.supabase, conta, lancamentos.map((l) => l.externalId));
    const novos = lancamentos.filter((l) => !existentes.has(l.externalId));
    const baixas = novos.length ? await buscarBaixasLivres(guard.supabase, extrato.inicio ?? novos[0].data, extrato.fim ?? novos[novos.length - 1].data) : [];
    const resultado = casarComBaixas(novos, baixas);
    const niveis = { 1: 0, 2: 0, 3: 0 };
    for (const v of resultado.vinculos) niveis[v.nivel]++;
    const porId = new Map(novos.map((l) => [l.id, l]));
    const valorConciliado = resultado.vinculos.reduce((s, v) => s - (porId.get(v.entradaId)?.centavos ?? 0), 0);
    const ignorados = novos.filter((l) => SEM_BAIXA.has(l.categoria)).length;

    if (acao === "confirmar") {
      if (!saldoConfere) return NextResponse.json({ error: "Os saldos do arquivo não fecham; nada foi gravado." }, { status: 400 });
      if (!novos.length) return NextResponse.json({ gravados: 0, conciliados: 0, mensagem: "Nada novo: todos os lançamentos deste arquivo já estavam na plataforma." });
      const lotes = montarLotes(novos, resultado, baixas, extrato.formato);
      let gravados = 0, conciliados = 0;
      for (const [i, lote] of lotes.entries()) {
        const ultimo = i === lotes.length - 1;
        const resumo = ultimo ? { arquivo: arquivo.name.slice(0, 120), novos: novos.length, inicio: extrato.inicio, fim: extrato.fim, conciliados: resultado.vinculos.length, origem: "tela" } : null;
        const { data, error } = await guard.supabase.rpc("finance_import_bank_statement", { p_account: conta, p_entries: lote.entries, p_links: lote.links, p_summary: resumo });
        if (error) {
          console.error("Falha ao gravar extrato", error);
          return NextResponse.json({ error: error.code === "42501" ? error.message : `Falha ao gravar (lote ${i + 1} de ${lotes.length}). Os lotes anteriores ficaram gravados; envie o arquivo de novo para continuar.` }, { status: error.code === "42501" ? 403 : 500 });
        }
        gravados += Number((data as { inserted?: number }).inserted ?? 0);
        conciliados += Number((data as { linked?: number }).linked ?? 0);
      }
      const { data: intakeId } = await guard.supabase.rpc("file_intake_register", {
        p_feature: "financeiro.bancos", p_module: "financeiro", p_kind: `extrato-${extrato.formato}`, p_name: arquivo.name, p_size: arquivo.size, p_sha256: sha256,
        p_summary: { banco: extrato.nomeBanco, conta: `${conta.branch}/${conta.account_number}`, inicio: extrato.inicio, fim: extrato.fim, gravados, conciliados },
      });
      // Original guardado (D3). Se falhar, o extrato já está gravado: só avisa.
      let aviso = "";
      try {
        await guardarOriginal(guard.supabase, {
          modulo: "financeiro", feature: "financeiro.bancos", origem: "extrato", intakeId: (intakeId as string | null) ?? null,
          arquivo: { nome: arquivo.name, tipo: arquivo.type, dados },
          titulo: `Extrato ${extrato.nomeBanco} ${conta.branch}/${conta.account_number}${extrato.inicio ? ` · ${extrato.inicio.split("-").reverse().join("/")} a ${(extrato.fim ?? "").split("-").reverse().join("/")}` : ""}`,
          categoria: "Extrato bancário",
        });
      } catch (e) {
        console.error("Extrato gravado, mas o original não foi guardado", e);
        aviso = " O arquivo original não pôde ser guardado em Documentos; envie de novo por lá se precisar.";
      }
      return NextResponse.json({ gravados, conciliados, mensagem: `Extrato ${extrato.nomeBanco} importado: ${gravados} lançamentos novos, ${conciliados} conciliados automaticamente.${aviso}` });
    }

    const { data: anterior } = await guard.supabase
      .from("file_intakes")
      .select("created_at, file_name, profiles:uploaded_by_profile_id(full_name)")
      .eq("sha256", sha256)
      .order("created_at", { ascending: false })
      .limit(1);
    const ultimoEnvio = anterior?.[0] as { created_at: string; file_name: string; profiles?: { full_name?: string } | null } | undefined;

    return NextResponse.json({
      banco: extrato.nomeBanco,
      formato: extrato.formato,
      conta: { agencia: conta.branch, numero: conta.account_number, digito: conta.account_digit, existe: Boolean(contaId) },
      periodo: { inicio: extrato.inicio, fim: extrato.fim },
      lancamentos: lancamentos.length,
      entradas: lancamentos.filter((l) => l.centavos > 0).reduce((s, l) => s + l.centavos, 0) / 100,
      saidas: lancamentos.filter((l) => l.centavos < 0).reduce((s, l) => s - l.centavos, 0) / 100,
      saldo: {
        confere: saldoConfere,
        diasConferidos: conferencia.dias,
        divergentes: conferencia.divergentes.slice(0, 5).map((d) => ({ data: d.data, banco: d.esperado / 100, calculado: d.calculado / 100 })),
        final: conferencia.saldoCalculado / 100,
        informado: extrato.saldoFinal === null ? null : extrato.saldoFinal / 100,
      },
      novos: novos.length,
      jaImportados: existentes.size,
      conciliacao: { conciliados: resultado.vinculos.length, nivel1: niveis[1], nivel2: niveis[2], nivel3: niveis[3], valor: valorConciliado / 100 },
      ignorados,
      paraRevisar: novos.length - ignorados - resultado.vinculos.length,
      categorias: resumoPorCategoria(novos).map((r) => ({ rotulo: ROTULO_CATEGORIA[r.categoria], quantidade: r.quantidade, entradas: r.entradas / 100, saidas: r.saidas / 100 })),
      avisos: extrato.avisos ?? [],
      envioAnterior: ultimoEnvio ? { quando: ultimoEnvio.created_at, nome: ultimoEnvio.file_name, quem: ultimoEnvio.profiles?.full_name ?? null } : null,
    });
  } catch (e) {
    console.error("Falha ao analisar extrato", e);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }
}
