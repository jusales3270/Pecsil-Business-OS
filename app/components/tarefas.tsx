"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Callout, Modal, Segmented, Status, type StatusTone } from "../../packages/design-system";
import { GravarReuniao, guardarReuniao, reuniaoGuardada } from "./gravar-reuniao";

/**
 * Tarefas e quadro (I-28, PLANO-SARA-FERRAMENTAS etapa 3): combinados com responsável e prazo, de uma reunião, de
 * uma ata ou de um pedido à SARA. Qualquer pessoa cria para qualquer outra; quem recebe pode devolver com o motivo.
 * Quem pode o quê é conferido pelo banco (tarefa_atualizar); a tela só mostra os botões que fazem sentido.
 */

type Situacao = "aberta" | "em_andamento" | "feita" | "devolvida" | "cancelada";
export type Tarefa = { id: string; quadro_id: string | null; titulo: string; detalhe: string | null; modulo: string | null; responsavel_id: string | null; responsavel_nome: string | null;
  prazo: string | null; situacao: Situacao; motivo: string | null; criado_por: string | null; criado_por_nome: string | null; concluida_em: string | null; created_at: string };
type Quadro = { id: string; titulo: string; origem: string; resumo: string | null; criado_por_nome: string | null; created_at: string };
type Pessoa = { id: string; nome: string };
type ItemLido = { titulo: string; detalhe: string | null; responsavel: Pessoa | null; prazo: string | null; modulo: string | null; avisos: string[] };

const SITUACAO: Record<Situacao, [string, StatusTone]> = {
  aberta: ["Aberta", "info"], em_andamento: ["Em andamento", "purple"], feita: ["Feita", "success"], devolvida: ["Devolvida", "attention"], cancelada: ["Cancelada", "neutral"],
};
const AREA: Record<string, string> = { financeiro: "Financeiro", compras: "Compras", almoxarifado: "Almoxarifado", fundicao: "Fundição", comercial: "Comercial", fiscal: "Fiscal", rh: "RH", portaria: "Portaria", producao: "Produção", ti: "TI", qualidade: "Qualidade" };
const aberta = (t: Tarefa) => t.situacao === "aberta" || t.situacao === "em_andamento";
const br = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function pedir<T = Record<string, unknown>>(url: string, corpo?: unknown): Promise<{ ok: true; j: T } | { ok: false; erro: string }> {
  const r = await fetch(url, corpo === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  return r?.ok ? { ok: true, j: j as T } : { ok: false, erro: (j as { error?: string } | null)?.error ?? "Não foi possível agora. Tente de novo." };
}

function usePessoas() {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => { let vivo = true; void pedir<{ pessoas: Pessoa[] }>("/api/tarefas?pessoas=1").then((r) => { if (vivo && r.ok) setPessoas(r.j.pessoas); }); return () => { vivo = false; }; }, []);
  return pessoas;
}

function Prazo({ t, hoje }: { t: Tarefa; hoje: string }) {
  if (!t.prazo) return <span className="tarefa-prazo sem">sem prazo</span>;
  const vencida = aberta(t) && t.prazo < hoje;
  return <span className={`tarefa-prazo${vencida ? " vencida" : t.prazo === hoje && aberta(t) ? " hoje" : ""}`}>{vencida ? "venceu " : t.prazo === hoje ? "hoje · " : "até "}{br(t.prazo)}</span>;
}

function LinhaTarefa({ t, hoje, abrir, mostrarResponsavel = true }: { t: Tarefa; hoje: string; abrir: (id: string) => void; mostrarResponsavel?: boolean }) {
  const [rotulo, tom] = SITUACAO[t.situacao];
  return (
    <li>
      <button type="button" className="tarefa-linha" onClick={() => abrir(t.id)}>
        <span className="tarefa-texto"><b>{t.titulo}</b><small>{[mostrarResponsavel ? (t.responsavel_nome ?? "sem responsável") : null, t.modulo ? AREA[t.modulo] : null, t.criado_por_nome ? `pedida por ${t.criado_por_nome}` : null].filter(Boolean).join(" · ")}</small></span>
        <Prazo t={t} hoje={hoje} />
        <Status tone={tom}>{rotulo}</Status>
      </button>
    </li>
  );
}

