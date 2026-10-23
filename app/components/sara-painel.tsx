"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type PointerEvent as EventoPonteiro, type ReactNode } from "react";
import { Callout, Carregando, useEscolherArquivo } from "../../packages/design-system";
import { pedirRegistro, type PedidoRegistro } from "../../lib/abrir-registro";
import type { Visual } from "../../lib/sara/visual";
import { SaraVisual } from "./sara-visual";
import { SaraGuias } from "./sara-guias";

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

/** Ação que a SARA preparou (E1): só acontece se a pessoa tocar em Permitir. */
type Cartao = { id: string; resumo: string; detalhes: string[]; risco: string; situacao: string; feito: string | null; erro: string | null; expiraEm?: string };
type Parametro = { consulta: string; filtros: string[] };
type Salva = { parametros?: Parametro[]; id: string; papel: "pessoa" | "sara"; texto: string; quando: string; nota: number | null; consultas: string[]; fontes: { rotulo: string; link: string }[]; abrir: Abrir | null; fora: boolean; visuais?: Visual[]; acoes?: Cartao[] };
type Estado = { nome: string; configurada: boolean; ferramentas: string[]; alcance?: { outrosModulos: boolean; dados: boolean; pesquisa: boolean }; rotulos?: Record<string, string>; habilidades?: { id: string; nome: string; pedido: string }[]; sugestoes: string[]; pessoa: string; saudacao: string; conversa: { id: string; mensagens: Salva[] } | null };
type Abrir = { modulo: string; secao: string | null; rotulo: string; registro?: PedidoRegistro };
type Mensagem = { parametros?: Parametro[]; anexo?: string; foto?: string; papel: "pessoa" | "sara"; texto: string; fontes?: { rotulo: string; link: string }[]; consultas?: string[]; abrir?: Abrir | null; id?: string | null; nota?: number; erro?: boolean; fora?: boolean; quando?: string; visuais?: Visual[]; acoes?: Cartao[] };

const CONSULTA: Record<string, string> = {
  contas_a_pagar: "contas a pagar", contas_a_receber: "contas a receber", fluxo_de_caixa_90_dias: "fluxo de caixa",
  bancos_e_conciliacao: "bancos e conciliação", compras_aprovadas_a_pagar: "ordens de compra (Compras)", abrir_tela: "abriu uma tela",
  pesquisar_na_internet: "pesquisou na internet", consultar_dados: "consultou os dados", calcular: "fez as contas",
  buscar_contas_a_pagar: "busca em contas a pagar", buscar_contas_a_receber: "busca em contas a receber", abrir_lancamento: "abriu um lançamento",
  registrar_lacuna: "anotou o pedido",
};
const SITUACAO_ACAO: Record<string, string> = { executada: "Feito", recusada: "Não permitido · nada foi feito", expirada: "Venceu · nada foi feito", falhou: "Não foi feito", permitida: "Fazendo…" };
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
  // **negrito** e `código` (a SARA de TI escreve comandos e nomes de arquivo).
  const negrito = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*|`[^`\n]+`)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
    : p.length > 2 && p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>));
  const celulas = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const blocos: ReactNode[] = []; let lista: string[] = []; let tabela: string[][] = []; let codigo: string[] | null = null;
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
    // Bloco de código (```bash … ```): mostrado como está, sem interpretar lista nem tabela.
    if (/^\s*```/.test(l)) {
      if (codigo) { blocos.push(<pre key={`c${blocos.length}`} className="sara-codigo"><code>{codigo.join("\n")}</code></pre>); codigo = null; }
      else { fecharTabela(); fecharLista(); codigo = []; }
      continue;
    }
    if (codigo) { codigo.push(l); continue; }
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
  if (codigo) blocos.push(<pre key={`c${blocos.length}`} className="sara-codigo"><code>{codigo.join("\n")}</code></pre>);
  fecharTabela();
  fecharLista();
  return <>{blocos}</>;
}

