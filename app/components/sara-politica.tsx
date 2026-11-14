"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Segmented, Status } from "../../packages/design-system";

/**
 * Fundação › O que a SARA aprendeu › Modelos e esforço (I-32, 14/11/2026). A política de modelos da empresa: que
 * modelo e que esforço cada nível de pedido usa, o modo do roteador, quem pode a análise profunda, o teto do mês e o
 * nível de cada trabalho fixo. O proprietário muda; a Auditoria vê. Os seletores só mostram o que o catálogo aceita.
 */

type Nivel = "rapido" | "padrao" | "criterio" | "profundo";
type Escolha = { modelo: string; esforco: string };
type Politica = { niveis: Record<Nivel, Escolha>; modo: "desligado" | "sombra" | "ligado"; profundoPara: "proprietario" | "diretoria" | "todos"; tetoMesReais: number | null; trabalhos: Record<string, Nivel> };
type Modelo = { id: string; rotulo: string; esforcos: string[]; esforco_padrao: string; preco: { entrada: number; saida: number }; exige_retencao: boolean };
type Dados = { politica: Politica; pode_gravar: boolean; custo_mes_reais: number | null; catalogo: Modelo[]; niveis: { id: Nivel; rotulo: string }[]; trabalhos: { id: string; rotulo: string }[] };