/** Uma tarefa: detalhe, histórico e o que a pessoa pode fazer (o banco confere de novo). */
export function DetalheTarefa({ id, pessoas, onClose, onMudou, notify }: { id: string; pessoas: Pessoa[]; onClose: () => void; onMudou: () => void; notify: (m: string) => void }) {
  const [dados, setDados] = useState<{ tarefa: Tarefa & { quadros?: { titulo: string } | null }; andamentos: { tipo: string; texto: string | null; autor_nome: string | null; created_at: string }[]; eu: string } | null>(null);
  const [erro, setErro] = useState("");
  const [modo, setModo] = useState<"" | "devolver" | "cancelar" | "comentar" | "prazo" | "responsavel">("");
  const [texto, setTexto] = useState("");
  const [prazo, setPrazo] = useState("");
  const [resp, setResp] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    const r = await pedir<NonNullable<typeof dados>>(`/api/tarefas/${id}`);
    if (!r.ok) { setErro(r.erro); return; }
    setErro(""); setDados(r.j);
  }, [id]);
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, [carregar]);
  const agir = async (acao: string, extra: Record<string, unknown> = {}) => {
    setOcupado(true);
    const r = await pedir(`/api/tarefas/${id}`, { acao, ...extra });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    setModo(""); setTexto(""); setErro("");
    notify({ andamento: "Marcada em andamento.", feita: "Tarefa concluída.", devolver: "Tarefa devolvida: quem pediu foi avisado.", reabrir: "Tarefa reaberta.", cancelar: "Tarefa cancelada.", comentar: "Comentário registrado.", prazo: "Prazo alterado.", responsavel: "Responsável trocado: a pessoa foi avisada." }[acao] ?? "Feito.");
    await carregar(); onMudou();
  };
  const t = dados?.tarefa;
  const souResp = Boolean(t && dados && t.responsavel_id === dados.eu);
  const souCriador = Boolean(t && dados && t.criado_por === dados.eu);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (modo === "prazo") void agir("prazo", { prazo: prazo || null, texto });
    else if (modo === "responsavel") void agir("responsavel", { responsavel: resp, texto });
    else if (modo) void agir(modo, { texto });
  };
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return (
    <Modal eyebrow={t?.quadros?.titulo ? `Quadro · ${t.quadros.titulo}` : "Tarefa"} title={t?.titulo ?? "Carregando…"} subtitle={t ? [t.responsavel_nome ?? "Sem responsável", t.modulo ? AREA[t.modulo] : null, t.criado_por_nome ? `pedida por ${t.criado_por_nome}` : null].filter(Boolean).join(" · ") : undefined} onClose={onClose}>
      {erro && <p className="almox-erro" role="alert">{erro}</p>}
      {t && (
        <div className="tarefa-detalhe">
          <div className="tarefa-detalhe-topo"><Prazo t={t} hoje={hoje} /><Status tone={SITUACAO[t.situacao][1]}>{SITUACAO[t.situacao][0]}</Status></div>
          {t.detalhe && <p>{t.detalhe}</p>}
          {t.motivo && <p className="tarefa-motivo"><b>{t.situacao === "devolvida" ? "Devolvida:" : "Motivo:"}</b> {t.motivo}</p>}
          <ol className="tarefa-historico" aria-label="Histórico">
            {dados.andamentos.map((a, k) => <li key={k}><time>{quando(a.created_at)}</time><span><b>{a.autor_nome ?? "Plataforma"}</b> · {a.tipo === "criada" ? "criou" : a.tipo === "andamento" ? "em andamento" : a.tipo === "feita" ? "concluiu" : a.tipo === "devolvida" ? "devolveu" : a.tipo === "reaberta" ? "reabriu" : a.tipo === "cancelada" ? "cancelou" : a.tipo === "prazo" ? "mudou o prazo" : a.tipo === "responsavel" ? "trocou o responsável" : a.tipo === "cobranca" ? "avisou" : "comentou"}{a.texto ? `: ${a.texto}` : ""}</span></li>)}
          </ol>
          {modo ? (
            <form className="almox-form tarefa-acao" onSubmit={enviar}>
              {modo === "prazo" && <label><span>Novo prazo</span><input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></label>}
              {modo === "responsavel" && <label><span>Novo responsável</span><span className="doc-envio-select"><select value={resp} onChange={(e) => setResp(e.target.value)} required><option value="">Escolha a pessoa</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></span></label>}
              <label><span>{modo === "devolver" ? "Por que você está devolvendo?" : modo === "cancelar" ? "Por que cancelar?" : modo === "comentar" ? "Comentário" : "Observação (opcional)"}</span>
                <textarea rows={2} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} required={modo === "devolver" || modo === "cancelar" || modo === "comentar"} /></label>
              <footer><Button type="button" variant="ghost" onClick={() => { setModo(""); setTexto(""); }}>Voltar</Button><Button type="submit" disabled={ocupado}>{ocupado ? "Salvando…" : "Confirmar"}</Button></footer>
            </form>
          ) : (
            <div className="tarefa-botoes">
              {souResp && t.situacao === "aberta" && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => void agir("andamento")}>Em andamento</Button>}
              {(souResp || souCriador) && aberta(t) && <Button type="button" disabled={ocupado} onClick={() => void agir("feita")}>Concluir</Button>}
              {souResp && aberta(t) && <Button type="button" variant="secondary" onClick={() => setModo("devolver")}>Devolver</Button>}
              {souCriador && <Button type="button" variant="secondary" onClick={() => { setPrazo(t.prazo ?? ""); setModo("prazo"); }}>Mudar prazo</Button>}
              {souCriador && <Button type="button" variant="secondary" onClick={() => { setResp(t.responsavel_id ?? ""); setModo("responsavel"); }}>Trocar responsável</Button>}
              {souCriador && !aberta(t) && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => void agir("reabrir")}>Reabrir</Button>}
              {souCriador && aberta(t) && <Button type="button" variant="ghost" onClick={() => setModo("cancelar")}>Cancelar a tarefa</Button>}
              <Button type="button" variant="ghost" onClick={() => setModo("comentar")}>Comentar</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function NovaTarefa({ pessoas, onClose, onCriada }: { pessoas: Pessoa[]; onClose: () => void; onCriada: () => void }) {
  const [f, setF] = useState({ titulo: "", detalhe: "", responsavel: "", prazo: "", modulo: "" });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const criar = async (e: FormEvent) => {
    e.preventDefault(); setOcupado(true);
    const r = await pedir("/api/tarefas", { acao: "tarefa", ...f, responsavel: f.responsavel || null, prazo: f.prazo || null, modulo: f.modulo || null });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    onCriada();
  };
  return (
    <Modal eyebrow="Tarefas" title="Nova tarefa" subtitle="O responsável é avisado no sino e cobrado na véspera e no vencimento." onClose={onClose}>
      <form className="almox-form" onSubmit={criar}>
        <label><span>O que fazer</span><input value={f.titulo} maxLength={200} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Ligar para a Cristal Rosario e confirmar o pagamento" required /></label>
        <div className="tarefa-campos">
          <label><span>Responsável</span><span className="doc-envio-select"><select value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })}><option value="">Definir depois</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></span></label>
          <label><span>Prazo</span><input type="date" value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} /></label>
          <label><span>Área</span><span className="doc-envio-select"><select value={f.modulo} onChange={(e) => setF({ ...f, modulo: e.target.value })}><option value="">—</option>{Object.entries(AREA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></span></label>
        </div>
        <label><span>Detalhe (opcional)</span><textarea rows={2} maxLength={2000} value={f.detalhe} onChange={(e) => setF({ ...f, detalhe: e.target.value })} /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={ocupado}>{ocupado ? "Criando…" : "Criar tarefa"}</Button></footer>
      </form>
    </Modal>
  );
}

