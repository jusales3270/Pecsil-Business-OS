"use client";

import { useRef, useState } from "react";
import { Button } from "../../packages/design-system";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import type { ModuleAccessContext } from "../../modules";
import type { SessionProfile } from "../../lib/data/use-session-access";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Minha conta: foto, nome e senha do próprio usuário.
 *
 * O e-mail é o login e NÃO é editável aqui — trocá-lo mudaria a credencial de
 * acesso, o que é operação de administração. Papel e escopo também são
 * somente leitura: um usuário editando o próprio papel seria escalada.
 */
export function AccountPanel({
  access,
  profile,
  onClose,
  onSaved,
  notify,
}: {
  access: ModuleAccessContext;
  profile: SessionProfile;
  onClose: () => void;
  onSaved: () => void;
  notify: (message: string) => void;
}) {
  const [fullName, setFullName] = useState(access.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [preview, setPreview] = useState<string | null>(profile.avatarUrl);
  const [busy, setBusy] = useState<"" | "avatar" | "name" | "password">("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function uploadAvatar(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      setError("Use uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("A imagem deve ter no máximo 2 MB.");
      return;
    }
    setBusy("avatar");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/me/avatar", {
        method: "POST",
        body: formData,
      });

      setBusy("");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Não foi possível salvar a foto.");
        return;
      }

      const result = await response.json();
      setPreview(result.avatarUrl || URL.createObjectURL(file));
      notify("Foto de perfil atualizada.");
      onSaved();
    } catch {
      setBusy("");
      setError("Falha de conexão ao enviar a foto.");
    }
  }

  async function saveName() {
    if (fullName.trim() === access.name) return;
    setBusy("name");
    setError("");
    const response = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName }),
    });
    setBusy("");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível salvar o nome.");
      return;
    }
    notify("Nome atualizado.");
    onSaved();
  }

  async function savePassword() {
    setBusy("password");
    setError("");
    const response = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setBusy("");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível trocar a senha.");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    notify("Senha alterada.");
  }

  return (
    <div className="employee-layer form-layer">
      <form
        className="user-admin-form account-form"
        onSubmit={(event) => event.preventDefault()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">MINHA CONTA</p>
            <h2>{access.name}</h2>
            <p>{profile.email || "—"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        {/* --- Foto --------------------------------------------------------- */}
        <section className="account-avatar">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`Foto de ${access.name}`} />
          ) : (
            <span className="account-avatar-initials">{access.initials}</span>
          )}
          <div>
            <b>Foto de perfil</b>
            <small>JPG, PNG ou WebP, até 2 MB.</small>
            <div className="account-avatar-actions">
              <Button
                variant="secondary"
                disabled={busy === "avatar"}
                onClick={() => fileInput.current?.click()}
              >
                {busy === "avatar" ? "Enviando…" : preview ? "Trocar foto" : "Enviar foto"}
              </Button>
              {preview && (
                <button
                  type="button"
                  className="employee-cancel"
                  disabled={busy === "avatar"}
                  onClick={async () => {
                    setBusy("avatar");
                    await fetch("/api/me/avatar", {
                      method: "DELETE",
                    });
                    setBusy("");
                    setPreview(null);
                    notify("Foto removida.");
                    onSaved();
                  }}
                >
                  Remover
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED.join(",")}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAvatar(file);
              event.target.value = "";
            }}
          />
        </section>

        <div className="user-admin-fields">
          {/* --- Nome ------------------------------------------------------- */}
          <label className="field-wide">
            <span>Nome de exibição</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>
          <div className="user-admin-actions field-wide">
            <Button
              variant="secondary"
              disabled={busy === "name" || fullName.trim().length < 2 || fullName.trim() === access.name}
              onClick={saveName}
            >
              {busy === "name" ? "Salvando…" : "Salvar nome"}
            </Button>
          </div>

          {/* --- Senha ------------------------------------------------------ */}
          <label>
            <span>Senha atual</span>
            <input
              type={showPasswords ? "text" : "password"}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            <span>Nova senha</span>
            <span className="user-admin-password">
              <input
                type={showPasswords ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPasswords((current) => !current)}>
                {showPasswords ? "Ocultar" : "Ver"}
              </button>
            </span>
          </label>
          <div className="user-admin-actions field-wide">
            <Button
              variant="secondary"
              disabled={busy === "password" || newPassword.length < 8 || currentPassword.length === 0}
              onClick={savePassword}
            >
              {busy === "password" ? "Trocando…" : "Trocar senha"}
            </Button>
          </div>

          {/* --- Somente leitura -------------------------------------------- */}
          <div className="user-admin-note field-wide">
            <span>🔒</span>
            <span>
              <b>
                {access.role} · {access.scopeLabel}
              </b>
              <small>
                O e-mail de acesso, o papel e o escopo são definidos pela administração e não podem
                ser alterados aqui.
              </small>
            </span>
          </div>

          {error && <p className="user-admin-error field-wide">{error}</p>}
        </div>

        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </form>
    </div>
  );
}
