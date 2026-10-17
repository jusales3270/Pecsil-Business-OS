"use client";

import { useState } from "react";
import { Button, Callout, EscolherArquivo, Modal, Status } from "../../../../packages/design-system";
import { date, money } from "../../../fiscal/src/comum";

/**
 * Pedido do cliente → itens do orçamento (C-05). Lê o pedido (PDF ou texto colado) por regra e
 * mostra, por linha, o produto sugerido e o porquê. A pessoa confirma linha a linha; ao adicionar, o
 * código do cliente vira o de-para do produto. Sugestão do Clef (se o uso estiver ligado) aparece
 * marcada como tal, com a confiança, e nunca é escolhida sozinha.
 */

type Candidato = { id: string; codigo: string; descricao: string; unidade: string; motivo: "de_para" | "artigo" | "descricao"; explicacao: string };
type Linha = {
  item: string; codigoMaterial: string | null; descricao: string; quantidade: number; unidade: string; precoUnitario: number | null; precoPor: number;
  entrega: string | null; valorItem: number | null; avisos: string[]; candidatos: Candidato[];
  clef: { produtoId: string | null; confianca: number; faixa: string; julgamentoId: string } | null;
};
type Leitura = { cabecalho: { numero: string | null; condicaoPagamento: string | null; cliente?: { id: string; nome: string; motivo: "cnpj" | "nome" } | null }; itens: Linha[]; clef: "ok" | "desligado" | "indisponivel"; aviso?: string };
export type ItemLido = { produtoId: string; quantidade: number; unidade: string; precoUnitario: number | null; entrega: string | null; itemPedido: string };

const MOTIVO: Record<Candidato["motivo"], [string, "success" | "attention" | "neutral"]> = {
  de_para: ["Pelo de-para do cliente", "success"], artigo: ["Provável: confira", "attention"], descricao: ["Pela descrição: confira", "neutral"],
};

