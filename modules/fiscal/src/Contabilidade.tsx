"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, EscolherArquivo, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { api, date, hoje, money } from "./comum";

/**
 * Fiscal › Contabilidade (N-04): o motor de escrituração. O plano de contas vem do escritório (arquivo da ECD ou
 * planilha); cada conta gerencial, conta bancária e papel ganha a sua conta contábil (vínculos); os títulos e as
 * baixas do Financeiro viram lançamentos por regra, sem modelo. Balancete e razão saem dos lançamentos; o mês
 * fechado não muda mais. O plano de exemplo só testa o motor e nunca é o oficial.
 */

type Natureza = "ativo" | "passivo" | "pl" | "resultado" | "compensacao" | "outras";
type Conta = { id: string; codigo: string; nome: string; natureza: Natureza; tipo: "sintetica" | "analitica"; nivel: number; superior_codigo: string | null; referencial: string | null; reduzido: string | null; dre_grupo: string | null; saldo_normal: "D" | "C" | null; ativa: boolean };
type Plano = { id: string; nome: string; origem: "exemplo" | "ecd" | "planilha"; oficial: boolean; abertura: string | null; criado_por_nome: string | null; created_at: string };
type Vinculo = { origem: "conta_gerencial" | "conta_bancaria" | "papel" | "fornecedor" | "cliente"; chave: string; conta_id: string; situacao: "proposto" | "confirmado"; evidencia: string | null; atualizado_por_nome: string | null };
type Dados = {
  planos: Plano[]; plano: Plano | null; contas: Conta[]; vinculos: Vinculo[]; periodos: { competencia: string; situacao: "aberto" | "fechado"; motivo: string | null; atualizado_por_nome: string | null }[];
  lancamentos: number; papeis: { papel: string; rotulo: string; natureza: string }[];
  gerenciais: { id: string; code: string | null; name: string; account_type: string; management_type: string }[];
  bancos: { id: string; bank_name: string | null; branch: string | null; account_number: string | null }[]; podeOperar: boolean;
};
type Aba = "plano" | "vinculos" | "escrituracao" | "balancete" | "demonstracoes" | "razao";

const NATUREZA: Record<Natureza, string> = { ativo: "Ativo", passivo: "Passivo", pl: "Patrimônio líquido", resultado: "Resultado", compensacao: "Compensação", outras: "Outras" };
const ORIGEM: Record<Plano["origem"], string> = { exemplo: "Exemplo (teste)", ecd: "ECD do escritório", planilha: "Planilha" };
const saldo = (v: number) => (Math.round(v * 100) === 0 ? "—" : `${money(Math.abs(v))} ${v > 0 ? "D" : "C"}`);
const inicioDoAno = () => `${hoje().slice(0, 4)}-01-01`;

/** Lê o arquivo da ECD (UTF-8 ou Latin-1) e manda só os registros que importam: empresa, contas e saldos. */
async function textoDaEcd(arquivo: File, comLancamentos = false) {
  const bytes = await arquivo.arrayBuffer();
  let texto: string;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { texto = new TextDecoder("iso-8859-1").decode(bytes); }
  const registros = comLancamentos ? /^\|(0000|I050|I051|I150|I155|I200|I250)\|/ : /^\|(0000|I050|I051|I150|I155)\|/;
  return texto.split(/\r?\n/).filter((l) => registros.test(l)).join("\n");
}

