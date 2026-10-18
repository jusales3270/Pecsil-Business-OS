"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Callout } from "../../packages/design-system";
import { pedirRegistro, type PedidoRegistro } from "../../lib/abrir-registro";

/**
 * SARA do módulo (I-12, nível 1): painel ao lado do módulo. Orienta e consulta com as permissões de
 * quem conversa; a resposta é marcada como da SARA (IA), com as fontes clicáveis e as consultas que
 * ela fez. O proprietário liga, escolhe o modelo e o teto de uso aqui mesmo.
 */

type Estado = {
  nome: string; configurada: boolean; ligada: boolean; modelo: string | null; uso: number; teto: number; podeConfigurar: boolean;
  ferramentas: string[]; sugestoes: string[];
};
type Abrir = { modulo: string; secao: string | null; rotulo: string; registro?: PedidoRegistro };
type Mensagem = { papel: "pessoa" | "sara"; texto: string; fontes?: { rotulo: string; link: string }[]; consultas?: string[]; abrir?: Abrir | null; id?: string | null; nota?: number; erro?: boolean };

const CONSULTA: Record<string, string> = {
  contas_a_pagar: "contas a pagar", contas_a_receber: "contas a receber", fluxo_de_caixa_90_dias: "fluxo de caixa",
  bancos_e_conciliacao: "bancos e conciliação", compras_aprovadas_a_pagar: "ordens de compra (Compras)", abrir_tela: "abriu uma tela",
  buscar_contas_a_pagar: "busca em contas a pagar", buscar_contas_a_receber: "busca em contas a receber", abrir_lancamento: "abriu um lançamento",
};
// Navegação, não consulta: não entram no "Posso consultar".
const NAVEGA = new Set(["abrir_tela", "abrir_lancamento"]);
const milhares = (n: number) => n.toLocaleString("pt-BR");

