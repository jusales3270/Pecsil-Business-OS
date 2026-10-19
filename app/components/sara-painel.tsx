"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type PointerEvent as EventoPonteiro, type ReactNode } from "react";
import { Callout } from "../../packages/design-system";
import { pedirRegistro, type PedidoRegistro } from "../../lib/abrir-registro";
import type { Visual } from "../../lib/sara/visual";
import { SaraVisual } from "./sara-visual";

/**
 * SARA do módulo (I-12, nível 1): janela flutuante sobre o módulo. Orienta e consulta com as
 * permissões de quem conversa; a resposta é marcada como da SARA (IA), com as fontes clicáveis e as
 * consultas que ela fez. Quem pode usá-la é decidido em Pessoas e Acessos (`<modulo>.sara`).
 * O botão e a janela se arrastam para qualquer ponto da tela (a posição fica guardada neste navegador).
 * A janela abre na última conversa da pessoa, já na última interação, com os dias separados; sem
 * conversa, cumprimenta pelo nome de quem está logado, na hora de São Paulo (vinda do servidor).
 * Avisos do módulo (calculados dos dados): o botão pulsa em vermelho (urgente) ou azul (aviso) até a
 * pessoa abrir a janela e vê-los; depois daquele aviso, não pulsa mais (até a situação mudar).
 */

type Salva = { id: string; papel: "pessoa" | "sara"; texto: string; quando: string; nota: number | null; consultas: string[]; fontes: { rotulo: string; link: string }[]; abrir: Abrir | null; fora: boolean; visuais?: Visual[] };
type Estado = { nome: string; configurada: boolean; ferramentas: string[]; alcance?: { outrosModulos: boolean; dados: boolean; pesquisa: boolean }; rotulos?: Record<string, string>; habilidades?: { id: string; nome: string; pedido: string }[]; sugestoes: string[]; pessoa: string; saudacao: string; conversa: { id: string; mensagens: Salva[] } | null };
type Abrir = { modulo: string; secao: string | null; rotulo: string; registro?: PedidoRegistro };
type Mensagem = { papel: "pessoa" | "sara"; texto: string; fontes?: { rotulo: string; link: string }[]; consultas?: string[]; abrir?: Abrir | null; id?: string | null; nota?: number; erro?: boolean; fora?: boolean; quando?: string; visuais?: Visual[] };

