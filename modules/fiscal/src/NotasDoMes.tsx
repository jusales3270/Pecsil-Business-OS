"use client";

import { useCallback, useEffect, useState } from "react";
import { Callout, Status } from "../../../packages/design-system";
import { EnviarArquivo } from "../../../app/components/enviar-arquivo";
import { api, cnpjFormatado, date, money, nomeMes } from "./comum";

/**
 * Fiscal › Notas emitidas › notas emitidas FORA da plataforma (GRV), por mês: a pessoa escolhe o mês (até
 * retroativo) e arrasta os XML e PDF das notas. É daqui que sai a receita do Lucro Presumido. Nota que já está na
 * plataforma, repetida, de outro mês ou de outra empresa não entra (o servidor confere de novo no Confirmar).
 */

type Tipo = "venda" | "exportacao" | "remessa" | "devolucao" | "entrada_propria";
type Receita = { industria: number; exportacao: number; servicos: number; devolucoes: number } | null;
type Lacuna = { numero: number; soEvento: boolean };
type DoMes = {
  mes: string;
  notas: { numero: string | null; chave: string | null; emissao: string | null; valor: number; tipo: Tipo; destinatario: string | null; origem: "plataforma" | "arquivo" }[];
  receita: Receita; lacunas: Lacuna[]; arquivos: number;
};
type Situacao = "saida" | "entrada_propria" | "evento" | "danfe" | "ja_na_plataforma" | "repetida_no_envio" | "outro_mes" | "outra_empresa" | "nao_reconhecido";
type Previa = {
  mes: string; rotuloMes: string; lacunas: Lacuna[];
  linhas: { arquivo: string; situacao: Situacao; entra: boolean; numero: string | null; emissao: string | null; destinatario: string | null; valor: number | null; natureza?: Tipo; nota: string }[];
  resumo: { arquivos: number; entram: number; saidas: number; entradasProprias: number; eventos: number; danfes: number; jaNaPlataforma: number; repetidas: number; outroMes: number; outraEmpresa: number; naoReconhecidos: number; remessas: number; receita: Receita; jaNoMes: number };
};

const TIPO: Record<Tipo, [string, "success" | "info" | "neutral" | "attention"]> = {
  venda: ["Venda", "success"], exportacao: ["Exportação", "info"], remessa: ["Remessa ou retorno", "neutral"],
  devolucao: ["Devolução", "attention"], entrada_propria: ["Entrada própria", "neutral"],
};
const SITUACAO: Record<Situacao, [string, "success" | "info" | "neutral" | "attention" | "danger"]> = {
  saida: ["Entra", "success"], entrada_propria: ["Entra", "success"], evento: ["Entra", "success"], danfe: ["Entra (PDF)", "info"],
  ja_na_plataforma: ["Já na plataforma", "neutral"], repetida_no_envio: ["Repetida", "neutral"], outro_mes: ["Outro mês", "attention"],
  outra_empresa: ["Outra empresa", "attention"], nao_reconhecido: ["Não lida", "danger"],
};
const mesAnterior = () => {
  const [a, m] = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7).split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};
const listaLacunas = (l: Lacuna[]) => l.map((x) => (x.soEvento ? `${x.numero} (só o evento)` : String(x.numero))).join(", ");

function PreviaEnvio({ p }: { p: Previa }) {
  const r = p.resumo;
  const naoEntram = r.outroMes + r.outraEmpresa + r.naoReconhecidos;
  return (
    <>
      <div className="arq-numeros">
        <div><small>Entram</small><b>{r.entram}</b><span>de {r.arquivos} {r.arquivos === 1 ? "arquivo" : "arquivos"}</span></div>
        <div><small>Receita das novas</small><b>{money((r.receita?.industria ?? 0) + (r.receita?.servicos ?? 0) - (r.receita?.devolucoes ?? 0))}</b><span>{r.receita?.exportacao ? `exportação ${money(r.receita.exportacao)}` : `${r.remessas} remessa${r.remessas === 1 ? "" : "s"} fora`}</span></div>
        <div><small>Já na plataforma</small><b>{r.jaNaPlataforma + r.repetidas}</b><span>não entram de novo</span></div>
        <div><small>Não entram</small><b className={naoEntram ? "alerta" : ""}>{naoEntram}</b><span>{r.outroMes ? `${r.outroMes} de outro mês` : r.outraEmpresa ? `${r.outraEmpresa} de outra empresa` : "outro mês, outra empresa ou não lidas"}</span></div>
      </div>
      {p.lacunas.length > 0 && (
        <Callout variant="warning" title={`${p.lacunas.length === 1 ? "Falta 1 número" : `Faltam ${p.lacunas.length} números`} na sequência de ${p.rotuloMes}`}>
          {listaLacunas(p.lacunas)}. Se foram canceladas ou inutilizadas, está certo; se não, falta enviar o XML.
        </Callout>
      )}
      <div className="arq-notas" role="table" aria-label="Arquivos do envio">
        {p.linhas.map((l, i) => (
          <div role="row" key={`${l.arquivo}-${i}`} className={l.entra || l.situacao === "ja_na_plataforma" || l.situacao === "repetida_no_envio" ? "" : "erro"}>
            <span className="nf"><b>{l.numero ? `NF ${l.numero}` : l.arquivo}</b><small>{l.emissao ? date(l.emissao) : "—"}{l.situacao === "danfe" ? " · PDF" : l.situacao === "evento" ? " · evento" : ""}</small></span>
            <span className="forn"><b title={l.destinatario ?? l.arquivo}>{l.destinatario ?? l.arquivo}</b><small>{l.nota}</small></span>
            <span className="r">{l.valor !== null ? money(l.valor) : "—"}</span>
            <span><Status tone={SITUACAO[l.situacao][1]}>{SITUACAO[l.situacao][0]}</Status></span>
          </div>
        ))}
      </div>
    </>
  );
}

