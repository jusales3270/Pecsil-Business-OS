"use client";

import { createSupabaseBrowserClient } from "../supabase/client";

const BUCKET = "rh-documents";

export type RhDocumentUpload = {
  title: string;
  category: string;
  employeeId: string | null;
  sensitive: boolean;
  signature: "signed" | "pending" | "not_required" | null;
  reviewDueAt: string | null;
};

/**
 * Envia o arquivo direto ao Storage (RLS do bucket) e grava os metadados.
 * Padrão do Supabase: o binário não passa pelo servidor da app. Caminho:
 * {organizationId}/{pasta}/{arquivo}, coerente com a RLS que isola por org.
 * Se a gravação dos metadados falhar, remove o arquivo já enviado.
 */
export async function uploadRhDocument(
  file: File,
  meta: RhDocumentUpload,
  organizationId: string,
): Promise<{ id: string; objectPath: string }> {
  const supabase = createSupabaseBrowserClient();
  const folder = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const objectPath = `${organizationId}/${folder}/${safeName}`;

  const upload = await supabase.storage.from(BUCKET).upload(objectPath, file, { upsert: false });
  if (upload.error) throw upload.error;

  // Qualquer falha depois do envio (recusa, sessão, rede) remove o arquivo:
  // antes, uma falha de rede deixava o arquivo solto no armazenamento.
  try {
    const response = await fetch("/api/rh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "document", objectPath, ...meta }),
    });
    if (response.status === 401) throw new Error("UNAUTHENTICATED");
    if (!response.ok) throw new Error("RH_DOC_DENIED");
    const { id } = (await response.json()) as { id: string };
    return { id, objectPath };
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => {});
    throw error;
  }
}

/** URL assinada de curta duração para visualizar/baixar um documento. */
export async function getRhDocumentUrl(objectPath: string): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 60);
  if (error) throw error;
  return data.signedUrl;
}

export type RhEmployeeDocument = {
  id: string;
  title: string;
  category: string;
  version: string;
  objectPath: string;
  reviewDueAt: string | null;
  updatedAt: string;
  sensitive: boolean;
};

/**
 * Documentos de um colaborador, para a aba Documentos da ficha. A leitura é
 * do banco, com a sessão do usuário: a mesma regra da central de documentos
 * (`documents_read`: rh.documentos; confidenciais só com o nível exigido).
 */
export async function listRhEmployeeDocuments(employeeId: string): Promise<RhEmployeeDocument[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id,title,category,version,object_path,review_due_at,classification,updated_at")
    .eq("employee_id", employeeId)
    .eq("module_code", "rh")
    .eq("active", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    category: String(row.category ?? "—"),
    version: String(row.version ?? "1"),
    objectPath: row.object_path ? String(row.object_path) : "",
    reviewDueAt: row.review_due_at ? String(row.review_due_at) : null,
    updatedAt: new Date(String(row.updated_at)).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    sensitive: row.classification === "confidential" || row.classification === "restricted",
  }));
}

/**
 * Exclui um documento: o registro e o arquivo. RLS: `documents_manage` e
 * `rh_docs_objects_delete` exigem rh.documentos em "operar". Registro
 * primeiro — se a RLS recusar, o arquivo fica intacto.
 */
export async function deleteRhDocument(id: string, objectPath: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("documents").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("RH_MUTATION_DENIED");
  if (objectPath) await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => {});
}

export type RhPersonalData = { cpf: string | null; phone: string | null; visible: boolean };

/**
 * CPF e telefone do colaborador (tabela protegida). Sem permissão, a RLS não
 * devolve a linha: `visible` = false e a ficha mostra "Restrito ao RH".
 */
export async function getRhEmployeePersonalData(employeeId: string): Promise<RhPersonalData> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("rh_employee_personal_data").select("cpf, phone").eq("employee_id", employeeId).maybeSingle();
  if (error) throw error;
  if (!data) return { cpf: null, phone: null, visible: false };
  return { cpf: data.cpf ? String(data.cpf) : null, phone: data.phone ? String(data.phone) : null, visible: true };
}

/** 12345678901 → 123.456.789-01 */
export function formatCpf(cpf: string | null): string {
  const d = (cpf ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf ?? "";
}
