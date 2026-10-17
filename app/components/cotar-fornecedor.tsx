"use client";

import { useEffect, useState } from "react";
import { Button, Callout, EscolherArquivo } from "../../packages/design-system";
import { valorDigitado } from "../../lib/fiscal/guia-parser";

/**
 * Portal do fornecedor por link (A-09). O fornecedor vê só os itens do pedido, preenche preço, IPI,
 * quantidade, prazo de entrega, frete e condição de pagamento, anexa o PDF da proposta e envia uma vez.
 * O nome da empresa vem da configuração fiscal: nenhuma empresa fica fixa no código.
 */

type Item = { id: string; produto: string; codigo: string | null; quantidade: number; unidade: string; observacao: string | null };
type Convite = {
  situacao: "aberto" | "respondido" | "cancelado" | "expirado" | "inexistente";
  empresa?: string; fornecedor?: string; expira_em?: string; respondido_em?: string | null; pedido?: number; precisa_ate?: string | null; itens?: Item[];
};
type Linha = { valor: string; ipi: string; quantidade: string; obs: string };

const data = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "");
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CotarFornecedor({ codigo }: { codigo: string }) {
  const [c, setC] = useState<Convite | null>(null);
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});
  const [prazo, setPrazo] = useState("");
  const [condicao, setCondicao] = useState("");
  const [frete, setFrete] = useState<"CIF" | "FOB">("CIF");
  const [freteValor, setFreteValor] = useState("");
  const [obs, setObs] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/cotar/${encodeURIComponent(codigo)}`, { cache: "no-store" })
      .then((r) => r.json()).catch(() => ({ situacao: "inexistente" }))
      .then((d: Convite) => {
        if (!vivo) return;
        setC(d);
        setLinhas(Object.fromEntries((d.itens ?? []).map((i) => [i.id, { valor: "", ipi: "", quantidade: String(i.quantidade).replace(".", ","), obs: "" }])));
      });
    return () => { vivo = false; };
  }, [codigo]);

  if (!c) return <main className="cotar"><p className="cotar-carregando">Abrindo a cotação…</p></main>;
  if (c.situacao !== "aberto") {
    const msg = {
      respondido: ["Cotação já enviada", `Recebemos a sua resposta${c.respondido_em ? ` em ${data(c.respondido_em)}` : ""}. Obrigado.`],
      cancelado: ["Link cancelado", "A empresa cancelou este pedido de cotação. Se tiver dúvida, fale com o comprador."],
      expirado: ["Link vencido", `O prazo para responder terminou${c.expira_em ? ` em ${data(c.expira_em)}` : ""}. Peça um novo link ao comprador.`],
      inexistente: ["Link inválido", "Confira se o endereço foi copiado inteiro ou peça um novo link ao comprador."],
    }[c.situacao];
    return <main className="cotar"><section className="cotar-cartao"><h1>{msg[0]}</h1><p>{msg[1]}</p></section></main>;
  }
  if (enviado !== null) {
    return <main className="cotar"><section className="cotar-cartao"><p className="eyebrow">{c.empresa}</p><h1>Cotação enviada</h1><p>Recebemos o preço de {enviado} item(ns) do pedido nº {c.pedido}. O comprador vai analisar e entrar em contato. Obrigado.</p></section></main>;
  }

  const itens = c.itens ?? [];
  const num = (s: string) => (s.trim() ? valorDigitado(s) : NaN);
  const total = itens.reduce((s, i) => {
    const l = linhas[i.id]; const v = num(l?.valor ?? ""), q = num(l?.quantidade ?? ""), ipi = l?.ipi.trim() ? num(l.ipi) : 0;
    return Number.isFinite(v) && Number.isFinite(q) ? s + v * q * (1 + (Number.isFinite(ipi) ? ipi : 0) / 100) : s;
  }, 0);
  const comPreco = itens.filter((i) => Number.isFinite(num(linhas[i.id]?.valor ?? "")) && num(linhas[i.id].valor) > 0).length;
  const valido = comPreco > 0 && condicao.trim().length >= 2 && (!prazo || prazo >= hoje());
  const mudar = (id: string, campo: keyof Linha, v: string) => setLinhas((x) => ({ ...x, [id]: { ...x[id], [campo]: v } }));

  const enviar = async () => {
    setEnviando(true); setErro("");
    const corpo = new FormData();
    corpo.append("itens", JSON.stringify(itens.map((i) => {
      const l = linhas[i.id];
      const v = num(l.valor), q = num(l.quantidade), ipi = l.ipi.trim() ? num(l.ipi) : 0;
      return Number.isFinite(v) && v > 0 ? { id: i.id, valor_unit: v, quantidade: Number.isFinite(q) ? q : i.quantidade, ipi: Number.isFinite(ipi) ? ipi : 0, obs: l.obs.trim() } : null;
    }).filter(Boolean)));
    corpo.append("prazoEntrega", prazo); corpo.append("condicao", condicao.trim());
    corpo.append("freteTipo", frete); corpo.append("freteValor", String(num(freteValor) || 0)); corpo.append("observacao", obs.trim());
    if (arquivo) corpo.append("arquivo", arquivo);
    const r = await fetch(`/api/cotar/${encodeURIComponent(codigo)}`, { method: "POST", body: corpo }).then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    setEnviando(false);
    if (!r.ok) { setErro(r.body?.error ?? "Não foi possível enviar. Tente de novo."); return; }
    setEnviado(r.body?.itens ?? comPreco);
  };

  return (
    <main className="cotar">
      <section className="cotar-cartao">
        <p className="eyebrow">{c.empresa} · pedido de cotação nº {c.pedido}</p>
        <h1>Cotação para {c.fornecedor}</h1>
        <p>Preencha o preço dos itens que você fornece (os demais podem ficar em branco), as condições e anexe a proposta em PDF. O link vale até {data(c.expira_em)} e aceita uma resposta.</p>
        {c.precisa_ate && <Callout variant="info" title={`Precisamos receber até ${data(c.precisa_ate)}`}>Informe o prazo de entrega que você consegue cumprir.</Callout>}
      </section>

      <section className="cotar-cartao">
        <h2>Itens</h2>
        <div className="cotar-itens">
          {itens.map((i) => {
            const l = linhas[i.id];
            return (
              <div key={i.id} className="cotar-item">
                <div className="cotar-item-nome"><b>{i.produto}</b><small>{i.codigo ? `Código ${i.codigo} · ` : ""}Pedido: {String(i.quantidade).replace(".", ",")} {i.unidade}{i.observacao ? ` · ${i.observacao}` : ""}</small></div>
                <label><span>Preço unitário (R$)</span><input inputMode="decimal" placeholder="0,00" value={l?.valor ?? ""} onChange={(e) => mudar(i.id, "valor", e.target.value)} aria-label={`Preço de ${i.produto}`} /></label>
                <label><span>Quantidade ({i.unidade})</span><input inputMode="decimal" value={l?.quantidade ?? ""} onChange={(e) => mudar(i.id, "quantidade", e.target.value)} /></label>
                <label><span>IPI (%)</span><input inputMode="decimal" placeholder="0" value={l?.ipi ?? ""} onChange={(e) => mudar(i.id, "ipi", e.target.value)} /></label>
                <label className="cotar-obs"><span>Observação do item</span><input maxLength={300} value={l?.obs ?? ""} onChange={(e) => mudar(i.id, "obs", e.target.value)} placeholder="marca, embalagem, similar…" /></label>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cotar-cartao">
        <h2>Condições</h2>
        <div className="cotar-campos">
          <label><span>Prazo de entrega</span><input type="date" min={hoje()} value={prazo} onChange={(e) => setPrazo(e.target.value)} /></label>
          <label><span>Condição de pagamento</span><input value={condicao} maxLength={120} onChange={(e) => setCondicao(e.target.value)} placeholder="ex.: 28 DDL, 30/60/90, à vista" /></label>
          <label><span>Frete</span><select value={frete} onChange={(e) => setFrete(e.target.value as "CIF" | "FOB")}><option value="CIF">CIF (por conta do fornecedor)</option><option value="FOB">FOB (por conta do comprador)</option></select></label>
          {frete === "FOB" && <label><span>Valor do frete (R$)</span><input inputMode="decimal" value={freteValor} onChange={(e) => setFreteValor(e.target.value)} placeholder="0,00" /></label>}
          <label className="cotar-largo"><span>Observações</span><textarea rows={3} maxLength={600} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
        </div>
        <div className="cotar-anexo">
          <EscolherArquivo rotulo={arquivo ? "Trocar o PDF" : "Anexar a proposta (PDF)"} aceita=".pdf,application/pdf" compacto onEscolher={(a) => setArquivo(a[0] ?? null)} />
          {arquivo && <small>{arquivo.name}</small>}
        </div>
      </section>

      <section className="cotar-cartao cotar-envio">
        <div><span>{comPreco} de {itens.length} item(ns) com preço</span><b>{dinheiro(total)}</b><small>Total com IPI, sem o frete</small></div>
        {erro && <p className="cotar-erro" role="alert">{erro}</p>}
        <Button onClick={() => void enviar()} disabled={!valido || enviando}>{enviando ? "Enviando…" : "Enviar cotação"}</Button>
      </section>
    </main>
  );
}
