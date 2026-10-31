"use client";

/* eslint-disable @next/next/no-img-element -- fotos servidas pela rota autenticada da plataforma */

import { useCallback, useEffect, useMemo, useState } from "react";
import { destacarNaTela, useRegistroNaTela } from "../../../lib/registro-na-tela";
import { definirRegistroAberto } from "../../../lib/tela-atual";
import { Button, Callout, Modal, Segmented, Status } from "../../../packages/design-system";
import { VisualizarArquivo } from "../../../app/components/visualizar-arquivo";
import { useModuleNav } from "../../../lib/module-nav-context";
import { canUseFeature } from "../../access";
import type { ModuleRuntimeProps } from "../../runtime";

/**
 * Qualidade (docs/PLANO-QUALIDADE.md). Primeira seção: Não conformidades. O registro nasce na conversa com
 * a SARA da Qualidade; aqui se vê, se filtra, se corrige, se encerra e se cancela, sempre com histórico.
 */

type Secao = "Não conformidades" | "Regras";
type Situacao = "aberta" | "encerrada" | "cancelada";
type Filtro = Situacao | "todas";
type Linha = { id: string; numero: number; tipo: string; setor: string; local: string | null; maquina: string | null; os_codigo: string | null; gravidade: string | null; situacao: Situacao; descricao: string; autor_nome: string; created_at: string; qualidade_nc_fotos: { id: string }[] };
type Regras = { tipos: string[]; usar_gravidade: boolean; gravidades: string[]; revisado_por_nome: string | null; revisado_em: string | null };
type Dados = { ncs: Linha[]; regras: Regras | null; setores: string[]; podeOperar: boolean; podeRegras: boolean };
type Detalhe = { nc: Linha & { analise_sara: string | null; confianca: "alta" | "media" | "baixa" | null }; andamentos: { id: string; autor_nome: string; tipo: string; texto: string; created_at: string }[] };

const SITUACAO: Record<Situacao, { label: string; tone: "attention" | "success" | "neutral" }> = {
  aberta: { label: "Aberta", tone: "attention" }, encerrada: { label: "Encerrada", tone: "success" }, cancelada: { label: "Cancelada", tone: "neutral" },
};
const CONFIANCA = { alta: "alta", media: "média", baixa: "baixa" } as const;
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const urlFoto = (id: string) => `/api/qualidade/foto/${id}`;

async function chamar<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = String(corpo?.error ?? "");
      return { ok: false, error: e === "FORBIDDEN" ? "Sem permissão." : e === "UNAUTHENTICATED" ? "Sessão expirada: entre de novo." : e && !/^[A-Z_]+$/.test(e) ? e : "Não foi possível carregar. Tente de novo." };
    }
    return { ok: true, data: corpo as T };
  } catch {
    return { ok: false, error: "Sem conexão com a plataforma." };
  }
}

