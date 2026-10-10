import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { guardarOriginal } from "../../../../../lib/documentos/guardar";
import { PdfInvalido } from "../../../../../lib/arquivos/pdf-texto";
import { DanfeInvalido } from "../../../../../lib/fiscal/danfe-pdf";
import { icmsColunas } from "../../../../../lib/fiscal/icms-campos";
import { NotaNaoReconhecida, fornecedorDaNota, lerNotaDoArquivo, type FornecedorCadastro, type NotaLida } from "../../../../../lib/fiscal/nota-carga";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ARQUIVOS = 40;
const LIMITE_TOTAL = 9_500_000;
const MES = /^\d{4}-\d{2}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

type Linha = {
  arquivo: string;
  ok: boolean;
  erro?: string;
  origem?: "xml" | "pdf";
  chave?: string;
  numero?: string;
  serie?: string;
  emissao?: string;
  emitente?: string;
  cnpj?: string;
  valor?: number;
  baseIcms?: number;
  icms?: number;
  ipi?: number;
  camposNaoLidos?: string[];
  situacao?: "nova" | "ja_no_painel" | "repetida_no_envio";
  fornecedor?: { id: string; nome: string; porCnpj: boolean; gravarCnpj: boolean } | null;
};

/**
 * Fiscal › Painel do ICMS › "Enviar notas": vários XML e/ou DANFE em PDF de uma vez.
 *   acao=analisar  → lê cada arquivo e mostra o que entraria (nada é gravado);
 *   acao=confirmar → lê de novo e lança no painel o que for novo (pela chave).
 * Centro (Fundição/Usinagem/Administrativo) e tipo ficam para a pessoa completar no painel.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Envie os arquivos das notas." }, { status: 400 });
  const arquivos = form.getAll("arquivo").filter((a): a is File => a instanceof File);
  const acao = String(form.get("acao") ?? "analisar");
  const mes = String(form.get("mes") ?? new Date().toISOString().slice(0, 7));
  const recebida = String(form.get("recebida") ?? new Date().toISOString().slice(0, 10));
  if (!arquivos.length) return NextResponse.json({ error: "Escolha ao menos um arquivo (XML ou PDF da nota)." }, { status: 400 });
  if (arquivos.length > MAX_ARQUIVOS) return NextResponse.json({ error: `Envie até ${MAX_ARQUIVOS} notas por vez.` }, { status: 400 });
  if (arquivos.reduce((s, a) => s + a.size, 0) > LIMITE_TOTAL) return NextResponse.json({ error: "Os arquivos juntos passam de 9,5 MB; envie em partes." }, { status: 413 });
  if (!MES.test(mes) || !DIA.test(recebida)) return NextResponse.json({ error: "Mês ou data de recebimento inválidos." }, { status: 400 });

  const { data: cadastro } = await guard.supabase.from("suppliers").select("id, name, tax_id").is("merged_into", null).limit(5000);
  const lidas: { arquivo: File; dados: Uint8Array; lida: NotaLida | null; erro?: string }[] = [];
  for (const arquivo of arquivos) {
    const dados = new Uint8Array(await arquivo.arrayBuffer());
    try {
      lidas.push({ arquivo, dados, lida: await lerNotaDoArquivo(dados) });
    } catch (e) {
      const conhecido = [NotaNaoReconhecida, DanfeInvalido, PdfInvalido].some((C) => e instanceof C);
      if (!conhecido) console.error("Falha ao ler nota", e);
      lidas.push({ arquivo, dados, lida: null, erro: conhecido ? (e as Error).message : "Não consegui ler este arquivo." });
    }
  }
  const chaves = lidas.flatMap((l) => (l.lida ? [l.lida.nfe.chave] : []));
  const { data: existentes } = chaves.length ? await guard.supabase.from("fiscal_icms_entries").select("chave").in("chave", chaves) : { data: [] };
  const jaNoPainel = new Set((existentes ?? []).map((e) => String(e.chave)));
  const vistas = new Set<string>();

  const linhas: Linha[] = lidas.map(({ arquivo, lida, erro }) => {
    if (!lida) return { arquivo: arquivo.name, ok: false, erro };
    const n = lida.nfe;
    const situacao: Linha["situacao"] = jaNoPainel.has(n.chave) ? "ja_no_painel" : vistas.has(n.chave) ? "repetida_no_envio" : "nova";
    vistas.add(n.chave);
    return {
      arquivo: arquivo.name, ok: true, origem: lida.origem, chave: n.chave, numero: n.numero, serie: n.serie, emissao: n.emissao,
      emitente: n.emitente.nome, cnpj: n.emitente.cnpj, valor: n.valorNota, baseIcms: n.baseIcms, icms: n.icms, ipi: n.ipi,
      camposNaoLidos: lida.camposNaoLidos, situacao, fornecedor: fornecedorDaNota(n, (cadastro ?? []) as FornecedorCadastro[]),
    };
  });
  const novas = linhas.filter((l) => l.ok && l.situacao === "nova");

  if (acao !== "confirmar") {
    return NextResponse.json({
      mes, recebida, linhas,
      resumo: { arquivos: linhas.length, novas: novas.length, jaNoPainel: linhas.filter((l) => l.situacao === "ja_no_painel").length, erros: linhas.filter((l) => !l.ok).length, valor: novas.reduce((s, l) => s + (l.valor ?? 0), 0), icms: novas.reduce((s, l) => s + (l.icms ?? 0), 0), pdf: novas.filter((l) => l.origem === "pdf").length, cnpjParaGravar: novas.filter((l) => l.fornecedor?.gravarCnpj).length },
    });
  }

  let lancadas = 0;
  let cnpjsGravados = 0;
  const falhas: string[] = [];
  const entradaPorChave = new Map<string, string>();
  for (const l of novas) {
    const resultado = icmsColunas({
      competencia: mes, emitida: l.emissao || null, recebida, fornecedor: l.emitente || "Fornecedor", fantasia: l.fornecedor?.nome ?? null,
      cnpj: l.cnpj ?? null, nfe: l.numero ?? null, serie: l.serie ?? null, chave: l.chave ?? null,
      valor: l.valor ?? 0, vlrCobrado: l.valor ?? 0, baseIcms: l.baseIcms ?? 0, icms: l.icms ?? 0, ipi: l.ipi ?? 0, xmlOk: l.origem === "xml",
      obs: l.origem === "pdf" ? "Lida do DANFE em PDF: conferir com a nota." : null,
    });
    if ("erro" in resultado) { falhas.push(`${l.arquivo}: ${resultado.erro}`); continue; }
    const { data: criada, error } = await guard.supabase.from("fiscal_icms_entries").insert({ ...resultado.colunas, origem: "manual", supplier_id: l.fornecedor?.id ?? null }).select("id").single();
    if (error) { falhas.push(`${l.arquivo}: ${error.code === "23505" ? "já está no painel" : "não foi possível lançar"}`); continue; }
    lancadas++;
    if (l.chave && criada?.id) entradaPorChave.set(l.chave, criada.id);
    if (l.fornecedor?.gravarCnpj && l.cnpj) {
      const { data } = await guard.supabase.rpc("supplier_set_tax_id_from_nfe", { p_supplier: l.fornecedor.id, p_cnpj: l.cnpj });
      if (data === true) cnpjsGravados++;
    }
  }
  let originaisFalharam = 0;
  for (const { arquivo, dados, lida } of lidas) {
    if (!lida) continue;
    const { data: intakeId } = await guard.supabase.rpc("file_intake_register", {
      p_feature: "fiscal.icms", p_module: "fiscal", p_kind: `nota-${lida.origem}`, p_name: arquivo.name, p_size: arquivo.size,
      p_sha256: createHash("sha256").update(dados).digest("hex"), p_summary: { chave: lida.nfe.chave, numero: lida.nfe.numero, valor: lida.nfe.valorNota },
    });
    // Original da nota lançada agora (D3): guardado no Fiscal, ligado à linha do Painel do ICMS.
    const entrada = entradaPorChave.get(lida.nfe.chave);
    if (!entrada) continue;
    try {
      await guardarOriginal(guard.supabase, {
        modulo: "fiscal", feature: "fiscal.icms", origem: "nota", intakeId: (intakeId as string | null) ?? null,
        entidade: { tipo: "fiscal_icms_entry", id: entrada },
        arquivo: { nome: arquivo.name, tipo: arquivo.type, dados },
        titulo: `NF ${lida.nfe.numero}${lida.nfe.serie ? `/${lida.nfe.serie}` : ""} · ${lida.nfe.emitente.nome} (${lida.origem === "xml" ? "XML" : "DANFE"})`,
        categoria: "Nota fiscal de entrada",
      });
    } catch (e) {
      originaisFalharam++;
      console.error("Nota lançada, mas o original não foi guardado", e);
    }
  }
  return NextResponse.json({
    lancadas, cnpjsGravados, falhas,
    mensagem: `${lancadas} ${lancadas === 1 ? "nota lançada" : "notas lançadas"} no Painel do ICMS${cnpjsGravados ? ` · CNPJ gravado em ${cnpjsGravados} ${cnpjsGravados === 1 ? "fornecedor" : "fornecedores"}` : ""}${falhas.length ? ` · ${falhas.length} com problema` : ""}. Complete centro e tipo no painel.${originaisFalharam ? ` ${originaisFalharam} arquivo(s) original(is) não foram guardados em Documentos.` : ""}`,
  });
}
