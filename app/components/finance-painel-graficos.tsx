"use client";

import { useMemo, useState } from "react";
import { Card, Segmented } from "../../packages/design-system";
import { MESES, anoAtual, mesAtual, money, moneyShort, useAno, type CashRow } from "./finance-reports";

/**
 * Gráficos do painel do Financeiro: posição em aberto (anel), realizado por mês
 * contra o ano anterior, em aberto por vencimento e mês contra mês. Os números
 * vêm somados do banco (finance_cash_by_month), os mesmos do Fluxo de caixa.
 */

/* ---------------------------------------------------------------------------
   Anel de posição — o valor do centro é sempre abreviado, para caber.
   ------------------------------------------------------------------------- */

type Fatia = { label: string; value: number; cor: string };

function Anel({ fatias, centro, legenda }: { fatias: Fatia[]; centro: string; legenda: string }) {
  const tamanho = 208, espessura = 14, raio = (tamanho - espessura) / 2, volta = 2 * Math.PI * raio;
  const soma = fatias.reduce((acc, f) => acc + f.value, 0);
  const visiveis = fatias.filter((f) => f.value > 0);
  // Ponta arredondada avança meia espessura de cada lado: o vão desconta isso.
  const vao = visiveis.length > 1 ? espessura + 6 : 0;
  let inicio = 0;
  return (
    <div className="fin-anel" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} aria-hidden>
        <g transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}>
          <circle className="fin-anel-trilho" cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" strokeWidth={espessura} />
          {soma > 0 && visiveis.map((f) => {
            const arco = (f.value / soma) * volta;
            const traco = Math.max(0.01, arco - vao);
            const el = <circle key={f.label} cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" stroke={f.cor} strokeWidth={espessura} strokeLinecap="round" strokeDasharray={`${traco} ${volta - traco}`} strokeDashoffset={-(inicio + vao / 2)} />;
            inicio += arco;
            return el;
          })}
        </g>
      </svg>
      <div className="fin-anel-centro"><small>{legenda}</small><strong>{centro}</strong></div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Gráfico de linha — SVG só para as curvas; rótulos e pontos em HTML, para o
   texto não esticar quando o cartão muda de largura.
   ------------------------------------------------------------------------- */

type Serie = { label: string; cor: string; valores: (number | null)[]; tracejada?: boolean; area?: boolean };

/** Valor abreviado com o sinal na frente do R$ ("−R$ 2,16 mi", não "R$ -2,16 mi"). */
const valor = (value: number) => (value < 0 ? `−${moneyShort(-value)}` : moneyShort(value));

const curto = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

/** Passo "redondo" (1, 2, 2,5, 5 × 10ⁿ) para a escala ter números limpos. */
function escala(min: number, max: number) {
  const faixa = Math.max(1, max - min);
  const bruto = faixa / 4, base = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * base).find((p) => p >= bruto) ?? 10 * base;
  const piso = Math.floor(min / passo) * passo, teto = Math.ceil(max / passo) * passo;
  const marcas: number[] = [];
  for (let v = piso; v <= teto + passo / 2; v += passo) marcas.push(v);
  return { piso, teto: Math.max(teto, piso + passo), marcas };
}

