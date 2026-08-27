"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) {
      setMessage("A conexão segura com o Supabase ainda não foi configurada.");
      return;
    }

    setLoading(true);
    setMessage("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setMessage("E-mail ou senha inválidos.");
      return;
    }

    window.location.assign("/");
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <img className="brand-logo light" src="/pecsil-logo.png" alt="Pecsil — Molds for Glass" /><img className="brand-logo dark" src="/pecsil-logo-dark.png" alt="" aria-hidden="true" />
          <div>
            <b>BUSINESS OS</b>
            <small>Ecossistema empresarial</small>
          </div>
        </div>
        <div className="login-heading">
          <span>ACESSO CORPORATIVO</span>
          <h1>Bem-vindo</h1>
          <p>Entre com sua identidade Pecsil para acessar os módulos autorizados.</p>
        </div>
        <form onSubmit={signIn}>
          <label>
            <span>E-mail corporativo</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="nome@pecsil.com.br"
              required
            />
          </label>
          <label>
            <span>Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Sua senha"
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? "Validando acesso..." : "Entrar no sistema"}
          </button>
          {message && <p className="login-message" role="alert">{message}</p>}
        </form>
        <div className={`login-connection ${configured ? "ready" : "pending"}`}>
          <i />
          <span>
            <b>{configured ? "Autenticação disponível" : "Ambiente em preparação"}</b>
            <small>
              {configured
                ? "Conexão protegida por Supabase Auth e RLS."
                : "O acesso será liberado após a conexão do Supabase interno."}
            </small>
          </span>
        </div>
      </section>

      <aside className="login-visual">
        {/* Vídeo de fundo leve (~1,4MB, servido pela CDN). O poster aparece na
            hora; o vídeo entra sem bloquear o carregamento. Sobrescreva a fonte
            com NEXT_PUBLIC_LOGIN_VIDEO_URL (ex.: um CDN) se quiser. */}
        <video
          className="login-video-bg"
          poster="/pecsil-login-poster.jpg"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        >
          <source
            src={process.env.NEXT_PUBLIC_LOGIN_VIDEO_URL || "/pecsil-login.mp4"}
            type="video/mp4"
          />
        </video>
        <div className="login-video-overlay" />
        <div className="login-visual-content">
          <div>
            <span>
              <b>34</b>
              <small>Tabelas protegidas</small>
            </span>
            <span>
              <b>RLS</b>
              <small>Negação por padrão</small>
            </span>
            <span>
              <b>6</b>
              <small>Papéis corporativos</small>
            </span>
          </div>
          <blockquote>
            Uma identidade. Somente os dados certos. Todo acesso rastreável.
          </blockquote>
        </div>
      </aside>
    </main>
  );
}
