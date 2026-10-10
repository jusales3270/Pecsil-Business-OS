import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../supabase/admin";
import { caminhoDocumento } from "./setores";

/**
 * Guarda o arquivo original de um setor (Segundo Cérebro, Etapa 1; decisão D3: o original
 * fica guardado). O arquivo sobe com a chave mestra — o bucket não tem política para
 * usuários — e o registro é feito com a SESSÃO da pessoa, que confere a permissão do setor.
 * Se o registro falhar, o arquivo que acabou de subir é apagado. Mesmo arquivo já guardado
 * no setor não duplica.
 */

const BUCKET = "empresa-documentos";

export type Origem = "envio" | "extrato" | "nota" | "recebimento" | "coleta";

export type GuardarEntrada = {
  modulo: string;
  feature: string;
  arquivo: { nome: string; tipo?: string | null; dados: Uint8Array };
  origem: Origem;
  titulo?: string | null;
  categoria?: string | null;
  intakeId?: string | null;
  entidade?: { tipo: string; id: string } | null;
  anterior?: string | null;
};

export type Guardado = { id: string; existente: boolean; versao?: number };

export const sha256 = (dados: Uint8Array) => createHash("sha256").update(dados).digest("hex");

export async function guardarOriginal(supabase: SupabaseClient, e: GuardarEntrada): Promise<Guardado> {
  const { data: org, error: eOrg } = await supabase.rpc("current_organization_id");
  if (eOrg || !org) throw new Error("Sessão sem organização.");
  const hash = sha256(e.arquivo.dados);

  // Já guardado no setor (e ativo)? Não sobe de novo; só liga ao envio.
  if (!e.anterior) {
    const { data: igual } = await supabase.from("company_documents").select("id")
      .eq("module_code", e.modulo).eq("sha256", hash).is("superseded_by", null).is("archived_at", null).limit(1).maybeSingle();
    if (igual) {
      const { data } = await supabase.rpc("company_document_register", registro(e, hash, `${org}/${e.modulo}/ja-guardado`, null));
      return { id: (data as Guardado | null)?.id ?? igual.id, existente: true };
    }
  }

  const caminho = caminhoDocumento(String(org), e.modulo, randomUUID(), e.arquivo.nome);
  const admin = createSupabaseAdminClient();
  const { error: eUp } = await admin.storage.from(BUCKET).upload(caminho, e.arquivo.dados, {
    contentType: e.arquivo.tipo || "application/octet-stream",
    upsert: false,
  });
  if (eUp) throw new Error(`Não foi possível guardar o arquivo: ${eUp.message}`);

  const { data, error } = await supabase.rpc("company_document_register", registro(e, hash, caminho, e.arquivo.tipo ?? null));
  if (error) {
    await admin.storage.from(BUCKET).remove([caminho]);
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  const r = data as Guardado;
  if (r.existente) await admin.storage.from(BUCKET).remove([caminho]);
  return r;
}

function registro(e: GuardarEntrada, hash: string, caminho: string, tipo: string | null) {
  // Para o caso "já guardado" o caminho não é usado: a função devolve o documento existente.
  return {
    p_module: e.modulo, p_feature: e.feature, p_title: e.titulo ?? e.arquivo.nome, p_category: e.categoria ?? null,
    p_original_name: e.arquivo.nome, p_mime: tipo, p_size: e.arquivo.dados.byteLength, p_sha256: hash,
    p_storage_path: caminho,
    p_source: e.origem, p_intake: e.intakeId ?? null, p_entity_type: e.entidade?.tipo ?? null, p_entity_id: e.entidade?.id ?? null, p_previous: e.anterior ?? null,
  };
}

/** Link de download de 60 s — só depois que a rota conferiu, com a sessão, que a pessoa vê o documento. */
export async function linkDeDownload(caminho: string, nome: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(caminho, 60, { download: nome });
  if (error || !data?.signedUrl) throw new Error("Não foi possível gerar o link do arquivo.");
  return data.signedUrl;
}