/* Ícones da caixa de mensagem (traço, como nos chats). */
const Ico = ({ children }: { children: ReactNode }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>;
const IconeMais = () => <Ico><path d="M12 5v14M5 12h14" /></Ico>;
const IconeX = () => <Ico><path d="M6 6l12 12M18 6 6 18" /></Ico>;
const IconeMicrofone = () => <Ico><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Ico>;
const IconeParar = () => <Ico><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></Ico>;
const IconeCamera = () => <Ico><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Ico>;
const IconeClipe = () => <Ico><path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" /></Ico>;
const IconeCodigo = () => <Ico><path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12" /></Ico>;

/** Foto pronta para enviar: reduzida no celular (lado maior 1568 px, JPEG), sem guardar no aparelho nem na plataforma. */
type Foto = { tipo: "image/jpeg"; dados: string; previa: string };
async function reduzirFoto(arquivo: File): Promise<Foto> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1568 / Math.max(img.width, img.height));
  const tela = document.createElement("canvas");
  tela.width = Math.round(img.width * escala); tela.height = Math.round(img.height * escala);
  tela.getContext("2d")?.drawImage(img, 0, 0, tela.width, tela.height);
  img.close();
  const previa = tela.toDataURL("image/jpeg", 0.82);
  return { tipo: "image/jpeg", dados: previa.split(",")[1] ?? "", previa };
}

type Detector = { detect: (fonte: CanvasImageSource) => Promise<{ rawValue: string; format: string }[]> };
type DetectorCtor = new (o?: { formats?: string[] }) => Detector;
/**
 * Leitor de código pela câmera (o "coletor de dados"): BarcodeDetector do navegador (Chrome no Android).
 * Lê código de barras e QR da etiqueta; a câmera desliga assim que lê ou quando a pessoa fecha.
 */