export default function QualidadeApp({ access, notify, initialSection }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const podeVer = canUseFeature(access, "qualidade.nao_conformidades");
  const podeAprovar = canUseFeature(access, "qualidade.nao_conformidades", "aprovar");
  const temSara = canUseFeature(access, "qualidade.sara");
  const secoes = useMemo(() => ([
    podeVer && { id: "Não conformidades" as Secao, icon: "alert" },
    podeAprovar && { id: "Regras" as Secao, icon: "settings" },
  ].filter(Boolean) as { id: Secao; icon: string }[]), [podeVer, podeAprovar]);
  const [secao, setSecao] = useState<Secao>(() => (secoes.find((s) => s.id === initialSection)?.id ?? "Não conformidades"));
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const r = await chamar<Dados>("/api/qualidade/nc");
    if (r.ok) { setDados(r.data); setErro(""); } else setErro(r.error);
  }, []);
  useEffect(() => {
    if (!podeVer) return;
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [podeVer, carregar]);
  // A SARA grava em outra janela: ao voltar para a aba e quando ela registra, a lista atualiza.
  useEffect(() => {
    const atualizar = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", atualizar);
    window.addEventListener("sara:acao-feita", atualizar);
    return () => { document.removeEventListener("visibilitychange", atualizar); window.removeEventListener("sara:acao-feita", atualizar); };
  }, [carregar]);

  const abertas = dados?.ncs.filter((n) => n.situacao === "aberta").length ?? 0;
  useEffect(() => {
    registerNav({
      moduleId: "qualidade", moduleName: "Qualidade", sidebarTree: true,
      items: secoes.map(({ id, icon }) => ({ id, label: id, icon, ...(id === "Não conformidades" && abertas ? { badge: abertas, badgeTone: "attention" as const } : {}) })),
      activeId: secao,
      onSelect: (id) => setSecao(id as Secao),
    });
  }, [registerNav, secoes, secao, abertas]);
  useEffect(() => () => registerNav(null), [registerNav]);

  if (!secoes.length) return <div className="almox-modulo"><div className="finance-empty almox-vazio"><b>Sem acesso às telas da Qualidade</b><small>Peça a liberação ao proprietário.</small></div></div>;
  const depois = async (m: string) => { if (m) notify(m); await carregar(); };

  return (
    <div className="almox-modulo">
      {erro && <Callout variant="danger" title="Não carregou">{erro}</Callout>}
      {secao === "Não conformidades" && <Lista dados={dados} temSara={temSara} depois={depois} />}
      {secao === "Regras" && (dados?.regras ? <RegrasNc key={dados.regras.revisado_em ?? "provisorio"} regras={dados.regras} onSalvo={(m) => void depois(m)} /> : <Carregando />)}
    </div>
  );
}

const Carregando = () => <div className="finance-empty almox-vazio"><b>Carregando…</b><small /></div>;

