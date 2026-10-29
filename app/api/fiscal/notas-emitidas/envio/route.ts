import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { receitaPorMes } from "../../../../../lib/contabil/apuracao/receita";
import { guardarOriginal, sha256 } from "../../../../../lib/documentos/guardar";
import { tipoDoArquivo } from "../../../../../lib/arquivos/detectar";
import { autorDaSessao } from "../../../../../lib/fiscal/emissao/servidor";
import { classificarEnvio, lacunasDaNumeracao, lerEventoNfe, lerNfeEmitida, naturezaDaSaida, numeroDaChave, rotuloMes, type ArquivoLido, type LinhaEnvio } from "../../../../../lib/fiscal/emitidas-envio";
import { lerNotaDoArquivo } from "../../../../../lib/fiscal/nota-carga";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › Notas emitidas › "Enviar notas do mês": as notas que a empresa emitiu FORA da plataforma (GRV), em XML
 * e/ou PDF, de qualquer mês (até retroativo). É daqui que sai a receita do Lucro Presumido.
 *   GET ?mes=AAAA-MM        → as notas do mês já na plataforma e os números que faltam;
 *   POST acao=analisar      → lê cada arquivo e mostra o que entraria (nada é gravado);
 *   POST acao=confirmar     → lê de novo e guarda em Documentos › Fiscal o que for novo (a leitura é feita na hora).
 * Nota já na plataforma (mesma chave ou mesmo arquivo), repetida no envio, de outro mês ou de outra empresa não entra.
 */
const MES = /^\d{4}-\d{2}$/;
const MAX_ARQUIVOS = 200;
const LIMITE_TOTAL = 9_500_000;
const CATEGORIA = "NF-e emitida";
const ENTIDADE = "fiscal_emitidas_mes";

async function cnpjDaEmpresa(org: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("fiscal_config").select("cnpj").eq("organization_id", org).maybeSingle();
  const cnpj = (data?.cnpj ?? "").replace(/\D/g, "");
  return cnpj.length === 14 ? cnpj : null;
}

/** Notas da empresa já lidas no mês (a que vale de cada chave). */
async function notasDoMes(org: string, cnpj: string, mes: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("fiscal_ibscbs_notas").select("chave, numero, lado, emissao, v_nf, receita, destinatario_cnpj, document_id, nfe_id, cancelada_em")
    .eq("organization_id", org).eq("competencia", mes).eq("emitente_cnpj", cnpj).is("repetida_de", null).order("numero").limit(5000);
  return (data ?? []) as { chave: string | null; numero: string | null; lado: "entrada" | "saida" | "outra"; emissao: string | null; v_nf: number; receita: { porCfop: Record<string, number> } | null; destinatario_cnpj: string | null; document_id: string | null; nfe_id: string | null; cancelada_em: string | null }[];
}

export async function GET(request: Request) {
  const guard = await requireFeature("fiscal.nfe");
  if ("error" in guard) return guard.error;
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem empresa." }, { status: 403 });
  const mes = new URL(request.url).searchParams.get("mes") ?? "";
  if (!MES.test(mes)) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  const cnpj = await cnpjDaEmpresa(autor.org);
  if (!cnpj) return NextResponse.json({ error: "Configure o CNPJ da empresa em Fiscal › Configuração." }, { status: 409 });
  const admin = createSupabaseAdminClient();
  const [notas, { data: docs }, { data: clientes }] = await Promise.all([
    notasDoMes(autor.org, cnpj, mes),
    admin.from("company_documents").select("id, title, original_name, mime_type, created_at, uploaded_by_name").eq("organization_id", autor.org).eq("entity_type", ENTIDADE).eq("entity_id", mes).is("archived_at", null).order("created_at"),
    admin.from("customers").select("tax_id, name").eq("organization_id", autor.org).not("tax_id", "is", null).limit(5000),
  ]);
  const nomeDo = new Map((clientes ?? []).map((c) => [String(c.tax_id).replace(/\D/g, ""), String(c.name)]));
  // Cancelada aparece na lista (marcada), mas não entra na receita.
  const receita = receitaPorMes(notas.filter((n) => !n.cancelada_em).map((n) => ({ lado: n.lado, competencia: mes, receita: n.receita })))[0] ?? null;
  // Evento guardado sem o XML da nota (o título diz de que nota é): o número aparece como "só o evento".
  const soEvento = (docs ?? []).flatMap((d) => /^(?:Carta de correção|Evento) da NF (\d+)/.exec(String(d.title ?? ""))?.[1] ?? []);
  return NextResponse.json({
    mes,
    notas: notas.map((n) => ({
      numero: n.numero, chave: n.chave, emissao: n.emissao, valor: Number(n.v_nf),
      tipo: n.cancelada_em ? "cancelada" : n.lado === "entrada" ? "entrada_propria" : naturezaDaSaida(n.receita?.porCfop ?? {}),
      destinatario: n.destinatario_cnpj ? nomeDo.get(n.destinatario_cnpj) ?? n.destinatario_cnpj : null,
      origem: n.nfe_id ? "plataforma" : "arquivo",
    })),
    receita,
    lacunas: lacunasDaNumeracao(notas.map((n) => n.numero), soEvento),
    arquivos: (docs ?? []).length,
  });
}