function LeitorDeCodigo({ onLido, onFechar }: { onLido: (valor: string, formato: string) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const Ctor = typeof window !== "undefined" ? (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector : undefined;
  const [erro, setErro] = useState(Ctor ? "" : "Este aparelho não lê código pela câmera. Tire uma foto da etiqueta: a SARA lê o código pela foto.");
  useEffect(() => {
    if (!Ctor) return;
    let fluxo: MediaStream | null = null, parado = false, timer: ReturnType<typeof setTimeout> | undefined;
    const detector = new Ctor();
    const procurar = async () => {
      if (parado || !video.current) return;
      try {
        const achados = video.current.readyState >= 2 ? await detector.detect(video.current) : [];
        const a = achados.find((x) => x.rawValue?.trim());
        if (a) { parado = true; onLido(a.rawValue.trim(), a.format); return; }
      } catch { /* quadro ruim: tenta o próximo */ }
      timer = setTimeout(() => void procurar(), 250);
    };
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((f) => {
        if (parado) { f.getTracks().forEach((t) => t.stop()); return; }
        fluxo = f;
        if (video.current) { video.current.srcObject = f; video.current.play().catch(() => { /* trocou a fonte (ex.: reabriu): segue no próximo quadro */ }); void procurar(); }
      })
      .catch(() => setErro("Não foi possível abrir a câmera. Libere a câmera para a plataforma nas permissões do navegador."));
    return () => { parado = true; clearTimeout(timer); fluxo?.getTracks().forEach((t) => t.stop()); };
  }, [Ctor, onLido]);
  return (
    <div className="sara-leitor" role="dialog" aria-label="Ler código pela câmera">
      {erro ? <p className="sara-leitor-erro">{erro}</p> : (<>
        <video ref={video} muted playsInline aria-label="Câmera" />
        <span className="sara-leitor-mira" aria-hidden />
        <p>Aponte para o código de barras ou QR da etiqueta.</p>
      </>)}
      <button type="button" className="sara-abrir" onClick={onFechar}>Fechar</button>
    </div>
  );
}

type Aviso = { chave: string; nivel: "urgente" | "aviso"; titulo: string; detalhe: string; abrir?: Abrir; visto: boolean; propor?: { rotulo: string } };

/** Cartão de autorização: a SARA preparou, a pessoa decide (na conversa ou dentro de um aviso). */
function CartaoAcao({ c, decidindo, confirmar, decidir }: { c: Cartao; decidindo: string | null; confirmar: string | null; decidir: (c: Cartao, permitir: boolean) => void }) {
  const vencida = c.situacao === "pendente" && c.expiraEm && Date.parse(c.expiraEm) < Date.now();
  const situacao = vencida ? "expirada" : c.situacao;
  return (
    <div className={`sara-acao ${situacao}${c.risco === "alto" ? " risco" : ""}`} role="group" aria-label="Autorização da SARA">
      <span className="sara-acao-titulo"><span aria-hidden>🔒</span> {situacao === "pendente" ? "Precisa da sua permissão" : SITUACAO_ACAO[situacao] ?? situacao}</span>
      <b>{c.resumo}</b>
      {c.detalhes.length > 0 && <ul>{c.detalhes.map((d, k) => <li key={k}>{d}</li>)}</ul>}
      {situacao === "pendente" && (
        <div className="sara-acao-botoes">
          <button type="button" className="nao" disabled={decidindo === c.id} onClick={() => decidir(c, false)}>Não permitir</button>
          <button type="button" className="sim" disabled={decidindo === c.id} onClick={() => decidir(c, true)}>{decidindo === c.id ? "Fazendo…" : confirmar === c.id ? "Confirmar" : "Permitir"}</button>
        </div>
      )}
      {confirmar === c.id && <small className="sara-acao-aviso">Esta ação não se desfaz pela SARA. Toque em Confirmar para seguir.</small>}
      {c.feito && <small className="sara-acao-feito">{c.feito}</small>}
      {c.erro && <small className="sara-acao-erro">{c.erro}</small>}
    </div>
  );
}
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

export function SaraPainel({ modulo, navegar, abrirAoCarregar = 0, abrirGuias = false }: { modulo: string; navegar: (modulo: string, secao?: string) => void; abrirAoCarregar?: number; abrirGuias?: boolean }) {
  const [aberto, setAberto] = useState(false);
  // Guias (E3): a janela mostra as guias no lugar da conversa (o aviso do sino abre direto nelas).
  const [verGuias, setVerGuias] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [conversa, setConversa] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [foto, setFoto] = useState<Foto | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const [lendoCodigo, setLendoCodigo] = useState(false);
  // Anexo (E5): Excel, Word, PDF ou texto, lido no servidor; print/foto vai pelo caminho da foto.
  const [anexo, setAnexo] = useState<{ nome: string; texto: string; cortado: boolean } | null>(null);
  const [lendoAnexo, setLendoAnexo] = useState(false);
  const [menuMais, setMenuMais] = useState(false);
  useEffect(() => {
    if (!menuMais) return;
    const fechar = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".sara-mais")) setMenuMais(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuMais(false); };
    window.addEventListener("pointerdown", fechar); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", fechar); window.removeEventListener("keydown", esc); };
  }, [menuMais]);
  const [erroAnexo, setErroAnexo] = useState("");
  const { abrir: escolherAnexo, abrindo: abrindoAnexo, inputProps: entradaAnexo } = useEscolherArquivo(async (arquivos) => {
    const f = arquivos[0];
    if (!f) return;
    setErroAnexo("");
    if (f.type.startsWith("image/")) { setPreparandoFoto(true); try { setFoto(await reduzirFoto(f)); } catch { setFoto(null); } setPreparandoFoto(false); return; }
    setLendoAnexo(true);
    const dados = new FormData(); dados.set("arquivo", f);
    const r = await fetch(`/api/sara/${modulo}/anexo`, { method: "POST", body: dados }).then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setLendoAnexo(false);
    if (!r.ok) { setErroAnexo(r.body?.error ?? "Sem conexão com o servidor."); return; }
    setAnexo({ nome: r.body.nome, texto: r.body.texto, cortado: Boolean(r.body.cortado) });
  });
  // Voz (E2): toque para gravar, toque de novo para enviar; o Whisper da Cloudflare transcreve e a pergunta segue normal.
  const [gravando, setGravando] = useState<number | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [ouvindo, setOuvindo] = useState(false);
  const [erroVoz, setErroVoz] = useState("");
  const gravador = useRef<{ rec: MediaRecorder; partes: Blob[]; fluxo: MediaStream; enviar: boolean; limite: ReturnType<typeof setTimeout> } | null>(null);
  const { abrir: escolherFoto, abrindo: abrindoFoto, inputProps: entradaFoto } = useEscolherArquivo(async (arquivos) => {
    const f = arquivos[0];
    if (!f || !f.type.startsWith("image/")) return;
    setPreparandoFoto(true);
    try { setFoto(await reduzirFoto(f)); } catch { setFoto(null); }
    setPreparandoFoto(false);
  });
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
        consultas: m.consultas, fontes: m.fontes, abrir: m.abrir, fora: m.fora, visuais: m.visuais ?? [], acoes: m.acoes ?? [], parametros: m.parametros ?? [],
      }))));
      setConversa((atual) => atual ?? salvas.id);
    }
  }, [modulo]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);
  // Veio pelo atalho "SARA" do ícone do app: a janela já abre (uma vez, quando a SARA carregou).
  // Também pelo aviso do sino (cada toque é um pedido novo: o número muda).
  const ultimoPedido = useRef(0);
  useEffect(() => {
    if (!abrirAoCarregar || !estado || ultimoPedido.current === abrirAoCarregar) return;
    ultimoPedido.current = abrirAoCarregar;
    const t = setTimeout(() => { setAberto(true); setVerGuias(abrirGuias); }, 0);
    return () => clearTimeout(t);
  }, [abrirAoCarregar, abrirGuias, estado]);

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
  const perguntar = async (pergunta: string, habilidade?: string, voz = false) => {
    const p = pergunta.trim();
    const comFoto = foto;
    const comAnexo = anexo;
    if ((!p && !comFoto && !comAnexo) || pensando) return;
    setTexto(""); setFoto(null); setAnexo(null);
    setMsgs((m) => [...m, { papel: "pessoa", texto: p || (comFoto ? "📷 O que é isto?" : "Leia o documento e cruze com a plataforma."), foto: comFoto?.previa, anexo: comAnexo?.nome, quando: new Date().toISOString() }]); setPensando(true);
    const r = await fetch(`/api/sara/${modulo}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pergunta: p, conversa, habilidade: habilidade ?? null, voz, imagem: comFoto ? { tipo: comFoto.tipo, dados: comFoto.dados } : null, anexo: comAnexo ? { nome: comAnexo.nome, texto: comAnexo.texto } : null }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setPensando(false);
    if (!r.ok) { setMsgs((m) => [...m, { papel: "sara", texto: r.body?.error ?? "A SARA está indisponível agora.", erro: true, quando: new Date().toISOString() }]); return; }
    setConversa(r.body.conversa ?? conversa);
    setMsgs((m) => [...m, { papel: "sara", texto: r.body.texto, fontes: r.body.fontes ?? [], consultas: r.body.ferramentas ?? [], abrir: r.body.abrir ?? null, id: r.body.mensagem, fora: Boolean(r.body.foraDoEscopo), quando: new Date().toISOString(), visuais: r.body.visuais ?? [], acoes: r.body.acoes ?? [], parametros: r.body.parametros ?? [] }]);
    // A SARA pediu para mostrar uma tela: abre por dentro da plataforma (a janela continua aberta).
    if (r.body.abrir) abrir(r.body.abrir);
  };
  const pararGravacao = (enviar: boolean) => {
    const g = gravador.current;
    if (!g) return;
    g.enviar = enviar; clearTimeout(g.limite);
    if (g.rec.state !== "inactive") g.rec.stop();
  };
  const falar = async () => {
    if (gravando) { pararGravacao(true); return; }
    setErroVoz("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setErroVoz("Este aparelho não grava áudio no navegador. Escreva a pergunta."); return; }
    let fluxo: MediaStream;
    try { fluxo = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setErroVoz("Não foi possível usar o microfone. Libere o microfone para a plataforma nas permissões do navegador."); return; }
    const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t));
    const rec = new MediaRecorder(fluxo, tipo ? { mimeType: tipo } : undefined);
    const g = { rec, partes: [] as Blob[], fluxo, enviar: false, limite: setTimeout(() => pararGravacao(true), 60_000) };
    gravador.current = g;
    rec.ondataavailable = (e) => { if (e.data.size) g.partes.push(e.data); };
    rec.onstop = async () => {
      fluxo.getTracks().forEach((t) => t.stop());
      gravador.current = null; setGravando(null);
      if (!g.enviar) return;
      const audio = new Blob(g.partes, { type: (rec.mimeType || tipo || "audio/webm").split(";")[0] });
      setOuvindo(true);
      const r = await fetch(`/api/sara/${modulo}/voz`, { method: "POST", headers: { "content-type": audio.type }, body: audio })
        .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
      setOuvindo(false);
      if (!r.ok || !r.body?.texto) { setErroVoz(r.body?.error ?? "Sem conexão com o servidor."); return; }
      void perguntar(r.body.texto, undefined, true);
    };
    rec.start(500);
    setSegundos(0); setGravando(Date.now());
  };
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos(Math.round((Date.now() - gravando) / 1000)), 500);
    return () => clearInterval(t);
  }, [gravando]);
  // Fechou a janela ou trocou de módulo gravando: descarta e desliga o microfone.
  useEffect(() => () => pararGravacao(false), []);

  // Cartão da ação: a pessoa decide. Ação de risco alto pede um segundo toque ("Confirmar").
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  // Degrau 3: cartão preparado a partir de um aviso ("Refazer o pedido"), por chave do aviso.
  const [cartoesAviso, setCartoesAviso] = useState<Record<string, Cartao>>({});
  const [preparando, setPreparando] = useState<string | null>(null);
  const mudarCartao = (id: string, mudar: Partial<Cartao>) => {
    setMsgs((l) => l.map((m) => (m.acoes?.some((a) => a.id === id) ? { ...m, acoes: m.acoes.map((a) => (a.id === id ? { ...a, ...mudar } : a)) } : m)));
    setCartoesAviso((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.id === id ? { ...v, ...mudar } : v])));
  };
  const prepararDoAviso = async (a: Aviso) => {
    setPreparando(a.chave);
    const r = await fetch(`/api/sara/${modulo}/propor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chave: a.chave }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setPreparando(null);
    setCartoesAviso((c) => ({ ...c, [a.chave]: r.ok ? r.body.cartao : { id: `erro-${a.chave}`, resumo: a.propor?.rotulo ?? "Ação", detalhes: [], risco: "normal", situacao: "falhou", feito: null, erro: r.body?.error ?? "Sem conexão com o servidor." } }));
  };
  const decidir = async (c: Cartao, permitir: boolean) => {
    if (permitir && c.risco === "alto" && confirmar !== c.id) { setConfirmar(c.id); return; }
    setConfirmar(null); setDecidindo(c.id);
    const r = await fetch(`/api/sara/${modulo}/acoes/${c.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ permitir }) })
      .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setDecidindo(null);
    if (!r.ok) { mudarCartao(c.id, { erro: r.body?.error ?? "Sem conexão com o servidor." }); return; }
    mudarCartao(c.id, { situacao: r.body.situacao, feito: r.body.feito ?? null, erro: r.body.erro ?? null });
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
            <div><b>{NOME}</b><small>IA · consulta com as suas permissões · só faz algo se você permitir</small></div>
            <span>
              {pode && !verGuias && <button type="button" className="sara-fechar sara-guias-botao" onClick={() => setVerGuias(true)} aria-label="Guias" title="Guias: rotinas que a SARA roda sozinha"><span aria-hidden>⚡</span></button>}
              {msgs.length > 0 && !verGuias && <button type="button" className="sara-nova" onClick={() => { setMsgs([]); setConversa(null); }}>Nova conversa</button>}
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
                        {(a.abrir || a.propor) && (
                          <span className="sara-aviso-acoes">
                            {a.propor && !cartoesAviso[a.chave] && <button type="button" className="sara-propor" disabled={preparando === a.chave} onClick={() => void prepararDoAviso(a)}><span aria-hidden>⚡</span> {preparando === a.chave ? "Preparando…" : a.propor.rotulo}</button>}
                            {a.abrir && <button type="button" className="sara-abrir" onClick={() => abrir(a.abrir!)}>Abrir {a.abrir.rotulo}</button>}
                          </span>
                        )}
                        {cartoesAviso[a.chave] && <CartaoAcao c={cartoesAviso[a.chave]} decidindo={decidindo} confirmar={confirmar} decidir={(c, x) => void decidir(c, x)} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {!estado.configurada && <Callout variant="info" title="SARA ainda não configurada">Falta a chave do modelo (Claude) no servidor. Quem cuida é o proprietário.</Callout>}
          {verGuias ? <SaraGuias modulo={modulo} voltar={() => setVerGuias(false)} /> : (<>
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
                {m.papel === "sara" && !m.erro && <span className="sara-selo">{m.fora ? "SARA (IA) · fora do escopo" : "SARA (IA)"}{m.quando ? <i className="sara-selo-hora"> · {horaSP(m.quando)}</i> : null}</span>}
                {/* eslint-disable-next-line @next/next/no-img-element -- prévia local da foto enviada (dado em memória, não fica guardada) */}
                {m.foto && <img className="sara-foto" src={m.foto} alt="Foto enviada à SARA" />}
                {m.anexo && <span className="sara-anexo-msg"><IconeClipe /> {m.anexo}</span>}
                <div className="sara-texto">{m.papel === "sara" ? <Texto texto={m.texto} /> : <p>{m.texto}</p>}</div>
                {m.visuais?.map((v, k) => <SaraVisual key={k} v={v} />)}
                {m.acoes?.map((c) => <CartaoAcao key={c.id} c={c} decidindo={decidindo} confirmar={confirmar} decidir={(x, permitir) => void decidir(x, permitir)} />)}
                {m.consultas && m.consultas.length > 0 && <small className="sara-consultas">Consultou: {[...new Set(m.consultas)].map(rotulo).join(", ")}</small>}
                {m.parametros && m.parametros.length > 0 && (
                  <details className="sara-parametros">
                    <summary>Parâmetros usados</summary>
                    <ul>{m.parametros.map((x, k) => <li key={k}><b>{x.consulta}</b>: {x.filtros.join(" · ")}</li>)}</ul>
                  </details>
                )}
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
          {lendoCodigo && <LeitorDeCodigo onFechar={() => setLendoCodigo(false)} onLido={(valor, formato) => { setLendoCodigo(false); void perguntar(`Código lido: ${valor} (${formato}). O que é?`); }} />}
          {/* Caixa de mensagem (o padrão dos chats): + (foto, arquivo, código) à esquerda; microfone e enviar à direita. */}
          <form className={`sara-caixa${gravando ? " gravando" : ""}`} onSubmit={(e) => { e.preventDefault(); void perguntar(texto); }}>
            <input {...entradaFoto} accept="image/*" capture="environment" />
            <input {...entradaAnexo} accept=".pdf,.xlsx,.xls,.csv,.docx,.txt,image/*" />
            {(foto || anexo || preparandoFoto || lendoAnexo) && (
              <div className="sara-caixa-anexos">
                {foto && (
                  <span className="sara-chip-foto">
                    {/* eslint-disable-next-line @next/next/no-img-element -- prévia local antes de enviar */}
                    <img src={foto.previa} alt="Foto pronta para enviar" />
                    <button type="button" onClick={() => setFoto(null)} aria-label="Tirar a foto"><IconeX /></button>
                  </span>
                )}
                {anexo && (
                  <span className="sara-chip" title={anexo.cortado ? "Arquivo grande: a SARA lê o começo (40 mil caracteres)." : undefined}>
                    <IconeClipe /> <span>{anexo.nome}{anexo.cortado ? " (início)" : ""}</span>
                    <button type="button" onClick={() => setAnexo(null)} aria-label="Tirar o anexo"><IconeX /></button>
                  </span>
                )}
                {(preparandoFoto || lendoAnexo) && <span className="sara-chip"><Carregando /> {lendoAnexo ? "Lendo o arquivo…" : "Preparando a foto…"}</span>}
              </div>
            )}
            {gravando ? (
              <div className="sara-caixa-gravando" aria-live="polite">
                <span className="sara-rec" aria-hidden /> Gravando {`0:${String(segundos).padStart(2, "0")}`}
                <span className="sara-onda" aria-hidden><i /><i /><i /><i /><i /></span>
              </div>
            ) : (
              <textarea rows={1} value={texto} disabled={!pode || pensando} maxLength={2000}
                placeholder={!pode ? "SARA indisponível" : ouvindo ? "Ouvindo…" : foto ? "Pergunte sobre a foto (ou só envie)…" : anexo ? "Pergunte sobre o anexo (ou só envie)…" : "Pergunte à SARA…"}
                onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void perguntar(texto); } }} aria-label="Pergunta para a SARA" />
            )}
            <div className="sara-caixa-barra">
              {gravando ? (
                <button type="button" className="sara-icone" onClick={() => pararGravacao(false)} aria-label="Cancelar a gravação" title="Cancelar"><IconeX /></button>
              ) : (
                <span className="sara-mais">
                  <button type="button" className="sara-icone" onClick={() => setMenuMais((v) => !v)} disabled={!pode || pensando || ouvindo}
                    aria-haspopup="menu" aria-expanded={menuMais} aria-label="Adicionar foto, arquivo ou código" title="Adicionar"><IconeMais /></button>
                  {menuMais && (
                    <span className="sara-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMenuMais(false); escolherFoto(); }}><IconeCamera /> Tirar foto</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuMais(false); escolherAnexo(); }}><IconeClipe /> Foto ou arquivo</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuMais(false); setLendoCodigo(true); }}><IconeCodigo /> Ler código</button>
                    </span>
                  )}
                </span>
              )}
              <span className="sara-caixa-espaco" />
              {(abrindoFoto || abrindoAnexo) && <small className="sara-caixa-dica">Abrindo…</small>}
              <button type="button" className={`sara-icone${gravando ? " ativo" : ""}`} onClick={() => void falar()} disabled={!pode || pensando || ouvindo}
                aria-pressed={Boolean(gravando)} aria-label={gravando ? "Parar e enviar o áudio" : "Falar"} title={gravando ? "Parar e enviar" : "Falar"}>
                {ouvindo ? <Carregando /> : gravando ? <IconeParar /> : <IconeMicrofone />}
              </button>
              {!gravando && (
                <button type="submit" className="sara-enviar" disabled={!pode || pensando || (texto.trim().length < 2 && !foto && !anexo)} aria-label="Enviar">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </div>
            {(erroVoz || erroAnexo) && <small className="sara-caixa-erro" role="alert">{erroVoz || erroAnexo}</small>}
          </form>
          </>)}
        </aside>
      )}
    </>
  );
}
