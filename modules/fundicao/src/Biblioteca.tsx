"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Carregando, EscolherArquivo, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import type { ModuleRuntimeProps } from "../../runtime";
import { chamar } from "../../almoxarifado/src/tipos";
import { TIPOS_DESENHO, type Peca, type TipoDesenho, type VersaoLinha } from "../../../lib/fundicao/biblioteca-regras";

/**
 * Fundição › Biblioteca: todos os desenhos da Forja (cópia guardada na plataforma, que não se
 * perde quando a Forja troca ou exclui) e os desenhos antigos da pasta física, por peça. Cada
 * peça mostra se já passou pela Fundição, as revisões, as versões antigas do arquivo e as
 * anotações da Fundição para o próximo trabalho.
 */

type Nota = { id: string; artigo_chave: string; texto: string; autor_id: string | null; autor_nome: string | null; created_at: string; updated_at: string };
type Resposta = { podeOperar: boolean; eu: string | null; pecas: Peca[]; notas: Nota[]; mais: boolean; resumo: { desenhos: number; fundidos: number; acervo: number } };
type Desenho = Peca["desenhos"][number];
type FiltroFundicao = "todas" | "fundidas" | "previstas" | "sem";

const FILTROS: { value: FiltroFundicao; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "fundidas", label: "Já fundidas" },
  { value: "previstas", label: "Previstas" },
  { value: "sem", label: "Sem Fundição no roteiro" },
];

