import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  // Get user profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, avatar_path")
    .eq("user_id", user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo de imagem não enviado." }, { status: 400 });
  }

  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Formato inválido. Use JPG, PNG ou WebP." }, { status: 400 });
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json({ error: "A imagem deve ter no máximo 2 MB." }, { status: 400 });
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const avatarPath = `${profile.id}/avatar-${Date.now()}.${extension}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const admin = createSupabaseAdminClient();

  // Upload to Supabase Storage avatars bucket
  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(avatarPath, fileBuffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    console.error("Erro no upload de avatar para o Storage:", uploadError.message);
    return NextResponse.json(
      { error: `Falha ao salvar no storage: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Update profile record with new avatar path
  const { error: updateError } = await admin
    .from("profiles")
    .update({ avatar_path: avatarPath })
    .eq("id", profile.id);

  if (updateError) {
    console.error("Erro ao atualizar profile com avatar_path:", updateError.message);
    await admin.storage.from("avatars").remove([avatarPath]);
    return NextResponse.json({ error: "Falha ao vincular imagem ao perfil." }, { status: 500 });
  }

  // Delete previous avatar if existed and different
  if (profile.avatar_path && profile.avatar_path !== avatarPath) {
    void admin.storage.from("avatars").remove([profile.avatar_path]);
  }

  const avatarUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${avatarPath}`;

  return NextResponse.json({
    ok: true,
    avatarPath,
    avatarUrl,
  });
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, avatar_path")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();

  if (profile.avatar_path) {
    await admin.storage.from("avatars").remove([profile.avatar_path]);
    await admin.from("profiles").update({ avatar_path: null }).eq("id", profile.id);
  }

  return NextResponse.json({ ok: true });
}