const QUANDO: Record<Nivel, string> = {
  rapido: "Consulta direta, status, lista, cumprimento, continuação curta, abrir uma tela.",
  padrao: "Tarefa com resultado claro: painel, documento ou planilha a partir de dados, cruzar áreas.",
  criterio: "Julgamento com risco: recomendar, decidir, projeção, preço ou prazo a cliente, o que sai da empresa.",
  profundo: "Aberto ou estratégico: diagnóstico, plano, estratégia, análise de período longo.",
};
const ESFORCO: Record<string, string> = { low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Muito alto", max: "Máximo" };
type Modo = Politica["modo"];
const MODO: { value: Modo; label: string }[] = [{ value: "desligado", label: "Desligado" }, { value: "sombra", label: "Só registrar" }, { value: "ligado", label: "Ligado" }];
const QUEM: Record<Politica["profundoPara"], string> = { proprietario: "Só o proprietário", diretoria: "Proprietário e diretoria", todos: "Todos" };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;

export function ModelosEEsforco({ notify }: { notify: (m: string) => void }) {
  const [d, setD] = useState<Dados | null>(null);
  const [p, setP] = useState<Politica | null>(null);
  const [teto, setTeto] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch("/api/sara/politica", { cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(b.error || "Não foi possível carregar a política de modelos."); return; }
    setErro(""); setD(b as Dados); setP((b as Dados).politica); setTeto((b as Dados).politica.tetoMesReais == null ? "" : String((b as Dados).politica.tetoMesReais).replace(".", ","));
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  if (erro) return <section className="aprendeu-bloco" aria-label="Modelos e esforço"><header><h2>Modelos e esforço da SARA</h2></header><p className="aprendeu-vazio">{erro}</p></section>;
  if (!d || !p) return null;
  const modelo = (id: string) => d.catalogo.find((m) => m.id === id);
  const mudarNivel = (n: Nivel, campo: keyof Escolha, valor: string) => {
    setP((x) => {
      if (!x) return x;
      const atual = { ...x.niveis[n], [campo]: valor };
      // Trocou o modelo e o esforço escolhido não vale nele: volta ao padrão do modelo.
      if (campo === "modelo") { const m = modelo(valor); if (m && !m.esforcos.includes(atual.esforco)) atual.esforco = m.esforco_padrao; }
      return { ...x, niveis: { ...x.niveis, [n]: atual } };
    });
  };
  const salvar = async () => {
    setSalvando(true);
    const r = await fetch("/api/sara/politica", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...p, tetoMesReais: teto.trim() === "" ? null : teto }) });
    const b = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) { notify(b.error || "Não foi possível salvar a política."); return; }
    notify("Política de modelos salva."); void carregar();
  };
  const fable = Object.values(p.niveis).some((e) => modelo(e.modelo)?.exige_retencao);
  const leitura = !d.pode_gravar;

  return (
    <section className="aprendeu-bloco politica-modelos" aria-label="Modelos e esforço">
      <header><h2>Modelos e esforço da SARA</h2><Status tone={p.modo === "ligado" ? "success" : p.modo === "sombra" ? "info" : "neutral"}>{MODO.find((m) => m.value === p.modo)?.label}</Status></header>
      <p className="aprendeu-vazio">Cada pedido feito à SARA é classificado em um de quatro níveis, e cada nível usa o modelo e o esforço escolhidos aqui. O modelo decide o quanto ela sabe; o esforço, o quanto ela se aplica. Em &ldquo;Só registrar&rdquo;, ela continua como hoje e anota o que o roteador escolheria, para comparar antes de ligar.</p>
      <div className="politica-linha"><span>Roteador</span>{leitura ? <b>{MODO.find((m) => m.value === p.modo)?.label}</b> : <Segmented<Modo> options={MODO} value={p.modo} onChange={(v) => setP({ ...p, modo: v })} ariaLabel="Modo do roteador" />}</div>
      <div className="aprendeu-tabela"><table>
        <thead><tr><th>Nível</th><th>Quando</th><th>Modelo</th><th>Esforço</th><th className="r">Preço por milhão de tokens</th></tr></thead>
        <tbody>{d.niveis.map((n) => {
          const e = p.niveis[n.id], m = modelo(e.modelo);
          return <tr key={n.id}><td><b>{n.rotulo}</b></td><td className="politica-quando">{QUANDO[n.id]}</td>
            <td>{leitura ? m?.rotulo : <select aria-label={`Modelo do nível ${n.rotulo}`} value={e.modelo} onChange={(ev) => mudarNivel(n.id, "modelo", ev.target.value)}>{d.catalogo.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}</select>}</td>
            <td>{leitura ? ESFORCO[e.esforco] : <select aria-label={`Esforço do nível ${n.rotulo}`} value={e.esforco} onChange={(ev) => mudarNivel(n.id, "esforco", ev.target.value)}>{(m?.esforcos ?? []).map((x) => <option key={x} value={x}>{ESFORCO[x] ?? x}{x === m?.esforco_padrao ? " (padrão)" : ""}</option>)}</select>}</td>
            <td className="r">{m ? `${usd(m.preco.entrada)} entrada · ${usd(m.preco.saida)} saída` : "—"}</td></tr>;
        })}</tbody>
      </table></div>
      {fable && <p className="aprendeu-vazio">O Fable 5.2 exige que a Anthropic guarde os pedidos por 30 dias (organização sem retenção zero).</p>}
      <div className="politica-linha">
        <label><span>Análise profunda para</span>{leitura ? <b>{QUEM[p.profundoPara]}</b> : <select value={p.profundoPara} onChange={(ev) => setP({ ...p, profundoPara: ev.target.value as Politica["profundoPara"] })}>
          {(Object.keys(QUEM) as Politica["profundoPara"][]).map((k) => <option key={k} value={k}>{QUEM[k]}</option>)}</select>}</label>
        <label><span>Teto do mês (R$)</span>{leitura ? <b>{p.tetoMesReais == null ? "Sem teto em reais" : brl(p.tetoMesReais)}</b> : <input inputMode="decimal" value={teto} onChange={(ev) => setTeto(ev.target.value)} placeholder="Sem teto em reais" aria-label="Teto do mês em reais" />}</label>
        {d.custo_mes_reais != null && <span className="politica-custo">Gasto neste mês: <b>{brl(d.custo_mes_reais)}</b></span>}
      </div>
      <h3>Trabalhos que a SARA faz sozinha</h3>
      <div className="aprendeu-tabela"><table>
        <thead><tr><th>Trabalho</th><th>Nível</th></tr></thead>
        <tbody>{d.trabalhos.map((t) => <tr key={t.id}><td>{t.rotulo}</td><td>{leitura ? d.niveis.find((n) => n.id === p.trabalhos[t.id])?.rotulo : <select aria-label={`Nível de ${t.rotulo}`} value={p.trabalhos[t.id]} onChange={(ev) => setP({ ...p, trabalhos: { ...p.trabalhos, [t.id]: ev.target.value as Nivel } })}>{d.niveis.map((n) => <option key={n.id} value={n.id}>{n.rotulo}</option>)}</select>}</td></tr>)}</tbody>
      </table></div>
      {!leitura && <div className="politica-acoes"><Button variant="primary" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar a política"}</Button></div>}
    </section>
  );
}