export function LerPedidoCliente({ onAdicionar, onFechar, notify }: {
  onAdicionar: (itens: ItemLido[], cabecalho: Leitura["cabecalho"]) => void; onFechar: () => void; notify: (m: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  const ler = async (arquivo?: File) => {
    setLendo(true); setErro("");
    const corpo = new FormData();
    if (arquivo) corpo.append("arquivo", arquivo); else corpo.append("texto", texto);
    const r = await fetch("/api/comercial/pedido-cliente", { method: "POST", body: corpo }).then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setLendo(false);
    if (!r.ok) { setErro(r.body?.error ?? "Não foi possível ler o pedido."); return; }
    const l = r.body as Leitura;
    setLeitura(l);
    // Começa pela sugestão da regra (o Clef só aparece marcado).
    setEscolha(Object.fromEntries(l.itens.map((i) => [i.item, i.candidatos[0]?.id ?? ""])));
  };

  const confirmar = async () => {
    if (!leitura) return;
    const usadas = leitura.itens.filter((i) => escolha[i.item]);
    setSalvando(true);
    const pares = usadas.map((i) => ({ produto: escolha[i.item], codigo: i.descricao, julgamentoId: i.clef?.julgamentoId ?? null, aceitouClef: i.clef ? i.clef.produtoId === escolha[i.item] : null }));
    const r = await fetch("/api/comercial/pedido-cliente", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pares }) }).then((x) => x.ok).catch(() => false);
    setSalvando(false);
    if (!r) notify("Os itens entraram, mas o de-para dos códigos do cliente não foi gravado agora.");
    onAdicionar(usadas.map((i) => ({ produtoId: escolha[i.item], quantidade: i.quantidade, unidade: i.unidade, precoUnitario: i.precoUnitario, entrega: i.entrega, itemPedido: i.item })), leitura.cabecalho);
  };

  const n = leitura ? leitura.itens.filter((i) => escolha[i.item]).length : 0;
  return (
    <Modal eyebrow="COMERCIAL · ORÇAMENTO" title="Ler pedido do cliente" subtitle="As linhas do pedido viram itens do orçamento. Confira o produto de cada uma antes de adicionar." onClose={onFechar}>
      <div className="vnd-pedido">
        {!leitura ? (
          <>
            <EscolherArquivo rotulo="Escolher o PDF do pedido" aceita=".pdf,application/pdf" ocupado={lendo} textoOcupado="Lendo o pedido…" onEscolher={(a) => a[0] && void ler(a[0])} />
            <label className="vnd-pedido-texto"><span>Ou cole o texto do pedido</span><textarea rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Item | Código | Descrição | Quantidade | Unid. | Preço | Entrega | Valor" /></label>
            {erro && <Callout variant="danger" title="Não deu para ler">{erro}</Callout>}
            <footer><Button variant="ghost" onClick={onFechar}>Fechar</Button><Button onClick={() => void ler()} disabled={lendo || texto.trim().length < 10}>{lendo ? "Lendo…" : "Ler o texto"}</Button></footer>
          </>
        ) : (
          <>
            <p className="fiscal-nota-ajuda">
              {leitura.cabecalho.numero ? <>Pedido nº <b>{leitura.cabecalho.numero}</b>{leitura.cabecalho.condicaoPagamento ? ` · ${leitura.cabecalho.condicaoPagamento}` : ""} · </> : null}
              {leitura.cabecalho.cliente ? <>Cliente: <b>{leitura.cabecalho.cliente.nome}</b> ({leitura.cabecalho.cliente.motivo === "cnpj" ? "pelo CNPJ" : "pelo nome no pedido"}) · </> : <>Cliente não reconhecido: escolha no orçamento · </>}
              {leitura.itens.length} linha(s) lida(s). {leitura.clef === "desligado" ? "Sugestão do Clef desligada: só a regra." : leitura.clef === "indisponivel" ? "Sugestão do Clef indisponível agora: só a regra." : ""}
            </p>
            {leitura.aviso && <Callout variant="warning" title="Nada lido">{leitura.aviso}</Callout>}
            <div className="vnd-pedido-linhas">
              {leitura.itens.map((i) => {
                const atual = i.candidatos.find((c) => c.id === escolha[i.item]);
                const doClef = i.clef?.produtoId ? i.candidatos.find((c) => c.id === i.clef!.produtoId) : null;
                return (
                  <div key={i.item} className={`vnd-pedido-linha${escolha[i.item] ? "" : " fora"}`}>
                    <div className="vnd-pedido-lido">
                      <b>Item {i.item} · {i.descricao}</b>
                      <small>{i.quantidade.toLocaleString("pt-BR")} {i.unidade}{i.precoUnitario !== null ? ` × ${money(i.precoUnitario)}${i.precoPor > 1 ? ` (pedido: por ${i.precoPor})` : ""}` : ""}{i.entrega ? ` · entrega ${date(i.entrega)}` : ""}{i.valorItem !== null ? ` · ${money(i.valorItem)}` : ""}</small>
                      {i.avisos.map((a) => <small key={a} className="fiscal-erro">{a}</small>)}
                    </div>
                    <label className="vnd-pedido-produto"><span>Produto do catálogo</span>
                      <select className="icms-select" value={escolha[i.item] ?? ""} onChange={(e) => setEscolha((x) => ({ ...x, [i.item]: e.target.value }))} aria-label={`Produto do item ${i.item}`}>
                        <option value="">Não adicionar esta linha</option>
                        {i.candidatos.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>)}
                      </select>
                    </label>
                    <div className="vnd-pedido-porque">
                      {atual ? <><Status tone={MOTIVO[atual.motivo][1]}>{MOTIVO[atual.motivo][0]}</Status><small>{atual.explicacao}</small></> : !i.candidatos.length ? <small>Nenhum produto parecido no catálogo: inclua à mão ou cadastre a peça.</small> : null}
                      {i.clef && <span className="vnd-pedido-clef" title="Sugestão do modelo de decisão, não é dado apurado">Sugestão do Clef: {doClef ? doClef.codigo : "nenhum destes"} · {Math.round(i.clef.confianca * 100)}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <footer>
              <Button variant="ghost" onClick={() => setLeitura(null)}>Ler outro</Button>
              <Button onClick={() => void confirmar()} disabled={!n || salvando}>{salvando ? "Adicionando…" : `Adicionar ${n} item(ns) ao orçamento`}</Button>
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}
