"use client";

import { FormEvent, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import { usePwa } from "../components/pwa-provider";
import { ativarDigital, digitalAtivaNesteAparelho, digitalDisponivel, dispensarOferta, entrarComDigital, ofertaDispensada } from "../../lib/auth/digital-cliente";

const IconeDigital = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 11c0 3.5-1 6.5-2.5 8.5" /><path d="M8.5 7.6A5 5 0 0 1 17 11c0 1.4-.1 2.8-.4 4.1" /><path d="M5.6 15.5A10 10 0 0 0 7 11a5 5 0 0 1 .3-1.7" /><path d="M3 9.6A9 9 0 0 1 20.9 9" /><path d="M14.5 21c.7-1.6 1.1-3.3 1.3-5" /><path d="M12 11v1.5" />
  </svg>
);

const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);

export default function LoginPage() {
  const pwa = usePwa();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  // Entrar com a digital (passkey): no celular ou tablet com biometria. "ativa" = alguém já ativou neste aparelho.
  const [digital, setDigital] = useState<{ disponivel: boolean; ativa: string | null }>({ disponivel: false, ativa: null });
  const [oferta, setOferta] = useState(false);
  const [usandoDigital, setUsandoDigital] = useState(false);

  useEffect(() => {
    let vivo = true;
    void digitalDisponivel().then((disponivel) => { if (vivo) setDigital({ disponivel, ativa: digitalAtivaNesteAparelho() }); });
    return () => { vivo = false; };
  }, []);

  async function entrarDigital() {
    setUsandoDigital(true);
    setMessage("");
    const r = await entrarComDigital();
    if (r.ok) { window.location.assign("/"); return; }
    setUsandoDigital(false);
    setDigital((d) => ({ ...d, ativa: digitalAtivaNesteAparelho() }));
    setMessage(r.erro === "ACCESS_EXPIRED" ? expiredMessage("") : r.erro);
  }

  async function ativarEEntrar() {
    setUsandoDigital(true);
    setMessage("");
    const r = await ativarDigital(email);
    if (r.ok) { window.location.assign("/"); return; }
    setUsandoDigital(false);
    setMessage(r.erro);
  }

  // Acesso de terceiro vencido (vindo da aplicação ou do próprio login).
  useEffect(() => {
    const until = new URLSearchParams(window.location.search).get("expirado");
    if (until !== null) {
      // Adiado: o estado inicial precisa ser igual ao do servidor (hidratação).
      void Promise.resolve().then(() => setMessage(expiredMessage(until)));
      return;
    }
    // Sessão ainda aberta de um acesso que venceu (qualquer tela pode ter
    // mandado para cá): explica o motivo e encerra a sessão.
    if (!configured) return;
    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status !== 403) return;
        const body = await response.json().catch(() => ({}));
        if (body?.error !== "ACCESS_EXPIRED") return;
        setMessage(expiredMessage(typeof body.expiresAt === "string" ? body.expiresAt : ""));
        await createSupabaseBrowserClient().auth.signOut().catch(() => {});
      })
      .catch(() => {});
  }, []);

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
      // Antes qualquer falha virava "e-mail ou senha inválidos" — inclusive
      // chave de API errada, servidor fora do ar ou usuário inexistente. Isso
      // mandava para o caminho errado quem estava depurando o acesso.
      // Credencial errada continua com a mensagem genérica de propósito (não
      // revelar se o e-mail existe); o resto agora se identifica.
      const credencialInvalida =
        error.code === "invalid_credentials" || error.status === 400;
      if (credencialInvalida) {
        setMessage("E-mail ou senha inválidos.");
      } else if (!error.status) {
        setMessage("Não foi possível falar com o servidor de autenticação. Verifique a conexão.");
      } else if (error.status === 401 || error.status === 403) {
        setMessage("A chave de acesso desta aplicação foi recusada pelo servidor. Avise a administração.");
      } else {
        setMessage(`Falha no acesso (${error.status}): ${error.message}`);
      }
      return;
    }

    // Credencial certa não basta: um terceiro com validade vencida não entra.
    const me = await fetch("/api/me", { cache: "no-store" });
    if (me.status === 403) {
      const body = await me.json().catch(() => ({}));
      if (body?.error === "ACCESS_EXPIRED") {
        await supabase.auth.signOut().catch(() => {});
        setMessage(expiredMessage(typeof body.expiresAt === "string" ? body.expiresAt : ""));
        return;
      }
    }

    // No celular ou tablet com biometria, oferece ativar a digital antes de seguir (uma vez a cada 30 dias, se dispensada).
    if (digital.disponivel && digital.ativa !== email && !ofertaDispensada()) { setOferta(true); return; }
    window.location.assign("/");
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <img className="brand-logo light" src="/pecsil-logo.png?v=2" alt="Pecsil — Molds for Glass" /><img className="brand-logo dark" src="/pecsil-logo-dark.png?v=2" alt="" aria-hidden="true" />
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
        {oferta ? (
          <div className="login-oferta">
            <span className="login-oferta-icone"><IconeDigital /></span>
            <b>Entrar mais rápido da próxima vez?</b>
            <p>Ative a digital (ou o rosto) neste aparelho. Ela fica só nele: a plataforma nunca recebe a sua biometria. A senha continua valendo.</p>
            <button type="button" className="login-digital" onClick={() => void ativarEEntrar()} disabled={usandoDigital}>
              {usandoDigital ? "Aguardando a digital…" : <><IconeDigital /> Ativar a digital</>}
            </button>
            <button type="button" className="login-link" onClick={() => { dispensarOferta(); window.location.assign("/"); }} disabled={usandoDigital}>Agora não</button>
            {message && <p className="login-message" role="alert">{message}</p>}
          </div>
        ) : (
        <>
        {digital.disponivel && digital.ativa && (
          <div className="login-digital-bloco">
            <button type="button" className="login-digital" onClick={() => void entrarDigital()} disabled={usandoDigital}>
              {usandoDigital ? "Aguardando a digital…" : <><IconeDigital /> Entrar com a digital</>}
            </button>
            <small>{digital.ativa}</small>
            <span className="login-ou">ou entre com e-mail e senha</span>
          </div>
        )}
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
          {digital.disponivel && !digital.ativa && (
            <button type="button" className="login-link" onClick={() => void entrarDigital()} disabled={usandoDigital}>
              {usandoDigital ? "Aguardando a digital…" : "Entrar com a digital"}
            </button>
          )}
          {/* Instalar já na entrada: útil no tablet compartilhado (portaria, fábrica) e no celular. */}
          {pwa.canInstall && (
            <button type="button" className="login-link login-instalar" onClick={() => void pwa.promptInstall()}>
              Instalar o app neste aparelho
            </button>
          )}
        </form>
        </>
        )}
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

function expiredMessage(until: string) {
  const parsed = Date.parse(until);
  const date = Number.isFinite(parsed)
    ? ` em ${new Date(parsed).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : "";
  return `Seu acesso expirou${date}. Fale com o responsável pela plataforma.`;
}