export function Contabilidade({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [planoId, setPlanoId] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("plano");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [definindo, setDefinindo] = useState(false);

  const carregar = useCallback(async (id?: string | null) => {
    const r = await api<Dados>(`/api/fiscal/contabilidade${id ? `?plano=${id}` : ""}`);
    if (!r.ok) { setErro(r.error); return; }
    setErro(""); setDados(r.data); setPlanoId(r.data.plano?.id ?? null);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const enviar = async (corpo: Record<string, unknown>, chave: string) => {
    setOcupado(chave);
    const r = await api<{ plano?: string; mensagem?: string; avisos?: string[]; contas?: number; abertura?: { data: string; fecha: boolean; debitos: number; creditos: number; faltam: string[] } | null }>("/api/fiscal/contabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    setOcupado(null);
    if (!r.ok) { notify(r.error); return null; }
    return r.data;
  };
  const importar = async (arquivo: File, formato: "ecd" | "planilha") => {
    const texto = formato === "ecd" ? await textoDaEcd(arquivo) : await arquivo.text();
    const r = await enviar({ acao: "importar", formato, texto, nome: "" }, formato);
    if (!r) return;
    const a = r.abertura;
    notify(`${r.contas} contas importadas.${a ? (a.fecha ? ` Saldos de abertura lançados em ${date(a.data)}.` : ` Os saldos não fecham (débitos ${money(a.debitos)} × créditos ${money(a.creditos)}): abertura não lançada.`) : ""}${r.avisos?.length ? ` ${r.avisos.length} aviso(s).` : ""}`);
    void carregar(r.plano);
  };
  // A escrituração de um ano fechado (ECD do escritório) vira histórico do plano: abertura, lançamentos e referencial.
  const importarHistorico = async (arquivo: File) => {
    if (!plano) return;
    const texto = await textoDaEcd(arquivo, true);
    const r = (await enviar({ acao: "importar_ecd", plano: plano.id, texto }, "historico")) as unknown as { ano: string; lancamentos: number; jaExistiam: number; referencial: number; abertura2026: string } | null;
    if (!r) return;
    notify(`ECD de ${r.ano}: ${r.lancamentos.toLocaleString("pt-BR")} lançamentos${r.jaExistiam ? ` (${r.jaExistiam} já estavam)` : ""}, referencial em ${r.referencial} contas. Os meses de ${r.ano} ficaram fechados; o Financeiro entra a partir de ${date(r.abertura2026)}.`);
    void carregar(plano.id);
  };

  const contas = useMemo(() => dados?.contas ?? [], [dados]);
  const analiticas = useMemo(() => contas.filter((c) => c.tipo === "analitica" && c.ativa), [contas]);
  const porChave = useMemo(() => new Map((dados?.vinculos ?? []).map((v) => [`${v.origem}:${v.chave}`, v])), [dados]);
  const vinculo = useCallback((origem: Vinculo["origem"], chave: string) => porChave.get(`${origem}:${chave}`) ?? null, [porChave]);
  const semVinculo = (dados?.gerenciais ?? []).filter((g) => vinculo("conta_gerencial", g.id)?.situacao !== "confirmado").length;
  const aConferir = (dados?.vinculos ?? []).filter((v) => v.situacao === "proposto").length;
  const plano = dados?.plano ?? null;

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · CONTABILIDADE</p><h1>Contabilidade</h1><p>Os títulos e as baixas do Financeiro viram lançamentos contábeis por regra, no plano de contas do escritório. Daqui saem o razão e o balancete. Nada vai para conta adivinhada: o que não tem vínculo fica como pendência.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          <section className="almox-bloco ctb-planos">
            <div className="ctb-plano-barra">
              <label className="pcf-mes"><span>Plano de contas</span>
                <select value={planoId ?? ""} onChange={(e) => void carregar(e.target.value)} disabled={!dados.planos.length}>
                  {!dados.planos.length && <option value="">Nenhum plano ainda</option>}
                  {dados.planos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.oficial ? " · oficial" : ""}</option>)}
                </select>
              </label>
              {plano && <span className="ctb-selos"><Status tone={plano.oficial ? "success" : plano.origem === "exemplo" ? "attention" : "neutral"}>{plano.oficial ? "Oficial" : ORIGEM[plano.origem]}</Status>{plano.abertura && <Status tone="info">{`Abertura em ${date(plano.abertura)}`}</Status>}</span>}
              {dados.podeOperar && (
                <span className="ctb-acoes">
                  <EscolherArquivo rotulo="Importar ECD (.txt)" aceita=".txt,text/plain" compacto ocupado={ocupado === "ecd"} textoOcupado="Importando…" onEscolher={(a) => a[0] && void importar(a[0], "ecd")} />
                  <EscolherArquivo rotulo="Importar planilha (.csv)" aceita=".csv,text/csv" compacto ocupado={ocupado === "planilha"} textoOcupado="Importando…" onEscolher={(a) => a[0] && void importar(a[0], "planilha")} />
                  {!dados.planos.some((p) => p.origem === "exemplo") && <Button variant="secondary" compact disabled={ocupado !== null} onClick={async () => { const r = await enviar({ acao: "criar_exemplo" }, "exemplo"); if (r) { notify(r.mensagem ?? "Plano de exemplo criado."); void carregar(r.plano); } }}>{ocupado === "exemplo" ? "Criando…" : "Criar plano de exemplo"}</Button>}
                  {plano && plano.origem !== "exemplo" && <EscolherArquivo rotulo="Trazer a ECD do ano (histórico)" aceita=".txt,text/plain" compacto ocupado={ocupado === "historico"} textoOcupado="Importando os lançamentos…" onEscolher={(a) => a[0] && void importarHistorico(a[0])} />}
                  {plano && <Button variant="secondary" compact onClick={() => setDefinindo(true)}>Oficial e abertura</Button>}
                </span>
              )}
            </div>
            {!dados.planos.length && <Callout variant="info" title="Falta o plano de contas do escritório">O caminho certo é importar o arquivo da ECD de 2025 (o .txt do SPED Contábil que o escritório transmitiu): ele traz o plano de contas oficial, a ligação com o plano da Receita e os saldos de 31/12/2025, que viram a abertura. Para testar o motor antes disso, crie o plano de exemplo.</Callout>}
            {plano?.origem === "exemplo" && <p className="fiscal-nota-ajuda">Plano de exemplo: serve só para testar o motor. Não é recomendação contábil e nunca vira o oficial; o oficial vem do escritório.</p>}
          </section>

          {plano && (
            <>
              <KpiGrid>
                <Kpi label="Contas" value={String(contas.length)} caption={`${analiticas.length} analíticas recebem lançamento`} tone="neutral" onOpen={() => setAba("plano")} />
                <Kpi label="Contas gerenciais sem vínculo confirmado" value={String(semVinculo)} caption={`de ${dados.gerenciais.length}: o que cair nelas fica pendente${aConferir ? ` · ${aConferir} vínculo(s) propostos a conferir` : ""}`} tone={semVinculo ? "amber" : "green"} onOpen={() => setAba("vinculos")} />
                <Kpi label="Lançamentos" value={dados.lancamentos.toLocaleString("pt-BR")} caption="Automáticos, manuais, estornos e abertura" tone="neutral" onOpen={() => setAba("escrituracao")} />
                <Kpi label="Meses fechados" value={String(dados.periodos.filter((p) => p.situacao === "fechado").length)} caption="Mês fechado não recebe nem perde lançamento" tone="neutral" onOpen={() => setAba("balancete")} />
              </KpiGrid>
              <div className="almox-filtros">
                <Segmented<Aba> options={[{ value: "plano", label: "Plano de contas" }, { value: "vinculos", label: "Vínculos" }, { value: "escrituracao", label: "Escrituração" }, { value: "balancete", label: "Balancete" }, { value: "demonstracoes", label: "DRE e Balanço" }, { value: "razao", label: "Razão" }]} value={aba} onChange={setAba} ariaLabel="Contabilidade" compact />
              </div>
              <datalist id={LISTA_ANALITICAS}>{analiticas.map((c) => <option key={c.id} value={rotuloConta(c)} />)}</datalist>
              {aba === "plano" && <PlanoDeContas contas={contas} />}
              {aba === "vinculos" && <Vinculos dados={dados} analiticas={analiticas} vinculo={vinculo} notify={notify} onMudou={() => void carregar(plano.id)} />}
              {aba === "escrituracao" && <Escrituracao dados={dados} plano={plano} analiticas={analiticas} notify={notify} irParaVinculos={() => setAba("vinculos")} onMudou={() => void carregar(plano.id)} />}
              {aba === "balancete" && <Balancete dados={dados} plano={plano} notify={notify} onMudou={() => void carregar(plano.id)} />}
              {aba === "demonstracoes" && <Demonstracoes dados={dados} plano={plano} contas={contas} notify={notify} />}
              {aba === "razao" && <Razao plano={plano} analiticas={analiticas} />}
            </>
          )}
        </>
      )}
      {definindo && plano && <DefinirPlano plano={plano} onClose={() => setDefinindo(false)} onFeito={async (corpo) => { const r = await enviar({ acao: "definir", plano: plano.id, ...corpo }, "definir"); if (r) { setDefinindo(false); notify("Plano atualizado."); void carregar(plano.id); } }} onApagar={async () => { const r = await enviar({ acao: "apagar", plano: plano.id }, "apagar"); if (r) { setDefinindo(false); notify("Plano apagado."); void carregar(); } }} />}
    </div>
  );
}