export async function POST(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "operar");
  if ("error" in guard) return guard.error;
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem empresa." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Envie os arquivos das notas." }, { status: 400 });
  const arquivos = form.getAll("arquivo").filter((a): a is File => a instanceof File);
  const acao = String(form.get("acao") ?? "analisar");
  const mes = String(form.get("mes") ?? "");
  if (!MES.test(mes)) return NextResponse.json({ error: "Escolha o mês das notas." }, { status: 400 });
  if (!arquivos.length) return NextResponse.json({ error: "Escolha ao menos um arquivo (XML ou PDF da nota)." }, { status: 400 });
  if (arquivos.length > MAX_ARQUIVOS) return NextResponse.json({ error: `Envie até ${MAX_ARQUIVOS} arquivos por vez.` }, { status: 400 });
  if (arquivos.reduce((s, a) => s + a.size, 0) > LIMITE_TOTAL) return NextResponse.json({ error: "Os arquivos juntos passam de 9,5 MB; envie em partes." }, { status: 413 });
  const cnpj = await cnpjDaEmpresa(autor.org);
  if (!cnpj) return NextResponse.json({ error: "Configure o CNPJ da empresa em Fiscal › Configuração antes de enviar as notas." }, { status: 409 });

  // Leitura de cada arquivo.
  const lidos: { arquivo: File; dados: Uint8Array; lido: ArquivoLido }[] = [];
  for (const arquivo of arquivos) {
    const dados = new Uint8Array(await arquivo.arrayBuffer());
    const tipo = tipoDoArquivo(dados);
    let lido: ArquivoLido | null = null;
    try {
      if (tipo === "nfe-xml" || tipo === "xml") {
        const xml = new TextDecoder("utf-8").decode(dados);
        lido = lerNfeEmitida(arquivo.name, xml, cnpj) ?? lerEventoNfe(arquivo.name, xml);
      } else if (tipo === "pdf") {
        const n = await lerNotaDoArquivo(dados);
        if (n.modelo === "nfe") lido = { nome: arquivo.name, tipo: "danfe", chave: n.nfe.chave || null, numero: n.nfe.numero || null, emissao: n.nfe.emissao || null, emitenteCnpj: n.nfe.emitente.cnpj || null, destinatario: null, valor: n.nfe.valorNota };
      }
    } catch {
      lido = null;
    }
    lidos.push({ arquivo, dados, lido: lido ?? { nome: arquivo.name, tipo: "erro", erro: tipo === "pdf" ? "PDF que não é DANFE de NF-e: não entra." : "Não é XML de NF-e, evento da NF-e nem DANFE: não entra." } });
  }

  // O que já está na plataforma: a nota (chave lida ou emitida pela plataforma) e o mesmo arquivo no Fiscal.
  const admin = createSupabaseAdminClient();
  const chaves = [...new Set(lidos.flatMap(({ lido }) => (lido.tipo === "nfe" && lido.chave ? [lido.chave] : [])))];
  const hashes = lidos.map(({ dados }) => sha256(dados));
  const [{ data: lidas }, { data: emitidas }, { data: iguais }] = await Promise.all([
    chaves.length ? admin.from("fiscal_ibscbs_notas").select("chave").eq("organization_id", autor.org).in("chave", chaves).is("repetida_de", null) : Promise.resolve({ data: [] as { chave: string }[] }),
    chaves.length ? admin.from("fiscal_nfe").select("chave").eq("organization_id", autor.org).eq("ambiente", "producao").eq("situacao", "autorizada").in("chave", chaves) : Promise.resolve({ data: [] as { chave: string }[] }),
    admin.from("company_documents").select("sha256").eq("organization_id", autor.org).eq("module_code", "fiscal").in("sha256", [...new Set(hashes)]).is("superseded_by", null).is("archived_at", null),
  ]);
  const jaNaPlataforma = new Set([...(lidas ?? []), ...(emitidas ?? [])].map((x) => String(x.chave)));
  const guardados = new Set((iguais ?? []).map((x) => String(x.sha256)));
  const linhas = classificarEnvio(lidos.map((l) => l.lido), { mes, cnpjEmpresa: cnpj, jaNaPlataforma, arquivoJaGuardado: hashes.map((h) => guardados.has(h)) });

  // Resumo: receita das notas novas e os números que faltam no mês (contando as que já estão na plataforma).
  const novasNfe = lidos.filter((l, i) => linhas[i].entra && l.lido.tipo === "nfe").map((l) => l.lido as Extract<ArquivoLido, { tipo: "nfe" }>);
  const receita = receitaPorMes(novasNfe.map((n) => ({ lado: n.tpNF === "0" && n.finNFe !== "4" ? "entrada" as const : "saida" as const, competencia: mes, receita: { porCfop: n.porCfop } })))[0] ?? null;
  const doMes = await notasDoMes(autor.org, cnpj, mes);
  const numeros = [...doMes.map((n) => n.numero), ...novasNfe.map((n) => n.numero)];
  const soEvento = linhas.filter((l) => l.situacao === "evento").map((l) => l.numero);
  const lacunas = lacunasDaNumeracao(numeros, soEvento);
  const conta = (s: LinhaEnvio["situacao"]) => linhas.filter((l) => l.situacao === s).length;
  const resumo = {
    arquivos: linhas.length, entram: linhas.filter((l) => l.entra).length, saidas: conta("saida"), entradasProprias: conta("entrada_propria"),
    eventos: conta("evento"), danfes: conta("danfe"), jaNaPlataforma: conta("ja_na_plataforma"), repetidas: conta("repetida_no_envio"),
    outroMes: conta("outro_mes"), outraEmpresa: conta("outra_empresa"), naoReconhecidos: conta("nao_reconhecido"),
    remessas: linhas.filter((l) => l.natureza === "remessa").length,
    receita: receita ? { industria: receita.industria, exportacao: receita.exportacao, servicos: receita.servicos, devolucoes: receita.devolucoes } : null,
    jaNoMes: doMes.length,
  };

  if (acao !== "confirmar") return NextResponse.json({ mes, rotuloMes: rotuloMes(mes), linhas, resumo, lacunas });

  let guardadas = 0;
  let jaExistiam = 0;
  const falhas: string[] = [];
  for (let i = 0; i < lidos.length; i++) {
    const { arquivo, dados, lido } = lidos[i];
    const linha = linhas[i];
    if (!linha.entra) continue;
    const numero = linha.numero ?? (lido.tipo === "evento" ? numeroDaChave(lido.chave) : null);
    const titulo = lido.tipo === "evento"
      ? `${lido.evento === "110110" ? "Carta de correção" : "Evento"} da NF ${numero ?? "?"} (${rotuloMes(mes)})`
      : `NF ${numero ?? "?"}${linha.destinatario ? ` · ${linha.destinatario}` : ""} (${lido.tipo === "danfe" ? "PDF" : "XML"})`;
    try {
      const r = await guardarOriginal(guard.supabase, {
        modulo: "fiscal", feature: "fiscal.nfe", origem: "envio", categoria: CATEGORIA, titulo: titulo.slice(0, 200),
        entidade: { tipo: ENTIDADE, id: mes },
        arquivo: { nome: arquivo.name, tipo: arquivo.type || (lido.tipo === "danfe" ? "application/pdf" : "text/xml"), dados },
      });
      if (r.existente) jaExistiam++; else guardadas++;
    } catch (e) {
      falhas.push(`${arquivo.name}: ${e instanceof Error ? e.message.slice(0, 120) : "não foi possível guardar"}`);
    }
  }
  const partes = [`${guardadas} ${guardadas === 1 ? "arquivo guardado" : "arquivos guardados"} em ${rotuloMes(mes)}`];
  if (jaExistiam) partes.push(`${jaExistiam} já estava${jaExistiam === 1 ? "" : "m"} na plataforma`);
  if (falhas.length) partes.push(`${falhas.length} com falha (${falhas.slice(0, 3).join("; ")})`);
  return NextResponse.json({ mensagem: `${partes.join(", ")}.`, guardadas, jaExistiam, falhas }, { status: falhas.length && !guardadas ? 500 : 200 });
}
