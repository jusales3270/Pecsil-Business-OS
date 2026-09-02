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

  const response = await fetch("/api/rh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity: "document", objectPath, ...meta }),
  });
  if (response.status === 401) { throw new Error("UNAUTHENTICATED"); }
  if (!response.ok) {
    await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => {});
    throw new Error("RH_DOC_DENIED");
  }
  const { id } = (await response.json()) as { id: string };
  return { id, objectPath };
}

/** URL assinada de curta duração para visualizar/baixar um documento. */
export async function getRhDocumentUrl(objectPath: string): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 60);
  if (error) throw error;
  return data.signedUrl;
}
