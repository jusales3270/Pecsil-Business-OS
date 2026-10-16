"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";

/**
 * Fundação › Linha de base (K-08): os números de antes da virada do GRV. Cada indicador é revisado
 * pela área que responde por ele (Financeiro, Compras, Produção): quem decide a área corrige o valor
 * quando o dado de origem está errado (com motivo; o calculado fica guardado ao lado) e volta ao
 * calculado. As medições seguintes usam a mesma conta, então o antes × depois compara igual com igual.
 */

type Medicao = {
  id: string; tipo: "linha_de_base" | "medicao"; chave: string; rotulo: string; valor: number | null; valor_calculado: number | null;
  unidade: string; periodo_inicio: string | null; periodo_fim: string; fonte: string; como: string; detalhes: Record<string, unknown>;
  medido_em: string; editado_em: string | null; motivo_edicao: string | null; editado_por_nome: string | null;
  area: string | null; podeCorrigir: boolean;
};

const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
function formatar(v: number | null, unidade: string) {
  if (v == null) return "sem valor";
  if (unidade === "R$") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const n = v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return unidade === "%" ? `${n}%` : `${n} ${unidade}`;
}
const lerNumero = (s: string) => {
  const v = s.trim();
  if (!v) return null;
  return Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
};

/** Ordem de leitura: dinheiro, depois compras, depois o que ainda não tem fonte. */
const ORDEM = [
  "receber_em_aberto", "receber_vencido", "receber_vencido_pct", "pagar_em_aberto", "pagar_vencido", "pagamentos_em_dia_pct", "pagamentos_atraso_medio",
  "compras_cotacao_decisao", "compras_pedido_a_compra", "compras_itens_por_mes",
  "entrega_no_prazo_pct", "maquina_parada_horas", "orcamento_a_os_dias", "custo_por_peca",
];
const posicao = (chave: string) => { const i = ORDEM.indexOf(chave); return i < 0 ? ORDEM.length : i; };

