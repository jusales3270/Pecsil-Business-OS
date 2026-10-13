"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { calcularItens, calcularTotais, icmsDestaca, ipiTributado, pisCofinsComAliquota, r2 } from "../../../lib/fiscal/emissao/calculo";
import { itemPadrao, notaVazia } from "../../../lib/fiscal/emissao/normalizar";
import { CSOSN_SIMPLES, CST_ICMS_NORMAL, CST_IPI_ENTRADA, CST_IPI_SAIDA, CST_PIS_COFINS, FORMAS_PAGAMENTO, MODELOS_OPERACAO, type Problema } from "../../../lib/fiscal/emissao/regras";
import type { Destinatario, ItemNfe, NotaNfe, SituacaoNfe, Totais } from "../../../lib/fiscal/emissao/tipos";
import { lerNumeroBr } from "../../../lib/numero-br";
import { api, cnpjFormatado, curto, dataHora, hoje, money } from "./comum";

/**
 * Fiscal › Notas emitidas — por enquanto só o TREINO: o Jefferson monta a NF-e como faria de
 * verdade, a plataforma confere (regras + esquema oficial da SEFAZ) e "autoriza" sem nada sair
 * para a SEFAZ. Sem valor fiscal e sem obrigação nenhuma. Quem opera monta, valida e envia;
 * quem aprova transmite, devolve, cancela, corrige e inutiliza — o mesmo portão da produção.
 */

type Linha = {
  id: string; ambiente: string; situacao: SituacaoNfe; serie: number | null; numero: number | null; chave: string | null; emissao: string | null;
  natureza: string; valor_total: number; destinatario_nome: string | null; destinatario_documento: string | null; protocolo: string | null;
  autorizada_em: string | null; motivo: string | null; montada_por_nome: string | null; aprovada_por_nome: string | null; cancelada_em: string | null; updated_at: string;
};
type Cliente = {
  id: string; name: string; tax_id: string | null; ie: string | null; ind_ie: 1 | 2 | 9 | null; email_nfe: string | null; cep: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null;
  codigo_municipio: string | null; uf: string | null; telefone: string | null;
};
type DadosCnpj = { razaoSocial: string; situacao: string; cep: string; logradouro: string; numero: string; complemento: string; bairro: string; municipio: string; codigoMunicipio: string; uf: string; telefone: string; email: string };
type DadosCep = { logradouro: string; complemento: string; bairro: string; municipio: string; codigoMunicipio: string; uf: string };
type Inutilizacao = { id: string; serie: number; numero_inicio: number; numero_fim: number; texto: string; created_by_name: string | null; created_at: string };
type Lista = {
  notas: Linha[]; emitente: { razaoSocial: string; cnpj: string; uf: string; crt: number } | null; problemasEmitente: Problema[];
  destinatarios: Destinatario[]; clientes: Cliente[]; inutilizacoes: Inutilizacao[]; podeOperar: boolean; podeAprovar: boolean; transmissor: boolean;
};
type Validacao = { ok: boolean; erros: Problema[]; avisos: Problema[]; esquema: { conferido: boolean; erros: string[] } };
type Detalhe = Linha & { nota: NotaNfe; totais: Totais | null; customer_id: string | null; validacao: Validacao | null };
type Evento = { id: string; tipo: "cancelamento" | "carta" | "inutilizacao"; sequencia: number | null; texto: string; protocolo: string | null; created_by_name: string | null; created_at: string };

type Filtro = "todas" | "edicao" | "aguardando" | "autorizadas" | "canceladas";
const NO_FILTRO: Record<Filtro, (s: SituacaoNfe) => boolean> = {
  todas: () => true, edicao: (s) => s === "rascunho" || s === "validada" || s === "rejeitada", aguardando: (s) => s === "aguardando_aprovacao",
  autorizadas: (s) => s === "autorizada", canceladas: (s) => s === "cancelada",
};
const SITUACAO: Record<SituacaoNfe, [string, "success" | "danger" | "attention" | "info" | "neutral"]> = {
  rascunho: ["Rascunho", "neutral"], validada: ["Validada", "info"], aguardando_aprovacao: ["Aguardando aprovação", "attention"],
  autorizada: ["Autorizada (treino)", "success"], rejeitada: ["Rejeitada", "danger"], cancelada: ["Cancelada", "danger"],
};

const CST_ICMS: Record<string, string> = {
  "00": "00 · Tributada integralmente", "20": "20 · Com redução de base", "40": "40 · Isenta", "41": "41 · Não tributada", "50": "50 · Suspensão", "51": "51 · Diferimento", "90": "90 · Outras",
  "101": "101 · Simples com permissão de crédito", "102": "102 · Simples sem permissão de crédito", "103": "103 · Isenção por faixa de receita", "300": "300 · Imune", "400": "400 · Não tributada pelo Simples",
};
const CST_IPI: Record<string, string> = {
  "50": "50 · Saída tributada", "51": "51 · Saída alíquota zero", "52": "52 · Saída isenta", "53": "53 · Saída não tributada", "54": "54 · Saída imune", "55": "55 · Saída com suspensão", "99": "99 · Outras saídas",
  "00": "00 · Entrada com crédito", "01": "01 · Entrada alíquota zero", "02": "02 · Entrada isenta", "03": "03 · Entrada não tributada", "04": "04 · Entrada imune", "05": "05 · Entrada com suspensão", "49": "49 · Outras entradas",
};
const CST_PC: Record<string, string> = {
  "01": "01 · Tributável (alíquota básica)", "02": "02 · Tributável (alíquota diferenciada)", "04": "04 · Monofásica (revenda a alíquota zero)", "05": "05 · Substituição tributária",
  "06": "06 · Alíquota zero", "07": "07 · Isenta", "08": "08 · Sem incidência", "09": "09 · Suspensão", "49": "49 · Outras operações de saída", "50": "50 · Entrada com crédito", "98": "98 · Outras de entrada", "99": "99 · Outras operações",
};
const ORIGENS = ["0 · Nacional", "1 · Estrangeira, importação direta", "2 · Estrangeira, comprada no mercado interno", "3 · Nacional, mais de 40% importado", "4 · Nacional, processo produtivo básico", "5 · Nacional, até 40% importado", "6 · Estrangeira direta, sem similar", "7 · Estrangeira no mercado interno, sem similar", "8 · Nacional, mais de 70% importado"];
const MODALIDADE_FRETE: Record<number, string> = { 0: "Por conta do emitente (CIF)", 1: "Por conta do destinatário (FOB)", 2: "Por conta de terceiros", 9: "Sem frete" };
const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

const lerNumero = (t: string) => lerNumeroBr(t);
const fmt = (v: number, casas = 2) => (v ? v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) : "");
const numeroNota = (l: Pick<Linha, "serie" | "numero">) => (l.numero ? `${String(l.numero).padStart(6, "0")}${l.serie !== null ? ` · série ${l.serie}` : ""}` : "sem número");
const so = (t: string) => t.replace(/\D/g, "");