/** Uma reunião, ata ou anotação vira um quadro: a SARA lê, a pessoa confere e corrige a lista, e só então cria. */
export function MontarQuadro({ pessoas, onClose, onCriado, textoInicial = "", origem = "texto", lerAoAbrir = false }: { pessoas: Pessoa[]; onClose: () => void; onCriado: () => void; textoInicial?: string; origem?: "texto" | "reuniao"; lerAoAbrir?: boolean }) {
  const [texto, setTexto] = useState(textoInicial);
  const [lido, setLido] = useState<{ titulo: string; resumo: string; itens: (ItemLido & { responsavelId: string })[] } | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const ler = async () => {
    setOcupado(true); setErro("");
    const r = await pedir<{ titulo: string; resumo: string; itens: ItemLido[] }>("/api/tarefas", { acao: "ler", texto });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    if (!r.j.itens.length) { setErro("A SARA não achou combinados no texto (alguém ficando de fazer algo)."); return; }
    setLido({ titulo: r.j.titulo, resumo: r.j.resumo, itens: r.j.itens.map((i) => ({ ...i, responsavelId: i.responsavel?.id ?? "" })) });
  };
  // A reunião gravada chega pronta: a SARA já começa a ler (uma vez).
  const leu = useRef(false);
  // A trava só vale quando a leitura começa de fato: montar, desmontar e montar de novo (React em modo estrito)
  // cancela o primeiro agendamento, e o segundo é o que lê.
  useEffect(() => {
    if (!lerAoAbrir || textoInicial.trim().length < 20) return;
    const t = setTimeout(() => { if (!leu.current) { leu.current = true; void ler(); } }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mudar = (k: number, campo: Partial<ItemLido & { responsavelId: string }>) => setLido((l) => (l ? { ...l, itens: l.itens.map((i, j) => (j === k ? { ...i, ...campo } : i)) } : l));
  const criar = async () => {
    if (!lido) return;
    setOcupado(true); setErro("");
    const r = await pedir("/api/tarefas", { acao: "quadro", origem, titulo: lido.titulo, resumo: lido.resumo, texto,
      itens: lido.itens.map((i) => ({ titulo: i.titulo, detalhe: i.detalhe, responsavel: i.responsavelId || null, prazo: i.prazo || null, modulo: i.modulo })) });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    onCriado();
  };
  const faltam = lido?.itens.filter((i) => !i.responsavelId || !i.prazo).length ?? 0;
  return (
    <Modal eyebrow={origem === "reuniao" ? "Tarefas · reunião gravada" : "Tarefas"} title={lido ? "Confira o quadro" : origem === "reuniao" ? "Texto da reunião" : "Montar quadro de uma reunião"} subtitle={lido ? "Corrija o que precisar: só vira tarefa quando você criar." : origem === "reuniao" ? "A reunião virou texto. A SARA lista os combinados com o responsável e o prazo; você confere antes de criar." : "Cole a ata ou as anotações. A SARA lista os combinados com o responsável e o prazo; você confere antes de criar."} onClose={onClose}>
      {!lido ? (
        <div className="almox-form">
          <label><span>Texto da reunião</span><textarea rows={9} maxLength={60000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"Ex.: Ana liga para a Cristal Rosario até sexta para confirmar o pagamento.\nRafa revê o roteiro da OS 12676 até dia 20.\nHenrique confere o estoque de grafite amanhã."} /></label>
          {erro && <p className="almox-erro" role="alert">{erro}</p>}
          <footer><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="button" disabled={ocupado || texto.trim().length < 20} onClick={() => void ler()}>{ocupado ? (texto.length > 8000 ? "A SARA está lendo (pode levar até um minuto)…" : "A SARA está lendo…") : "Ler com a SARA"}</Button></footer>
        </div>
      ) : (
        <div className="almox-form tarefa-quadro-conferir">
          <label><span>Título do quadro</span><input value={lido.titulo} maxLength={160} onChange={(e) => setLido({ ...lido, titulo: e.target.value })} /></label>
          {lido.resumo && <p className="tarefa-resumo">{lido.resumo}</p>}
          <ol className="tarefa-itens">
            {lido.itens.map((i, k) => (
              <li key={k}>
                <input aria-label={`Tarefa ${k + 1}`} value={i.titulo} maxLength={200} onChange={(e) => mudar(k, { titulo: e.target.value })} />
                <span className="doc-envio-select"><select aria-label={`Responsável da tarefa ${k + 1}`} value={i.responsavelId} onChange={(e) => mudar(k, { responsavelId: e.target.value })}><option value="">Sem responsável</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></span>
                <input aria-label={`Prazo da tarefa ${k + 1}`} type="date" value={i.prazo ?? ""} onChange={(e) => mudar(k, { prazo: e.target.value || null })} />
                <button type="button" className="tarefa-tirar" aria-label={`Tirar a tarefa ${k + 1}`} onClick={() => setLido({ ...lido, itens: lido.itens.filter((_, j) => j !== k) })}>✕</button>
                {i.avisos.length > 0 && <small>{i.avisos.join(" ")}</small>}
              </li>
            ))}
          </ol>
          {faltam > 0 && <p className="tarefa-falta">{faltam} {faltam === 1 ? "tarefa está" : "tarefas estão"} sem responsável ou sem prazo: dá para criar assim e completar depois.</p>}
          {erro && <p className="almox-erro" role="alert">{erro}</p>}
          <footer><Button type="button" variant="ghost" onClick={() => setLido(null)}>Voltar ao texto</Button><Button type="button" disabled={ocupado || !lido.itens.length} onClick={() => void criar()}>{ocupado ? "Criando…" : `Criar o quadro (${lido.itens.length})`}</Button></footer>
        </div>
      )}
    </Modal>
  );
}

/** Fundação › Tarefas: os quadros e as tarefas que a pessoa vê, por prazo ou por pessoa. */
export function TarefasView({ notify, quadroInicial = "" }: { notify: (m: string) => void; quadroInicial?: string }) {
  const [dados, setDados] = useState<{ eu: string; hojeIso: string; tarefas: Tarefa[]; quadros: Quadro[] } | null>(null);
  const [erro, setErro] = useState("");
  const [quem, setQuem] = useState<"minhas" | "pedi" | "todas">("minhas");
  const [ver, setVer] = useState<"prazo" | "pessoa">("prazo");
  const [quadro, setQuadro] = useState(quadroInicial);
  const [fechadas, setFechadas] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [montar, setMontar] = useState<{ texto: string; origem: "texto" | "reuniao" } | null>(null);
  const [gravar, setGravar] = useState(false);
  // Reunião gravada que ainda não virou quadro (fechou sem querer, recarregou a página): dá para retomar.
  const [guardada, setGuardada] = useState<{ texto: string; em: number } | null>(null);
  useEffect(() => { const t = setTimeout(() => setGuardada(reuniaoGuardada()), 0); return () => clearTimeout(t); }, [montar, gravar]);
  const pessoas = usePessoas();
  const carregar = useCallback(async () => {
    const r = await pedir<NonNullable<typeof dados>>("/api/tarefas");
    if (!r.ok) { setErro(r.erro); return; }
    setErro(""); setDados(r.j);
  }, []);
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, [carregar]);
  const hoje = dados?.hojeIso ?? "";
  const lista = useMemo(() => (dados?.tarefas ?? []).filter((t) => (quem === "minhas" ? t.responsavel_id === dados?.eu : quem === "pedi" ? t.criado_por === dados?.eu : true)
    && (!quadro || t.quadro_id === quadro) && (fechadas || aberta(t))), [dados, quem, quadro, fechadas]);
  const grupos = useMemo((): [string, Tarefa[]][] => {
    if (ver === "pessoa") {
      const m = new Map<string, Tarefa[]>();
      for (const t of lista) m.set(t.responsavel_nome ?? "Sem responsável", [...(m.get(t.responsavel_nome ?? "Sem responsável") ?? []), t]);
      return [...m.entries()].sort((a, b) => (a[0] === "Sem responsável" ? -1 : b[0] === "Sem responsável" ? 1 : a[0].localeCompare(b[0], "pt-BR")));
    }
    if (!hoje) return []; // os hooks rodam antes de os dados chegarem: sem a data de hoje, não há grupo por prazo
    const semana = new Date(`${hoje}T12:00:00Z`); semana.setUTCDate(semana.getUTCDate() + 7);
    const fimSemana = semana.toISOString().slice(0, 10);
    const g: [string, Tarefa[]][] = [["Vencidas", []], ["Hoje", []], ["Próximos 7 dias", []], ["Depois", []], ["Sem prazo", []], ["Concluídas, devolvidas e canceladas", []]];
    for (const t of lista) {
      const i = !aberta(t) ? 5 : !t.prazo ? 4 : t.prazo < hoje ? 0 : t.prazo === hoje ? 1 : t.prazo <= fimSemana ? 2 : 3;
      g[i][1].push(t);
    }
    return g.filter(([, l]) => l.length);
  }, [lista, ver, hoje]);
  const progresso = (q: Quadro) => { const ts = (dados?.tarefas ?? []).filter((t) => t.quadro_id === q.id && t.situacao !== "cancelada"); return { total: ts.length, feitas: ts.filter((t) => t.situacao === "feita").length }; };

  if (erro) return <Callout variant="warning" title="Tarefas">{erro}</Callout>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">COMBINADOS</p>
          <h1>Tarefas</h1>
          <p>O que cada um ficou de fazer, com o prazo. Quem recebe é avisado no sino e cobrado na véspera e no vencimento; pode devolver dizendo o motivo.</p>
        </div>
        <div className="icms-acoes">
          <Button type="button" variant="secondary" onClick={() => setGravar(true)}>Gravar reunião</Button>
          <Button type="button" variant="secondary" onClick={() => setMontar({ texto: "", origem: "texto" })}>Montar quadro de uma reunião</Button>
          <Button type="button" onClick={() => setNova(true)}>Nova tarefa</Button>
        </div>
      </div>
      {guardada && !gravar && !montar && (
        <Callout variant="info" title="Há uma reunião gravada que ainda não virou quadro">
          Gravada às {new Date(guardada.em).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}, com {guardada.texto.length.toLocaleString("pt-BR")} caracteres de texto.
          <span className="tarefa-retomar"><Button type="button" compact onClick={() => setMontar({ texto: guardada.texto, origem: "reuniao" })}>Montar o quadro</Button><Button type="button" compact variant="ghost" onClick={() => { guardarReuniao(""); setGuardada(null); }}>Descartar</Button></span>
        </Callout>
      )}
      <div className="tarefas-filtros">
        <Segmented<"minhas" | "pedi" | "todas"> ariaLabel="De quem" value={quem} onChange={setQuem} options={[{ value: "minhas", label: "Minhas" }, { value: "pedi", label: "Que pedi" }, { value: "todas", label: "Todas que vejo" }]} />
        <Segmented<"prazo" | "pessoa"> ariaLabel="Ver por" value={ver} onChange={setVer} options={[{ value: "prazo", label: "Por prazo" }, { value: "pessoa", label: "Por pessoa" }]} />
        <span className="doc-envio-select"><select aria-label="Quadro" value={quadro} onChange={(e) => setQuadro(e.target.value)}><option value="">Todos os quadros</option>{dados.quadros.map((q) => <option key={q.id} value={q.id}>{q.titulo}</option>)}</select></span>
        <label className="tarefas-fechadas"><input type="checkbox" checked={fechadas} onChange={(e) => setFechadas(e.target.checked)} /> Mostrar concluídas</label>
      </div>
      {quadro && (() => { const q = dados.quadros.find((x) => x.id === quadro); if (!q) return null; const p = progresso(q); return <p className="tarefa-resumo">{q.resumo ?? q.titulo} · {p.feitas} de {p.total} feitas · criado por {q.criado_por_nome ?? "—"} em {quando(q.created_at)}</p>; })()}
      {!grupos.length
        ? <div className="finance-empty almox-vazio"><b>{quem === "minhas" ? "Nenhuma tarefa sua em aberto" : "Nenhuma tarefa aqui"}</b><small>Crie uma tarefa ou monte um quadro a partir de uma reunião.</small></div>
        : grupos.map(([titulo, ts]) => (
          <section key={titulo} className="parados-area tarefas-grupo" aria-label={titulo}>
            <header><h2>{titulo}</h2><Status tone={titulo === "Vencidas" ? "danger" : titulo === "Hoje" ? "attention" : "neutral"}>{ts.length}</Status></header>
            <ul>{ts.map((t) => <LinhaTarefa key={t.id} t={t} hoje={hoje} abrir={setAberto} mostrarResponsavel={ver === "prazo"} />)}</ul>
          </section>
        ))}
      {aberto && <DetalheTarefa id={aberto} pessoas={pessoas} onClose={() => setAberto(null)} onMudou={() => void carregar()} notify={notify} />}
      {nova && <NovaTarefa pessoas={pessoas} onClose={() => setNova(false)} onCriada={() => { setNova(false); notify("Tarefa criada: o responsável foi avisado."); void carregar(); }} />}
      {gravar && <GravarReuniao onClose={() => setGravar(false)} onTexto={(texto) => { setGravar(false); setMontar({ texto, origem: "reuniao" }); }} />}
      {montar && <MontarQuadro pessoas={pessoas} textoInicial={montar.texto} origem={montar.origem} lerAoAbrir={montar.origem === "reuniao"} onClose={() => setMontar(null)}
        onCriado={() => { if (montar.origem === "reuniao") guardarReuniao(""); setMontar(null); setQuem("pedi"); notify("Quadro criado: os responsáveis foram avisados."); void carregar(); }} />}
    </>
  );
}

/** O que tarefas_minhas devolve (a pessoa é a responsável; "criado_por" é o nome de quem pediu). */
type Minha = { id: string; titulo: string; detalhe: string | null; modulo: string | null; prazo: string | null; situacao: Situacao; motivo: string | null;
  criado_por: string | null; quadro: string | null; quadro_id: string | null; criada_em: string; concluida_em: string | null };
const comoTarefa = (m: Minha): Tarefa => ({ id: m.id, quadro_id: m.quadro_id, titulo: m.titulo, detalhe: m.detalhe, modulo: m.modulo, responsavel_id: null, responsavel_nome: null,
  prazo: m.prazo, situacao: m.situacao, motivo: m.motivo, criado_por: null, criado_por_nome: m.criado_por, concluida_em: m.concluida_em, created_at: m.criada_em });

/** Menu da conta › Minhas tarefas (o aviso do sino abre já na tarefa). */
export function MinhasTarefas({ focoId, onClose, notify }: { focoId?: string | null; onClose: () => void; notify: (m: string) => void }) {
  const [dados, setDados] = useState<{ tarefas: Minha[]; hojeIso: string } | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<string | null>(focoId ?? null);
  const pessoas = usePessoas();
  const carregar = useCallback(async () => {
    const r = await pedir<NonNullable<typeof dados>>("/api/tarefas?minhas=1");
    if (!r.ok) { setErro(r.erro); return; }
    setErro(""); setDados(r.j);
  }, []);
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, [carregar]);
  const lista = (dados?.tarefas ?? []).map(comoTarefa);
  const abertas = lista.filter(aberta), outras = lista.filter((t) => !aberta(t));
  if (aberto) return <DetalheTarefa id={aberto} pessoas={pessoas} onClose={() => setAberto(null)} onMudou={() => void carregar()} notify={notify} />;
  return (
    <Modal eyebrow="Conta" title="Minhas tarefas" subtitle="O que você ficou de fazer, pelo prazo. Toque para concluir, marcar o andamento ou devolver." onClose={onClose}>
      {erro && <p className="almox-erro" role="alert">{erro}</p>}
      {!dados ? <p className="ds-detail-empty">Carregando…</p> : (
        <div className="tarefas-minhas">
          {!abertas.length && <p className="ds-detail-empty">Nenhuma tarefa sua em aberto.</p>}
          {abertas.length > 0 && <section className="parados-area tarefas-grupo"><ul>{abertas.map((t) => <LinhaTarefa key={t.id} t={t} hoje={dados.hojeIso} abrir={setAberto} mostrarResponsavel={false} />)}</ul></section>}
          {outras.length > 0 && <section className="parados-area tarefas-grupo" aria-label="Últimos 30 dias"><header><h2>Últimos 30 dias</h2></header><ul>{outras.map((t) => <LinhaTarefa key={t.id} t={t} hoje={dados.hojeIso} abrir={setAberto} mostrarResponsavel={false} />)}</ul></section>}
          <footer><Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
        </div>
      )}
    </Modal>
  );
}