const CONSULTA: Record<string, string> = {
  contas_a_pagar: "contas a pagar", contas_a_receber: "contas a receber", fluxo_de_caixa_90_dias: "fluxo de caixa",
  bancos_e_conciliacao: "bancos e conciliação", compras_aprovadas_a_pagar: "ordens de compra (Compras)", abrir_tela: "abriu uma tela",
  pesquisar_na_internet: "pesquisou na internet", consultar_dados: "consultou os dados", calcular: "fez as contas",
  buscar_contas_a_pagar: "busca em contas a pagar", buscar_contas_a_receber: "busca em contas a receber", abrir_lancamento: "abriu um lançamento",
  registrar_lacuna: "anotou o pedido",
};
// Navegação, não consulta: não entram no "Posso consultar".
const NAVEGA = new Set(["abrir_tela", "abrir_lancamento", "registrar_lacuna", "propor_habilidade", "mostrar", "calcular"]);
const AVATAR = "/favicon.png?v=2";
// Para quem usa é só "SARA": o módulo ("do Financeiro", "de Compras") é identificação interna dos agentes.
const NOME = "SARA";
// Dia (no fuso de São Paulo) de cada mensagem, para separar "Hoje", "Ontem" e as datas.
const diaSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
function rotuloDoDia(iso: string): string {
  const d = diaSP(iso), hoje = diaSP(new Date().toISOString()), ontem = diaSP(new Date(Date.now() - 86_400_000).toISOString());
  if (d === hoje) return "Hoje";
  if (d === ontem) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
const horaSP = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Texto do modelo com **negrito**, listas "- " e tabelas "| a | b |", sem HTML (nada do texto vira código na página). */
function Texto({ texto }: { texto: string }) {
  const linhas = texto.split("\n");
  const negrito = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  const celulas = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const blocos: ReactNode[] = []; let lista: string[] = []; let tabela: string[][] = [];
  const fecharLista = () => { if (lista.length) { blocos.push(<ul key={`l${blocos.length}`}>{lista.map((l, i) => <li key={i}>{negrito(l)}</li>)}</ul>); lista = []; } };
  const fecharTabela = () => {
    if (!tabela.length) return;
    const [cabeca, ...corpo] = tabela;
    blocos.push(
      <div key={`t${blocos.length}`} className="sara-tabela">
        <table>
          <thead><tr>{cabeca.map((c, i) => <th key={i}>{negrito(c)}</th>)}</tr></thead>
          <tbody>{corpo.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{negrito(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>,
    );
    tabela = [];
  };
  for (const l of linhas) {
    if (/^\s*\|.*\|\s*$/.test(l)) {
      fecharLista();
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(l)) tabela.push(celulas(l)); // a linha |---|---| só separa o cabeçalho
      continue;
    }
    fecharTabela();
    const m = l.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { lista.push(m[1]); continue; }
    fecharLista();
    if (l.trim()) blocos.push(<p key={`p${blocos.length}`}>{negrito(l.replace(/^#+\s*/, ""))}</p>);
  }
  fecharTabela();
  fecharLista();
  return <>{blocos}</>;
}

type Aviso = { chave: string; nivel: "urgente" | "aviso"; titulo: string; detalhe: string; abrir?: Abrir; visto: boolean };
/** De quanto em quanto tempo os avisos são recalculados quando a pessoa volta à aba. */
const RECARREGAR_AVISOS_MS = 10 * 60 * 1000;

type Pos = { x: number; y: number };
const MARGEM = 8;
const lerPos = (chave: string): Pos | null => {
  try { const v = JSON.parse(window.localStorage.getItem(chave) ?? "null"); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null; } catch { return null; }
};
const guardarPos = (chave: string, p: Pos) => { try { window.localStorage.setItem(chave, JSON.stringify(p)); } catch { /* sem armazenamento: só não lembra */ } };
const caber = (p: Pos, el: HTMLElement | null): Pos => {
  const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
  return { x: Math.min(Math.max(MARGEM, p.x), Math.max(MARGEM, window.innerWidth - w - MARGEM)), y: Math.min(Math.max(MARGEM, p.y), Math.max(MARGEM, window.innerHeight - h - MARGEM)) };
};
const telaEstreita = () => window.matchMedia("(max-width: 600px)").matches;
// Se o último gesto em cada elemento foi arrasto (para o clique que vem junto não abrir a janela).
const ARRASTOU = new Map<string, boolean>();

/**
 * Arrastar com o mouse (ou o dedo): segura e leva para qualquer ponto da tela, sem sair dela.
 * Sem posição guardada, o elemento fica no canto padrão do CSS. `moveu` separa arrastar de clicar.
 */
function useArrastar(chave: string, ativo: boolean) {
  // O elemento fica em estado (ref de callback), não em useRef: nada de ref lido durante a renderização.
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  useEffect(() => {
    if (!ativo) return;
    const t = setTimeout(() => { const p = lerPos(chave); if (p && !telaEstreita()) setPos(caber(p, el)); }, 0);
    const ajustar = () => setPos((p) => (p ? caber(p, el) : p));
    window.addEventListener("resize", ajustar);
    return () => { clearTimeout(t); window.removeEventListener("resize", ajustar); };
  }, [chave, ativo, el]);
  const iniciar = (e: EventoPonteiro<HTMLElement>, podeNoCelular = true) => {
    if (e.button !== 0 || !el || (!podeNoCelular && telaEstreita())) return;
    // Na alça da janela, clicar em "Nova conversa" ou em fechar não começa a arrastar.
    const alvo = (e.target as HTMLElement).closest("button, a, textarea, input, select");
    if (alvo && alvo !== e.currentTarget) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top, x0 = e.clientX, y0 = e.clientY;
    ARRASTOU.set(chave, false);
    let ultimo: Pos | null = null;
    const mover = (ev: PointerEvent) => {
      if (!ARRASTOU.get(chave) && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      ARRASTOU.set(chave, true);
      ultimo = caber({ x: ev.clientX - dx, y: ev.clientY - dy }, el);
      setPos(ultimo);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      if (ultimo) guardarPos(chave, ultimo);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };
  const estilo = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;
  const arrastou = useCallback(() => ARRASTOU.get(chave) === true, [chave]);
  return { prender: setEl, estilo, iniciar, arrastou };
}

export function SaraPainel({ modulo, navegar }: { modulo: string; navegar: (modulo: string, secao?: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [conversa, setConversa] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [novos, setNovos] = useState<Set<string>>(new Set());
  const [verAvisos, setVerAvisos] = useState(false);
  const { prender: prenderBotao, estilo: estiloBotao, iniciar: arrastarBotao, arrastou: botaoArrastou } = useArrastar("sara.botao", Boolean(estado) && !aberto);
  const { prender: prenderJanela, estilo: estiloJanela, iniciar: arrastarJanela } = useArrastar("sara.janela", Boolean(estado) && aberto);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/sara/${modulo}`, { cache: "no-store" }).catch(() => null);
    if (!r || r.status === 403 || r.status === 404) { setSemAcesso(true); return; }
    const e = (await r.json().catch(() => null)) as Estado | null;
    setEstado(e);
    // Volta a última conversa (se a pessoa ainda não começou outra nesta tela).
    if (e?.conversa?.mensagens.length) {
      const salvas = e.conversa;
      setMsgs((atuais) => (atuais.length ? atuais : salvas.mensagens.map((m) => ({
        papel: m.papel, texto: m.texto, quando: m.quando, id: m.papel === "sara" ? m.id : null, nota: m.nota ?? undefined,
        consultas: m.consultas, fontes: m.fontes, abrir: m.abrir, fora: m.fora, visuais: m.visuais ?? [],
      }))));
      setConversa((atual) => atual ?? salvas.id);
    }
  }, [modulo]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  // Avisos: ao entrar no módulo e, depois, quando a pessoa volta à aba (no máximo a cada 10 minutos).
  const carregarAvisos = useCallback(async () => {
    const r = await fetch(`/api/sara/${modulo}/alertas`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const b = (await r.json().catch(() => null)) as { alertas?: Aviso[] } | null;
    setAvisos(b?.alertas ?? []);
  }, [modulo]);
  useEffect(() => {
    let ultimo = 0;
    const atualizar = () => { if (document.visibilityState === "visible" && Date.now() - ultimo > RECARREGAR_AVISOS_MS) { ultimo = Date.now(); void carregarAvisos(); } };
    const t = setTimeout(atualizar, 0);
    document.addEventListener("visibilitychange", atualizar);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", atualizar); };
  }, [carregarAvisos]);
  // Abriu a janela: a pessoa tomou ciência dos avisos novos (eles ficam marcados como "novo" nesta abertura).
  useEffect(() => {
    if (!aberto) return;
    const pendentes = avisos.filter((a) => !a.visto);
    if (!pendentes.length) return;
    const t = setTimeout(() => {
      setNovos((n) => new Set([...n, ...pendentes.map((a) => a.chave)]));
      setVerAvisos(true);
      setAvisos((l) => l.map((a) => ({ ...a, visto: true })));
      void fetch(`/api/sara/${modulo}/alertas`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alertas: pendentes.map((a) => ({ chave: a.chave, nivel: a.nivel })) }) }).catch(() => null);
    }, 0);
    return () => clearTimeout(t);
  }, [aberto, avisos, modulo]);
  // Sempre na última interação: ao abrir a janela, ao chegar mensagem e enquanto ela pensa.
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => { const el = rolagem.current; if (el) el.scrollTop = el.scrollHeight; }, 0);
    return () => clearTimeout(t);
  }, [msgs, pensando, aberto]);

  const abrir = (a: Abrir) => {
    navegar(a.modulo, a.secao ?? undefined);
    // O pedido sai depois da troca de tela: se a pessoa já estava nela, a tela antiga é desmontada e
    // não pode "pegar" o pedido no lugar da nova. Até alguém atender, ele fica guardado.
    const registro = a.registro;
    if (registro) setTimeout(() => pedirRegistro(registro), 400);
  };
  const perguntar = async (pergunta: string, habilidade?: string) => {
    const p = pergunta.trim();
    if (!p || pensando) return;
    setTexto(""); setMsgs((m) => [...m, { papel: "pessoa", texto: p, quando: new Date().toISOString() }]); setPensando(true);
    const r = await fetch(`/api/sara/${modulo}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pergunta: p, conversa, habilidade: habilidade ?? null }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setPensando(false);
    if (!r.ok) { setMsgs((m) => [...m, { papel: "sara", texto: r.body?.error ?? "A SARA está indisponível agora.", erro: true, quando: new Date().toISOString() }]); return; }
    setConversa(r.body.conversa ?? conversa);
    setMsgs((m) => [...m, { papel: "sara", texto: r.body.texto, fontes: r.body.fontes ?? [], consultas: r.body.ferramentas ?? [], abrir: r.body.abrir ?? null, id: r.body.mensagem, fora: Boolean(r.body.foraDoEscopo), quando: new Date().toISOString(), visuais: r.body.visuais ?? [] }]);
    // A SARA pediu para mostrar uma tela: abre por dentro da plataforma (a janela continua aberta).
    if (r.body.abrir) abrir(r.body.abrir);
  };
  const avaliar = async (i: number, nota: number) => {
    const m = msgs[i];
    if (!m?.id) return;
    setMsgs((l) => l.map((x, k) => (k === i ? { ...x, nota } : x)));
    await fetch(`/api/sara/${modulo}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mensagem: m.id, nota }) }).catch(() => null);
  };

  if (semAcesso || !estado) return null;
  const pode = estado.configurada;
  const rotulo = (nome: string) => estado.rotulos?.[nome] ?? CONSULTA[nome] ?? nome.replace(/_/g, " ");
  const naoVistos = avisos.filter((a) => !a.visto);
  const pulso = naoVistos.some((a) => a.nivel === "urgente") ? "urgente" : naoVistos.length ? "aviso" : null;
  return (
    <>
      {!aberto && (
        <button type="button" ref={prenderBotao} className={`sara-botao sara-vidro${pulso ? ` pulsa-${pulso}` : ""}`} style={estiloBotao}
          onPointerDown={(e) => arrastarBotao(e)} onClick={() => { if (!botaoArrastou()) setAberto(true); }}
          aria-label={`Abrir a ${NOME}${naoVistos.length ? ` (${naoVistos.length} ${naoVistos.length === 1 ? "aviso novo" : "avisos novos"}${pulso === "urgente" ? ", com urgência" : ""})` : ""} (segure e arraste para mudar de lugar)`} title="Clique para abrir · segure e arraste para mudar de lugar">
          {/* eslint-disable-next-line @next/next/no-img-element -- avatar pequeno e fixo (o favicon) */}
          <img src={AVATAR} alt="" className="sara-avatar" draggable={false} />
          <span>SARA</span>
          {naoVistos.length > 0 && <span className={`sara-contador ${pulso}`} aria-hidden>{naoVistos.length}</span>}
        </button>
      )}
      {aberto && (
        <aside ref={prenderJanela} className="sara-painel sara-vidro" style={estiloJanela} aria-label={NOME}>
          <header className="sara-alca" onPointerDown={(e) => arrastarJanela(e, false)} title="Segure e arraste para mudar de lugar">
            {/* eslint-disable-next-line @next/next/no-img-element -- avatar pequeno e fixo (o favicon) */}
            <img src={AVATAR} alt="" className="sara-avatar" draggable={false} />
            <div><b>{NOME}</b><small>IA · consulta com as suas permissões · não grava nada</small></div>
            <span>
              {msgs.length > 0 && <button type="button" className="sara-nova" onClick={() => { setMsgs([]); setConversa(null); }}>Nova conversa</button>}
              <button type="button" className="sara-fechar" onClick={() => setAberto(false)} aria-label="Fechar a SARA">×</button>
            </span>
          </header>
          {avisos.length > 0 && (
            <section className="sara-avisos" aria-label="Avisos do módulo">
              <button type="button" className="sara-avisos-titulo" onClick={() => setVerAvisos((v) => !v)} aria-expanded={verAvisos}>
                <span className={`sara-ponto ${avisos.some((a) => a.nivel === "urgente") ? "urgente" : "aviso"}`} aria-hidden />
                <b>Avisos</b>
                <small>{avisos.filter((a) => a.nivel === "urgente").length ? `${avisos.filter((a) => a.nivel === "urgente").length} urgente${avisos.filter((a) => a.nivel === "urgente").length > 1 ? "s" : ""} · ` : ""}{avisos.length} no total</small>
                <i aria-hidden>{verAvisos ? "▾" : "▸"}</i>
              </button>
              {verAvisos && (
                <div className="sara-avisos-lista">
                  {avisos.map((a) => (
                    <div key={a.chave} className={`sara-aviso ${a.nivel}`}>
                      <span className={`sara-ponto ${a.nivel}${novos.has(a.chave) ? " pulsa" : ""}`} aria-hidden />
                      <div>
                        <b>{a.titulo}{novos.has(a.chave) && <em> · novo</em>}</b>
                        <small>{a.detalhe}</small>
                        {a.abrir && <button type="button" className="sara-abrir" onClick={() => abrir(a.abrir!)}>Abrir {a.abrir.rotulo}</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {!estado.configurada && <Callout variant="info" title="SARA ainda não configurada">Falta a chave do modelo (Claude) no servidor. Quem cuida é o proprietário.</Callout>}
          <div className="sara-conversa" ref={rolagem}>
            {!msgs.length && pode && (
              <div className="sara-inicio">
                <b className="sara-ola">{estado.saudacao}{estado.pessoa ? `, ${estado.pessoa}` : ""}!</b>
                <p>Pergunte sobre o módulo ou peça um dado. Eu consulto com as suas permissões e mostro de onde veio cada número.</p>
                {estado.habilidades && estado.habilidades.length > 0 && (
                  <div className="sara-habilidades" aria-label="Habilidades da SARA">
                    {estado.habilidades.map((h) => <button key={h.id} type="button" onClick={() => void perguntar(h.pedido, h.id)} title={h.pedido}><span aria-hidden>⚡</span> {h.nome}</button>)}
                  </div>
                )}
                <div className="sara-sugestoes">{estado.sugestoes.map((s) => <button key={s} type="button" onClick={() => void perguntar(s)}>{s}</button>)}</div>
                {estado.ferramentas.some((f) => !NAVEGA.has(f)) && <small>Posso consultar: {estado.ferramentas.filter((f) => !NAVEGA.has(f)).map(rotulo).join(", ")}{estado.ferramentas.some((f) => f === "abrir_tela" || f === "abrir_lancamento") ? ", e abrir as telas e os lançamentos que você usa" : ""}.{estado.alcance?.outrosModulos || estado.alcance?.dados ? " Também busco os dados dos outros módulos que você pode ver." : ""}{estado.alcance?.pesquisa ? " Tiro dúvidas do assunto do módulo e, se precisar, pesquiso em fontes oficiais." : ""}</small>}
              </div>
            )}
            {msgs.map((m, i) => (
              <Fragment key={i}>
              {m.quando && (i === 0 || !msgs[i - 1].quando || diaSP(msgs[i - 1].quando!) !== diaSP(m.quando)) && <div className="sara-dia" role="separator"><span>{rotuloDoDia(m.quando)}</span></div>}
              <div className={`sara-msg ${m.papel}${m.erro ? " erro" : ""}${m.fora ? " fora" : ""}`}>
                {m.papel === "sara" && !m.erro && <span className="sara-selo">{m.fora ? "SARA (IA) · fora do escopo" : "SARA (IA)"}{m.quando ? <i> · {horaSP(m.quando)}</i> : null}</span>}
                <div className="sara-texto">{m.papel === "sara" ? <Texto texto={m.texto} /> : <p>{m.texto}</p>}</div>
                {m.visuais?.map((v, k) => <SaraVisual key={k} v={v} />)}
                {m.consultas && m.consultas.length > 0 && <small className="sara-consultas">Consultou: {[...new Set(m.consultas)].map(rotulo).join(", ")}</small>}
                {m.abrir && <button type="button" className="sara-abrir" onClick={() => abrir(m.abrir!)}>Abrir {m.abrir.rotulo}</button>}
                {m.fontes && m.fontes.length > 0 && <div className="sara-fontes">{m.fontes.map((f) => /^https?:\/\//.test(f.link)
                  ? <a key={f.link} href={f.link} target="_blank" rel="noopener noreferrer" className="externa" title={f.link}>{f.rotulo} ↗</a>
                  : <a key={f.link} href={f.link}>{f.rotulo}</a>)}</div>}
                {m.papel === "sara" && m.id && (
                  <div className="sara-nota" aria-label="Avaliar a resposta">
                    <button type="button" aria-pressed={m.nota === 5} className={m.nota === 5 ? "ativo" : ""} onClick={() => void avaliar(i, 5)} title="Resposta boa">👍</button>
                    <button type="button" aria-pressed={m.nota === 1} className={m.nota === 1 ? "ativo" : ""} onClick={() => void avaliar(i, 1)} title="Resposta ruim">👎</button>
                  </div>
                )}
              </div>
              </Fragment>
            ))}
            {pensando && <div className="sara-msg sara"><span className="sara-selo">SARA (IA)</span><p className="sara-pensando">Consultando…</p></div>}
          </div>
          <form className="sara-entrada" onSubmit={(e) => { e.preventDefault(); void perguntar(texto); }}>
            <textarea rows={2} value={texto} disabled={!pode || pensando} placeholder={pode ? "Pergunte à SARA…" : "SARA indisponível"} maxLength={2000}
              onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void perguntar(texto); } }} aria-label="Pergunta para a SARA" />
            <button type="submit" className="sara-enviar" disabled={!pode || pensando || texto.trim().length < 2} aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