/** Texto do modelo com **negrito** e listas "- ", sem HTML (nada do texto vira código na página). */
function Texto({ texto }: { texto: string }) {
  const linhas = texto.split("\n");
  const negrito = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  const blocos: ReactNode[] = []; let lista: string[] = [];
  const fechar = () => { if (lista.length) { blocos.push(<ul key={`l${blocos.length}`}>{lista.map((l, i) => <li key={i}>{negrito(l)}</li>)}</ul>); lista = []; } };
  for (const l of linhas) {
    const m = l.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { lista.push(m[1]); continue; }
    fechar();
    if (l.trim()) blocos.push(<p key={`p${blocos.length}`}>{negrito(l.replace(/^#+\s*/, ""))}</p>);
  }
  fechar();
  return <>{blocos}</>;
}

export function SaraPainel({ modulo, navegar }: { modulo: string; navegar: (modulo: string, secao?: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [conversa, setConversa] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/sara/${modulo}`, { cache: "no-store" }).catch(() => null);
    if (!r || r.status === 403 || r.status === 404) { setSemAcesso(true); return; }
    setEstado((await r.json().catch(() => null)) as Estado | null);
  }, [modulo]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs, pensando]);

  const perguntar = async (pergunta: string) => {
    const p = pergunta.trim();
    if (!p || pensando) return;
    setTexto(""); setMsgs((m) => [...m, { papel: "pessoa", texto: p }]); setPensando(true);
    const r = await fetch(`/api/sara/${modulo}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pergunta: p, conversa }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setPensando(false);
    if (!r.ok) { setMsgs((m) => [...m, { papel: "sara", texto: r.body?.error ?? "A SARA está indisponível agora.", erro: true }]); return; }
    setConversa(r.body.conversa ?? conversa);
    setMsgs((m) => [...m, { papel: "sara", texto: r.body.texto, fontes: r.body.fontes ?? [], consultas: r.body.ferramentas ?? [], abrir: r.body.abrir ?? null, id: r.body.mensagem }]);
    // A SARA pediu para mostrar uma tela: abre por dentro da plataforma (o painel continua aberto).
    if (r.body.abrir) abrir(r.body.abrir);
    void carregar();
  };
  const abrir = (a: Abrir) => {
    navegar(a.modulo, a.secao ?? undefined);
    if (a.registro) pedirRegistro(a.registro);
  };
  const avaliar = async (i: number, nota: number) => {
    const m = msgs[i];
    if (!m?.id) return;
    setMsgs((l) => l.map((x, k) => (k === i ? { ...x, nota } : x)));
    await fetch(`/api/sara/${modulo}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mensagem: m.id, nota }) }).catch(() => null);
  };
  const configurar = async (c: { ligada: boolean; modelo: string; teto: number }) => {
    await fetch(`/api/sara/${modulo}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ configurar: c }) }).catch(() => null);
    void carregar();
  };

  if (semAcesso || !estado) return null;
  const pode = estado.configurada && estado.ligada;
  return (
    <>
      {!aberto && <button type="button" className="sara-botao" onClick={() => setAberto(true)} aria-label={`Abrir a ${estado.nome}`}><span aria-hidden>✦</span> SARA</button>}
      {aberto && (
        <aside className="sara-painel" aria-label={estado.nome}>
          <header>
            <div><b>{estado.nome}</b><small>IA · consulta com as suas permissões · não grava nada</small></div>
            <span>
              {msgs.length > 0 && <button type="button" className="almox-link" onClick={() => { setMsgs([]); setConversa(null); }}>Nova conversa</button>}
              <button type="button" className="sara-fechar" onClick={() => setAberto(false)} aria-label="Fechar a SARA">×</button>
            </span>
          </header>
          {estado.podeConfigurar && <Config estado={estado} onSalvar={configurar} />}
          {!estado.configurada ? <Callout variant="info" title="SARA ainda não configurada">Falta a chave do modelo (Claude) no servidor. Quem cuida é o proprietário.</Callout>
            : !estado.ligada ? <Callout variant="info" title="SARA desligada">{estado.podeConfigurar ? "Ligue acima para começar." : "Quem liga a SARA deste módulo é o proprietário."}</Callout> : null}
          <div className="sara-conversa">
            {!msgs.length && pode && (
              <div className="sara-inicio">
                <p>Pergunte sobre o módulo ou peça um dado. Eu consulto com as suas permissões e mostro de onde veio cada número.</p>
                <div className="sara-sugestoes">{estado.sugestoes.map((s) => <button key={s} type="button" onClick={() => void perguntar(s)}>{s}</button>)}</div>
                {estado.ferramentas.some((f) => !NAVEGA.has(f)) && <small>Posso consultar: {estado.ferramentas.filter((f) => !NAVEGA.has(f)).map((f) => CONSULTA[f] ?? f).join(", ")}{estado.ferramentas.some((f) => NAVEGA.has(f)) ? ", e abrir as telas e os lançamentos que você usa" : ""}.</small>}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`sara-msg ${m.papel}${m.erro ? " erro" : ""}`}>
                {m.papel === "sara" && !m.erro && <span className="sara-selo">SARA (IA)</span>}
                <div className="sara-texto">{m.papel === "sara" ? <Texto texto={m.texto} /> : <p>{m.texto}</p>}</div>
                {m.consultas && m.consultas.length > 0 && <small className="sara-consultas">Consultou: {[...new Set(m.consultas)].map((c) => CONSULTA[c] ?? c).join(", ")}</small>}
                {m.abrir && <button type="button" className="sara-abrir" onClick={() => abrir(m.abrir!)}>Abrir {m.abrir.rotulo}</button>}
                {m.fontes && m.fontes.length > 0 && <div className="sara-fontes">{m.fontes.map((f) => <a key={f.link} href={f.link}>{f.rotulo}</a>)}</div>}
                {m.papel === "sara" && m.id && (
                  <div className="sara-nota" aria-label="Avaliar a resposta">
                    <button type="button" aria-pressed={m.nota === 5} className={m.nota === 5 ? "ativo" : ""} onClick={() => void avaliar(i, 5)} title="Resposta boa">👍</button>
                    <button type="button" aria-pressed={m.nota === 1} className={m.nota === 1 ? "ativo" : ""} onClick={() => void avaliar(i, 1)} title="Resposta ruim">👎</button>
                  </div>
                )}
              </div>
            ))}
            {pensando && <div className="sara-msg sara"><span className="sara-selo">SARA (IA)</span><p className="sara-pensando">Consultando…</p></div>}
            <div ref={fim} />
          </div>
          <form className="sara-entrada" onSubmit={(e) => { e.preventDefault(); void perguntar(texto); }}>
            <textarea rows={2} value={texto} disabled={!pode || pensando} placeholder={pode ? "Pergunte à SARA…" : "SARA indisponível"} maxLength={2000}
              onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void perguntar(texto); } }} aria-label="Pergunta para a SARA" />
            <Button type="submit" disabled={!pode || pensando || texto.trim().length < 2}>Enviar</Button>
          </form>
          {pode && <small className="sara-uso">Uso do mês: {milhares(estado.uso)} de {milhares(estado.teto)} tokens</small>}
        </aside>
      )}
    </>
  );
}

function Config({ estado, onSalvar }: { estado: Estado; onSalvar: (c: { ligada: boolean; modelo: string; teto: number }) => void }) {
  const [modelo, setModelo] = useState(estado.modelo ?? "claude-haiku-5-5");
  const [teto, setTeto] = useState(String(estado.teto || 2000000));
  return (
    <div className="sara-config" aria-label="Configurar a SARA (proprietário)">
      <label className="sara-liga"><input type="checkbox" checked={estado.ligada} disabled={!estado.configurada} onChange={(e) => onSalvar({ ligada: e.target.checked, modelo, teto: Number(teto) || 0 })} /><span>{estado.ligada ? "Ligada" : "Desligada"}</span></label>
      <label><span>Modelo</span><select className="icms-select" value={modelo} onChange={(e) => { setModelo(e.target.value); onSalvar({ ligada: estado.ligada, modelo: e.target.value, teto: Number(teto) || 0 }); }}>
        <option value="claude-haiku-5-5">Claude Haiku 5.5 (dia a dia)</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5 (análise)</option>
      </select></label>
      <label><span>Teto (tokens/mês)</span><input inputMode="numeric" value={teto} onChange={(e) => setTeto(e.target.value.replace(/\D/g, ""))} onBlur={() => onSalvar({ ligada: estado.ligada, modelo, teto: Number(teto) || 0 })} /></label>
    </div>
  );
}