export function NotasDoMes({ notify, podeOperar }: { notify: (m: string) => void; podeOperar: boolean }) {
  const [mes, setMes] = useState(mesAnterior);
  const [dados, setDados] = useState<DoMes | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async (m: string) => {
    const r = await api<DoMes>(`/api/fiscal/notas-emitidas/envio?mes=${m}`);
    if (!r.ok) { setErro(r.error); setDados(null); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(mes); }, 0); return () => clearTimeout(t); }, [carregar, mes]);

  const receita = dados?.receita;
  return (
    <section className="almox-bloco fiscal-config-bloco nfe-mes">
      <header className="nfe-mes-topo">
        <div>
          <h2>Notas emitidas no GRV</h2>
          <p>As notas que a empresa emitiu fora da plataforma, mês a mês. É daqui que sai a receita do Lucro Presumido.</p>
        </div>
        <div className="icms-acoes">
          <label className="almox-mes"><span>Mês</span><input type="month" value={mes} max={new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>
          {podeOperar && (
            <EnviarArquivo<Previa>
              rotulo="Enviar notas do mês"
              titulo={`Enviar notas de ${nomeMes(mes)}`}
              descricao={`XML das NF-e emitidas (e, se quiser, o DANFE em PDF e as cartas de correção) de ${nomeMes(mes)}. Pode mandar várias de uma vez, até 200. Nota que já está na plataforma não entra de novo.`}
              aceita=".xml,.pdf,text/xml,application/xml,application/pdf"
              endpoint="/api/fiscal/notas-emitidas/envio"
              multiplo
              maximo={200}
              destaque
              extras={{ mes }}
              renderPrevia={(p) => <PreviaEnvio p={p} />}
              podeConfirmar={(p) => p.resumo.entram > 0}
              textoConfirmar="Guardar as notas"
              onConcluido={(msg) => { notify(msg); void carregar(mes); }}
            />
          )}
        </div>
      </header>

      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          <div className="arq-numeros nfe-mes-numeros">
            <div><small>Notas no mês</small><b>{dados.notas.length}</b><span>{dados.arquivos} {dados.arquivos === 1 ? "arquivo enviado" : "arquivos enviados"}</span></div>
            <div><small>Receita do mês</small><b>{money((receita?.industria ?? 0) + (receita?.servicos ?? 0) - (receita?.devolucoes ?? 0))}</b><span>{receita?.devolucoes ? `devoluções de ${money(receita.devolucoes)} já abatidas` : "vendas e exportação, sem remessas"}</span></div>
            <div><small>Exportação</small><b>{money(receita?.exportacao ?? 0)}</b><span>dentro da receita, fora do PIS/COFINS</span></div>
            <div><small>Números que faltam</small><b className={dados.lacunas.length ? "alerta" : ""}>{dados.lacunas.length}</b><span>{dados.lacunas.length ? listaLacunas(dados.lacunas).slice(0, 60) : "sequência completa"}</span></div>
          </div>
          {dados.notas.length ? (
            <div className="nfe-tabela" role="table" aria-label={`Notas de ${nomeMes(mes)}`}>
              <div className="cabeca" role="row"><span>Número</span><span>Destinatário</span><span>Emissão</span><span className="r">Valor</span><span>Tipo</span><span>Origem</span></div>
              {dados.notas.map((n, i) => (
                <div role="row" key={n.chave ?? `${n.numero}-${i}`}>
                  <span className="nfe-numero">{n.numero ?? "—"}</span>
                  <span className="nome">{n.destinatario ? (/^\d{14}$/.test(n.destinatario) ? cnpjFormatado(n.destinatario) : n.destinatario) : n.tipo === "exportacao" ? "Cliente no exterior" : "Destinatário não informado"}</span>
                  <span>{date(n.emissao)}</span>
                  <span className="r">{money(n.valor)}</span>
                  <span><Status tone={TIPO[n.tipo][1]}>{TIPO[n.tipo][0]}</Status></span>
                  <span>{n.origem === "plataforma" ? "Plataforma" : "Arquivo"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="finance-empty">
              <b>Nenhuma nota de {nomeMes(mes)} na plataforma</b>
              <small>{podeOperar ? "Clique em Enviar notas do mês e arraste os XML das notas emitidas." : "Quem opera as notas fiscais envia as notas do mês aqui."}</small>
            </div>
          )}
        </>
      )}
    </section>
  );
}
