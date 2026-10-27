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
type Conta = { id: string; codigo: string; nome: string; natureza: Natureza; tipo: "sintetica" | "analitica"; nivel: number; superior_codigo: string | null; referencial: string | null; ativa: boolean };
type Plano = { id: string; nome: string; origem: "exemplo" | "ecd" | "planilha"; oficial: boolean; abertura: string | null; criado_por_nome: string | null; created_at: string };
type Vinculo = { origem: "conta_gerencial" | "conta_bancaria" | "papel"; chave: string; conta_id: string; situacao: "proposto" | "confirmado"; atualizado_por_nome: string | null };
type Dados = {
  planos: Plano[]; plano: Plano | null; contas: Conta[]; vinculos: Vinculo[]; periodos: { competencia: string; situacao: "aberto" | "fechado"; motivo: string | null; atualizado_por_nome: string | null }[];
  lancamentos: number; papeis: { papel: string; rotulo: string; natureza: string }[];
  gerenciais: { id: string; code: string | null; name: string; account_type: string; management_type: string }[];
  bancos: { id: string; bank_name: string | null; branch: string | null; account_number: string | null }[]; podeOperar: boolean;
};
type Aba = "plano" | "vinculos" | "escrituracao" | "balancete" | "razao";

const NATUREZA: Record<Natureza, string> = { ativo: "Ativo", passivo: "Passivo", pl: "Patrimônio líquido", resultado: "Resultado", compensacao: "Compensação", outras: "Outras" };
const ORIGEM: Record<Plano["origem"], string> = { exemplo: "Exemplo (teste)", ecd: "ECD do escritório", planilha: "Planilha" };
const saldo = (v: number) => (Math.round(v * 100) === 0 ? "—" : `${money(Math.abs(v))} ${v > 0 ? "D" : "C"}`);
const inicioDoAno = () => `${hoje().slice(0, 4)}-01-01`;

