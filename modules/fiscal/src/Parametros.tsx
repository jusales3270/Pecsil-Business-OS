"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { atuais, historico, type Parametro } from "../../../lib/contabil/parametros";
import { api, date, dataHora, hoje } from "./comum";

/**
 * Fiscal › Parâmetros (Contábil-Fiscal, N-01): as tabelas, alíquotas, prazos e códigos com vigência e
 * fonte oficial que os cálculos usam; as teses dos tribunais; e o perfil fiscal da empresa (modo de
 * operação, regime, RAT/FAP). Tudo nasce como rascunho e só vale "conferido" depois do contador.
 * Desenho em docs/PLANO-CONTABIL-FISCAL.md.
 */

type Linha = Parametro & { origem: string; motivo_descarte: string | null; conferido_por_nome: string | null; conferido_em: string | null; criado_por_nome: string | null; created_at: string };
type Tese = {
  id: string; tribunal: string; tema: string; leading_case: string | null; titulo: string; tese: string; data: string | null; modulacao: string | null;
  situacao: "firmada" | "firmada_modulacao_pendente" | "pendente" | "superada"; impacto: string | null; observacao: string | null;
  parametros_afetados: string[]; fontes: string[]; confianca: "alta" | "media" | "baixa"; conferida_por_nome: string | null; conferida_em: string | null;
};
type Perfil = { modo: "interna" | "escritorio"; regime: "presumido" | "real" | "a_definir"; cnaes_secundarios: string[]; rat: number | null; fap: number | null; beneficio_estadual: string | null; observacao: string | null; updated_at: string | null; updated_by_name: string | null };
type Empresa = { cnpj: string | null; cnae: string | null; crt: number | null; uf: string | null; municipio: string | null; codigo_municipio: string | null } | null;
type Dados = { parametros: Linha[]; teses: Tese[]; perfil: Perfil; empresa: Empresa; podeCurar: boolean; podeEditarPerfil: boolean };
type Aba = "parametros" | "teses" | "perfil";
type Filtro = "todos" | "conferir" | "reforma";

const CONFIANCA: Record<Linha["confianca"], string> = { alta: "Confiança alta", media: "Confiança média", baixa: "Confiança baixa" };
const SITUACAO: Record<Linha["situacao"], { rotulo: string; tom: "attention" | "success" | "neutral" }> = {
  rascunho: { rotulo: "A conferir", tom: "attention" }, conferido: { rotulo: "Conferido", tom: "success" }, descartado: { rotulo: "Descartado", tom: "neutral" },
};
const SITUACAO_TESE: Record<Tese["situacao"], { rotulo: string; tom: "success" | "attention" | "danger" | "neutral" }> = {
  firmada: { rotulo: "Firmada", tom: "success" }, firmada_modulacao_pendente: { rotulo: "Modulação pendente", tom: "attention" },
  pendente: { rotulo: "Pendente", tom: "danger" }, superada: { rotulo: "Superada", tom: "neutral" },
};
const ESCOPO = (p: Pick<Parametro, "escopo" | "uf" | "codigo_municipio">) => (p.escopo === "legal" ? "Nacional" : p.escopo === "uf" ? p.uf ?? "UF" : `Município ${p.codigo_municipio ?? ""}`);
const vigencia = (p: Pick<Parametro, "vigente_de" | "vigente_ate">) => (p.vigente_ate ? `${date(p.vigente_de)} a ${date(p.vigente_ate)}` : `desde ${date(p.vigente_de)}`);
const reforma = (p: Parametro) => p.chave.startsWith("reforma_") || p.chave.startsWith("pis_cofins");