function Linhas({ series, atual, rotuloVazio }: { series: Serie[]; atual: number; rotuloVazio: string }) {
  const [foco, setFoco] = useState<number | null>(null);
  const todos = series.flatMap((s) => s.valores.filter((v): v is number => v !== null));
  const vazio = !todos.some((v) => v !== 0);
  const { piso, teto, marcas } = escala(Math.min(0, ...todos), Math.max(0, ...todos));
  const x = (i: number) => ((i + 0.5) / 12) * 100;
  const y = (v: number) => 100 - ((v - piso) / (teto - piso)) * 100;
  // Curva monótona (Fritsch–Carlson): suave, mas sem inventar pico ou vale entre dois meses.
  const caminho = (valores: (number | null)[]) => {
    let d = "";
    const trechos: [number, number][][] = [];
    let atualTrecho: [number, number][] = [];
    valores.forEach((v, i) => {
      if (v === null) { if (atualTrecho.length) trechos.push(atualTrecho); atualTrecho = []; return; }
      atualTrecho.push([x(i), y(v)]);
    });
    if (atualTrecho.length) trechos.push(atualTrecho);
    for (const pts of trechos) {
      d += `M${pts[0][0]},${pts[0][1]}`;
      if (pts.length < 2) continue;
      const n = pts.length, dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]), m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / dx[i]);
      const t = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
      for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
        const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
        if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
      }
      for (let i = 0; i < n - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3;
        d += `C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
      }
    }
    return d;
  };
  if (vazio) return <div className="finance-empty"><b>Sem movimento</b><small>{rotuloVazio}</small></div>;
  return (
    <div className="fin-linhas">
      <div className="fin-linhas-eixo" aria-hidden>{[...marcas].reverse().map((m) => <span key={m} style={{ top: `${y(m)}%` }}>{curto(m)}</span>)}</div>
      <div className="fin-linhas-area" onMouseLeave={() => setFoco(null)}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {marcas.map((m) => <line key={m} x1="0" x2="100" y1={y(m)} y2={y(m)} className={m === 0 ? "zero" : ""} />)}
          {series.map((s) => {
            const d = caminho(s.valores);
            if (!d) return null;
            const indices = s.valores.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
            return (
              <g key={s.label}>
                {s.area && indices.length > 1 && <path d={`${d}L${x(indices[indices.length - 1])},${y(0)}L${x(indices[0])},${y(0)}Z`} className="area" style={{ fill: s.cor }} />}
                <path d={d} stroke={s.cor} className={s.tracejada ? "tracejada" : ""} />
              </g>
            );
          })}
        </svg>
        {foco !== null && <i className="fin-linhas-guia" style={{ left: `${x(foco)}%` }} />}
        {series.filter((s) => !s.tracejada).map((s) => s.valores.map((v, i) => v === null || (foco !== i && !(foco === null && i === atual - 1)) ? null : <i key={s.label + i} className="fin-linhas-ponto" style={{ left: `${x(i)}%`, top: `${y(v)}%`, borderColor: s.cor }} />))}
        <div className="fin-linhas-colunas">{MESES.map((nome, i) => <button key={nome} type="button" tabIndex={-1} aria-label={nome} onMouseEnter={() => setFoco(i)} onFocus={() => setFoco(i)} onClick={() => setFoco(i)} />)}</div>
        {foco !== null && (
          <div className={`fin-linhas-dica${foco > 7 ? " esquerda" : ""}`} style={{ left: `${x(foco)}%` }}>
            <b>{MESES[foco]}</b>
            {series.map((s) => <span key={s.label}><i className="bolinha" style={{ background: s.cor }} />{s.label}<em>{s.valores[foco] === null ? "—" : money(s.valores[foco] as number)}</em></span>)}
          </div>
        )}
      </div>
      <div className="fin-linhas-meses" aria-hidden>{MESES.map((nome, i) => <span key={nome} className={i === atual - 1 ? "atual" : ""}>{nome}</span>)}</div>
    </div>
  );
}

function LegendaSeries({ series }: { series: Serie[] }) {
  return <div className="fin-series">{series.map((s) => <span key={s.label} className={s.tracejada ? "tracejada" : ""}><i className="traco" style={{ color: s.cor }} />{s.label}</span>)}</div>;
}

function Variacao({ atual, anterior, menorMelhor }: { atual: number; anterior: number; menorMelhor?: boolean }) {
  if (!anterior) return <span className="fin-delta neutro">sem base</span>;
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.05) return <span className="fin-delta neutro">igual</span>;
  const bom = menorMelhor ? pct < 0 : pct > 0;
  return <span className={`fin-delta ${bom ? "bom" : "ruim"}`}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>;
}

/* ---------------------------------------------------------------------------
   Bloco do painel
   ------------------------------------------------------------------------- */

type Medida = "pago" | "recebido" | "resultado";
const MEDIDAS: { value: Medida; label: string }[] = [{ value: "pago", label: "Pago" }, { value: "recebido", label: "Recebido" }, { value: "resultado", label: "Resultado" }];
const VERDE = "var(--accent-green)", AMBAR = "var(--accent-amber)", AZUL = "var(--accent-blue)", CINZA = "var(--text-muted)";

function porMes(rows: CashRow[] | undefined) {
  return MESES.map((_, i) => {
    const de = (direction: CashRow["direction"]) => rows?.find((r) => r.month === i + 1 && r.direction === direction) ?? { realized: 0, open: 0, forecast: 0 };
    const entra = de("receivable"), sai = de("payable");
    return { pago: sai.realized, recebido: entra.realized, resultado: entra.realized - sai.realized, aReceber: entra.open, aPagar: sai.open };
  });
}

export function FinancePainelGraficos({ receiveOpen, payableOpen, podeFluxo, abrirFluxo }: { receiveOpen: number; payableOpen: number; podeFluxo: boolean; abrirFluxo: () => void }) {
  const ano = anoAtual(), mes = mesAtual();
  const [medida, setMedida] = useState<Medida>("pago");
  const esteAno = useAno<{ months: CashRow[] }>((y) => `/api/finance/fluxo?ano=${y}`, ano);
  const anoPassado = useAno<{ months: CashRow[] }>((y) => `/api/finance/fluxo?ano=${y}`, ano - 1);
  const agora = useMemo(() => porMes(esteAno.dados?.months), [esteAno.dados]);
  const antes = useMemo(() => porMes(anoPassado.dados?.months), [anoPassado.dados]);
  const carregando = esteAno.carregando || anoPassado.carregando;

  const corMedida = medida === "pago" ? AMBAR : medida === "recebido" ? VERDE : AZUL;
  const realizado: Serie[] = [
    { label: String(ano), cor: corMedida, valores: agora.map((m, i) => (i < mes ? m[medida] : null)), area: true },
    { label: String(ano - 1), cor: CINZA, valores: antes.map((m) => m[medida]), tracejada: true },
  ].filter((serie) => !serie.tracejada || serie.valores.some((v) => v));
  const aberto: Serie[] = [
    { label: "A receber", cor: VERDE, valores: agora.map((m) => m.aReceber), area: true },
    { label: "A pagar", cor: AMBAR, valores: agora.map((m) => m.aPagar) },
  ];
  const acumulado = (lista: typeof agora, ate: number) => lista.slice(0, ate).reduce((acc, m) => acc + m[medida], 0);
  const noAno = acumulado(agora, mes), noAnoPassado = acumulado(antes, mes);
  const mesAnterior = mes > 1 ? agora[mes - 2] : antes[11];
  const nomeAnterior = MESES[mes > 1 ? mes - 2 : 11];
  const comparativo: { label: string; atual: number; anterior: number; menorMelhor?: boolean }[] = [
    { label: "Pago", atual: agora[mes - 1].pago, anterior: mesAnterior.pago, menorMelhor: true },
    { label: "Recebido", atual: agora[mes - 1].recebido, anterior: mesAnterior.recebido },
    { label: "Resultado", atual: agora[mes - 1].resultado, anterior: mesAnterior.resultado },
  ];
  const total = receiveOpen + payableOpen;
  const parte = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : "—");
  const saldo = receiveOpen - payableOpen;

  return (
    <div className="fin-painel">
      {podeFluxo && (
        <Card className="fin-grafico fin-painel-largo">
          <div className="fin-grafico-topo">
            <div>
              <p className="eyebrow">REALIZADO · {realizado.length > 1 ? `${ano} × ${ano - 1}` : ano}</p>
              <h2>{medida === "pago" ? "Pagamentos por mês" : medida === "recebido" ? "Recebimentos por mês" : "Resultado por mês"}</h2>
            </div>
            <Segmented<Medida> options={MEDIDAS} value={medida} onChange={setMedida} compact ariaLabel="Medida do gráfico" />
          </div>
          <div className="fin-grafico-numero">
            <p><strong className={noAno < 0 ? "neg" : ""}>{valor(noAno)}</strong>{noAnoPassado ? <Variacao atual={noAno} anterior={noAnoPassado} menorMelhor={medida === "pago"} /> : null}</p>
            <p>Acumulado de Jan a {MESES[mes - 1]} · {noAnoPassado ? `${valor(noAnoPassado)} no mesmo período de ${ano - 1}` : `sem lançamentos de ${ano - 1} para comparar`}</p>
          </div>
          {esteAno.erro ? <div className="finance-empty"><b>{esteAno.erro}</b></div> : carregando ? <div className="finance-empty"><small>Calculando…</small></div> : <><Linhas series={realizado} atual={mes} rotuloVazio={medida === "pago" ? "Os pagamentos aparecem conforme as baixas forem registradas." : "O contas a receber veio do sistema antigo só com títulos em aberto; os recebimentos aparecem conforme forem confirmados aqui."} /><LegendaSeries series={realizado} /></>}
        </Card>
      )}

      <Card className="fin-posicao">
        <p className="eyebrow">EM ABERTO</p>
        <h2>A receber e a pagar</h2>
        {total > 0 ? (
          <>
            <Anel fatias={[{ label: "A receber", value: receiveOpen, cor: VERDE }, { label: "A pagar", value: payableOpen, cor: AMBAR }]} centro={valor(Math.abs(saldo))} legenda={saldo >= 0 ? "Saldo a favor" : "Saldo contra"} />
            <div className="fin-posicao-lista">
              <div><i className="bolinha" style={{ background: VERDE }} /><span>A receber<small>{parte(receiveOpen)} do total em aberto</small></span><b>{money(receiveOpen)}</b></div>
              <div><i className="bolinha" style={{ background: AMBAR }} /><span>A pagar<small>{parte(payableOpen)} do total em aberto</small></span><b>{money(payableOpen)}</b></div>
              <div className="saldo"><span>Diferença</span><b className={saldo < 0 ? "neg" : ""}>{money(saldo)}</b></div>
            </div>
          </>
        ) : <div className="finance-empty"><b>Sem títulos em aberto</b><small>O gráfico aparece quando houver contas a pagar ou a receber.</small></div>}
        <small className="fin-nota">Previsões ficam de fora.</small>
      </Card>

      {podeFluxo && (
        <Card className="fin-grafico fin-painel-largo">
          <div className="fin-grafico-topo">
            <div>
              <p className="eyebrow">EM ABERTO · VENCIMENTO EM {ano}</p>
              <h2>A receber × a pagar por mês</h2>
            </div>
            <button type="button" className="fin-link" onClick={abrirFluxo}>Ver fluxo de caixa ›</button>
          </div>
          {esteAno.erro ? <div className="finance-empty"><b>{esteAno.erro}</b></div> : esteAno.carregando ? <div className="finance-empty"><small>Calculando…</small></div> : <><Linhas series={aberto} atual={mes} rotuloVazio={`Nenhum título em aberto com vencimento em ${ano}.`} /><LegendaSeries series={aberto} /></>}
        </Card>
      )}

      {podeFluxo && (
        <Card className="fin-comparativo">
          <p className="eyebrow">MÊS CONTRA MÊS</p>
          <h2>{MESES[mes - 1]} × {nomeAnterior}</h2>
          {carregando ? <div className="finance-empty"><small>Calculando…</small></div> : (
            <div className="fin-comparativo-lista">
              {comparativo.map((c) => (
                <div key={c.label}>
                  <span>{c.label}<small>{nomeAnterior}: {valor(c.anterior)}</small></span>
                  <b className={c.atual < 0 ? "neg" : ""}>{valor(c.atual)}</b>
                  <Variacao atual={c.atual} anterior={c.anterior} menorMelhor={c.menorMelhor} />
                </div>
              ))}
            </div>
          )}
          <small className="fin-nota">{MESES[mes - 1]} conta até hoje. Realizado = baixas registradas.</small>
        </Card>
      )}
    </div>
  );
}