function Lista({ dados, temSara, depois }: { dados: Dados | null; temSara: boolean; depois: (m: string) => Promise<void> }) {
  const [filtro, setFiltro] = useState<Filtro>("aberta");
  const [tipo, setTipo] = useState("");
  const [setor, setSetor] = useState("");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  // A SARA pediu uma NC: tira os filtros (ela pode não estar entre as abertas) e abre ou acende a linha.
  useRegistroNaTela("nc", (p) => {
    setFiltro("todas"); setTipo(""); setSetor(""); setBusca("");
    if (p.modo === "destacar") destacarNaTela(p.id); else setAberta(p.id);
  });
  useEffect(() => { definirRegistroAberto(aberta ? { tipo: "nc", id: aberta } : null); return () => definirRegistroAberto(null); }, [aberta]);

  const todas = useMemo(() => dados?.ncs ?? [], [dados]);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todas.filter((n) => (filtro === "todas" || n.situacao === filtro) && (!tipo || n.tipo === tipo) && (!setor || n.setor === setor)
      && (!q || `nc-${n.numero} ${n.descricao} ${n.local ?? ""} ${n.maquina ?? ""} ${n.os_codigo ?? ""} ${n.autor_nome}`.toLowerCase().includes(q)));
  }, [todas, filtro, tipo, setor, busca]);
  const contagem = (s: Situacao) => todas.filter((n) => n.situacao === s).length;
  // Tipo que saiu da lista da área continua no filtro enquanto houver registro com ele.
  const tipos = useMemo(() => [...new Set([...(dados?.regras?.tipos ?? []), ...todas.map((n) => n.tipo)])], [dados, todas]);

  return (
    <>
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">QUALIDADE · NÃO CONFORMIDADES</p><h1>Não conformidades</h1><p>O que foi visto na fábrica, com a foto e o histórico. O registro é feito pela SARA da Qualidade: foto, voz ou texto, e você confirma.</p></div>
        {temSara && dados?.podeOperar && <Button onClick={() => window.dispatchEvent(new Event("sara:abrir"))}>Registrar com a SARA</Button>}
      </div>
      {!dados ? <Carregando /> : (
        <section className="almox-bloco">
          <div className="qualidade-filtros">
            <Segmented<Filtro> ariaLabel="Situação" value={filtro} onChange={setFiltro}
              options={[{ value: "aberta", label: `Abertas (${contagem("aberta")})` }, { value: "encerrada", label: `Encerradas (${contagem("encerrada")})` }, { value: "cancelada", label: `Canceladas (${contagem("cancelada")})` }, { value: "todas", label: "Todas" }]} />
            <select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos os tipos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select aria-label="Setor" value={setor} onChange={(e) => setSetor(e.target.value)}><option value="">Todos os setores</option>{dados.setores.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <input type="search" aria-label="Buscar" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          {!lista.length ? (
            <div className="finance-empty almox-vazio"><b>{todas.length ? "Nada com estes filtros" : "Nenhuma não conformidade registrada"}</b><small>{todas.length ? "Mude os filtros acima." : "Quando alguém registrar pela SARA, aparece aqui."}</small></div>
          ) : (
            <div className="vnd-tabela qualidade-nc" role="table" aria-label="Não conformidades">
              <div className="cabeca" role="row"><span>Foto</span><span>Nº</span><span>O que aconteceu</span><span>Setor e local</span><span>Tipo</span><span>Situação</span><span>Registrou</span></div>
              {lista.map((n) => (
                <button type="button" role="row" key={n.id} data-registro={n.id} onClick={() => setAberta(n.id)}>
                  <span className="qualidade-miniatura">{n.qualidade_nc_fotos[0] ? <img src={urlFoto(n.qualidade_nc_fotos[0].id)} alt="" loading="lazy" /> : <small>sem foto</small>}</span>
                  <span>NC-{n.numero}</span>
                  <span className="nome qualidade-desc">{n.descricao}<small>{dataHora(n.created_at)}{n.qualidade_nc_fotos.length > 1 ? ` · ${n.qualidade_nc_fotos.length} fotos` : ""}</small><small className="qualidade-so-celular">NC-{n.numero} · {n.setor} · {SITUACAO[n.situacao].label}</small></span>
                  <span className="nome">{n.setor}<small>{[n.local, n.maquina].filter(Boolean).join(" · ") || "—"}</small></span>
                  <span>{n.tipo}{n.gravidade ? ` · ${n.gravidade}` : ""}</span>
                  <span><Status tone={SITUACAO[n.situacao].tone}>{SITUACAO[n.situacao].label}</Status></span>
                  <span>{n.autor_nome}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {aberta && dados && <DetalheNc id={aberta} dados={dados} onClose={() => setAberta(null)} depois={depois} />}
    </>
  );
}

function DetalheNc({ id, dados, onClose, depois }: { id: string; dados: Dados; onClose: () => void; depois: (m: string) => Promise<void> }) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  const [corrigir, setCorrigir] = useState<{ tipo: string; setor: string; local: string; maquina: string; os: string; descricao: string; gravidade: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamar<Detalhe>(`/api/qualidade/nc/${id}`);
    if (r.ok) { setD(r.data); setErro(""); } else setErro(r.error);
  }, [id]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const n = d?.nc;
  const agir = async (acao: string, aviso: string, extra?: Record<string, unknown>) => {
    setEnviando(true); setErro("");
    const r = await chamar(`/api/qualidade/nc/${id}`, { method: "POST", body: JSON.stringify({ acao, texto, extra }) });
    setEnviando(false);
    if (!r.ok) return setErro(r.error);
    setTexto(""); setCorrigir(null);
    await carregar();
    await depois(aviso);
  };

  return (
    <Modal eyebrow={n ? `NC-${n.numero} · ${n.tipo}` : "Não conformidade"} title={n ? `${n.setor}${n.local ? ` · ${n.local}` : ""}` : "Carregando…"}
      subtitle={n ? `Registrada por ${n.autor_nome} em ${dataHora(n.created_at)}` : undefined} onClose={onClose}>
      {!n ? (erro ? <p className="almox-erro">{erro}</p> : <p className="ds-detail-empty">Carregando…</p>) : (
        <div className="almox-detalhe ti-chamado">
          <div className="ti-chamado-selos">
            <Status tone={SITUACAO[n.situacao].tone}>{SITUACAO[n.situacao].label}</Status>
            {n.gravidade && <span className="ti-quem">Gravidade: {n.gravidade}</span>}
            {n.maquina && <span className="ti-quem">Máquina: {n.maquina}</span>}
            {n.os_codigo && <span className="ti-quem">OS: {n.os_codigo}</span>}
          </div>
          {n.qualidade_nc_fotos.length > 0 ? (
            <div className="qualidade-fotos">
              {n.qualidade_nc_fotos.map((f, i) => <button type="button" key={f.id} onClick={() => setFoto(f.id)} aria-label={`Ampliar a foto ${i + 1}`}><img src={urlFoto(f.id)} alt={`Foto ${i + 1} da NC-${n.numero}`} /></button>)}
            </div>
          ) : <p className="ti-nota">Registrada sem foto.</p>}
          <div><p className="almox-rotulo">O que aconteceu</p><p className="qualidade-texto">{n.descricao}</p></div>
          {n.analise_sara && (
            <div className="qualidade-sara">
              <p className="almox-rotulo">Leitura da SARA{n.confianca ? ` · confiança ${CONFIANCA[n.confianca]}` : ""}</p>
              <p>{n.analise_sara}</p>
              <small>Opinião do modelo sobre a foto, não é dado apurado.</small>
            </div>
          )}
          <ol className="ti-linha-tempo">
            {d?.andamentos.map((a) => (
              <li key={a.id} className={`ti-andamento ${a.tipo === "registro" ? "abertura" : a.tipo === "comentario" ? "comentario" : "situacao"}`}>
                <header><b>{a.autor_nome}</b><time>{dataHora(a.created_at)}</time></header>
                <p>{a.texto}</p>
              </li>
            ))}
          </ol>
          {dados.podeOperar && (
            <div className="almox-form ti-form">
              <label><span>{n.situacao === "aberta" ? "Comentário, ou o motivo de encerrar ou cancelar" : "Por que reabrir"}</span>
                <textarea rows={3} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} />
              </label>
              {erro && <p className="almox-erro" role="alert">{erro}</p>}
              <div className="ti-acoes">
                {n.situacao === "aberta" && <Button onClick={() => void agir("comentar", "Comentário registrado.")} disabled={enviando || !texto.trim()}>Comentar</Button>}
                {n.situacao === "aberta" && <Button variant="secondary" onClick={() => void agir("encerrar", `NC-${n.numero} encerrada.`)} disabled={enviando}>Encerrar</Button>}
                {n.situacao === "aberta" && !corrigir && <Button variant="secondary" disabled={enviando} onClick={() => setCorrigir({ tipo: n.tipo, setor: n.setor, local: n.local ?? "", maquina: n.maquina ?? "", os: n.os_codigo ?? "", descricao: n.descricao, gravidade: n.gravidade ?? "" })}>Corrigir</Button>}
                {n.situacao !== "aberta" && <Button onClick={() => void agir("reabrir", `NC-${n.numero} reaberta.`)} disabled={enviando}>Reabrir</Button>}
                {n.situacao === "aberta" && <Button variant="ghost" className="almox-perigo" onClick={() => void agir("cancelar", `NC-${n.numero} cancelada.`)} disabled={enviando || !texto.trim()} title="Use o texto para dizer o motivo">Cancelar registro</Button>}
              </div>
            </div>
          )}
          {corrigir && (
            <div className="almox-bloco-interno">
              <p className="almox-rotulo">Corrigir o registro</p>
              <div className="almox-campos">
                <label><span>Tipo</span><select value={corrigir.tipo} onChange={(e) => setCorrigir({ ...corrigir, tipo: e.target.value })}>{[...new Set([n.tipo, ...(dados.regras?.tipos ?? [])])].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                <label><span>Setor</span><select value={corrigir.setor} onChange={(e) => setCorrigir({ ...corrigir, setor: e.target.value })}>{[...new Set([n.setor, ...dados.setores])].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                <label><span>Local</span><input value={corrigir.local} maxLength={160} onChange={(e) => setCorrigir({ ...corrigir, local: e.target.value })} /></label>
                <label><span>Máquina</span><input value={corrigir.maquina} maxLength={160} onChange={(e) => setCorrigir({ ...corrigir, maquina: e.target.value })} /></label>
                <label><span>OS</span><input value={corrigir.os} maxLength={40} onChange={(e) => setCorrigir({ ...corrigir, os: e.target.value })} /></label>
                {dados.regras?.usar_gravidade && <label><span>Gravidade</span><select value={corrigir.gravidade} onChange={(e) => setCorrigir({ ...corrigir, gravidade: e.target.value })}><option value="">—</option>{dados.regras.gravidades.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>}
                <label className="ti-campo-4"><span>Descrição</span><textarea rows={4} maxLength={4000} value={corrigir.descricao} onChange={(e) => setCorrigir({ ...corrigir, descricao: e.target.value })} /></label>
              </div>
              <div className="ti-acoes">
                <Button disabled={enviando} onClick={() => void agir("corrigir", `NC-${n.numero} corrigida.`, corrigir)}>Salvar correção</Button>
                <Button variant="ghost" disabled={enviando} onClick={() => setCorrigir(null)}>Desistir</Button>
              </div>
            </div>
          )}
          <footer><Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
        </div>
      )}
      {foto && n && <VisualizarArquivo nome={`NC-${n.numero}.jpg`} url={urlFoto(foto)} baixar={`${urlFoto(foto)}?baixar=1`} onFechar={() => setFoto(null)} />}
    </Modal>
  );
}

function RegrasNc({ regras, onSalvo }: { regras: Regras; onSalvo: (m: string) => void }) {
  const [tipos, setTipos] = useState(regras.tipos.join("\n"));
  const [usar, setUsar] = useState(regras.usar_gravidade);
  const [gravidades, setGravidades] = useState(regras.gravidades.join("\n"));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const linhas = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

  const salvar = async () => {
    setErro("");
    if (!linhas(tipos).length) return setErro("Informe ao menos um tipo.");
    setSalvando(true);
    const r = await chamar("/api/qualidade/regras", { method: "PUT", body: JSON.stringify({ tipos: linhas(tipos), usarGravidade: usar, gravidades: linhas(gravidades) }) });
    setSalvando(false);
    if (!r.ok) return setErro(r.error);
    onSalvo("Regras salvas.");
  };

  return (
    <>
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">QUALIDADE · REGRAS</p><h1>Tipos e gravidade</h1><p>A SARA classifica cada não conformidade nesta lista. Mudar aqui vale para os próximos registros; os antigos ficam como estão.</p></div>
      </div>
      {regras.revisado_em
        ? <Callout variant="success" title="Revisado">Por {regras.revisado_por_nome ?? "—"} em {dataHora(regras.revisado_em)}.</Callout>
        : <Callout variant="warning" title="Provisório">Esta lista foi posta na implantação do módulo. Quem decide é a área de Qualidade: revise e salve.</Callout>}
      <section className="almox-bloco">
        <div className="almox-form ti-form">
          <div className="ti-regras">
            <label><span>Tipos (um por linha)</span><textarea rows={10} value={tipos} onChange={(e) => setTipos(e.target.value)} /></label>
            <div className="qualidade-gravidade">
              <label className="qualidade-marcar"><input type="checkbox" checked={usar} onChange={(e) => setUsar(e.target.checked)} /><span>Usar gravidade</span></label>
              <label><span>Gravidades (uma por linha, da menor para a maior)</span><textarea rows={6} value={gravidades} disabled={!usar} onChange={(e) => setGravidades(e.target.value)} /></label>
            </div>
          </div>
          {erro && <p className="almox-erro" role="alert">{erro}</p>}
          <footer><Button onClick={() => void salvar()} disabled={salvando} aria-busy={salvando}>{salvando ? "Salvando…" : "Salvar regras"}</Button></footer>
        </div>
      </section>
    </>
  );
}