function PlanoDeContas({ contas }: { contas: Conta[] }) {
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();
  const visiveis = termo ? contas.filter((c) => c.codigo.includes(termo) || c.reduzido === termo || c.nome.toLowerCase().includes(termo)) : contas;
  return (
    <section className="almox-bloco">
      <div className="almox-filtros"><input className="msk-input pcf-busca" type="search" placeholder="Buscar por código, reduzido ou nome" aria-label="Buscar conta" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      <div className="vnd-tabela ctb-contas" role="table" aria-label="Plano de contas">
        <div className="cabeca" role="row"><span>Código</span><span className="r">Reduzido</span><span>Conta</span><span>Natureza</span><span>Tipo</span><span title="Lado em que a conta costuma ter saldo">Saldo</span><span title="Grupo da DRE no plano do escritório">DRE</span><span>Referencial</span></div>
        {visiveis.map((c) => (
          <div role="row" key={c.id} className={c.tipo === "sintetica" ? "ctb-sintetica" : undefined}>
            <span className="ctb-codigo">{c.codigo}</span>
            <span className="ctb-codigo r">{c.reduzido ?? "—"}</span>
            <span className="nome" style={{ paddingLeft: `${Math.min(c.nivel - 1, 6) * 12}px` }}>{c.nome}</span>
            <span>{NATUREZA[c.natureza]}</span>
            <span>{c.tipo === "sintetica" ? "Sintética" : "Analítica"}</span>
            <span>{c.saldo_normal === "D" ? "Devedor" : c.saldo_normal === "C" ? "Credor" : "—"}</span>
            <span className="ctb-codigo">{c.dre_grupo ?? "—"}</span>
            <span className="ctb-codigo">{c.referencial ?? "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Campo com busca sobre UMA lista de contas da página (datalist): o plano oficial tem mais de 2 mil analíticas e
 * um <select> por linha punha centenas de milhares de opções na tela. Vale a conta digitada que bate exatamente;
 * campo vazio ao sair remove o vínculo; texto que não é conta volta ao que estava.
 */
const LISTA_ANALITICAS = "ctb-contas-analiticas";
const rotuloConta = (c: Pick<Conta, "codigo" | "nome">) => `${c.codigo} · ${c.nome}`;

function SeletorConta({ analiticas, valor, onEscolher, desabilitado, rotulo }: { analiticas: Conta[]; valor: string | null; onEscolher: (id: string | null) => void; desabilitado?: boolean; rotulo: string }) {
  const atual = useMemo(() => (valor ? analiticas.find((c) => c.id === valor) ?? null : null), [analiticas, valor]);
  const [texto, setTexto] = useState(atual ? rotuloConta(atual) : "");
  // Vínculo trocado de fora (recarga da lista): o texto acompanha, sem efeito (ajuste durante a renderização).
  const [visto, setVisto] = useState(atual);
  if (visto !== atual) { setVisto(atual); setTexto(atual ? rotuloConta(atual) : ""); }
  return (
    <input className="ctb-seletor" type="search" list={LISTA_ANALITICAS} aria-label={rotulo} placeholder="— sem vínculo — digite código ou nome" value={texto} disabled={desabilitado}
      onChange={(e) => {
        setTexto(e.target.value);
        const c = analiticas.find((x) => rotuloConta(x) === e.target.value);
        if (c && c.id !== valor) onEscolher(c.id);
      }}
      onBlur={() => {
        if (!texto.trim()) { if (valor) onEscolher(null); return; }
        if (!analiticas.some((x) => rotuloConta(x) === texto)) setTexto(atual ? rotuloConta(atual) : "");
      }} />
  );
}

type Linha = { origem: Vinculo["origem"]; chave: string; nome: string; sub?: string };
type Filtro = "conferir" | "sem" | "confirmados" | "todas";

function Vinculos({ dados, analiticas, vinculo, notify, onMudou }: { dados: Dados; analiticas: Conta[]; vinculo: (o: Vinculo["origem"], k: string) => Vinculo | null; notify: (m: string) => void; onMudou: () => void }) {
  const [busca, setBusca] = useState("");
  const [secao, setSecao] = useState<"gerenciais" | "fornecedores" | "bancos">("gerenciais");
  const [so, setSo] = useState<Filtro>(() => (dados.vinculos.some((v) => v.situacao === "proposto") ? "conferir" : "sem"));
  const [propondo, setPropondo] = useState(false);
  const [emLote, setEmLote] = useState(false);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string; titulos: number; valor: number }[] | null>(null);
  const plano = dados.plano!;
  useEffect(() => {
    if (secao !== "fornecedores" || fornecedores) return;
    const t = setTimeout(async () => {
      const r = await api<{ fornecedores: NonNullable<typeof fornecedores> }>(`/api/fiscal/contabilidade?plano=${plano.id}&visao=fornecedores`);
      if (r.ok) setFornecedores(r.data.fornecedores); else notify(r.error);
    }, 0);
    return () => clearTimeout(t);
  }, [secao, fornecedores, plano.id, notify]);
  const post = (corpo: Record<string, unknown>) => api<Record<string, unknown>>("/api/fiscal/contabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plano: plano.id, ...corpo }) });
  const vincular = async (origem: Vinculo["origem"], chave: string, conta: string | null, nome: string) => {
    const r = await post({ acao: "vincular", origem, chave, conta });
    if (!r.ok) { notify(r.error); return; }
    notify(conta ? `${nome}: vínculo gravado.` : `${nome}: vínculo removido.`);
    onMudou();
  };
  const confirmar = async (origem: Vinculo["origem"], chaves: string[]) => {
    const r = await post({ acao: "confirmar_vinculos", origem, chaves });
    setEmLote(false);
    if (!r.ok) { notify(r.error); return; }
    notify(`${Number(r.data.confirmados)} vínculo(s) confirmado(s).`);
    onMudou();
  };
  const propor = async () => {
    setPropondo(true);
    const r = await post({ acao: "propor_vinculos" });
    setPropondo(false);
    if (!r.ok) { notify(r.error); return; }
    const x = r.data as { gravados: number; fornecedores: { comTitulo: number; propostos: number; ambiguos: number }; bancos: { propostos: number }; gerenciais: { propostos: number } };
    notify(`${x.gravados} proposta(s) nova(s) ou atualizada(s): ${x.fornecedores.propostos} de ${x.fornecedores.comTitulo} fornecedores (${x.fornecedores.ambiguos} com mais de uma conta possível), ${x.bancos.propostos} conta(s) bancária(s), ${x.gerenciais.propostos} conta(s) gerencial(is). Nada vale antes de confirmar.`);
    onMudou();
  };

  const termo = busca.trim().toLowerCase();
  const passa = (l: Linha) => {
    const v = vinculo(l.origem, l.chave);
    const filtro = so === "todas" || (so === "conferir" ? v?.situacao === "proposto" : so === "sem" ? !v : v?.situacao === "confirmado");
    return filtro && (!termo || `${l.nome} ${l.sub ?? ""}`.toLowerCase().includes(termo));
  };
  const linhasGerenciais: Linha[] = dados.gerenciais.map((g) => ({ origem: "conta_gerencial", chave: g.id, nome: `${g.code ? `${g.code} · ` : ""}${g.name}`, sub: g.management_type.replace(/_/g, " ") }));
  const linhasFornecedores: Linha[] = (fornecedores ?? []).map((f) => ({ origem: "fornecedor", chave: f.id, nome: f.nome, sub: `${f.titulos} título(s) · ${money(f.valor)}` }));
  const visiveis = (secao === "gerenciais" ? linhasGerenciais : linhasFornecedores).filter(passa);
  const propostasVisiveis = visiveis.filter((l) => vinculo(l.origem, l.chave)?.situacao === "proposto");
  const conta = (l: Linha) => vinculo(l.origem, l.chave);
  const situacao = (l: Linha) => {
    const v = conta(l);
    return (
      <span className="ctb-situacao">
        {v ? <Status tone={v.situacao === "confirmado" ? "success" : "attention"}>{v.situacao === "confirmado" ? "Confirmado" : "Proposto"}</Status> : <Status tone="danger">Sem vínculo</Status>}
        {v?.situacao === "proposto" && dados.podeOperar && <Button variant="secondary" compact onClick={() => void confirmar(l.origem, [l.chave])}>Confirmar</Button>}
        {v?.evidencia && <small className="ctb-evidencia">{v.evidencia}</small>}
      </span>
    );
  };
  const linha = (l: Linha) => (
    <div role="row" key={`${l.origem}:${l.chave}`}>
      <span className="nome">{l.nome}{l.sub && <small>{l.sub}</small>}</span>
      <span><SeletorConta rotulo={l.nome} analiticas={analiticas} valor={conta(l)?.conta_id ?? null} desabilitado={!dados.podeOperar} onEscolher={(c) => void vincular(l.origem, l.chave, c, l.nome)} /></span>
      <span>{situacao(l)}</span>
    </div>
  );
  const nPropostos = (o: Vinculo["origem"]) => dados.vinculos.filter((v) => v.origem === o && v.situacao === "proposto").length;
  return (
    <section className="almox-bloco">
      {!dados.podeOperar && <Callout variant="info" title="Somente leitura">Quem liga e confirma as contas é quem opera a Contabilidade.</Callout>}
      <p className="fiscal-nota-ajuda">Cada lançamento automático tira a conta daqui: a conta gerencial do rateio do título, o fornecedor (contas a pagar vai para a conta dele), a conta bancária da baixa e os papéis. Só vale o vínculo <b>confirmado</b>; o proposto mostra de onde veio e espera a conferência. Sem vínculo, o evento fica como pendência na escrituração.</p>
      {dados.podeOperar && (
        <div className="almox-filtros">
          <Button variant="secondary" compact disabled={propondo} onClick={() => void propor()}>{propondo ? "Lendo o plano e o histórico…" : "Propor pelo plano e pelo histórico"}</Button>
          <small className="ctb-legenda">Fornecedor pelo nome da conta no plano, banco pelo número da conta, conta gerencial pelo que o escritório lançou no histórico. Não passa por cima do que já foi confirmado.</small>
        </div>
      )}
      <div className="almox-filtros">
        <Segmented<typeof secao> options={[
          { value: "gerenciais", label: `Contas gerenciais${nPropostos("conta_gerencial") ? ` (${nPropostos("conta_gerencial")} a conferir)` : ""}` },
          { value: "fornecedores", label: `Fornecedores${nPropostos("fornecedor") ? ` (${nPropostos("fornecedor")} a conferir)` : ""}` },
          { value: "bancos", label: `Bancos e papéis${nPropostos("conta_bancaria") ? ` (${nPropostos("conta_bancaria")} a conferir)` : ""}` },
        ]} value={secao} onChange={(v) => { setSecao(v); setEmLote(false); }} ariaLabel="Vínculos de" compact />
      </div>
      {secao === "bancos" ? <>
        <h3 className="ctb-titulo">Contas bancárias</h3>
        <div className="vnd-tabela ctb-vinc" role="table" aria-label="Contas bancárias">
          <div className="cabeca" role="row"><span>Conta bancária</span><span>Conta contábil</span><span>Situação</span></div>
          {dados.bancos.map((b) => linha({ origem: "conta_bancaria", chave: b.id, nome: `${b.bank_name ?? "Banco"} · ag. ${b.branch ?? "—"} · cc ${b.account_number ?? "—"}` }))}
        </div>
        <h3 className="ctb-titulo">Papéis</h3>
        <p className="fiscal-nota-ajuda">Contas a pagar e a receber só valem para quem não tem conta própria (fornecedor ou cliente sem vínculo). Sem a conta do papel, esses títulos ficam pendentes.</p>
        <div className="vnd-tabela ctb-vinc" role="table" aria-label="Papéis">
          <div className="cabeca" role="row"><span>Papel</span><span>Conta contábil</span><span>Situação</span></div>
          {dados.papeis.map((p) => linha({ origem: "papel", chave: p.papel, nome: p.rotulo }))}
        </div>
      </> : <>
        <div className="almox-filtros">
          <Segmented<Filtro> options={[{ value: "conferir", label: "A conferir" }, { value: "sem", label: "Sem vínculo" }, { value: "confirmados", label: "Confirmados" }, { value: "todas", label: "Todos" }]} value={so} onChange={(v) => { setSo(v); setEmLote(false); }} ariaLabel="Mostrar" compact />
          <input className="msk-input pcf-busca" type="search" placeholder={secao === "gerenciais" ? "Buscar conta gerencial" : "Buscar fornecedor"} aria-label={secao === "gerenciais" ? "Buscar conta gerencial" : "Buscar fornecedor"} value={busca} onChange={(e) => setBusca(e.target.value)} />
          {dados.podeOperar && propostasVisiveis.length > 1 && (emLote
            ? <Button compact onClick={() => void confirmar(propostasVisiveis[0].origem, propostasVisiveis.map((l) => l.chave))}>{`Sim, confirmar os ${propostasVisiveis.length}`}</Button>
            : <Button variant="secondary" compact onClick={() => setEmLote(true)}>{`Confirmar os ${propostasVisiveis.length} propostos da lista`}</Button>)}
        </div>
        {secao === "fornecedores" && !fornecedores ? <div className="finance-empty"><small>Carregando os fornecedores dos títulos…</small></div>
          : visiveis.length ? (
            <div className="vnd-tabela ctb-vinc" role="table" aria-label={secao === "gerenciais" ? "Contas gerenciais" : "Fornecedores"}>
              <div className="cabeca" role="row"><span>{secao === "gerenciais" ? "Conta gerencial" : "Fornecedor"}</span><span>Conta contábil</span><span>Situação</span></div>
              {visiveis.map(linha)}
            </div>
          ) : <div className="finance-empty"><b>Nada a mostrar</b><small>{so === "conferir" ? "Nenhuma proposta esperando conferência." : so === "sem" ? "Todos têm vínculo." : "Troque o filtro ou a busca."}</small></div>}
      </>}
    </section>
  );
}

type Resultado = { lancados: number; jaLancados: number; eventos: number; de: string; ate: string; porMotivo: Record<string, number>; semVinculo: { chave: string; contas: number; valor: number }[]; amostra: { motivo: string; detalhe: string; data: string; historico: string; valor: number }[] };
type Lancamento = { id: string; data: string; historico: string; origem_tipo: string; estorno_de: string | null; criado_por_nome: string | null; partidas: { lado: "D" | "C"; valor: number; conta: { codigo: string; nome: string } }[] };
const MOTIVO: Record<string, string> = { sem_vinculo_gerencial: "Conta gerencial sem vínculo", sem_vinculo_contraparte: "Fornecedor ou cliente sem conta", sem_vinculo_bancario: "Conta bancária sem vínculo", sem_vinculo_papel: "Papel sem vínculo", sem_banco: "Baixa sem banco (nem conciliada)", sem_rateio: "Título sem conta gerencial", desequilibrado: "Rateio ou baixa que não fecha", periodo_fechado: "Mês fechado", sem_regra: "Sem regra", valor_zero: "Valor zero" };
const ORIGEM_LANC: Record<string, string> = { titulo: "Título", baixa: "Baixa", abertura: "Abertura", manual: "Manual", estorno: "Estorno", historico_ecd: "ECD do escritório" };

function Escrituracao({ dados, plano, analiticas, notify, irParaVinculos, onMudou }: { dados: Dados; plano: Plano; analiticas: Conta[]; notify: (m: string) => void; irParaVinculos: () => void; onMudou: () => void }) {
  const [de, setDe] = useState(plano.abertura ?? inicioDoAno());
  const [ate, setAte] = useState(hoje());
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [lista, setLista] = useState<{ lancamentos: Lancamento[]; estornados: string[] } | null>(null);
  const [manual, setManual] = useState(false);
  const [estornando, setEstornando] = useState<Lancamento | null>(null);
  const nomeGerencial = (id: string) => dados.gerenciais.find((g) => g.id === id)?.name ?? id;

  const listar = useCallback(async () => {
    const r = await api<{ lancamentos: Lancamento[]; estornados: string[] }>(`/api/fiscal/contabilidade?plano=${plano.id}&visao=lancamentos&de=${de}&ate=${ate}`);
    if (r.ok) setLista(r.data);
  }, [plano.id, de, ate]);
  useEffect(() => { const t = setTimeout(() => { void listar(); }, 0); return () => clearTimeout(t); }, [listar]);

  const escriturar = async () => {
    setRodando(true);
    const r = await api<Resultado>("/api/fiscal/contabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "escriturar", plano: plano.id, de, ate }) });
    setRodando(false);
    if (!r.ok) { notify(r.error); return; }
    setResultado(r.data);
    notify(`${r.data.lancados} lançamento(s) novo(s); ${Object.values(r.data.porMotivo).reduce((a, b) => a + b, 0)} pendência(s).`);
    onMudou(); void listar();
  };
  const pendentes = resultado ? Object.values(resultado.porMotivo).reduce((a, b) => a + b, 0) : 0;
  return (
    <section className="almox-bloco">
      <div className="almox-filtros ctb-periodo">
        <label className="pcf-mes"><span>De</span><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="pcf-mes"><span>Até</span><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        {dados.podeOperar && <Button onClick={() => void escriturar()} disabled={rodando || !de || !ate}>{rodando ? "Escriturando…" : "Escriturar o período"}</Button>}
        {dados.podeOperar && <Button variant="secondary" onClick={() => setManual(true)}>Lançamento manual</Button>}
      </div>
      {plano.abertura && <p className="fiscal-nota-ajuda">Antes de {date(plano.abertura)} vale o saldo de abertura: evento de antes não é lançado.</p>}
      {resultado && (
        <Callout variant={pendentes ? "warning" : "success"} title={`${resultado.lancados} lançado(s) agora · ${resultado.jaLancados} já estavam · ${pendentes} pendente(s)`}>
          <span className="ctb-linha">Período {date(resultado.de)} a {date(resultado.ate)}: {resultado.eventos.toLocaleString("pt-BR")} evento(s) no Financeiro (títulos e baixas).</span>
          {Object.entries(resultado.porMotivo).map(([m, n]) => <span key={m} className="ctb-linha">{MOTIVO[m] ?? m}: {n.toLocaleString("pt-BR")}</span>)}
          {resultado.semVinculo.length > 0 && <span className="ctb-linha">Contas gerenciais que mais travam: {resultado.semVinculo.slice(0, 5).map((s) => `${nomeGerencial(s.chave)} (${s.contas})`).join(", ")}. <button type="button" className="almox-link" onClick={irParaVinculos}>Ligar nos Vínculos</button></span>}
        </Callout>
      )}
      {resultado && resultado.amostra.length > 0 && (
        <details className="ctb-detalhes"><summary>Outras pendências ({resultado.amostra.length})</summary>
          <div className="vnd-tabela ctb-pend" role="table" aria-label="Pendências">
            <div className="cabeca" role="row"><span>Data</span><span>Evento</span><span>Motivo</span><span className="r">Valor</span></div>
            {resultado.amostra.map((x, k) => <div role="row" key={k}><span>{date(x.data)}</span><span className="nome">{x.historico}</span><span>{MOTIVO[x.motivo] ?? x.motivo}<small>{x.motivo === "sem_vinculo_bancario" ? "" : x.detalhe}</small></span><span className="r">{money(x.valor)}</span></div>)}
          </div>
        </details>
      )}
      <h3 className="ctb-titulo">Lançamentos do período{lista ? ` (${lista.lancamentos.length >= 300 ? "300 mais recentes" : lista.lancamentos.length})` : ""}</h3>
      {lista?.lancamentos.length ? (
        <div className="vnd-tabela ctb-lanc" role="table" aria-label="Lançamentos">
          <div className="cabeca" role="row"><span>Data</span><span>Histórico</span><span>Partidas</span><span>Origem</span><span></span></div>
          {lista.lancamentos.map((l) => {
            const estornado = lista.estornados.includes(l.id);
            return (
              <div role="row" key={l.id}>
                <span>{date(l.data)}</span>
                <span className="nome">{l.historico}<small>{l.criado_por_nome ?? ""}</small></span>
                <span className="ctb-partidas">{[...l.partidas].sort((a, b) => a.lado.localeCompare(b.lado) * -1).map((p, k) => <small key={k}>{p.lado} {p.conta.codigo} {p.conta.nome} · {money(Number(p.valor))}</small>)}</span>
                <span>{estornado ? <Status tone="neutral">Estornado</Status> : <Status tone={l.origem_tipo === "estorno" ? "attention" : l.origem_tipo === "manual" ? "info" : "neutral"}>{ORIGEM_LANC[l.origem_tipo] ?? l.origem_tipo}</Status>}</span>
                <span>{dados.podeOperar && !estornado && !["estorno", "historico_ecd", "abertura"].includes(l.origem_tipo) && <button type="button" className="almox-link" onClick={() => setEstornando(l)}>Estornar</button>}</span>
              </div>
            );
          })}
        </div>
      ) : <div className="finance-empty"><b>Nenhum lançamento no período</b><small>Escriture o período ou faça um lançamento manual.</small></div>}
      {manual && <LancamentoManual plano={plano} analiticas={analiticas} onClose={() => setManual(false)} onFeito={() => { setManual(false); notify("Lançamento manual gravado."); onMudou(); void listar(); }} />}
      {estornando && <Estornar lancamento={estornando} onClose={() => setEstornando(null)} onFeito={() => { setEstornando(null); notify("Estorno lançado; o original ficou."); onMudou(); void listar(); }} />}
    </section>
  );
}

function LancamentoManual({ plano, analiticas, onClose, onFeito }: { plano: Plano; analiticas: Conta[]; onClose: () => void; onFeito: () => void }) {
  const [data, setData] = useState(hoje());
  const [historico, setHistorico] = useState("");
  const [linhas, setLinhas] = useState<{ conta: string; lado: "D" | "C"; valor: string }[]>([{ conta: "", lado: "D", valor: "" }, { conta: "", lado: "C", valor: "" }]);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const num = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;
  const total = (l: "D" | "C") => linhas.filter((x) => x.lado === l).reduce((t, x) => t + Math.round(num(x.valor) * 100), 0) / 100;
  const fecha = total("D") > 0 && total("D") === total("C");
  const gravar = async () => {
    setEnviando(true);
    const r = await api("/api/fiscal/contabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "manual", plano: plano.id, data, historico, partidas: linhas.filter((x) => x.conta && num(x.valor) > 0).map((x) => ({ conta_id: x.conta, lado: x.lado, valor: num(x.valor) })) }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito();
  };
  return (
    <Modal eyebrow="CONTABILIDADE · LANÇAMENTO MANUAL" title="Novo lançamento" subtitle="Ajuste ou evento que não vem do Financeiro. O histórico explica o porquê; débitos e créditos têm de fechar." onClose={onClose}>
      <div className="almox-form">
        <label><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label><span>Histórico</span><input value={historico} maxLength={500} onChange={(e) => setHistorico(e.target.value)} placeholder="Ex.: reclassificação da despesa de energia de março para custo de produção" /></label>
        {linhas.map((x, k) => (
          <div className="ctb-manual-linha" key={k}>
            <select aria-label={`Lado da partida ${k + 1}`} value={x.lado} onChange={(e) => setLinhas((l) => l.map((y, j) => (j === k ? { ...y, lado: e.target.value as "D" | "C" } : y)))}><option value="D">Débito</option><option value="C">Crédito</option></select>
            <SeletorConta rotulo={`Conta da partida ${k + 1}`} analiticas={analiticas} valor={x.conta || null} onEscolher={(c) => setLinhas((l) => l.map((y, j) => (j === k ? { ...y, conta: c ?? "" } : y)))} />
            <input aria-label={`Valor da partida ${k + 1}`} inputMode="decimal" placeholder="0,00" value={x.valor} onChange={(e) => setLinhas((l) => l.map((y, j) => (j === k ? { ...y, valor: e.target.value } : y)))} />
          </div>
        ))}
        <div><button type="button" className="almox-link" onClick={() => setLinhas((l) => [...l, { conta: "", lado: "D", valor: "" }])}>Mais uma partida</button></div>
        <p className={fecha ? "ctb-fecha" : "ctb-nao-fecha"}>Débitos {money(total("D"))} · Créditos {money(total("C"))}{fecha ? " · fecha" : " · ainda não fecha"}</p>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          <Button type="button" disabled={!fecha || historico.trim().length < 10 || enviando} onClick={() => void gravar()}>{enviando ? "Gravando…" : "Gravar lançamento"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

function Estornar({ lancamento, onClose, onFeito }: { lancamento: Lancamento; onClose: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    const r = await api("/api/fiscal/contabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "estornar", lancamento: lancamento.id, motivo }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito();
  };
  return (
    <Modal eyebrow="CONTABILIDADE · ESTORNO" title={lancamento.historico} subtitle={`${date(lancamento.data)} · o estorno lança o inverso na mesma data; o original fica no razão.`} onClose={onClose}>
      <div className="almox-form">
        <label><span>Motivo do estorno</span><input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: título lançado em duplicidade" /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          <Button type="button" disabled={motivo.trim().length < 10 || enviando} onClick={() => void enviar()}>{enviando ? "Estornando…" : "Estornar"}</Button>
        </footer>
      </div>
    </Modal>
  );
}

type LinhaBal = Conta & { anterior: number; debitos: number; creditos: number; final: number; alerta: string | null };
function Balancete({ dados, plano, notify, onMudou }: { dados: Dados; plano: Plano; notify: (m: string) => void; onMudou: () => void }) {
  const [de, setDe] = useState(`${hoje().slice(0, 7)}-01`);
  const [ate, setAte] = useState(hoje());
  const [bal, setBal] = useState<{ linhas: LinhaBal[]; totais: { debitos: number; creditos: number; saldoFinal: number }; integro: boolean } | null>(null);
  const [soMovimento, setSoMovimento] = useState(true);
  const [motivo, setMotivo] = useState("");
  const carregar = useCallback(async () => {
    const r = await api<{ balancete: typeof bal }>(`/api/fiscal/contabilidade?plano=${plano.id}&visao=balancete&de=${de}&ate=${ate}`);
    if (r.ok) setBal(r.data.balancete); else notify(r.error);
  }, [plano.id, de, ate, notify]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);
  const competencia = ate.slice(0, 7);
  const periodo = dados.periodos.find((p) => p.competencia === competencia);
  const fechado = periodo?.situacao === "fechado";
  const definirPeriodo = async (fechar: boolean) => {
    const r = await api("/api/fiscal/contabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "periodo", plano: plano.id, competencia, fechar, motivo }) });
    if (!r.ok) { notify(r.error); return; }
    notify(fechar ? `Competência ${competencia} fechada.` : `Competência ${competencia} reaberta.`);
    setMotivo(""); onMudou();
  };
  const linhas = (bal?.linhas ?? []).filter((l) => !soMovimento || l.anterior || l.debitos || l.creditos);
  const exportar = () => {
    const csv = [["codigo", "reduzido", "conta", "natureza", "tipo", "dre", "saldo_anterior", "debitos", "creditos", "saldo_final"], ...linhas.map((l) => [l.codigo, l.reduzido ?? "", l.nome.replace(/;/g, ","), l.natureza, l.tipo, l.dre_grupo ?? "", l.anterior, l.debitos, l.creditos, l.final])]
      .map((r) => r.map((c) => (typeof c === "number" ? c.toFixed(2).replace(".", ",") : String(c))).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `balancete-${de}-a-${ate}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section className="almox-bloco">
      <div className="almox-filtros ctb-periodo">
        <label className="pcf-mes"><span>De</span><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="pcf-mes"><span>Até</span><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <Segmented<"mov" | "todas"> options={[{ value: "mov", label: "Com saldo ou movimento" }, { value: "todas", label: "Todas as contas" }]} value={soMovimento ? "mov" : "todas"} onChange={(v) => setSoMovimento(v === "mov")} ariaLabel="Contas" compact />
        <Button variant="secondary" compact onClick={exportar} disabled={!linhas.length}>Baixar planilha (CSV)</Button>
      </div>
      {bal && (bal.integro
        ? <Callout variant="success" title={`Íntegro: débitos ${money(bal.totais.debitos)} = créditos ${money(bal.totais.creditos)}`}>Os saldos finais somam zero e cada sintética é a soma das filhas.</Callout>
        : <Callout variant="warning" title="O balancete não fecha">Débitos {money(bal.totais.debitos)} e créditos {money(bal.totais.creditos)}; saldo final somando {money(bal.totais.saldoFinal)}. Avise quem cuida da plataforma.</Callout>)}
      {dados.podeOperar && (
        <div className="almox-filtros ctb-periodo">
          <span>Competência {competencia}: {fechado ? <Status tone="neutral">Fechada</Status> : <Status tone="success">Aberta</Status>}{periodo?.atualizado_por_nome ? <small> · {periodo.atualizado_por_nome}</small> : null}</span>
          {fechado
            ? <><input className="msk-input" placeholder="Motivo para reabrir" aria-label="Motivo para reabrir" value={motivo} onChange={(e) => setMotivo(e.target.value)} /><Button variant="secondary" compact disabled={motivo.trim().length < 10} onClick={() => void definirPeriodo(false)}>Reabrir</Button></>
            : <Button variant="secondary" compact onClick={() => void definirPeriodo(true)}>Fechar a competência</Button>}
        </div>
      )}
      {linhas.length ? (
        <div className="vnd-tabela ctb-bal" role="table" aria-label="Balancete">
          <div className="cabeca" role="row"><span>Código</span><span>Conta</span><span className="r">Saldo anterior</span><span className="r">Débitos</span><span className="r">Créditos</span><span className="r">Saldo final</span></div>
          {linhas.map((l) => (
            <div role="row" key={l.id} className={l.tipo === "sintetica" ? "ctb-sintetica" : undefined}>
              <span className="ctb-codigo">{l.codigo}</span>
              <span className="nome" style={{ paddingLeft: `${Math.min(l.nivel - 1, 6) * 12}px` }}>{l.nome}{l.alerta && <small className="ctb-alerta">{l.alerta}</small>}</span>
              <span className="r">{saldo(l.anterior)}</span>
              <span className="r">{l.debitos ? money(l.debitos) : "—"}</span>
              <span className="r">{l.creditos ? money(l.creditos) : "—"}</span>
              <span className="r">{saldo(l.final)}</span>
            </div>
          ))}
        </div>
      ) : <div className="finance-empty"><b>Sem movimento no período</b><small>Escriture o período na aba Escrituração.</small></div>}
    </section>
  );
}

type LinhaDemo = { codigo: string; nome: string; nivel: number; tipo: "grupo" | "conta" | "total"; valor: number };
type Dre = { linhas: LinhaDemo[]; resultado: number };
type BalancoPat = { linhas: LinhaDemo[]; ativo: number; passivoPl: number; resultadoNaoEncerrado: number; fecha: boolean };
type Recorte = "t1" | "t2" | "t3" | "t4" | "ano" | "outro";
const RECORTES: Record<Exclude<Recorte, "outro">, [string, string]> = { t1: ["01-01", "03-31"], t2: ["04-01", "06-30"], t3: ["07-01", "09-30"], t4: ["10-01", "12-31"], ano: ["01-01", "12-31"] };
/** DRE com sinal: receita positiva, custo e despesa entre parênteses. */
const valorDre = (v: number) => (Math.round(v * 100) === 0 ? "—" : v < 0 ? `(${money(-v)})` : money(v));

/**
 * DRE e Balanço (N-05 adiantado), no formato do escritório: a DRE sem os lançamentos de encerramento, com o mesmo
 * período do ano anterior; o balanço no início (com a abertura do 1º dia, como a ECD) e no fim do período, com o
 * resultado ainda não encerrado no PL.
 */
function Demonstracoes({ dados, plano, contas, notify }: { dados: Dados; plano: Plano; contas: Conta[]; notify: (m: string) => void }) {
  // Ano inicial: o mais recente com mês fechado (o exercício que o escritório já entregou); sem nenhum, o atual.
  const fechados = dados.periodos.filter((p) => p.situacao === "fechado").map((p) => p.competencia.slice(0, 4));
  const anos = [...new Set([hoje().slice(0, 4), ...dados.periodos.map((p) => p.competencia.slice(0, 4)), ...(plano.abertura ? [plano.abertura.slice(0, 4)] : [])])].sort().reverse();
  const [ano, setAno] = useState(fechados.sort().at(-1) ?? hoje().slice(0, 4));
  const [recorte, setRecorte] = useState<Recorte>("ano");
  const [livre, setLivre] = useState({ de: inicioDoAno(), ate: hoje() });
  const [qual, setQual] = useState<"dre" | "balanco">("dre");
  const [resposta, setResposta] = useState<{ de: string; ate: string; dre: Dre; dreAnterior: Dre; balanco: BalancoPat; balancoInicial: BalancoPat } | null>(null);
  const de = recorte === "outro" ? livre.de : `${ano}-${RECORTES[recorte][0]}`;
  const ate = recorte === "outro" ? livre.ate : `${ano}-${RECORTES[recorte][1]}`;
  useEffect(() => {
    if (!de || !ate || de > ate) return;
    const t = setTimeout(async () => {
      const x = await api<Omit<NonNullable<typeof resposta>, "de" | "ate">>(`/api/fiscal/contabilidade?plano=${plano.id}&visao=demonstracoes&de=${de}&ate=${ate}`);
      if (x.ok) setResposta({ ...x.data, de, ate }); else notify(x.error);
    }, 0);
    return () => clearTimeout(t);
  }, [plano.id, de, ate, notify]);
  // Só vale a resposta do período escolhido: a de um período anterior pode chegar depois (o ano demora mais que o trimestre).
  const r = resposta && resposta.de === de && resposta.ate === ate ? resposta : null;

  const anterior = new Map((r?.dreAnterior.linhas ?? []).map((l) => [l.codigo || l.tipo, l.valor]));
  const temAnterior = (r?.dreAnterior.linhas ?? []).some((l) => Math.round(l.valor * 100) !== 0);
  // Balanço: as linhas do início e do fim juntas, na ordem do plano.
  const inicio = new Map((r?.balancoInicial.linhas ?? []).map((l) => [l.codigo, l]));
  const fim = new Map((r?.balanco.linhas ?? []).map((l) => [l.codigo, l]));
  const linhasBal = [...new Set([...inicio.keys(), ...fim.keys()])].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })).map((c) => ({ ...(fim.get(c) ?? inicio.get(c)!), inicio: inicio.get(c)?.valor ?? 0, fim: fim.get(c)?.valor ?? 0 }));
  // Letras da DRE (coluna do plano do escritório): em que grupos as contas de cada letra estão. É só uma leitura do plano.
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]));
  const letras = [...contas.reduce((m, c) => {
    if (!c.dre_grupo) return m;
    const g = m.get(c.dre_grupo) ?? { contas: 0, grupos: new Set<string>() };
    g.contas++; g.grupos.add(porCodigo.get(c.superior_codigo ?? "")?.nome ?? "—");
    return m.set(c.dre_grupo, g);
  }, new Map<string, { contas: number; grupos: Set<string> }>())].sort(([a], [b]) => a.localeCompare(b));

  const exportar = () => {
    const linhas = qual === "dre"
      ? [["codigo", "conta", "periodo", "ano_anterior"], ...(r?.dre.linhas ?? []).map((l) => [l.codigo, l.nome, l.valor, anterior.get(l.codigo || l.tipo) ?? 0])]
      : [["codigo", "conta", `saldo_inicio_${de}`, `saldo_${ate}`], ...linhasBal.map((l) => [l.codigo, l.nome, l.inicio, l.fim])];
    const csv = linhas.map((x) => x.map((c) => (typeof c === "number" ? c.toFixed(2).replace(".", ",") : String(c).replace(/;/g, ","))).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${qual === "dre" ? "dre" : "balanco"}-${de}-a-${ate}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const bal = r?.balanco;
  return (
    <section className="almox-bloco">
      <div className="almox-filtros ctb-periodo">
        <Segmented<"dre" | "balanco"> options={[{ value: "dre", label: "DRE" }, { value: "balanco", label: "Balanço patrimonial" }]} value={qual} onChange={setQual} ariaLabel="Demonstração" compact />
        {recorte !== "outro" && <label className="pcf-mes"><span>Ano</span><select value={ano} onChange={(e) => setAno(e.target.value)}>{anos.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>}
        <Segmented<Recorte> options={[{ value: "t1", label: "1º tri" }, { value: "t2", label: "2º tri" }, { value: "t3", label: "3º tri" }, { value: "t4", label: "4º tri" }, { value: "ano", label: "Ano" }, { value: "outro", label: "Outro período" }]} value={recorte} onChange={setRecorte} ariaLabel="Período" compact />
        {recorte === "outro" && <>
          <label className="pcf-mes"><span>De</span><input type="date" value={livre.de} onChange={(e) => setLivre({ ...livre, de: e.target.value })} /></label>
          <label className="pcf-mes"><span>Até</span><input type="date" value={livre.ate} onChange={(e) => setLivre({ ...livre, ate: e.target.value })} /></label>
        </>}
        <Button variant="secondary" compact onClick={exportar} disabled={!r}>Baixar planilha (CSV)</Button>
      </div>

      {r && qual === "dre" && (r.dre.linhas.length > 1 ? <>
        <p className="ctb-titulo">DRE de {date(de)} a {date(ate)} · sem os lançamentos de encerramento do resultado</p>
        <div className="vnd-tabela ctb-demo" role="table" aria-label="DRE">
          <div className="cabeca" role="row"><span>Código</span><span>Conta</span><span className="r">Período</span>{temAnterior && <span className="r">Mesmo período de {Number(de.slice(0, 4)) - 1}</span>}</div>
          {r.dre.linhas.map((l) => (
            <div role="row" key={l.codigo || l.tipo} className={l.tipo !== "conta" ? "ctb-sintetica" : undefined}>
              <span className="ctb-codigo">{l.codigo}</span>
              <span className="nome" style={{ paddingLeft: `${Math.min(Math.max(l.nivel - 1, 0), 6) * 12}px` }}>{l.nome}</span>
              <span className="r">{valorDre(l.valor)}</span>
              {temAnterior && <span className="r">{valorDre(anterior.get(l.codigo || l.tipo) ?? 0)}</span>}
            </div>
          ))}
        </div>
        {letras.length > 0 && (
          <details className="ctb-detalhes">
            <summary>Letras da DRE no plano de contas ({letras.length})</summary>
            <p className="ctb-legenda">Leitura do próprio plano: em que grupos estão as contas de cada letra. A legenda oficial é do escritório contábil.</p>
            <div className="vnd-tabela ctb-letras" role="table" aria-label="Letras da DRE">
              <div className="cabeca" role="row"><span>Letra</span><span>Grupos das contas</span><span className="r">Contas</span></div>
              {letras.map(([letra, g]) => (
                <div role="row" key={letra}><span className="ctb-codigo">{letra}</span><span className="nome">{[...g.grupos].join(" · ")}</span><span className="r">{g.contas}</span></div>
              ))}
            </div>
          </details>
        )}
      </> : <div className="finance-empty"><b>Sem movimento de resultado no período</b><small>Escriture o período na aba Escrituração ou traga a ECD do ano.</small></div>)}

      {r && bal && qual === "balanco" && (linhasBal.length ? <>
        {bal.fecha
          ? <Callout variant="success" title={`Fecha: ativo ${money(bal.ativo)} = passivo + PL ${money(bal.passivoPl)}`}>{Math.round(bal.resultadoNaoEncerrado * 100) !== 0 ? `Inclui no PL o resultado ainda não encerrado: ${valorDre(bal.resultadoNaoEncerrado)}.` : "O resultado do período já está encerrado no PL."}</Callout>
          : <Callout variant="warning" title="O balanço não fecha">Ativo {money(bal.ativo)} e passivo + PL {money(bal.passivoPl)}. Avise quem cuida da plataforma.</Callout>}
        <div className="vnd-tabela ctb-demo" role="table" aria-label="Balanço patrimonial">
          <div className="cabeca" role="row"><span>Código</span><span>Conta</span><span className="r">Início ({date(de)})</span><span className="r">Em {date(ate)}</span></div>
          {linhasBal.map((l) => (
            <div role="row" key={l.codigo} className={l.tipo === "grupo" ? "ctb-sintetica" : undefined}>
              <span className="ctb-codigo">{l.codigo}</span>
              <span className="nome" style={{ paddingLeft: `${Math.min(l.nivel - 1, 6) * 12}px` }}>{l.nome}</span>
              <span className="r">{saldo(l.inicio)}</span>
              <span className="r">{saldo(l.fim)}</span>
            </div>
          ))}
          {Math.round(bal.resultadoNaoEncerrado * 100) !== 0 && (
            <div role="row" className="ctb-sintetica"><span className="ctb-codigo" /><span className="nome">Resultado do período ainda não encerrado (no PL)</span><span className="r">{valorDre(r.balancoInicial.resultadoNaoEncerrado)}</span><span className="r">{valorDre(bal.resultadoNaoEncerrado)}</span></div>
          )}
        </div>
      </> : <div className="finance-empty"><b>Sem saldo nas contas patrimoniais</b><small>Lance a abertura ou traga a ECD do ano.</small></div>)}
    </section>
  );
}

function Razao({ plano, analiticas }: { plano: Plano; analiticas: Conta[] }) {
  const [conta, setConta] = useState<string | null>(analiticas[0]?.id ?? null);
  const [de, setDe] = useState(plano.abertura ?? inicioDoAno());
  const [ate, setAte] = useState(hoje());
  const [razao, setRazao] = useState<{ anterior: number; linhas: { id: string; lado: "D" | "C"; valor: number; lancamento: { data: string; historico: string; origem_tipo: string } }[] } | null>(null);
  useEffect(() => {
    if (!conta) return;
    const t = setTimeout(async () => {
      const r = await api<{ razao: NonNullable<typeof razao> }>(`/api/fiscal/contabilidade?plano=${plano.id}&visao=razao&conta=${conta}&de=${de}&ate=${ate}`);
      if (r.ok) setRazao(r.data.razao);
    }, 0);
    return () => clearTimeout(t);
  }, [plano.id, conta, de, ate]);
  // Saldo corrente de cada linha (devedor positivo), a partir do saldo anterior.
  const saldos = useMemo(() => {
    const saida: number[] = [];
    for (const l of razao?.linhas ?? []) saida.push(Math.round(((saida.at(-1) ?? razao?.anterior ?? 0) + (l.lado === "D" ? Number(l.valor) : -Number(l.valor))) * 100) / 100);
    return saida;
  }, [razao]);
  return (
    <section className="almox-bloco">
      <div className="almox-filtros ctb-periodo">
        <label className="pcf-mes ctb-conta-razao"><span>Conta</span><SeletorConta rotulo="Conta do razão" analiticas={analiticas} valor={conta} onEscolher={setConta} /></label>
        <label className="pcf-mes"><span>De</span><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="pcf-mes"><span>Até</span><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
      </div>
      {razao && (
        <div className="vnd-tabela ctb-razao" role="table" aria-label="Razão">
          <div className="cabeca" role="row"><span>Data</span><span>Histórico</span><span className="r">Débito</span><span className="r">Crédito</span><span className="r">Saldo</span></div>
          <div role="row" className="ctb-sintetica"><span>{date(de)}</span><span className="nome">Saldo anterior</span><span className="r">—</span><span className="r">—</span><span className="r">{saldo(razao.anterior)}</span></div>
          {razao.linhas.map((l, k) => {
            return (
              <div role="row" key={l.id}>
                <span>{date(l.lancamento.data)}</span>
                <span className="nome">{l.lancamento.historico}<small>{ORIGEM_LANC[l.lancamento.origem_tipo] ?? l.lancamento.origem_tipo}</small></span>
                <span className="r">{l.lado === "D" ? money(Number(l.valor)) : "—"}</span>
                <span className="r">{l.lado === "C" ? money(Number(l.valor)) : "—"}</span>
                <span className="r">{saldo(saldos[k])}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DefinirPlano({ plano, onClose, onFeito, onApagar }: { plano: Plano; onClose: () => void; onFeito: (c: { oficial: boolean; abertura: string | null }) => void; onApagar: () => void }) {
  const [oficial, setOficial] = useState(plano.oficial);
  const [abertura, setAbertura] = useState(plano.abertura ?? "");
  const [apagando, setApagando] = useState(false);
  return (
    <Modal eyebrow="CONTABILIDADE · PLANO" title={plano.nome} subtitle={`${ORIGEM[plano.origem]} · criado por ${plano.criado_por_nome ?? "—"}`} onClose={onClose}>
      <div className="almox-form">
        <label className="nfe-check"><input type="checkbox" checked={oficial} disabled={plano.origem === "exemplo"} onChange={(e) => setOficial(e.target.checked)} /><span>Plano oficial da empresa<small> · {plano.origem === "exemplo" ? "o de exemplo nunca é o oficial" : "só um por empresa; o anterior deixa de ser"}</small></span></label>
        <label><span>Data de abertura<small> · eventos de antes dela não são lançados (valem os saldos iniciais)</small></span><input type="date" value={abertura} onChange={(e) => setAbertura(e.target.value)} /></label>
        <footer>
          {!plano.oficial && (apagando
            ? <Button type="button" variant="secondary" onClick={onApagar}>Confirmar: apagar o plano{plano.origem === "exemplo" ? " e os lançamentos de teste" : ""}</Button>
            : <Button type="button" variant="secondary" onClick={() => setApagando(true)}>Apagar plano</Button>)}
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
          <Button type="button" onClick={() => onFeito({ oficial, abertura: abertura || null })}>Salvar</Button>
        </footer>
      </div>
    </Modal>
  );
}