export function LinhaDeBase({ notify }: { notify: (m: string) => void }) {
  const [medicoes, setMedicoes] = useState<Medicao[] | null>(null);
  const [podeMedir, setPodeMedir] = useState(false);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<{ id: string; valor: string; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/foundation/linha-de-base", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(d.error || "Não foi possível carregar a linha de base."); return; }
    setErro("");
    setMedicoes(d.medicoes as Medicao[]);
    setPodeMedir(Boolean(d.podeMedir));
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const enviar = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    const r = await fetch("/api/foundation/linha-de-base", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) { notify(d.error || "Não foi possível concluir."); return false; }
    notify(ok);
    await carregar();
    return true;
  };

  const base = useMemo(() => (medicoes ?? []).filter((m) => m.tipo === "linha_de_base").sort((a, b) => posicao(a.chave) - posicao(b.chave)), [medicoes]);
  /** Última medição de cada indicador (depois da linha de base). */
  const ultima = useMemo(() => {
    const m = new Map<string, Medicao>();
    for (const x of medicoes ?? []) if (x.tipo === "medicao") m.set(x.chave, x);
    return m;
  }, [medicoes]);

  if (erro) return <Callout variant="warning" title="Linha de base">{erro}</Callout>;
  if (!medicoes) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;
  const corte = base[0]?.periodo_fim ?? null;
  const corrigidos = base.filter((m) => m.editado_em).length;
  const semValor = base.filter((m) => m.valor == null).length;

  const gravarEdicao = async (m: Medicao) => {
    if (!editando) return;
    const valor = lerNumero(editando.valor);
    if (valor !== null && !Number.isFinite(valor)) { notify("Valor inválido."); return; }
    if (!editando.motivo.trim()) { notify("Informe o motivo da correção."); return; }
    if (await enviar({ acao: "editar", id: m.id, valor, motivo: editando.motivo.trim() }, `Indicador corrigido: ${m.rotulo}.`)) setEditando(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">PROVA DE RESULTADO</p>
          <h1>Linha de base</h1>
          <p>Os números de antes da virada do GRV{corte ? `, com corte em ${dia(corte)}` : ""}. Cada área revisa os seus: quem responde pela área corrige um valor quando o dado de origem estiver errado; o calculado fica guardado e a correção vai para a auditoria.</p>
        </div>
        {podeMedir && <div className="icms-acoes">
          <Button type="button" variant="secondary" disabled={ocupado || !base.length} onClick={() => void enviar({ acao: "recalcular" }, "Linha de base recalculada na mesma data de corte; as correções foram mantidas.")}>Recalcular{corte ? ` (corte ${dia(corte)})` : ""}</Button>
          <Button type="button" disabled={ocupado || !base.length} onClick={() => void enviar({ acao: "medir" }, "Medição de hoje registrada.")}>Registrar medição de hoje</Button>
        </div>}
      </div>

      {!base.length
        ? <Callout variant="info" title="Ainda sem linha de base">A linha de base é registrada uma vez, antes da virada do GRV.</Callout>
        : <Callout variant="info" title={`${base.length} indicadores`}>{corrigidos ? `${corrigidos} corrigido(s) à mão. ` : ""}{semValor ? `${semValor} ainda sem fonte na plataforma: viram número quando a fonte existir (exportações do GRV, Forja em produção, custo e margem).` : ""}</Callout>}

      <div className="lb-lista">
        {base.map((m) => {
          const depois = ultima.get(m.chave);
          const emEdicao = editando?.id === m.id;
          return (
            <article key={m.id} className={`lb-item${m.valor == null ? " sem-valor" : ""}`}>
              <header>
                <div><b>{m.rotulo}</b><small>{m.area ? `Revisa: ${m.area}` : m.fonte}{m.periodo_inicio ? ` · ${dia(m.periodo_inicio)} a ${dia(m.periodo_fim)}` : ` · em ${dia(m.periodo_fim)}`}</small></div>
                <strong>{formatar(m.valor, m.unidade)}</strong>
              </header>
              <p className="lb-como">{m.como}</p>
              {m.editado_em && (
                <p className="lb-correcao">
                  <Status tone="attention">Corrigido</Status> por {m.editado_por_nome} em {dia(m.editado_em)}: {m.motivo_edicao} · calculado: {formatar(m.valor_calculado, m.unidade)}
                </p>
              )}
              {depois && <p className="lb-depois">Última medição ({dia(depois.periodo_fim)}): <b>{formatar(depois.valor, depois.unidade)}</b></p>}
              {emEdicao ? (
                <form className="lb-editar" onSubmit={(e) => { e.preventDefault(); void gravarEdicao(m); }}>
                  <label><span>Valor certo ({m.unidade}) · vazio = sem valor</span><input value={editando.valor} onChange={(e) => setEditando({ ...editando, valor: e.target.value.replace(/[^\d.,-]/g, "") })} inputMode="decimal" autoFocus /></label>
                  <label className="largo"><span>Motivo *</span><input value={editando.motivo} onChange={(e) => setEditando({ ...editando, motivo: e.target.value })} maxLength={500} placeholder="Ex.: títulos do GRV já recebidos e nunca baixados" /></label>
                  <footer>
                    <Button type="button" variant="secondary" compact onClick={() => setEditando(null)} disabled={ocupado}>Cancelar</Button>
                    <Button type="submit" compact disabled={ocupado || !editando.motivo.trim()}>{ocupado ? "Gravando…" : "Gravar correção"}</Button>
                  </footer>
                </form>
              ) : (
                m.podeCorrigir && <footer>
                  {m.editado_em && <Button type="button" variant="secondary" compact disabled={ocupado} onClick={() => void enviar({ acao: "desfazer", id: m.id }, `Voltou ao calculado: ${m.rotulo}.`)}>Voltar ao calculado</Button>}
                  <Button type="button" variant="secondary" compact disabled={ocupado} onClick={() => setEditando({ id: m.id, valor: m.valor == null ? "" : String(m.valor).replace(".", ","), motivo: "" })}>Corrigir valor</Button>
                </footer>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