/** Lê o arquivo da ECD (UTF-8 ou Latin-1) e manda só os registros que importam: empresa, contas e saldos. */
async function textoDaEcd(arquivo: File) {
  const bytes = await arquivo.arrayBuffer();
  let texto: string;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { texto = new TextDecoder("iso-8859-1").decode(bytes); }
  return texto.split(/\r?\n/).filter((l) => /^\|(0000|I050|I051|I150|I155)\|/.test(l)).join("\n");
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

  const contas = useMemo(() => dados?.contas ?? [], [dados]);
  const analiticas = useMemo(() => contas.filter((c) => c.tipo === "analitica" && c.ativa), [contas]);
  const vinculo = useCallback((origem: Vinculo["origem"], chave: string) => dados?.vinculos.find((v) => v.origem === origem && v.chave === chave) ?? null, [dados]);
  const semVinculo = (dados?.gerenciais ?? []).filter((g) => !vinculo("conta_gerencial", g.id)).length;
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
                <Kpi label="Contas gerenciais sem vínculo" value={String(semVinculo)} caption={`de ${dados.gerenciais.length}: o que cair nelas fica pendente`} tone={semVinculo ? "amber" : "green"} onOpen={() => setAba("vinculos")} />
                <Kpi label="Lançamentos" value={dados.lancamentos.toLocaleString("pt-BR")} caption="Automáticos, manuais, estornos e abertura" tone="neutral" onOpen={() => setAba("escrituracao")} />
                <Kpi label="Meses fechados" value={String(dados.periodos.filter((p) => p.situacao === "fechado").length)} caption="Mês fechado não recebe nem perde lançamento" tone="neutral" onOpen={() => setAba("balancete")} />
              </KpiGrid>
              <div className="almox-filtros">
                <Segmented<Aba> options={[{ value: "plano", label: "Plano de contas" }, { value: "vinculos", label: "Vínculos" }, { value: "escrituracao", label: "Escrituração" }, { value: "balancete", label: "Balancete" }, { value: "razao", label: "Razão" }]} value={aba} onChange={setAba} ariaLabel="Contabilidade" compact />
              </div>
              <datalist id={LISTA_ANALITICAS}>{analiticas.map((c) => <option key={c.id} value={rotuloConta(c)} />)}</datalist>
              {aba === "plano" && <PlanoDeContas contas={contas} />}
              {aba === "vinculos" && <Vinculos dados={dados} analiticas={analiticas} vinculo={vinculo} notify={notify} onMudou={() => void carregar(plano.id)} />}
              {aba === "escrituracao" && <Escrituracao dados={dados} plano={plano} analiticas={analiticas} notify={notify} irParaVinculos={() => setAba("vinculos")} onMudou={() => void carregar(plano.id)} />}
              {aba === "balancete" && <Balancete dados={dados} plano={plano} notify={notify} onMudou={() => void carregar(plano.id)} />}
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
  const visiveis = termo ? contas.filter((c) => c.codigo.includes(termo) || c.nome.toLowerCase().includes(termo)) : contas;
  return (
    <section className="almox-bloco">
      <div className="almox-filtros"><input className="msk-input pcf-busca" type="search" placeholder="Buscar por código ou nome" aria-label="Buscar conta" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      <div className="vnd-tabela ctb-contas" role="table" aria-label="Plano de contas">
        <div className="cabeca" role="row"><span>Código</span><span>Conta</span><span>Natureza</span><span>Tipo</span><span>Referencial</span></div>
        {visiveis.map((c) => (
          <div role="row" key={c.id} className={c.tipo === "sintetica" ? "ctb-sintetica" : undefined}>
            <span className="ctb-codigo">{c.codigo}</span>
            <span className="nome" style={{ paddingLeft: `${Math.min(c.nivel - 1, 6) * 12}px` }}>{c.nome}</span>
            <span>{NATUREZA[c.natureza]}</span>
            <span>{c.tipo === "sintetica" ? "Sintética" : "Analítica"}</span>
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
  useEffect(() => setTexto(atual ? rotuloConta(atual) : ""), [atual]);
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

function Vinculos({ dados, analiticas, vinculo, notify, onMudou }: { dados: Dados; analiticas: Conta[]; vinculo: (o: Vinculo["origem"], k: string) => Vinculo | null; notify: (m: string) => void; onMudou: () => void }) {
  const [busca, setBusca] = useState("");
  const [so, setSo] = useState<"todas" | "sem">("sem");
  const plano = dados.plano!;
  const vincular = async (origem: Vinculo["origem"], chave: string, conta: string | null, nome: string) => {
    const r = await api("/api/fiscal/contabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "vincular", plano: plano.id, origem, chave, conta }) });
    if (!r.ok) { notify(r.error); return; }
    notify(conta ? `${nome}: vínculo gravado.` : `${nome}: vínculo removido.`);
    onMudou();
  };
  const termo = busca.trim().toLowerCase();
  const gerenciais = dados.gerenciais.filter((g) => (so === "todas" || !vinculo("conta_gerencial", g.id)) && (!termo || `${g.code ?? ""} ${g.name}`.toLowerCase().includes(termo)));
  const situacao = (v: Vinculo | null) => (v ? <Status tone={v.situacao === "confirmado" ? "success" : "attention"}>{v.situacao === "confirmado" ? "Confirmado" : "Proposto"}</Status> : <Status tone="danger">Sem vínculo</Status>);
  return (
    <section className="almox-bloco">
      {!dados.podeOperar && <Callout variant="info" title="Somente leitura">Quem liga as contas é quem opera a Contabilidade.</Callout>}
      <p className="fiscal-nota-ajuda">Cada lançamento automático tira a conta daqui: a conta gerencial do rateio do título, a conta bancária da baixa e os papéis (contas a pagar, juros…). Sem vínculo, o evento fica como pendência na escrituração.</p>
      <h3 className="ctb-titulo">Papéis</h3>
      <div className="vnd-tabela ctb-vinc" role="table" aria-label="Papéis">
        <div className="cabeca" role="row"><span>Papel</span><span>Conta contábil</span><span>Situação</span></div>
        {dados.papeis.map((p) => (
          <div role="row" key={p.papel}><span className="nome">{p.rotulo}</span><span><SeletorConta rotulo={p.rotulo} analiticas={analiticas} valor={vinculo("papel", p.papel)?.conta_id ?? null} desabilitado={!dados.podeOperar} onEscolher={(c) => void vincular("papel", p.papel, c, p.rotulo)} /></span><span>{situacao(vinculo("papel", p.papel))}</span></div>
        ))}
      </div>
      <h3 className="ctb-titulo">Contas bancárias</h3>
      <div className="vnd-tabela ctb-vinc" role="table" aria-label="Contas bancárias">
        <div className="cabeca" role="row"><span>Conta bancária</span><span>Conta contábil</span><span>Situação</span></div>
        {dados.bancos.map((b) => {
          const nome = `${b.bank_name ?? "Banco"} · ag. ${b.branch ?? "—"} · cc ${b.account_number ?? "—"}`;
          return <div role="row" key={b.id}><span className="nome">{nome}</span><span><SeletorConta rotulo={nome} analiticas={analiticas} valor={vinculo("conta_bancaria", b.id)?.conta_id ?? null} desabilitado={!dados.podeOperar} onEscolher={(c) => void vincular("conta_bancaria", b.id, c, nome)} /></span><span>{situacao(vinculo("conta_bancaria", b.id))}</span></div>;
        })}
      </div>
      <h3 className="ctb-titulo">Contas gerenciais do Financeiro</h3>
      <div className="almox-filtros">
        <Segmented<"todas" | "sem"> options={[{ value: "sem", label: "Sem vínculo" }, { value: "todas", label: "Todas" }]} value={so} onChange={setSo} ariaLabel="Mostrar" compact />
        <input className="msk-input pcf-busca" type="search" placeholder="Buscar conta gerencial" aria-label="Buscar conta gerencial" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {gerenciais.length ? (
        <div className="vnd-tabela ctb-vinc" role="table" aria-label="Contas gerenciais">
          <div className="cabeca" role="row"><span>Conta gerencial</span><span>Conta contábil</span><span>Situação</span></div>
          {gerenciais.map((g) => {
            const nome = `${g.code ? `${g.code} · ` : ""}${g.name}`;
            return <div role="row" key={g.id}><span className="nome">{nome}<small>{g.management_type.replace(/_/g, " ")}</small></span><span><SeletorConta rotulo={nome} analiticas={analiticas} valor={vinculo("conta_gerencial", g.id)?.conta_id ?? null} desabilitado={!dados.podeOperar} onEscolher={(c) => void vincular("conta_gerencial", g.id, c, g.name)} /></span><span>{situacao(vinculo("conta_gerencial", g.id))}</span></div>;
          })}
        </div>
      ) : <div className="finance-empty"><b>Nada a mostrar</b><small>{so === "sem" ? "Todas as contas gerenciais têm vínculo." : "Troque a busca."}</small></div>}
    </section>
  );
}

type Resultado = { lancados: number; jaLancados: number; eventos: number; de: string; ate: string; porMotivo: Record<string, number>; semVinculo: { chave: string; contas: number; valor: number }[]; amostra: { motivo: string; detalhe: string; data: string; historico: string; valor: number }[] };
type Lancamento = { id: string; data: string; historico: string; origem_tipo: string; estorno_de: string | null; criado_por_nome: string | null; partidas: { lado: "D" | "C"; valor: number; conta: { codigo: string; nome: string } }[] };
const MOTIVO: Record<string, string> = { sem_vinculo_gerencial: "Conta gerencial sem vínculo", sem_vinculo_bancario: "Conta bancária sem vínculo", sem_vinculo_papel: "Papel sem vínculo", sem_banco: "Baixa sem banco (nem conciliada)", sem_rateio: "Título sem conta gerencial", desequilibrado: "Rateio ou baixa que não fecha", periodo_fechado: "Mês fechado", sem_regra: "Sem regra", valor_zero: "Valor zero" };
const ORIGEM_LANC: Record<string, string> = { titulo: "Título", baixa: "Baixa", abertura: "Abertura", manual: "Manual", estorno: "Estorno" };

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
                <span>{dados.podeOperar && !estornado && l.origem_tipo !== "estorno" && <button type="button" className="almox-link" onClick={() => setEstornando(l)}>Estornar</button>}</span>
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
    const csv = [["codigo", "conta", "natureza", "tipo", "saldo_anterior", "debitos", "creditos", "saldo_final"], ...linhas.map((l) => [l.codigo, l.nome.replace(/;/g, ","), l.natureza, l.tipo, l.anterior, l.debitos, l.creditos, l.final])]
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