const data = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const tamanho = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`);
const urlArquivo = (id: string, baixar = false) => `/api/fundicao/biblioteca/arquivo/${id}${baixar ? "?baixar=1" : ""}`;

export function Biblioteca({ notify }: Pick<ModuleRuntimeProps, "notify">) {
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [fundicao, setFundicao] = useState<FiltroFundicao>("todas");
  const [tipo, setTipo] = useState("");
  const [removidos, setRemovidos] = useState(false);
  const [ver, setVer] = useState<{ desenho: Desenho; peca: Peca; versao: VersaoLinha } | null>(null);
  const [enviar, setEnviar] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    const p = new URLSearchParams();
    if (termo.length >= 2) p.set("q", termo);
    if (fundicao !== "todas") p.set("fundicao", fundicao);
    if (tipo) p.set("tipo", tipo);
    if (removidos) p.set("removidos", "1");
    const r = await chamar<Resposta>(`/api/fundicao/biblioteca?${p}`);
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setResposta(r.data);
  }, [termo, fundicao, tipo, removidos]);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const podeOperar = resposta?.podeOperar ?? false;
  const cabecalho = (
    <div className="finance-page-head almox-head">
      <div>
        <p className="eyebrow">FUNDIÇÃO · BIBLIOTECA</p>
        <h1>Biblioteca de desenhos</h1>
        <p>Todos os desenhos da Forja, guardados aqui mesmo que a Forja troque ou exclua, e os desenhos antigos da pasta física. Procure pela peça, pelo cliente ou pelo código do desenho.</p>
      </div>
      {podeOperar && <Button onClick={() => setEnviar(true)}>Enviar desenho antigo</Button>}
    </div>
  );

  return (
    <div className="almox-modulo bib-modulo">
      {cabecalho}
      {resposta && (
        <KpiGrid>
          <Kpi label="Desenhos" value={resposta.resumo.desenhos.toLocaleString("pt-BR")} caption="Na Biblioteca" tone="blue" />
          <Kpi label="Já fundidos" value={resposta.resumo.fundidos.toLocaleString("pt-BR")} caption="Peça com lote que passou pela Fundição" tone="green" />
          <Kpi label="Acervo da Fundição" value={resposta.resumo.acervo.toLocaleString("pt-BR")} caption="Desenhos antigos da pasta física" tone="purple" />
        </KpiGrid>
      )}
      <div className="bib-filtros">
        <input type="search" className="bib-busca" placeholder="Peça, descrição, cliente ou código do desenho" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar na Biblioteca" />
        <Segmented<FiltroFundicao> options={FILTROS} value={fundicao} onChange={setFundicao} compact ariaLabel="Passagem pela Fundição" />
        <label className="bib-campo-inline"><span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(TIPOS_DESENHO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="bib-marca"><input type="checkbox" checked={removidos} onChange={(e) => setRemovidos(e.target.checked)} /> <span>Mostrar os removidos na Forja</span></label>
      </div>

      {erro ? (
        <div className="finance-empty almox-vazio"><b>{erro}</b><small>Tente de novo em instantes.</small></div>
      ) : !resposta ? (
        <div className="finance-empty almox-vazio"><b><Carregando /> Carregando…</b><small /></div>
      ) : !resposta.pecas.length ? (
        <div className="finance-empty almox-vazio">
          <b>{resposta.resumo.desenhos ? "Nenhum desenho neste filtro" : "A Biblioteca ainda está vazia"}</b>
          <small>{resposta.resumo.desenhos ? "Mude a busca ou os filtros." : "Os desenhos da Forja chegam sozinhos a cada 10 minutos. Os antigos, da pasta física, entram por \"Enviar desenho antigo\"."}</small>
        </div>
      ) : (
        <>
          {resposta.mais && <p className="bib-aviso">Mostrando os primeiros 200 desenhos. Refine a busca para ver o resto.</p>}
          <div className="bib-pecas">
            {resposta.pecas.map((peca) => (
              <CartaoPeca key={peca.chave} peca={peca} notas={resposta.notas.filter((n) => n.artigo_chave === peca.chave)} eu={resposta.eu} podeOperar={podeOperar}
                onVer={(desenho, versao) => setVer({ desenho, peca, versao })}
                onMudou={async (msg) => { notify(msg); await carregar(); }} />
            ))}
          </div>
        </>
      )}

      {ver && <Visualizador {...ver} onClose={() => setVer(null)} onVersao={(versao) => setVer({ ...ver, versao })} />}
      {enviar && <EnviarAntigo onClose={() => setEnviar(false)} onEnviado={async (msg) => { setEnviar(false); notify(msg); await carregar(); }} />}
    </div>
  );
}

function SeloFundicao({ peca }: { peca: Pick<Peca, "fundidaEm" | "prevista" | "os"> }) {
  if (peca.fundidaEm) return <Status tone="success">Fundida em {data(peca.fundidaEm)}{peca.os.length ? ` · OS ${peca.os.slice(-3).join(", ")}${peca.os.length > 3 ? "…" : ""}` : ""}</Status>;
  if (peca.prevista) return <Status tone="info">Prevista no roteiro</Status>;
  return null;
}

function CartaoPeca({ peca, notas, eu, podeOperar, onVer, onMudou }: {
  peca: Peca; notas: Nota[]; eu: string | null; podeOperar: boolean;
  onVer: (d: Desenho, v: VersaoLinha) => void; onMudou: (msg: string) => Promise<void>;
}) {
  const [apagando, setApagando] = useState<string | null>(null);
  const apagarAcervo = async (d: Desenho) => {
    setApagando(d.id);
    const r = await chamar(`/api/fundicao/biblioteca/acervo?id=${d.id}`, { method: "DELETE" });
    setApagando(null);
    if (!r.ok) { await onMudou(r.error); return; }
    await onMudou(`Desenho ${d.codigo} apagado da Biblioteca.`);
  };
  return (
    <section className="bib-peca">
      <header className="bib-peca-cabeca">
        <div className="bib-peca-nome">
          <b>{peca.codigo}</b>
          <span>{peca.descricao ?? "Sem descrição"}{peca.cliente ? ` · ${peca.cliente}` : ""}</span>
        </div>
        <SeloFundicao peca={peca} />
      </header>
      <div className="bib-tabela" role="table" aria-label={`Desenhos da peça ${peca.codigo}`}>
        <div className="cabeca" role="row"><span>Tipo</span><span>Desenho</span><span>Rev.</span><span>Data da revisão</span><span>Situação</span><span>Arquivo</span></div>
        {peca.desenhos.map((d) => {
          const atual = d.versoes.find((v) => !v.substituido_em) ?? d.versoes[0];
          const antigas = d.versoes.filter((v) => v.substituido_em).length;
          return (
            <div key={d.id} role="row" className={d.removido_na_forja_em ? "bib-removido" : undefined}>
              <span>{TIPOS_DESENHO[d.tipo as TipoDesenho] ?? d.tipo}</span>
              <span className="nome">{d.codigo}{d.observacoes && <small>{d.observacoes}</small>}</span>
              <span>{d.revisao || "—"}</span>
              <span>{data(d.data_revisao)}</span>
              <span className="bib-selos">
                {d.removido_na_forja_em ? <Status tone="danger">Removido na Forja</Status> : d.atual ? <Status tone="success">Revisão atual</Status> : <Status tone="neutral">Revisão antiga</Status>}
                {d.origem === "acervo" && <Status tone="purple">Acervo da Fundição</Status>}
                {antigas > 0 && <Status tone="attention">{antigas} versão(ões) antiga(s)</Status>}
              </span>
              <span className="bib-acoes">
                {atual ? (
                  <>
                    <Button variant="secondary" compact onClick={() => onVer(d, atual)}>Ver</Button>
                    <a className="ds-button ghost compact" href={urlArquivo(atual.id, true)}>Baixar</a>
                  </>
                ) : <small className="bib-mudo">Arquivo chegando da Forja</small>}
                {podeOperar && d.origem === "acervo" && (eu === d.enviado_por) && (
                  <Button variant="ghost" compact disabled={apagando === d.id} onClick={() => void apagarAcervo(d)}>{apagando === d.id ? "Apagando…" : "Apagar"}</Button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <Anotacoes peca={peca} notas={notas} eu={eu} podeOperar={podeOperar} onMudou={onMudou} />
    </section>
  );
}

function Anotacoes({ peca, notas, eu, podeOperar, onMudou }: { peca: Peca; notas: Nota[]; eu: string | null; podeOperar: boolean; onMudou: (msg: string) => Promise<void> }) {
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  if (!notas.length && !podeOperar) return null;

  const gravar = async (event: FormEvent) => {
    event.preventDefault();
    setSalvando(true);
    const r = await chamar("/api/fundicao/biblioteca/notas", { method: "POST", body: JSON.stringify({ artigo: peca.chave, texto }) });
    setSalvando(false);
    if (!r.ok) { setErro(r.error); return; }
    setTexto(""); setErro("");
    await onMudou(`Anotação gravada na peça ${peca.codigo}.`);
  };
  const salvarEdicao = async () => {
    if (!editando) return;
    setSalvando(true);
    const r = await chamar("/api/fundicao/biblioteca/notas", { method: "PATCH", body: JSON.stringify(editando) });
    setSalvando(false);
    if (!r.ok) { setErro(r.error); return; }
    setEditando(null); setErro("");
    await onMudou("Anotação alterada.");
  };
  const apagar = async (id: string) => {
    const r = await chamar(`/api/fundicao/biblioteca/notas?id=${id}`, { method: "DELETE" });
    if (!r.ok) { setErro(r.error); return; }
    await onMudou("Anotação apagada.");
  };

  return (
    <div className="bib-notas">
      <p className="bib-notas-titulo">Anotações da Fundição</p>
      {notas.map((n) => (
        <div key={n.id} className="bib-nota">
          {editando?.id === n.id ? (
            <div className="bib-nota-editar">
              <textarea value={editando.texto} onChange={(e) => setEditando({ id: n.id, texto: e.target.value })} rows={3} maxLength={4000} aria-label="Alterar a anotação" />
              <div className="bib-linha-botoes">
                <Button compact disabled={salvando || !editando.texto.trim()} onClick={() => void salvarEdicao()}>{salvando ? "Salvando…" : "Salvar"}</Button>
                <Button variant="ghost" compact onClick={() => setEditando(null)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <>
              <p>{n.texto}</p>
              <small>
                {n.autor_nome ?? "—"} · {dataHora(n.created_at)}{n.updated_at !== n.created_at ? " (alterada)" : ""}
                {podeOperar && eu === n.autor_id && (
                  <>
                    {" · "}<button type="button" className="bib-link" onClick={() => setEditando({ id: n.id, texto: n.texto })}>Alterar</button>
                    {" · "}<button type="button" className="bib-link" onClick={() => void apagar(n.id)}>Apagar</button>
                  </>
                )}
              </small>
            </>
          )}
        </div>
      ))}
      {podeOperar && (
        <form className="bib-nota-nova" onSubmit={gravar}>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={4000} placeholder="Ex.: massalote, contração, o que deu problema na última corrida…" aria-label={`Nova anotação na peça ${peca.codigo}`} />
          <Button type="submit" compact disabled={salvando || !texto.trim()}>{salvando ? "Gravando…" : "Anotar"}</Button>
        </form>
      )}
      {erro && <p className="almox-erro" role="alert">{erro}</p>}
    </div>
  );
}

function Visualizador({ desenho, peca, versao, onClose, onVersao }: { desenho: Desenho; peca: Peca; versao: VersaoLinha; onClose: () => void; onVersao: (v: VersaoLinha) => void }) {
  const imagem = (versao.mime ?? "").startsWith("image/");
  return (
    <Modal eyebrow={`Fundição · ${peca.codigo}`} title={`${desenho.codigo}${desenho.revisao ? ` · rev. ${desenho.revisao}` : ""}`}
      subtitle={`${TIPOS_DESENHO[desenho.tipo as TipoDesenho] ?? desenho.tipo}${peca.cliente ? ` · ${peca.cliente}` : ""}`} onClose={onClose}>
      <div className="bib-visor">
        {versao.substituido_em && <p className="bib-aviso">Versão antiga do arquivo, substituída em {dataHora(versao.substituido_em)}.</p>}
        <div className="bib-visor-quadro">
          {imagem
            ? <img src={urlArquivo(versao.id)} alt={`Desenho ${desenho.codigo}`} />
            : <iframe src={urlArquivo(versao.id)} title={`Desenho ${desenho.codigo}`} />}
        </div>
        <div className="bib-visor-rodape">
          <span>{versao.nome ?? "desenho"} {tamanho(versao.tamanho) && `· ${tamanho(versao.tamanho)}`} · recebido em {dataHora(versao.recebido_em)}</span>
          <a className="ds-button primary compact" href={urlArquivo(versao.id, true)}>Baixar</a>
        </div>
        {desenho.versoes.length > 1 && (
          <div className="bib-versoes">
            <p className="bib-notas-titulo">Versões do arquivo</p>
            {desenho.versoes.map((v) => (
              <button key={v.id} type="button" className={`bib-versao${v.id === versao.id ? " ativa" : ""}`} onClick={() => onVersao(v)}>
                {v.substituido_em ? `Antiga · substituída em ${dataHora(v.substituido_em)}` : "Atual"} · recebida em {dataHora(v.recebido_em)}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

type PecaCadastro = { id: string; codigo: string; descricao: string; cliente: string | null };

function EnviarAntigo({ onClose, onEnviado }: { onClose: () => void; onEnviado: (msg: string) => Promise<void> }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [buscaPeca, setBuscaPeca] = useState("");
  const [achadas, setAchadas] = useState<PecaCadastro[]>([]);
  const [peca, setPeca] = useState<PecaCadastro | null>(null);
  const [cliente, setCliente] = useState("");
  const [tipo, setTipo] = useState<TipoDesenho>("cliente");
  const [codigo, setCodigo] = useState("");
  const [revisao, setRevisao] = useState("");
  const [dataRevisao, setDataRevisao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (peca || buscaPeca.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await chamar<{ pecas: PecaCadastro[] }>(`/api/fundicao/biblioteca/pecas?q=${encodeURIComponent(buscaPeca.trim())}`);
      setAchadas(r.ok ? r.data.pecas : []);
    }, 300);
    return () => clearTimeout(t);
  }, [buscaPeca, peca]);

  const enviar = async (event: FormEvent) => {
    event.preventDefault();
    if (!arquivo) { setErro("Escolha o arquivo do desenho."); return; }
    setEnviando(true); setErro("");
    const f = new FormData();
    f.set("arquivo", arquivo);
    if (peca) f.set("product_id", peca.id);
    else f.set("artigo_codigo", buscaPeca.trim());
    f.set("cliente_nome", peca?.cliente ?? cliente);
    f.set("tipo", tipo); f.set("codigo", codigo); f.set("revisao", revisao);
    if (dataRevisao) f.set("data_revisao", dataRevisao);
    if (observacoes) f.set("observacoes", observacoes);
    try {
      const res = await fetch("/api/fundicao/biblioteca/acervo", { method: "POST", body: f });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.existente) { setErro(`Esse arquivo já está na Biblioteca${body.artigo ? `, na peça ${body.artigo}` : ""}.`); return; }
      if (!res.ok) { setErro(body?.error === "FORBIDDEN" ? "Sem permissão para esta ação." : body?.error || "Não foi possível enviar."); return; }
      await onEnviado(`Desenho ${codigo} guardado na peça ${body.artigo}.`);
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setEnviando(false);
    }
  };

  const prontoParaEnviar = Boolean(arquivo && codigo.trim() && (peca || buscaPeca.trim()));
  return (
    <Modal eyebrow="Fundição · Biblioteca" title="Enviar desenho antigo" subtitle="Desenho escaneado da pasta física. Ele fica na Biblioteca com o selo Acervo da Fundição." onClose={onClose}>
      <form className="almox-form bib-form" onSubmit={enviar}>
        <EscolherArquivo rotulo="Escolher o desenho" aceita="application/pdf,image/png,image/jpeg" arquivo={arquivo?.name ?? null}
          onEscolher={(a) => { setArquivo(a[0] ?? null); setErro(""); }} ajuda="PDF, PNG ou JPEG, até 50 MB." />
        <label className="almox-largo"><span>Peça (código ou descrição no cadastro; se não achar, fica o código digitado)</span>
          {peca ? (
            <div className="bib-peca-escolhida">
              <b>{peca.codigo}</b> <span>{peca.descricao}{peca.cliente ? ` · ${peca.cliente}` : ""}</span>
              <button type="button" className="bib-link" onClick={() => { setPeca(null); setAchadas([]); }}>Trocar</button>
            </div>
          ) : (
            <input value={buscaPeca} onChange={(e) => setBuscaPeca(e.target.value)} placeholder="Ex.: 5-01-0123 ou FORMA" maxLength={100} />
          )}
        </label>
        {!peca && achadas.length > 0 && (
          <div className="bib-achadas" role="listbox" aria-label="Peças do cadastro">
            {achadas.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => { setPeca(p); setAchadas([]); }}>
                <b>{p.codigo}</b> <span>{p.descricao}{p.cliente ? ` · ${p.cliente}` : ""}</span>
              </button>
            ))}
          </div>
        )}
        {!peca && <label className="almox-largo"><span>Cliente (opcional)</span><input value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={200} /></label>}
        <div className="bib-form-linha">
          {/* O select vai dentro de um span: a regra global `:where(label):has(> select)` o deixaria na horizontal. */}
          <label><span>Tipo</span>
            <span className="bib-select">
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoDesenho)}>
                {Object.entries(TIPOS_DESENHO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </span>
          </label>
          <label><span>Código do desenho</span><input value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={100} required /></label>
          <label><span>Revisão</span><input value={revisao} onChange={(e) => setRevisao(e.target.value)} maxLength={30} /></label>
          <label><span>Data da revisão</span><input type="date" value={dataRevisao} onChange={(e) => setDataRevisao(e.target.value)} /></label>
        </div>
        <label className="almox-largo"><span>Observação (opcional)</span><textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} maxLength={2000} /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <div className="bib-linha-botoes">
          <Button type="submit" disabled={enviando || !prontoParaEnviar}>{enviando ? "Enviando…" : "Guardar na Biblioteca"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}