/** Campo numérico em formato brasileiro: enquanto digita, guarda o texto; fora do foco, mostra formatado. */
function Numero({ valor, onChange, casas = 2, rotulo }: { valor: number; onChange: (v: number) => void; casas?: number; rotulo?: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const mostra = texto ?? fmt(valor, casas);
  return (
    <input inputMode="decimal" value={mostra} aria-label={rotulo}
      onFocus={() => setTexto(mostra)} onBlur={() => setTexto(null)}
      onChange={(e) => { setTexto(e.target.value); onChange(lerNumero(e.target.value)); }} />
  );
}

export function NotasEmitidas({ notify, abrir = null, onAberta }: { notify: (m: string) => void; abrir?: string | null; onAberta?: () => void }) {
  const [dados, setDados] = useState<Lista | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [aberta, setAberta] = useState<string | "nova" | null>(abrir);
  useEffect(() => { if (abrir) onAberta?.(); }, [abrir, onAberta]);
  const [inutilizar, setInutilizar] = useState(false);
  const [limpando, setLimpando] = useState<"perguntar" | "apagando" | null>(null);

  const carregar = useCallback(async () => {
    const r = await api<Lista>("/api/fiscal/nfe?ambiente=treino");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados({ ...r.data, notas: r.data.notas.map((n) => ({ ...n, valor_total: Number(n.valor_total) })) });
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const notas = useMemo(() => dados?.notas ?? [], [dados]);
  const visiveis = notas.filter((n) => NO_FILTRO[filtro](n.situacao));
  const conta = (f: Filtro) => notas.filter((n) => NO_FILTRO[f](n.situacao)).length;
  const autorizadas = notas.filter((n) => n.situacao === "autorizada");

  const limparTreino = async () => {
    setLimpando("apagando");
    const r = await api<{ apagadas: number }>("/api/fiscal/nfe?ambiente=treino", { method: "DELETE" });
    setLimpando(null);
    notify(r.ok ? `Treino limpo: ${r.data.apagadas} nota(s) apagada(s) e a numeração do treino voltou ao 1.` : r.error);
    void carregar();
  };

  if (aberta && dados) {
    return (
      <EditorNota id={aberta === "nova" ? null : aberta} lista={dados} notify={notify}
        onFechar={() => { setAberta(null); void carregar(); }} onCriada={(id) => setAberta(id)} />
    );
  }

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · NF-e</p><h1>Notas emitidas</h1><p>Monte a nota como faria de verdade: a plataforma confere as regras e o esquema oficial da SEFAZ antes de qualquer transmissão.</p></div>
        <div className="icms-acoes">
          {dados?.podeAprovar && <Button variant="secondary" onClick={() => setInutilizar(true)}>Inutilizar números</Button>}
          {dados?.podeOperar && <Button onClick={() => setAberta("nova")}>Nova nota</Button>}
        </div>
      </div>

      <FaixaTreino />

      {dados && dados.problemasEmitente.length > 0 && (
        <Callout variant="warning" title="Falta completar a Configuração fiscal">
          A nota usa os dados do emitente de Fiscal › Configuração. Enquanto faltar algo, a validação aponta:
          <ul className="nfe-problemas">{dados.problemasEmitente.map((p) => <li key={p.campo}>{p.mensagem.replace("Configuração fiscal: ", "")}</li>)}</ul>
        </Callout>
      )}
      {dados && !dados.transmissor && <Callout variant="info" title="Conferência do esquema oficial indisponível">O transmissor não respondeu: as regras da plataforma são conferidas, o esquema oficial da SEFAZ não.</Callout>}
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}

      {dados && (
        <>
          {filtro === "todas" && (
            <KpiGrid>
              <Kpi label="Em edição" value={String(conta("edicao"))} caption="Rascunhos e validadas" tone="neutral" onOpen={() => setFiltro("edicao")} />
              <Kpi label="Aguardando aprovação" value={String(conta("aguardando"))} caption="Esperando quem transmite" tone={conta("aguardando") ? "amber" : "neutral"} onOpen={() => setFiltro("aguardando")} />
              <Kpi label="Autorizadas no treino" value={String(autorizadas.length)} caption={curto(autorizadas.reduce((a, n) => a + n.valor_total, 0))} tone="green" onOpen={() => setFiltro("autorizadas")} />
              <Kpi label="Canceladas" value={String(conta("canceladas"))} caption="Dentro do prazo de 24 h" tone={conta("canceladas") ? "red" : "neutral"} onOpen={() => setFiltro("canceladas")} />
            </KpiGrid>
          )}

          <div className="almox-filtros">
            <Segmented<Filtro> options={[{ value: "todas", label: "Todas" }, { value: "edicao", label: "Em edição" }, { value: "aguardando", label: "Aguardando" }, { value: "autorizadas", label: "Autorizadas" }, { value: "canceladas", label: "Canceladas" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
          </div>

          <section className="almox-bloco">
            {visiveis.length ? (
              <div className="nfe-tabela" role="table">
                <div className="cabeca" role="row"><span>Número</span><span>Destinatário</span><span>Emissão</span><span className="r">Valor</span><span>Situação</span><span /></div>
                {visiveis.map((n) => (
                  <div role="row" key={n.id}>
                    <span className="nfe-numero">{numeroNota(n)}</span>
                    <span className="nome">
                      {n.destinatario_nome || "Destinatário não informado"}
                      <small>{n.natureza || "—"}{n.montada_por_nome ? ` · montada por ${n.montada_por_nome}` : ""}{n.aprovada_por_nome ? ` · aprovada por ${n.aprovada_por_nome}` : ""}</small>
                      {n.motivo && n.situacao === "rascunho" && <small className="fiscal-erro">{n.motivo}</small>}
                    </span>
                    <span>{n.emissao ? dataHora(n.emissao).slice(0, 10) : "—"}</span>
                    <span className="r">{money(n.valor_total)}</span>
                    <span><Status tone={SITUACAO[n.situacao][1]}>{SITUACAO[n.situacao][0]}</Status></span>
                    <span className="fiscal-dfe-acoes">
                      {n.situacao === "autorizada" && <a className="almox-link" href={`/api/fiscal/nfe/${n.id}/danfe`} target="_blank" rel="noreferrer">DANFE</a>}
                      <button type="button" className="almox-link" onClick={() => setAberta(n.id)}>Abrir</button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="finance-empty">
                <b>{filtro === "todas" ? "Nenhuma nota de treino ainda" : "Nenhuma nota neste filtro"}</b>
                <small>{filtro === "todas" ? (dados.podeOperar ? "Clique em Nova nota para montar a primeira." : "Quem opera as notas fiscais monta as notas aqui.") : "Troque o filtro para ver as demais."}</small>
              </div>
            )}
          </section>

          {dados.inutilizacoes.length > 0 && (
            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Números inutilizados no treino</h2></header>
              <ul className="nfe-eventos">
                {dados.inutilizacoes.map((i) => (
                  <li key={i.id}><b>Série {i.serie} · {i.numero_inicio === i.numero_fim ? `nº ${i.numero_inicio}` : `nº ${i.numero_inicio} a ${i.numero_fim}`}</b><span>{i.texto}</span><small>{i.created_by_name ?? "—"} · {dataHora(i.created_at)}</small></li>
                ))}
              </ul>
            </section>
          )}

          {dados.podeAprovar && notas.length + dados.inutilizacoes.length > 0 && (
            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Recomeçar o treino</h2></header>
              <p className="fiscal-nota-ajuda">Apaga todas as notas, eventos e números do treino (a numeração volta ao 1). Não mexe em nada real: o treino nunca saiu da plataforma.</p>
              <footer>
                {limpando === null && <Button variant="ghost" className="almox-perigo" onClick={() => setLimpando("perguntar")}>Limpar o treino</Button>}
                {limpando !== null && (
                  <>
                    <Button variant="ghost" onClick={() => setLimpando(null)} disabled={limpando === "apagando"}>Cancelar</Button>
                    <Button className="almox-perigo-cheio" onClick={() => void limparTreino()} disabled={limpando === "apagando"}>{limpando === "apagando" ? "Apagando…" : `Apagar ${notas.length} nota(s) de treino`}</Button>
                  </>
                )}
              </footer>
            </section>
          )}
        </>
      )}

      {inutilizar && <InutilizarModal onClose={() => setInutilizar(false)} onFeito={(m) => { setInutilizar(false); notify(m); void carregar(); }} />}
    </div>
  );
}

function FaixaTreino() {
  return (
    <div className="nfe-faixa-treino" role="note">
      <b>TREINO — SEM VALOR FISCAL</b>
      <span>Nada vai para a SEFAZ e nenhuma obrigação fiscal é gerada. Numeração, protocolo e DANFE são simulados, só para conferir se a nota sai certa.</span>
    </div>
  );
}

/* --- Editor ------------------------------------------------------------------------------- */

function EditorNota({ id, lista, notify, onFechar, onCriada }: { id: string | null; lista: Lista; notify: (m: string) => void; onFechar: () => void; onCriada: (id: string) => void }) {
  const crt = lista.emitente?.crt ?? 3;
  const ufEmitente = lista.emitente?.uf ?? "";
  const [det, setDet] = useState<Detalhe | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [nota, setNota] = useState<NotaNfe>(() => ({ ...notaVazia(), itens: [itemPadrao("5101", crt)] }));
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [sujo, setSujo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pedir, setPedir] = useState<null | "devolver" | "cancelar" | "carta">(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async (nfeId: string) => {
    const r = await api<{ nota: Detalhe; eventos: Evento[] }>(`/api/fiscal/nfe/${nfeId}`);
    if (!r.ok) { setErro(r.error); return; }
    setDet({ ...r.data.nota, valor_total: Number(r.data.nota.valor_total) });
    setNota(r.data.nota.nota);
    setClienteId(r.data.nota.customer_id);
    setEventos(r.data.eventos);
    setSujo(false);
  }, []);
  useEffect(() => { if (!id) return; const t = setTimeout(() => { void carregar(id); }, 0); return () => clearTimeout(t); }, [carregar, id]);

  const situacao: SituacaoNfe = det?.situacao ?? "rascunho";
  const editavel = lista.podeOperar && (situacao === "rascunho" || situacao === "validada");
  const calculo = useMemo(() => calcularItens(nota), [nota]);
  const totais = useMemo(() => calcularTotais(calculo), [calculo]);
  const validacao = sujo ? null : det?.validacao ?? null;
  const destinoFora = Boolean(nota.destinatario.uf && ufEmitente && nota.destinatario.uf !== ufEmitente);

  const mudar = (fn: (n: NotaNfe) => NotaNfe) => { setNota(fn); setSujo(true); };
  const mudarDest = (parcial: Partial<Destinatario>) => mudar((n) => {
    const destinatario = { ...n.destinatario, ...parcial };
    // UF mudou: o CFOP acompanha (5↔6 na saída, 1↔2 na entrada).
    if (parcial.uf && parcial.uf !== n.destinatario.uf && ufEmitente && parcial.uf.length === 2) {
      const fora = parcial.uf !== ufEmitente;
      const de = n.tipo === 1 ? (fora ? "5" : "6") : (fora ? "1" : "2");
      const para = n.tipo === 1 ? (fora ? "6" : "5") : (fora ? "2" : "1");
      return { ...n, destinatario, itens: n.itens.map((i) => (i.cfop.startsWith(de) ? { ...i, cfop: para + i.cfop.slice(1) } : i)) };
    }
    return { ...n, destinatario };
  });
  const setDest = <K extends keyof Destinatario>(k: K, v: Destinatario[K]) => mudarDest({ [k]: v } as Partial<Destinatario>);
  const setItem = <K extends keyof ItemNfe>(k: number, campo: K, v: ItemNfe[K]) => mudar((n) => ({ ...n, itens: n.itens.map((i, j) => (j === k ? { ...i, [campo]: v } : i)) }));

  const aplicarModelo = (mid: string) => {
    const m = MODELOS_OPERACAO.find((x) => x.id === mid);
    if (!m) return;
    const cfop = destinoFora ? m.cfopFora : m.cfopDentro;
    mudar((n) => ({ ...n, natureza: m.natureza, tipo: m.tipo, finalidade: m.finalidade, itens: n.itens.map((i) => ({ ...i, cfop })) }));
  };

  const preencherDestinatario = (valor: string) => {
    if (valor.startsWith("u:")) {
      const d = lista.destinatarios.find((x) => x.documento === valor.slice(2));
      if (d) { mudar((n) => ({ ...n, destinatario: { ...notaVazia().destinatario, ...d } })); setClienteId(null); }
    } else if (valor.startsWith("c:")) {
      const c = lista.clientes.find((x) => x.id === valor.slice(2));
      if (!c) return;
      // O que o cadastro tem preenche; o que falta fica em branco para completar (e volta ao cadastro ao salvar).
      mudarDest({
        ...notaVazia().destinatario, nome: c.name.slice(0, 60), documento: so(c.tax_id ?? ""), indIE: c.ind_ie ?? 1, ie: c.ie ?? "",
        email: c.email_nfe ?? "", cep: c.cep ?? "", logradouro: c.logradouro ?? "", numero: c.numero ?? "", complemento: c.complemento ?? "",
        bairro: c.bairro ?? "", municipio: c.municipio ?? "", codigoMunicipio: c.codigo_municipio ?? "", uf: c.uf ?? "", fone: c.telefone ?? "",
      });
      setClienteId(c.id);
      const faltam = !c.tax_id ? "o CNPJ" : !c.logradouro || !c.codigo_municipio ? "o endereço" : "";
      if (faltam) notify(`O cadastro de ${c.name} ainda não tem ${faltam}. ${!c.tax_id ? "Digite o CNPJ e clique em Buscar pelo CNPJ" : "Complete aqui"}: ao salvar, vai para o cadastro.`);
    }
  };

  const [consultando, setConsultando] = useState<null | "cnpj" | "cep">(null);
  const buscarCnpj = async () => {
    setConsultando("cnpj");
    const r = await api<{ dados: DadosCnpj }>(`/api/fiscal/consulta?cnpj=${nota.destinatario.documento}`);
    setConsultando(null);
    if (!r.ok) { notify(r.error); return; }
    const x = r.data.dados;
    mudarDest({
      nome: x.razaoSocial || nota.destinatario.nome, cep: x.cep, logradouro: x.logradouro, numero: x.numero, complemento: x.complemento, bairro: x.bairro,
      municipio: x.municipio, codigoMunicipio: x.codigoMunicipio, uf: x.uf, fone: x.telefone || nota.destinatario.fone, email: nota.destinatario.email || x.email,
    });
    notify(`${x.situacao && x.situacao !== "ATIVA" ? `Atenção: CNPJ com situação ${x.situacao} na Receita. ` : ""}Dados da Receita preenchidos. A inscrição estadual não vem na consulta: confira e digite.`);
  };
  const buscarCep = async (cep: string) => {
    setConsultando("cep");
    const r = await api<{ dados: DadosCep }>(`/api/fiscal/consulta?cep=${cep}`);
    setConsultando(null);
    if (!r.ok) { notify(r.error); return; }
    const x = r.data.dados;
    mudarDest({ logradouro: x.logradouro || nota.destinatario.logradouro, bairro: x.bairro || nota.destinatario.bairro, municipio: x.municipio, codigoMunicipio: x.codigoMunicipio, uf: x.uf });
  };

  const salvar = async (): Promise<string | null> => {
    const corpo = JSON.stringify({ ambiente: "treino", nota, customer_id: clienteId });
    const r = id
      ? await api(`/api/fiscal/nfe/${id}`, { method: "PUT", body: corpo })
      : await api<{ id: string }>("/api/fiscal/nfe", { method: "POST", body: corpo });
    if (!r.ok) { notify(r.error); return null; }
    setSujo(false);
    const salvo = r.data as { id?: string; customer_id?: string | null };
    if (salvo.customer_id) setClienteId(salvo.customer_id);
    return id ?? salvo.id ?? null;
  };

  const acao = async (nome: string, texto?: string): Promise<boolean> => {
    if (!id) return false;
    const r = await api<{ validacao?: Validacao; protocolo?: string }>(`/api/fiscal/nfe/${id}/acao`, { method: "POST", body: JSON.stringify({ acao: nome, texto }) });
    if (!r.ok) { notify(r.error); void carregar(id); return false; }
    return true;
  };

  const rodar = async (rotulo: string, fn: () => Promise<void>) => { setOcupado(rotulo); try { await fn(); } finally { setOcupado(null); } };

  const gravarRascunho = () => rodar("salvar", async () => {
    const nid = await salvar();
    if (!nid) return;
    notify("Rascunho salvo.");
    if (!id) onCriada(nid); else void carregar(nid);
  });

  const validar = () => rodar("validar", async () => {
    const nid = sujo || !id ? await salvar() : id;
    if (!nid) return;
    const r = await api<{ validacao: Validacao }>(`/api/fiscal/nfe/${nid}/acao`, { method: "POST", body: JSON.stringify({ acao: "validar" }) });
    if (!r.ok) notify(r.error);
    else notify(r.data.validacao.ok ? "Nota validada: regras e esquema oficial conferidos." : `A nota tem ${r.data.validacao.erros.length + r.data.validacao.esquema.erros.length} ponto(s) para corrigir.`);
    if (!id) onCriada(nid); else void carregar(nid);
  });

  const simples = (nome: string, ok: string) => rodar(nome, async () => { if (await acao(nome)) { notify(ok); void carregar(id!); } });

  const descartar = () => rodar("descartar", async () => {
    if (!id) { onFechar(); return; }
    const r = await api<{ numeroSemUso: { serie: number; numero: number } | null }>(`/api/fiscal/nfe/${id}`, { method: "DELETE" });
    if (!r.ok) { notify(r.error); return; }
    notify(r.data.numeroSemUso ? `Nota descartada. O nº ${r.data.numeroSemUso.numero} ficou sem uso: na produção, ele precisaria ser inutilizado.` : "Nota descartada.");
    onFechar();
  });

  const gerarParcelas = (qtd: number, intervalo: number) => mudar((n) => {
    const base = Math.floor((totais.vNF * 100) / qtd) / 100;
    const inicio = new Date(`${hoje()}T12:00:00`);
    const duplicatas = Array.from({ length: qtd }, (_, k) => {
      const venc = new Date(inicio.getTime() + (k + 1) * intervalo * 86_400_000).toISOString().slice(0, 10);
      return { numero: String(k + 1).padStart(3, "0"), vencimento: venc, valor: k === qtd - 1 ? r2(totais.vNF - base * (qtd - 1)) : base };
    });
    return { ...n, pagamento: { ...n.pagamento, duplicatas } };
  });

  if (erro) return <div className="finance-empty almox-vazio"><b>{erro}</b><Button variant="secondary" onClick={onFechar}>Voltar</Button></div>;
  if (id && !det) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;

  const errosDo = (prefixo: string) => (validacao?.erros ?? []).filter((p) => p.campo.startsWith(prefixo));
  const d = nota.destinatario;
  const docsDoCadastro = new Set(lista.clientes.map((c) => c.tax_id).filter(Boolean));
  const usadosFora = lista.destinatarios.filter((x) => !docsDoCadastro.has(x.documento));
  const ipiCsts = nota.tipo === 1 ? CST_IPI_SAIDA : CST_IPI_ENTRADA;
  const icmsCsts = crt === 1 || crt === 2 || crt === 4 ? CSOSN_SIMPLES : CST_ICMS_NORMAL;
  const somaDup = r2(nota.pagamento.duplicatas.reduce((a, x) => a + x.valor, 0));

  return (
    <div className="icms-modulo nfe-editor-pagina">
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">FISCAL · NF-e · TREINO</p>
          <h1>{det?.numero ? `NF-e nº ${numeroNota(det)}` : "Nova nota fiscal"}</h1>
          <p>{det ? <>Montada por {det.montada_por_nome ?? "—"}{det.aprovada_por_nome ? ` · aprovada por ${det.aprovada_por_nome}` : ""}</> : "Preencha, valide e envie para aprovação."}</p>
        </div>
        <div className="icms-acoes">
          <Status tone={SITUACAO[situacao][1]}>{SITUACAO[situacao][0]}</Status>
          <Button variant="secondary" onClick={onFechar}>Voltar à lista</Button>
        </div>
      </div>

      <FaixaTreino />

      {det?.motivo && situacao === "rascunho" && <Callout variant="danger" title="Volte e corrija">{det.motivo}</Callout>}
      {det?.chave && (
        <dl className="fiscal-cert nfe-ids">
          <div><dt>Chave de acesso</dt><dd className="nfe-chave">{det.chave.replace(/(\d{4})(?=\d)/g, "$1 ")}</dd></div>
          <div><dt>Emissão</dt><dd>{dataHora(det.emissao)}</dd></div>
          <div><dt>Protocolo (simulado)</dt><dd>{det.protocolo ?? "—"}</dd></div>
          <div><dt>Autorizada em</dt><dd>{dataHora(det.autorizada_em)}</dd></div>
        </dl>
      )}

      <div className="nfe-editor">
        <fieldset className="nfe-form" disabled={!editavel || ocupado !== null}>
          <section className="almox-bloco fiscal-config-bloco">
            <header><h2>Operação</h2>
              {editavel && (
                <select className="nfe-modelo" value="" onChange={(e) => aplicarModelo(e.target.value)} aria-label="Modelo de operação">
                  <option value="">Usar um modelo…</option>
                  {MODELOS_OPERACAO.map((m) => <option key={m.id} value={m.id}>{m.rotulo} ({destinoFora ? m.cfopFora : m.cfopDentro})</option>)}
                </select>
              )}
            </header>
            <div className="fiscal-campos nfe-campos">
              <label className="nfe-largo"><span>Natureza da operação</span><input value={nota.natureza} maxLength={60} onChange={(e) => mudar((n) => ({ ...n, natureza: e.target.value.toUpperCase() }))} /></label>
              <label><span>Tipo</span><select value={nota.tipo} onChange={(e) => mudar((n) => ({ ...n, tipo: Number(e.target.value) as 0 | 1 }))}><option value={1}>1 · Saída</option><option value={0}>0 · Entrada</option></select></label>
              <label><span>Finalidade</span><select value={nota.finalidade} onChange={(e) => mudar((n) => ({ ...n, finalidade: Number(e.target.value) as 1 | 2 | 3 | 4 }))}><option value={1}>1 · Normal</option><option value={2}>2 · Complementar</option><option value={3}>3 · Ajuste</option><option value={4}>4 · Devolução</option></select></label>
              <label className="nfe-largo"><span>Presença do comprador</span><select value={nota.presenca} onChange={(e) => mudar((n) => ({ ...n, presenca: Number(e.target.value) as 0 | 1 | 2 | 9 }))}><option value={9}>9 · Outros (venda comum entre empresas)</option><option value={1}>1 · Presencial</option><option value={2}>2 · Internet</option><option value={0}>0 · Não se aplica</option></select></label>
              <label className="nfe-check"><input type="checkbox" checked={nota.consumidorFinal} onChange={(e) => mudar((n) => ({ ...n, consumidorFinal: e.target.checked }))} /><span>Consumidor final<small> · quem compra usa (não revende nem industrializa)</small></span></label>
              {(nota.finalidade === 2 || nota.finalidade === 4) && (
                <label className="nfe-cheio"><span>Chave da NF-e referenciada<small> · a nota {nota.finalidade === 4 ? "devolvida" : "complementada"} (44 dígitos)</small></span><input inputMode="numeric" value={nota.referencia ?? ""} onChange={(e) => mudar((n) => ({ ...n, referencia: so(e.target.value).slice(0, 44) }))} /></label>
              )}
            </div>
            <Problemas lista={[...errosDo("natureza"), ...errosDo("referencia"), ...errosDo("consumidorFinal")]} />
          </section>

          <section className="almox-bloco fiscal-config-bloco">
            <header><h2>Destinatário</h2>
              {editavel && (lista.destinatarios.length > 0 || lista.clientes.length > 0) && (
                <select className="nfe-modelo" value="" onChange={(e) => preencherDestinatario(e.target.value)} aria-label="Preencher destinatário">
                  <option value="">Preencher a partir de…</option>
                  {lista.clientes.length > 0 && <optgroup label="Cadastro de clientes">{lista.clientes.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}{c.tax_id ? ` · ${cnpjFormatado(c.tax_id)}` : " · sem CNPJ"}{c.tax_id && (!c.logradouro || !c.codigo_municipio) ? " · sem endereço" : ""}</option>)}</optgroup>}
                  {usadosFora.length > 0 && <optgroup label="Já usados em notas (fora do cadastro)">{usadosFora.map((x) => <option key={x.documento} value={`u:${x.documento}`}>{x.nome} · {cnpjFormatado(x.documento)}</option>)}</optgroup>}
                </select>
              )}
            </header>
            <div className="fiscal-campos nfe-campos">
              <label><span>CNPJ ou CPF</span><input inputMode="numeric" value={d.documento.length === 14 ? cnpjFormatado(d.documento) : d.documento} onChange={(e) => setDest("documento", so(e.target.value).slice(0, 14))} /></label>
              {editavel && <div className="nfe-buscar"><Button type="button" variant="secondary" compact onClick={() => void buscarCnpj()} disabled={d.documento.length !== 14 || consultando !== null}>{consultando === "cnpj" ? "Consultando…" : "Buscar pelo CNPJ"}</Button></div>}
              <label className="nfe-largo"><span>Razão social / nome</span><input value={d.nome} maxLength={60} onChange={(e) => setDest("nome", e.target.value)} /></label>
              <label className="nfe-largo"><span>Indicador da IE</span><select value={d.indIE} onChange={(e) => setDest("indIE", Number(e.target.value) as 1 | 2 | 9)}><option value={1}>1 · Contribuinte do ICMS</option><option value={2}>2 · Contribuinte isento</option><option value={9}>9 · Não contribuinte</option></select></label>
              <label><span>Inscrição estadual</span><input value={d.ie} maxLength={14} disabled={d.indIE !== 1} onChange={(e) => setDest("ie", so(e.target.value))} /></label>
              <label><span>E-mail para a nota</span><input type="email" value={d.email} maxLength={60} onChange={(e) => setDest("email", e.target.value)} /></label>
              <label><span>CEP{consultando === "cep" ? <small> · buscando…</small> : <small> · completa o endereço</small>}</span><input inputMode="numeric" value={d.cep} onChange={(e) => { const cep = so(e.target.value).slice(0, 8); setDest("cep", cep); if (cep.length === 8 && cep !== d.cep) void buscarCep(cep); }} /></label>
              <label className="nfe-largo"><span>Logradouro</span><input value={d.logradouro} maxLength={60} onChange={(e) => setDest("logradouro", e.target.value)} /></label>
              <label><span>Número</span><input value={d.numero} maxLength={60} onChange={(e) => setDest("numero", e.target.value)} /></label>
              <label><span>Complemento</span><input value={d.complemento} maxLength={60} onChange={(e) => setDest("complemento", e.target.value)} /></label>
              <label><span>Bairro</span><input value={d.bairro} maxLength={60} onChange={(e) => setDest("bairro", e.target.value)} /></label>
              <label><span>Município</span><input value={d.municipio} maxLength={60} onChange={(e) => setDest("municipio", e.target.value)} /></label>
              <label><span>Código IBGE<small> · 7 dígitos</small></span><input inputMode="numeric" value={d.codigoMunicipio} onChange={(e) => setDest("codigoMunicipio", so(e.target.value).slice(0, 7))} /></label>
              <label><span>UF</span><select value={d.uf} onChange={(e) => setDest("uf", e.target.value)}><option value="">—</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
              <label><span>Telefone</span><input inputMode="tel" value={d.fone} onChange={(e) => setDest("fone", so(e.target.value).slice(0, 14))} /></label>
            </div>
            {destinoFora && <p className="fiscal-nota-ajuda">Destino em outro estado ({ufEmitente} → {d.uf}): CFOP começando por {nota.tipo === 1 ? "6" : "2"} e, em geral, ICMS interestadual (12% ou 7%; 4% para importados). Confira com o Jefferson/escritório.</p>}
            <Problemas lista={errosDo("destinatario")} />
          </section>

          <section className="almox-bloco fiscal-config-bloco">
            <header><h2>Itens</h2><span className="nfe-contagem">{nota.itens.length} {nota.itens.length === 1 ? "item" : "itens"}</span></header>
            <p className="fiscal-nota-ajuda">NCM: classificação do produto (8 dígitos). CFOP: 5 = dentro do estado, 6 = outro estado, 7 = exterior (na saída). O CST diz como cada imposto incide; a plataforma calcula base e valor.</p>
            {nota.itens.map((i, k) => {
              const c = calculo[k];
              return (
                <div className="nfe-item" key={k}>
                  <header>
                    <b>Item {k + 1}</b>
                    {i.itemOrcamento && <Status tone="info">{`Do orçamento${i.pedidoCompra ? ` · pedido ${i.pedidoCompra}${i.itemPedido ? ` item ${i.itemPedido}` : ""}` : ""}`}</Status>}
                    <span>{money(c ? r2(c.vProd - c.vDesc) : 0)}{c && c.vICMS ? ` · ICMS ${money(c.vICMS)}` : ""}{c && c.vIPI ? ` · IPI ${money(c.vIPI)}` : ""}</span>
                    {editavel && (
                      <span className="nfe-item-acoes">
                        <button type="button" className="almox-link" onClick={() => mudar((n) => ({ ...n, itens: [...n.itens.slice(0, k + 1), { ...i }, ...n.itens.slice(k + 1)] }))}>Duplicar</button>
                        {nota.itens.length > 1 && <button type="button" className="almox-link almox-perigo" onClick={() => mudar((n) => ({ ...n, itens: n.itens.filter((_, j) => j !== k) }))}>Remover</button>}
                      </span>
                    )}
                  </header>
                  <div className="fiscal-campos nfe-campos">
                    <label><span>Código</span><input value={i.codigo} maxLength={60} onChange={(e) => setItem(k, "codigo", e.target.value)} /></label>
                    <label className="nfe-largo"><span>Descrição</span><input value={i.descricao} maxLength={120} onChange={(e) => setItem(k, "descricao", e.target.value)} /></label>
                    <label><span>NCM</span><input inputMode="numeric" value={i.ncm} onChange={(e) => setItem(k, "ncm", so(e.target.value).slice(0, 8))} /></label>
                    <label><span>CFOP</span><input inputMode="numeric" value={i.cfop} onChange={(e) => setItem(k, "cfop", so(e.target.value).slice(0, 4))} /></label>
                    <label><span>Unidade</span><input value={i.unidade} maxLength={6} onChange={(e) => setItem(k, "unidade", e.target.value.toUpperCase())} /></label>
                    <label><span>Quantidade</span><Numero valor={i.quantidade} casas={4} onChange={(v) => setItem(k, "quantidade", v)} /></label>
                    <label><span>Valor unitário</span><Numero valor={i.valorUnitario} casas={4} onChange={(v) => setItem(k, "valorUnitario", v)} /></label>
                    <label><span>Desconto (R$)</span><Numero valor={i.desconto} onChange={(v) => setItem(k, "desconto", v)} /></label>
                    <label className="nfe-largo"><span>Origem da mercadoria</span><select value={i.origem} onChange={(e) => setItem(k, "origem", Number(e.target.value))}>{ORIGENS.map((o, j) => <option key={j} value={j}>{o}</option>)}</select></label>
                  </div>
                  <div className="fiscal-campos nfe-campos nfe-impostos">
                    <label className="nfe-largo"><span>ICMS · {crt === 1 || crt === 2 || crt === 4 ? "CSOSN" : "CST"}</span><select value={i.icmsCst} onChange={(e) => setItem(k, "icmsCst", e.target.value)}>{icmsCsts.map((x) => <option key={x} value={x}>{CST_ICMS[x] ?? x}</option>)}</select></label>
                    <label><span>Alíquota ICMS %</span><Numero valor={i.icmsAliquota} onChange={(v) => setItem(k, "icmsAliquota", v)} /></label>
                    {i.icmsCst === "20" && <label><span>Redução da base %</span><Numero valor={i.icmsReducaoBase} onChange={(v) => setItem(k, "icmsReducaoBase", v)} /></label>}
                    <label className="nfe-largo"><span>IPI · CST</span><select value={i.ipiCst} onChange={(e) => setItem(k, "ipiCst", e.target.value)}>{ipiCsts.map((x) => <option key={x} value={x}>{CST_IPI[x] ?? x}</option>)}</select></label>
                    <label><span>Alíquota IPI %</span><Numero valor={i.ipiAliquota} onChange={(v) => setItem(k, "ipiAliquota", v)} /></label>
                    <label className="nfe-largo"><span>PIS · CST</span><select value={i.pisCst} onChange={(e) => setItem(k, "pisCst", e.target.value)}>{CST_PIS_COFINS.map((x) => <option key={x} value={x}>{CST_PC[x] ?? x}</option>)}</select></label>
                    <label><span>Alíquota PIS %</span><Numero valor={i.pisAliquota} onChange={(v) => setItem(k, "pisAliquota", v)} /></label>
                    <label className="nfe-largo"><span>COFINS · CST</span><select value={i.cofinsCst} onChange={(e) => setItem(k, "cofinsCst", e.target.value)}>{CST_PIS_COFINS.map((x) => <option key={x} value={x}>{CST_PC[x] ?? x}</option>)}</select></label>
                    <label><span>Alíquota COFINS %</span><Numero valor={i.cofinsAliquota} onChange={(v) => setItem(k, "cofinsAliquota", v)} /></label>
                  </div>
                  {c && (
                    <p className="nfe-item-calculo">
                      Base ICMS {money(c.vBC)}{icmsDestaca(i.icmsCst) ? ` → ${money(c.vICMS)}` : " (não destaca)"} · IPI {ipiTributado(i.ipiCst) ? money(c.vIPI) : "não tributado"} · PIS {pisCofinsComAliquota(i.pisCst) ? money(c.vPIS) : "—"} · COFINS {pisCofinsComAliquota(i.cofinsCst) ? money(c.vCOFINS) : "—"}
                      {c.vFrete || c.vSeg || c.vOutro ? ` · rateio: frete ${money(c.vFrete)}${c.vSeg ? `, seguro ${money(c.vSeg)}` : ""}${c.vOutro ? `, outras ${money(c.vOutro)}` : ""}` : ""}
                    </p>
                  )}
                  <Problemas lista={errosDo(`itens.${k}.`)} />
                </div>
              );
            })}
            {editavel && <div><Button variant="secondary" compact onClick={() => mudar((n) => ({ ...n, itens: [...n.itens, itemPadrao(destinoFora ? n.itens[0]?.cfop.replace(/^5/, "6") ?? "6101" : n.itens[0]?.cfop ?? "5101", crt)] }))}>Adicionar item</Button></div>}
            <Problemas lista={errosDo("itens").filter((p) => p.campo === "itens")} />
          </section>

          <section className="almox-bloco fiscal-config-bloco">
            <header><h2>Transporte e despesas</h2></header>
            <div className="fiscal-campos nfe-campos">
              <label className="nfe-largo"><span>Frete</span><select value={nota.frete.modalidade} onChange={(e) => mudar((n) => ({ ...n, frete: { ...n.frete, modalidade: Number(e.target.value) as 0 | 1 | 2 | 9 } }))}>{Object.entries(MODALIDADE_FRETE).map(([v, l]) => <option key={v} value={v}>{v} · {l}</option>)}</select></label>
              <label><span>Valor do frete<small> · na nota</small></span><Numero valor={nota.frete.valor} onChange={(v) => mudar((n) => ({ ...n, frete: { ...n.frete, valor: v } }))} /></label>
              <label><span>Seguro</span><Numero valor={nota.seguro} onChange={(v) => mudar((n) => ({ ...n, seguro: v }))} /></label>
              <label><span>Outras despesas</span><Numero valor={nota.outrasDespesas} onChange={(v) => mudar((n) => ({ ...n, outrasDespesas: v }))} /></label>
            </div>
            {nota.frete.modalidade !== 9 && (
              <>
                <div className="fiscal-campos nfe-campos">
                  <label className="nfe-largo"><span>Transportadora</span><input value={nota.frete.transportadora?.nome ?? ""} maxLength={60} onChange={(e) => mudar((n) => ({ ...n, frete: { ...n.frete, transportadora: { documento: "", ie: "", uf: "", ...n.frete.transportadora, nome: e.target.value } } }))} /></label>
                  <label><span>CNPJ da transportadora</span><input inputMode="numeric" value={cnpjFormatado(nota.frete.transportadora?.documento ?? "")} onChange={(e) => mudar((n) => ({ ...n, frete: { ...n.frete, transportadora: { nome: "", ie: "", uf: "", ...n.frete.transportadora, documento: so(e.target.value).slice(0, 14) } } }))} /></label>
                  <label><span>UF</span><select value={nota.frete.transportadora?.uf ?? ""} onChange={(e) => mudar((n) => ({ ...n, frete: { ...n.frete, transportadora: { nome: "", ie: "", documento: "", ...n.frete.transportadora, uf: e.target.value } } }))}><option value="">—</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
                </div>
                <div className="fiscal-campos nfe-campos">
                  <label><span>Volumes</span><Numero valor={nota.frete.volumes?.quantidade ?? 0} casas={0} onChange={(v) => mudar((n) => ({ ...n, frete: { ...n.frete, volumes: { especie: "", pesoLiquido: 0, pesoBruto: 0, ...n.frete.volumes, quantidade: Math.round(v) } } }))} /></label>
                  <label><span>Espécie</span><input value={nota.frete.volumes?.especie ?? ""} maxLength={60} placeholder="CAIXA, PALETE…" onChange={(e) => mudar((n) => ({ ...n, frete: { ...n.frete, volumes: { quantidade: 0, pesoLiquido: 0, pesoBruto: 0, ...n.frete.volumes, especie: e.target.value.toUpperCase() } } }))} /></label>
                  <label><span>Peso líquido (kg)</span><Numero valor={nota.frete.volumes?.pesoLiquido ?? 0} casas={3} onChange={(v) => mudar((n) => ({ ...n, frete: { ...n.frete, volumes: { quantidade: 0, especie: "", pesoBruto: 0, ...n.frete.volumes, pesoLiquido: v } } }))} /></label>
                  <label><span>Peso bruto (kg)</span><Numero valor={nota.frete.volumes?.pesoBruto ?? 0} casas={3} onChange={(v) => mudar((n) => ({ ...n, frete: { ...n.frete, volumes: { quantidade: 0, especie: "", pesoLiquido: 0, ...n.frete.volumes, pesoBruto: v } } }))} /></label>
                </div>
              </>
            )}
            <Problemas lista={errosDo("frete")} />
          </section>

          <section className="almox-bloco fiscal-config-bloco">
            <header><h2>Pagamento</h2></header>
            <div className="fiscal-campos nfe-campos">
              <label className="nfe-largo"><span>Forma de pagamento</span><select value={nota.pagamento.forma} onChange={(e) => mudar((n) => ({ ...n, pagamento: { ...n.pagamento, forma: e.target.value } }))}>{Object.entries(FORMAS_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{v} · {l}</option>)}</select></label>
            </div>
            {nota.pagamento.forma !== "90" && (
              <>
                {nota.pagamento.duplicatas.length > 0 && (
                  <div className="nfe-duplicatas" role="table">
                    <div className="cabeca" role="row"><span>Parcela</span><span>Vencimento</span><span className="r">Valor</span><span /></div>
                    {nota.pagamento.duplicatas.map((u, k) => (
                      <div role="row" key={k}>
                        <input value={u.numero} maxLength={20} aria-label="Número da parcela" onChange={(e) => mudar((n) => ({ ...n, pagamento: { ...n.pagamento, duplicatas: n.pagamento.duplicatas.map((x, j) => (j === k ? { ...x, numero: e.target.value } : x)) } }))} />
                        <input type="date" value={u.vencimento} aria-label="Vencimento" onChange={(e) => mudar((n) => ({ ...n, pagamento: { ...n.pagamento, duplicatas: n.pagamento.duplicatas.map((x, j) => (j === k ? { ...x, vencimento: e.target.value } : x)) } }))} />
                        <Numero valor={u.valor} rotulo="Valor da parcela" onChange={(v) => mudar((n) => ({ ...n, pagamento: { ...n.pagamento, duplicatas: n.pagamento.duplicatas.map((x, j) => (j === k ? { ...x, valor: v } : x)) } }))} />
                        {editavel ? <button type="button" className="almox-link almox-perigo" onClick={() => mudar((n) => ({ ...n, pagamento: { ...n.pagamento, duplicatas: n.pagamento.duplicatas.filter((_, j) => j !== k) } }))}>Remover</button> : <span />}
                      </div>
                    ))}
                    <div role="row" className="nfe-dup-soma"><span>Soma</span><span /><span className={`r${somaDup !== totais.vNF ? " fiscal-erro" : ""}`}>{money(somaDup)}</span><span>{somaDup === totais.vNF ? "fecha com a nota" : `nota: ${money(totais.vNF)}`}</span></div>
                  </div>
                )}
                {editavel && <GerarParcelas onGerar={gerarParcelas} desabilitado={totais.vNF <= 0} />}
              </>
            )}
            <Problemas lista={errosDo("pagamento")} />
          </section>

          <section className="almox-bloco fiscal-config-bloco">
            <header><h2>Informações complementares</h2></header>
            <label className="nfe-texto">
              <textarea aria-label="Informações complementares" rows={3} maxLength={2000} value={nota.infoComplementar} onChange={(e) => mudar((n) => ({ ...n, infoComplementar: e.target.value }))} placeholder="Pedido do cliente, dados bancários, observações exigidas por lei…" />
            </label>
            <p className="fiscal-nota-ajuda">No treino, a plataforma acrescenta “SIMULACAO DE TREINO NA PLATAFORMA - SEM VALOR FISCAL” no começo deste texto.</p>
          </section>
        </fieldset>

        <aside className="nfe-lado">
          <section className="almox-bloco nfe-totais">
            <h2>Totais da nota</h2>
            <dl>
              <div><dt>Produtos</dt><dd>{money(totais.vProd)}</dd></div>
              {totais.vDesc > 0 && <div><dt>(−) Descontos</dt><dd>{money(totais.vDesc)}</dd></div>}
              {totais.vFrete > 0 && <div><dt>(+) Frete</dt><dd>{money(totais.vFrete)}</dd></div>}
              {totais.vSeg > 0 && <div><dt>(+) Seguro</dt><dd>{money(totais.vSeg)}</dd></div>}
              {totais.vOutro > 0 && <div><dt>(+) Outras despesas</dt><dd>{money(totais.vOutro)}</dd></div>}
              <div><dt>(+) IPI</dt><dd>{money(totais.vIPI)}</dd></div>
              <div className="nfe-total"><dt>Total da nota</dt><dd>{money(totais.vNF)}</dd></div>
              <div><dt>Base do ICMS</dt><dd>{money(totais.vBC)}</dd></div>
              <div><dt>ICMS</dt><dd>{money(totais.vICMS)}</dd></div>
              <div><dt>PIS</dt><dd>{money(totais.vPIS)}</dd></div>
              <div><dt>COFINS</dt><dd>{money(totais.vCOFINS)}</dd></div>
            </dl>
          </section>

          <section className="almox-bloco nfe-conferencia">
            <h2>Conferência</h2>
            {sujo && <p className="fiscal-nota-ajuda">Há alterações não salvas. Valide de novo depois de mexer.</p>}
            {!sujo && !validacao && <p className="fiscal-nota-ajuda">Ainda não validada. A validação confere as regras da plataforma e o esquema oficial da SEFAZ, e reserva o número.</p>}
            {validacao && (
              <>
                {validacao.ok ? <Status tone="success">Tudo certo</Status> : <Status tone="danger">{validacao.erros.length + validacao.esquema.erros.length} para corrigir</Status>}
                {validacao.erros.length > 0 && <ul className="nfe-problemas">{validacao.erros.map((p, k) => <li key={k}>{p.mensagem}</li>)}</ul>}
                {validacao.esquema.erros.length > 0 && <><p className="fiscal-nota-ajuda"><b>Esquema oficial da SEFAZ:</b></p><ul className="nfe-problemas">{validacao.esquema.erros.map((p, k) => <li key={k}>{p}</li>)}</ul></>}
                {validacao.ok && validacao.esquema.conferido && <p className="fiscal-nota-ajuda">Regras da plataforma e esquema oficial (leiaute 4.00) conferidos.</p>}
                {validacao.avisos.length > 0 && <ul className="nfe-avisos">{validacao.avisos.map((p, k) => <li key={k}>{p.mensagem}</li>)}</ul>}
              </>
            )}
          </section>

          <section className="almox-bloco nfe-acoes-lado">
            {editavel && (
              <>
                <Button onClick={() => void validar()} disabled={ocupado !== null}>{ocupado === "validar" ? "Validando…" : "Salvar e validar"}</Button>
                <Button variant="secondary" onClick={() => void gravarRascunho()} disabled={ocupado !== null || (!sujo && Boolean(id))}>{ocupado === "salvar" ? "Salvando…" : "Salvar rascunho"}</Button>
                {situacao === "validada" && !sujo && <Button onClick={() => void simples("enviar", "Enviada para aprovação. Quem aprova as notas foi avisado.")} disabled={ocupado !== null}>{ocupado === "enviar" ? "Enviando…" : "Enviar para aprovação"}</Button>}
              </>
            )}
            {situacao === "aguardando_aprovacao" && (lista.podeAprovar ? (
              <>
                <p className="fiscal-nota-ajuda">Você aprova as notas: confira e transmita. No treino a “SEFAZ” é simulada e devolve um protocolo fictício.</p>
                <Button onClick={() => void simples("transmitir", "Nota autorizada no treino. DANFE e XML disponíveis.")} disabled={ocupado !== null}>{ocupado === "transmitir" ? "Transmitindo…" : "Aprovar e transmitir (treino)"}</Button>
                <Button variant="secondary" onClick={() => setPedir("devolver")} disabled={ocupado !== null}>Devolver para correção</Button>
              </>
            ) : <p className="fiscal-nota-ajuda">Aguardando quem aprova as notas transmitir.</p>)}
            {(situacao === "autorizada" || situacao === "cancelada") && (
              <>
                <a className="ds-button primary" href={`/api/fiscal/nfe/${id}/danfe`} target="_blank" rel="noreferrer">Ver DANFE</a>
                <a className="ds-button secondary" href={`/api/fiscal/nfe/${id}/xml`}>Baixar XML</a>
              </>
            )}
            {situacao === "autorizada" && lista.podeAprovar && (
              <>
                <Button variant="secondary" onClick={() => setPedir("carta")} disabled={ocupado !== null}>Carta de correção</Button>
                <Button variant="ghost" className="almox-perigo" onClick={() => setPedir("cancelar")} disabled={ocupado !== null}>Cancelar a nota</Button>
              </>
            )}
            {(situacao === "validada" || situacao === "aguardando_aprovacao") && det?.chave && <a className="almox-link" href={`/api/fiscal/nfe/${id}/xml`}>Baixar o XML gerado (sem protocolo)</a>}
            {lista.podeOperar && ["rascunho", "validada", "aguardando_aprovacao", "rejeitada"].includes(situacao) && (
              <Button variant="ghost" className="almox-perigo" onClick={() => void descartar()} disabled={ocupado !== null}>{id ? "Descartar nota" : "Descartar"}</Button>
            )}
          </section>

          {eventos.length > 0 && (
            <section className="almox-bloco">
              <h2 className="nfe-h2">Eventos</h2>
              <ul className="nfe-eventos">
                {eventos.map((e) => (
                  <li key={e.id}><b>{e.tipo === "cancelamento" ? "Cancelamento" : `Carta de correção nº ${e.sequencia}`}</b><span>{e.texto}</span><small>{e.created_by_name ?? "—"} · {dataHora(e.created_at)} · protocolo {e.protocolo}</small></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {pedir && id && (
        <PedirTexto tipo={pedir} onClose={() => setPedir(null)} onConfirmar={async (texto) => {
          const ok = await acao(pedir, texto);
          if (ok) {
            notify({ devolver: "Nota devolvida para correção.", cancelar: "Nota cancelada no treino.", carta: "Carta de correção registrada no treino." }[pedir]);
            setPedir(null);
            void carregar(id);
          }
          return ok;
        }} />
      )}
    </div>
  );
}

function Problemas({ lista }: { lista: Problema[] }) {
  if (!lista.length) return null;
  return <ul className="nfe-problemas">{lista.map((p, k) => <li key={k}>{p.mensagem}</li>)}</ul>;
}

function GerarParcelas({ onGerar, desabilitado }: { onGerar: (qtd: number, intervalo: number) => void; desabilitado: boolean }) {
  const [qtd, setQtd] = useState("1");
  const [intervalo, setIntervalo] = useState("30");
  return (
    <div className="nfe-gerar">
      <label><span>Parcelas</span><input inputMode="numeric" value={qtd} onChange={(e) => setQtd(so(e.target.value).slice(0, 2))} /></label>
      <label><span>A cada (dias)</span><input inputMode="numeric" value={intervalo} onChange={(e) => setIntervalo(so(e.target.value).slice(0, 3))} /></label>
      <Button variant="secondary" compact disabled={desabilitado || !(Number(qtd) >= 1 && Number(qtd) <= 60) || !(Number(intervalo) >= 1)} onClick={() => onGerar(Number(qtd), Number(intervalo))}>Gerar duplicatas</Button>
    </div>
  );
}

const PEDIR = {
  devolver: { titulo: "Devolver para correção", rotulo: "O que precisa ser corrigido", minimo: 5, botao: "Devolver", ajuda: "Quem montou a nota recebe de volta, com este recado." },
  cancelar: { titulo: "Cancelar a nota", rotulo: "Justificativa do cancelamento", minimo: 15, botao: "Cancelar a nota", ajuda: "Regra da SEFAZ: até 24 horas depois da autorização (em SP), com justificativa de 15 caracteres ou mais, e só se a mercadoria não circulou." },
  carta: { titulo: "Carta de correção", rotulo: "Texto da correção", minimo: 15, botao: "Registrar a carta", ajuda: "A carta corrige dados que NÃO mudam o valor nem o imposto, nem o destinatário, nem a data. Ex.: endereço de entrega, peso, transportadora. Cada nova carta substitui a anterior." },
} as const;

function PedirTexto({ tipo, onClose, onConfirmar }: { tipo: keyof typeof PEDIR; onClose: () => void; onConfirmar: (texto: string) => Promise<boolean> }) {
  const p = PEDIR[tipo];
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    setEnviando(true);
    await onConfirmar(texto.trim());
    setEnviando(false);
  };
  return (
    <Modal eyebrow="NF-e · TREINO" title={p.titulo} onClose={onClose}>
      <form className="almox-form" onSubmit={enviar}>
        <p className="fiscal-nota-ajuda">{p.ajuda}</p>
        <label className="nfe-texto"><span>{p.rotulo}</span><textarea rows={4} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus /></label>
        <small className="nfe-contador">{texto.trim().length} caractere(s){texto.trim().length < p.minimo ? ` · mínimo ${p.minimo}` : ""}</small>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={enviando}>Voltar</Button>
          <Button type="submit" className={tipo === "cancelar" ? "almox-perigo-cheio" : ""} disabled={enviando || texto.trim().length < p.minimo}>{enviando ? "Enviando…" : p.botao}</Button>
        </footer>
      </form>
    </Modal>
  );
}

function InutilizarModal({ onClose, onFeito }: { onClose: () => void; onFeito: (m: string) => void }) {
  const [serie, setSerie] = useState("1");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    setEnviando(true); setErro("");
    const r = await api<{ protocolo: string }>("/api/fiscal/nfe/inutilizar", { method: "POST", body: JSON.stringify({ ambiente: "treino", serie, inicio, fim: fim || inicio, texto }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(`Numeração inutilizada no treino (protocolo simulado ${r.data.protocolo}).`);
  };
  return (
    <Modal eyebrow="NF-e · TREINO" title="Inutilizar números" subtitle="Para números que pularam e não vão ser usados" onClose={onClose}>
      <form className="almox-form" onSubmit={enviar}>
        <p className="fiscal-nota-ajuda">Na vida real, todo número pulado (nota descartada, falha no sistema) precisa ser inutilizado na SEFAZ até o dia 10 do mês seguinte. Número de nota autorizada não pode ser inutilizado.</p>
        <div className="fiscal-campos nfe-campos">
          <label><span>Série</span><input inputMode="numeric" value={serie} onChange={(e) => setSerie(so(e.target.value).slice(0, 3))} required /></label>
          <label><span>Do número</span><input inputMode="numeric" value={inicio} onChange={(e) => setInicio(so(e.target.value).slice(0, 9))} required /></label>
          <label><span>Até o número</span><input inputMode="numeric" value={fim} placeholder={inicio} onChange={(e) => setFim(so(e.target.value).slice(0, 9))} /></label>
        </div>
        <label className="nfe-texto"><span>Justificativa (15 caracteres ou mais)</span><textarea rows={3} maxLength={255} value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={enviando}>Voltar</Button>
          <Button type="submit" disabled={enviando || !inicio || texto.trim().length < 15}>{enviando ? "Inutilizando…" : "Inutilizar"}</Button>
        </footer>
      </form>
    </Modal>
  );
}