/** War Room › Conselho: o andamento das tarefas da empresa (a diretoria vê todas). */
export function ResumoTarefas() {
  const [dados, setDados] = useState<{ hojeIso: string; tarefas: Tarefa[]; quadros: Quadro[] } | null>(null);
  useEffect(() => { let vivo = true; void pedir<NonNullable<typeof dados>>("/api/tarefas").then((r) => { if (vivo && r.ok) setDados(r.j); }); return () => { vivo = false; }; }, []);
  if (!dados) return null;
  const abertas = dados.tarefas.filter(aberta);
  const vencidas = abertas.filter((t) => t.prazo && t.prazo < dados.hojeIso);
  const devolvidas = dados.tarefas.filter((t) => t.situacao === "devolvida");
  const quadros = dados.quadros.slice(0, 5).map((q) => { const ts = dados.tarefas.filter((t) => t.quadro_id === q.id && t.situacao !== "cancelada"); return { q, total: ts.length, feitas: ts.filter((t) => t.situacao === "feita").length }; }).filter((x) => x.total);
  return (
    <section className="cresc" aria-labelledby="tarefas-titulo">
      <header className="vigia-topo"><div><h3 id="tarefas-titulo">Tarefas</h3><p>Os combinados da empresa com responsável e prazo. O detalhe está em Fundação › Tarefas.</p></div>
        <Button type="button" variant="secondary" compact onClick={() => { window.location.href = "/?view=Tarefas"; }}>Abrir Tarefas</Button></header>
      <div className="tarefas-numeros">
        <span><b>{abertas.length}</b><small>em aberto</small></span>
        <span className={vencidas.length ? "ruim" : ""}><b>{vencidas.length}</b><small>vencidas</small></span>
        <span className={devolvidas.length ? "atencao" : ""}><b>{devolvidas.length}</b><small>devolvidas</small></span>
      </div>
      {quadros.length > 0 && <ul className="tarefas-quadros">{quadros.map(({ q, total, feitas }) => <li key={q.id}><a href={`/?view=Tarefas&quadro=${q.id}`}>{q.titulo}</a><span className="tarefa-barra" aria-label={`${feitas} de ${total} feitas`}><i style={{ width: `${Math.round((feitas / total) * 100)}%` }} /></span><small>{feitas}/{total}</small></li>)}</ul>}
    </section>
  );
}