export function Parametros({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("parametros");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [tese, setTese] = useState<Tese | null>(null);

  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/fiscal/parametros");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const dia = hoje();
  const lista = useMemo(() => atuais(dados?.parametros ?? [], dia), [dados, dia]) as Linha[];
  const rascunhos = (dados?.parametros ?? []).filter((p) => p.situacao === "rascunho").length;
  const conferidos = lista.filter((p) => p.situacao === "conferido").length;
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lista.filter((p) => {
      if (filtro === "conferir" && !(dados?.parametros ?? []).some((x) => x.chave === p.chave && x.situacao === "rascunho")) return false;
      if (filtro === "reforma" && !reforma(p)) return false;
      return !termo || [p.titulo, p.chave, p.fonte?.norma, p.observacao].some((v) => (v ?? "").toLowerCase().includes(termo));
    });
  }, [lista, filtro, busca, dados]);
  const pendentesTese = (dados?.teses ?? []).filter((t) => t.situacao !== "firmada").length;

  const depois = (m: string) => { notify(m); void carregar(); };
  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · PARÂMETROS</p><h1>Parâmetros legais</h1><p>Tabelas, alíquotas, prazos e códigos que os cálculos usam, cada um com a vigência e a norma de onde veio. O cálculo sempre usa o que valia na data do fato. Nada vale como &quot;conferido&quot; antes do contador conferir.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          <KpiGrid>
            <Kpi label="Parâmetros" value={String(lista.length)} caption="Valendo hoje" tone="neutral" onOpen={() => { setAba("parametros"); setFiltro("todos"); }} />
            <Kpi label="Conferidos" value={`${conferidos} de ${lista.length}`} caption="Valem nos cálculos sem aviso" tone="green" onOpen={() => { setAba("parametros"); setFiltro("todos"); }} />
            <Kpi label="A conferir" value={String(rascunhos)} caption="Rascunhos e propostas de nova vigência" tone="amber" onOpen={() => { setAba("parametros"); setFiltro("conferir"); }} />
            <Kpi label="Teses a acompanhar" value={String(pendentesTese)} caption="Pendentes ou com modulação em aberto" tone="red" onOpen={() => setAba("teses")} />
          </KpiGrid>
          <div className="almox-filtros">
            <Segmented<Aba> options={[{ value: "parametros", label: `Parâmetros · ${lista.length}` }, { value: "teses", label: `Teses · ${dados.teses.length}` }, { value: "perfil", label: "Perfil da empresa" }]} value={aba} onChange={setAba} ariaLabel="Lista" compact />
          </div>
          {aba === "parametros" && (
            <section className="almox-bloco">
              <div className="almox-filtros">
                <Segmented<Filtro> options={[{ value: "todos", label: "Todos" }, { value: "conferir", label: "A conferir" }, { value: "reforma", label: "Reforma e PIS/COFINS" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
                <input className="msk-input pcf-busca" type="search" placeholder="Buscar por nome, norma ou chave" aria-label="Buscar parâmetro" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              {!dados.podeCurar && <p className="fiscal-nota-ajuda">A curadoria dos parâmetros legais é da plataforma: aqui a empresa consulta e acompanha. O perfil da empresa (aba ao lado) é da empresa.</p>}
              {visiveis.length ? (
                <div className="vnd-tabela pcf-tabela" role="table" aria-label="Parâmetros legais">
                  <div className="cabeca" role="row"><span>Parâmetro</span><span>Onde vale</span><span>Vigência</span><span>Confiança</span><span>Situação</span></div>
                  {visiveis.map((p) => {
                    const temProposta = (dados.parametros).some((x) => x.chave === p.chave && x.situacao === "rascunho" && x.id !== p.id);
                    return (
                      <button type="button" role="row" key={p.id} onClick={() => setAberto(p.chave)}>
                        <span className="nome">{p.titulo}<small>{p.fonte?.norma ?? "—"}</small></span>
                        <span>{ESCOPO(p)}</span>
                        <span>{vigencia(p)}{temProposta ? <small>nova vigência proposta</small> : null}</span>
                        <span>{CONFIANCA[p.confianca]}</span>
                        <span><Status tone={SITUACAO[p.situacao].tom}>{SITUACAO[p.situacao].rotulo}</Status></span>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="finance-empty"><b>Nada com esse filtro</b><small>Troque o filtro ou a busca.</small></div>}
            </section>
          )}
          {aba === "teses" && (
            <section className="almox-bloco">
              <p className="fiscal-nota-ajuda">Decisões dos tribunais, súmulas e soluções de consulta que mexem nos parâmetros. &quot;Pendente&quot; e &quot;modulação pendente&quot; são o que pode mudar uma regra a qualquer momento.</p>
              <div className="vnd-tabela pcf-teses" role="table" aria-label="Teses">
                <div className="cabeca" role="row"><span>Tribunal</span><span>Tema</span><span>Assunto</span><span>Data</span><span>Situação</span></div>
                {dados.teses.map((t) => (
                  <button type="button" role="row" key={t.id} onClick={() => setTese(t)}>
                    <span className="vnd-codigo">{t.tribunal}</span>
                    <span>{t.tema}</span>
                    <span className="nome">{t.titulo}<small>{t.impacto ?? t.leading_case ?? ""}</small></span>
                    <span>{date(t.data)}</span>
                    <span><Status tone={SITUACAO_TESE[t.situacao].tom}>{SITUACAO_TESE[t.situacao].rotulo}</Status></span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {aba === "perfil" && <PerfilEmpresa key={dados.perfil.updated_at ?? "novo"} perfil={dados.perfil} empresa={dados.empresa} podeEditar={dados.podeEditarPerfil} onFeito={depois} />}
        </>
      )}
      {aberto && dados && <DetalheParametro versoes={historico(dados.parametros, aberto) as Linha[]} podeCurar={dados.podeCurar} onClose={() => setAberto(null)} onFeito={(m) => { setAberto(null); depois(m); }} />}
      {tese && dados && <DetalheTese tese={tese} podeCurar={dados.podeCurar} onClose={() => setTese(null)} onFeito={(m) => { setTese(null); depois(m); }} />}
    </div>
  );
}

/** Valor do parâmetro em linhas legíveis (o JSON do banco vira "campo: valor"). */
function Valor({ valor, nivel = 0 }: { valor: unknown; nivel?: number }) {
  if (valor === null || valor === undefined) return <span className="pcf-vazio">—</span>;
  if (typeof valor === "number") return <span className="pcf-num">{valor.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}</span>;
  if (typeof valor !== "object") return <span>{String(valor)}</span>;
  if (Array.isArray(valor)) {
    return <ol className="pcf-lista">{valor.map((v, i) => <li key={i}><Valor valor={v} nivel={nivel + 1} /></li>)}</ol>;
  }
  return (
    <dl className={nivel ? "pcf-valor pcf-valor-sub" : "pcf-valor"}>
      {Object.entries(valor as Record<string, unknown>).map(([k, v]) => (
        <div key={k}><dt>{k.replace(/_/g, " ")}</dt><dd><Valor valor={v} nivel={nivel + 1} /></dd></div>
      ))}
    </dl>
  );
}

function DetalheParametro({ versoes, podeCurar, onClose, onFeito }: { versoes: Linha[]; podeCurar: boolean; onClose: () => void; onFeito: (m: string) => void }) {
  const [vendo, setVendo] = useState<Linha>(() => versoes.find((v) => v.situacao === "rascunho") ?? versoes.find((v) => v.situacao === "conferido") ?? versoes[0]);
  const [propondo, setPropondo] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true); setErro("");
    const r = await api("/api/fiscal/parametros", { method: "POST", body: JSON.stringify(corpo) });
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(ok);
  };
  if (propondo) return <NovaVigencia base={vendo} onClose={() => setPropondo(false)} onFeito={onFeito} />;
  return (
    <Modal eyebrow={`FISCAL · PARÂMETRO · ${vendo.chave}`} title={vendo.titulo} subtitle={<>{ESCOPO(vendo)} · {vigencia(vendo)} · {CONFIANCA[vendo.confianca]} · {SITUACAO[vendo.situacao].rotulo}{vendo.conferido_em ? ` por ${vendo.conferido_por_nome ?? "—"} em ${dataHora(vendo.conferido_em)}` : ""}</>} onClose={onClose}>
      <div className="almox-form pcf-detalhe">
        {vendo.situacao === "rascunho" && <Callout variant="warning" title="Ainda não conferido">Os cálculos usam este valor marcando &quot;a conferir&quot;. Confira na norma antes de marcar como conferido.{vendo.origem === "carga_inicial" ? " Veio da pesquisa de 25/10/2026 em fonte oficial." : vendo.criado_por_nome ? ` Proposto por ${vendo.criado_por_nome}.` : ""}</Callout>}
        {vendo.situacao === "descartado" && <Callout variant="info" title="Descartado">{vendo.motivo_descarte ?? "Sem motivo registrado."}</Callout>}
        <section className="almox-bloco-interno">
          <p className="almox-rotulo">Valor</p>
          <Valor valor={vendo.valor} />
        </section>
        <section className="almox-bloco-interno">
          <p className="almox-rotulo">Fonte</p>
          <p className="pcf-fonte"><b>{vendo.fonte?.norma}</b><br /><a href={vendo.fonte?.url} target="_blank" rel="noreferrer noopener">{vendo.fonte?.url}</a></p>
          {vendo.fonte?.trecho && <blockquote className="pcf-trecho">{vendo.fonte.trecho}</blockquote>}
          {vendo.observacao && <p className="fiscal-nota-ajuda">{vendo.observacao}</p>}
        </section>
        {versoes.length > 1 && (
          <section className="almox-bloco-interno">
            <p className="almox-rotulo">Versões</p>
            <div className="vnd-tabela pcf-versoes" role="table" aria-label="Versões do parâmetro">
              {versoes.map((v) => (
                <button type="button" role="row" key={v.id} onClick={() => setVendo(v)} aria-current={v.id === vendo.id}>
                  <span>{vigencia(v)}</span><span className="nome">{v.fonte?.norma}</span><span><Status tone={SITUACAO[v.situacao].tom}>{SITUACAO[v.situacao].rotulo}</Status></span>
                </button>
              ))}
            </div>
          </section>
        )}
        {descartando && (
          <label className="nfe-cheio"><span>Motivo do descarte</span><input value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: leitura errada da norma" autoFocus /></label>
        )}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          {podeCurar && vendo.situacao !== "descartado" && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => setPropondo(true)}>Nova vigência</Button>}
          {podeCurar && vendo.situacao === "rascunho" && !descartando && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => setDescartando(true)}>Descartar</Button>}
          {podeCurar && vendo.situacao === "rascunho" && descartando && <Button type="button" variant="secondary" disabled={ocupado || motivo.trim().length < 3} onClick={() => void enviar({ acao: "descartar", id: vendo.id, motivo }, `Rascunho de "${vendo.titulo}" descartado.`)}>Confirmar descarte</Button>}
          {podeCurar && vendo.situacao === "rascunho" && <Button type="button" disabled={ocupado} onClick={() => void enviar({ acao: "conferir", id: vendo.id }, `"${vendo.titulo}" conferido. A versão anterior, se havia, fecha na véspera.`)}>{ocupado ? "Gravando…" : "Conferido na norma"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}

function NovaVigencia({ base, onClose, onFeito }: { base: Linha; onClose: () => void; onFeito: (m: string) => void }) {
  const [valor, setValor] = useState(() => JSON.stringify(base.valor, null, 2));
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [norma, setNorma] = useState("");
  const [url, setUrl] = useState("");
  const [trecho, setTrecho] = useState("");
  const [confianca, setConfianca] = useState<Linha["confianca"]>("alta");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    let v: unknown;
    try { v = JSON.parse(valor); } catch { setErro("O valor não está num formato válido (JSON). Confira as vírgulas e as aspas."); return; }
    setOcupado(true); setErro("");
    const r = await api("/api/fiscal/parametros", { method: "POST", body: JSON.stringify({ acao: "propor", proposta: { chave: base.chave, titulo: base.titulo, escopo: base.escopo, uf: base.uf, codigo_municipio: base.codigo_municipio, valor: v, vigente_de: de, vigente_ate: ate || null, norma, url, trecho, confianca, observacao: obs } }) });
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(`Nova vigência de "${base.titulo}" proposta a partir de ${date(de)}. Ela só vale depois de conferida.`);
  };
  return (
    <Modal eyebrow={`FISCAL · NOVA VIGÊNCIA · ${base.chave}`} title={base.titulo} subtitle="A proposta entra como rascunho e não muda nenhum cálculo até ser conferida. Ao conferir, a versão anterior fecha na véspera." onClose={onClose}>
      <form className="almox-form" onSubmit={salvar}>
        <div className="fiscal-campos nfe-campos">
          <label><span>Vale a partir de</span><input type="date" required value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label><span>Até <small>· vazio: em aberto</small></span><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
          <label><span>Confiança</span><select value={confianca} onChange={(e) => setConfianca(e.target.value as Linha["confianca"])}><option value="alta">Alta (norma oficial lida)</option><option value="media">Média (cópia ou imprensa especializada)</option><option value="baixa">Baixa (a confirmar)</option></select></label>
          <label className="nfe-largo"><span>Norma <small>· ex.: Decreto 12.797, de 23/12/2025, art. 1º</small></span><input required minLength={5} value={norma} onChange={(e) => setNorma(e.target.value)} /></label>
          <label className="nfe-cheio"><span>Link da fonte oficial</span><input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
          <label className="nfe-cheio"><span>Trecho da norma <small>· o que muda, copiado da fonte</small></span><textarea rows={3} value={trecho} maxLength={2000} onChange={(e) => setTrecho(e.target.value)} /></label>
          <label className="nfe-cheio"><span>Valor <small>· mesmo formato da versão atual</small></span><textarea className="pcf-json" rows={12} spellCheck={false} value={valor} onChange={(e) => setValor(e.target.value)} /></label>
          <label className="nfe-cheio"><span>Observação</span><input value={obs} maxLength={2000} onChange={(e) => setObs(e.target.value)} /></label>
        </div>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" disabled={ocupado}>{ocupado ? "Gravando…" : "Propor nova vigência"}</Button>
        </footer>
      </form>
    </Modal>
  );
}

function DetalheTese({ tese: t, podeCurar, onClose, onFeito }: { tese: Tese; podeCurar: boolean; onClose: () => void; onFeito: (m: string) => void }) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const conferir = async () => {
    setOcupado(true); setErro("");
    const r = await api("/api/fiscal/parametros", { method: "POST", body: JSON.stringify({ acao: "conferir_tese", id: t.id }) });
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(`Tese ${t.tribunal} ${t.tema} conferida.`);
  };
  return (
    <Modal eyebrow={`FISCAL · TESE · ${t.tribunal} ${t.tema}`} title={t.titulo} subtitle={<>{SITUACAO_TESE[t.situacao].rotulo}{t.data ? ` · ${date(t.data)}` : ""}{t.leading_case ? ` · ${t.leading_case}` : ""} · {CONFIANCA[t.confianca]}{t.conferida_em ? ` · conferida por ${t.conferida_por_nome ?? "—"} em ${dataHora(t.conferida_em)}` : ""}</>} onClose={onClose}>
      <div className="almox-form pcf-detalhe">
        <section className="almox-bloco-interno"><p className="almox-rotulo">Tese</p><p>{t.tese}</p></section>
        {t.modulacao && <section className="almox-bloco-interno"><p className="almox-rotulo">Modulação dos efeitos</p><p>{t.modulacao}</p></section>}
        {t.impacto && <Callout variant="info" title="Impacto">{t.impacto}</Callout>}
        {t.observacao && <p className="fiscal-nota-ajuda">{t.observacao}</p>}
        {t.parametros_afetados.length > 0 && <p className="fiscal-nota-ajuda">Mexe nos parâmetros: {t.parametros_afetados.join(", ")}.</p>}
        {t.fontes.length > 0 && (
          <section className="almox-bloco-interno"><p className="almox-rotulo">Fontes</p>
            <ul className="pcf-fontes">{t.fontes.map((f) => <li key={f}><a href={f} target="_blank" rel="noreferrer noopener">{f}</a></li>)}</ul>
          </section>
        )}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          {podeCurar && <Button type="button" disabled={ocupado} onClick={() => void conferir()}>{ocupado ? "Gravando…" : t.conferida_em ? "Conferir de novo" : "Conferida"}</Button>}
        </footer>
      </div>
    </Modal>
  );
}

const CRT: Record<number, string> = { 1: "Simples Nacional", 2: "Simples (excesso de sublimite)", 3: "Regime normal", 4: "MEI" };

function PerfilEmpresa({ perfil, empresa, podeEditar, onFeito }: { perfil: Perfil; empresa: Empresa; podeEditar: boolean; onFeito: (m: string) => void }) {
  const [modo, setModo] = useState(perfil.modo);
  const [regime, setRegime] = useState(perfil.regime);
  const [cnaes, setCnaes] = useState(perfil.cnaes_secundarios.join(", "));
  const [rat, setRat] = useState(perfil.rat === null ? "" : String(Number(perfil.rat)));
  const [fap, setFap] = useState(perfil.fap === null ? "" : String(Number(perfil.fap)).replace(".", ","));
  const [beneficio, setBeneficio] = useState(perfil.beneficio_estadual ?? "");
  const [obs, setObs] = useState(perfil.observacao ?? "");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true); setErro("");
    const r = await api("/api/fiscal/parametros", { method: "POST", body: JSON.stringify({ acao: "perfil", perfil: { modo, regime, cnaes_secundarios: cnaes.split(/[,;\s]+/).filter(Boolean), rat, fap, beneficio_estadual: beneficio, observacao: obs } }) });
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito("Perfil fiscal da empresa salvo.");
  };
  return (
    <section className="almox-bloco">
      <p className="fiscal-nota-ajuda">O perfil diz quais regras valem para a empresa. O modo de operação diz quem faz a contabilidade: a equipe da própria empresa ou o escritório externo, pelo portal do contador. Pode mudar a qualquer momento, sem perder dados.</p>
      {!podeEditar && <Callout variant="info" title="Somente leitura">Quem altera a Configuração fiscal edita o perfil da empresa.</Callout>}
      {regime === "a_definir" && <Callout variant="warning" title="Regime do IRPJ a definir">Presumido ou Real muda o Lucro Presumido da LC 224/2025, os créditos de PIS/COFINS e o levantamento de créditos. Quem decide é o Fiscal com o contador.</Callout>}
      {empresa && <p className="fiscal-nota-ajuda">Da Configuração fiscal: {empresa.municipio ?? "—"}/{empresa.uf ?? "—"} · CNAE {empresa.cnae ?? "—"} · {empresa.crt ? CRT[empresa.crt] ?? `CRT ${empresa.crt}` : "CRT não informado"}.</p>}
      <form className="almox-form pcf-perfil" onSubmit={salvar}>
        <fieldset disabled={!podeEditar || ocupado}>
          <div className="fiscal-campos nfe-campos">
            <label className="nfe-largo"><span>Modo de operação</span>
              <select value={modo} onChange={(e) => setModo(e.target.value as Perfil["modo"])}>
                <option value="escritorio">Escritório externo (o escritório opera pelo portal do contador)</option>
                <option value="interna">Contabilidade interna (a equipe da empresa faz o ciclo inteiro)</option>
              </select>
            </label>
            <label><span>Regime do IRPJ</span>
              <select value={regime} onChange={(e) => setRegime(e.target.value as Perfil["regime"])}>
                <option value="a_definir">A definir</option><option value="presumido">Lucro Presumido</option><option value="real">Lucro Real</option>
              </select>
            </label>
            <label><span>RAT (%)</span>
              <select value={rat} onChange={(e) => setRat(e.target.value)}><option value="">Não informado</option><option value="1">1%</option><option value="2">2%</option><option value="3">3%</option></select>
            </label>
            <label><span>FAP <small>· 0,5 a 2,0</small></span><input inputMode="decimal" value={fap} onChange={(e) => setFap(e.target.value)} placeholder="ex.: 1,0000" /></label>
            <label className="nfe-largo"><span>CNAEs secundários <small>· separados por vírgula</small></span><input value={cnaes} onChange={(e) => setCnaes(e.target.value)} placeholder="ex.: 2539-0/01, 3314-7/10" /></label>
            <label className="nfe-cheio"><span>Benefício fiscal estadual <small>· crédito outorgado, regime especial etc.</small></span><input value={beneficio} maxLength={500} onChange={(e) => setBeneficio(e.target.value)} /></label>
            <label className="nfe-cheio"><span>Observação</span><input value={obs} maxLength={2000} onChange={(e) => setObs(e.target.value)} /></label>
          </div>
        </fieldset>
        {perfil.updated_at && <p className="fiscal-nota-ajuda">Alterado por {perfil.updated_by_name ?? "—"} em {dataHora(perfil.updated_at)}.</p>}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        {podeEditar && <footer><Button type="submit" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar perfil"}</Button></footer>}
      </form>
    </section>
  );
}
