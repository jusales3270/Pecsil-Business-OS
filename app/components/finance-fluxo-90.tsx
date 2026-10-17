"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Kpi, KpiGrid, Segmented, Status } from "../../packages/design-system";
import {
  CENARIOS, ORDEM_CENARIOS, contasAtrasadas, diasEntre, explicar, projetar, saldoDePartida, vencidoAPagar,
  type CenarioId, type Conta, type Parcela, type Projecao, type Regras,
} from "../../lib/finance/fluxo-90";
import { money, moneyShort } from "./finance-reports";

/**
 * Fluxo de caixa dos próximos 90 dias (F-07). Parte do saldo dos bancos e soma as parcelas em aberto
 * dia a dia, em três cenários por regra (sem IA). As regras ficam à vista e podem ser ajustadas na
 * tela para simular; nada do que se ajusta aqui é gravado. A explicação em texto livre fica para a SARA.
 */

type Dados = { hoje: string; contas: Conta[]; parcelas: Parcela[]; fora: { aReceber: number; aReceberN: number; aPagar: number; aPagarN: number; previsoes: number; previsoesN: number } };

const data = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const curta = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const COR: Record<CenarioId, string> = { conservador: "var(--accent-amber)", base: "var(--accent-blue)", otimista: "var(--accent-green)" };

export function FinanceFluxo90() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [cenario, setCenario] = useState<CenarioId>("base");
  const [ajustes, setAjustes] = useState<Partial<Record<CenarioId, Regras>>>({});
  const [digitado, setDigitado] = useState<Record<string, number | undefined>>({});
  const [aberta, setAberta] = useState<number | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch("/api/finance/fluxo-90", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, body: null }))
      .then(({ ok, body }) => { if (!ativo) return; if (ok) setDados(body as Dados); else setErro(body?.error === "FORBIDDEN" ? "Sem permissão para o fluxo de caixa." : "Não foi possível montar o fluxo agora."); });
    return () => { ativo = false; };
  }, []);

  const regrasDe = (id: CenarioId) => ajustes[id] ?? CENARIOS[id].regras;
  const saldoInicial = dados ? saldoDePartida(dados.contas, digitado) : 0;
  const projecoes = useMemo(() => {
    if (!dados) return null;
    return Object.fromEntries(ORDEM_CENARIOS.map((id) => [id, projetar(dados.parcelas, ajustes[id] ?? CENARIOS[id].regras, dados.hoje, saldoInicial)])) as Record<CenarioId, Projecao>;
  }, [dados, ajustes, saldoInicial]);

  if (erro) return <div className="finance-empty"><b>{erro}</b></div>;
  if (!dados || !projecoes) return <div className="finance-empty"><small>Montando os próximos 90 dias…</small></div>;

  const p = projecoes[cenario];
  const regras = regrasDe(cenario);
  const atrasadas = contasAtrasadas(dados.contas, dados.hoje);
  const vencido = vencidoAPagar(dados.parcelas, dados.hoje);
  const ajustado = Boolean(ajustes[cenario]);
  const mudar = (r: Partial<Regras>) => setAjustes((a) => ({ ...a, [cenario]: { ...regras, ...r } }));

  return (
    <>
      <KpiGrid>
        <Kpi label="Saldo de partida" value={moneyShort(saldoInicial)} caption={`Bancos, ${data(dados.hoje)}`} tone="blue" />
        <Kpi label="Menor saldo" value={moneyShort(p.menor.valor)} caption={`Em ${data(p.menor.data)}`} tone={p.menor.valor < 0 ? "red" : "green"} />
        <Kpi label="Saldo em 90 dias" value={moneyShort(p.saldoFinal)} caption={data(p.dias.at(-1)!.data)} tone={p.saldoFinal < 0 ? "red" : "green"} />
        <Kpi label="Resultado dos 90 dias" value={moneyShort(p.entra - p.sai)} caption={`Entra ${moneyShort(p.entra)} · sai ${moneyShort(p.sai)}`} tone={p.entra - p.sai < 0 ? "red" : "neutral"} />
      </KpiGrid>

      {p.primeiroNegativo && (
        <Callout variant="danger" title={p.primeiroNegativo === dados.hoje ? "O caixa já fica negativo hoje" : `O caixa fica negativo em ${data(p.primeiroNegativo)}`}>
          No cenário “{CENARIOS[cenario].nome}”, o saldo dos bancos não cobre as saídas a partir desse dia{p.primeiroNegativo === dados.hoje && vencido.n ? `, porque o a pagar vencido (${money(vencido.valor)}) sai hoje` : ""}. O menor saldo é {money(p.menor.valor)}, em {data(p.menor.data)}.
        </Callout>
      )}

      <Card className="fin-fluxo fluxo90">
        <header className="fluxo90-cabeca">
          <Segmented<CenarioId> options={ORDEM_CENARIOS.map((id) => ({ value: id, label: CENARIOS[id].nome }))} value={cenario} onChange={setCenario} ariaLabel="Cenário" compact />
          <div className="fluxo90-comparar" aria-label="Os três cenários">
            {ORDEM_CENARIOS.map((id) => (
              <button key={id} type="button" className={id === cenario ? "ativo" : ""} onClick={() => setCenario(id)}>
                <i style={{ background: COR[id] }} />
                <span>{CENARIOS[id].nome}{ajustes[id] ? " (ajustado)" : ""}</span>
                <b className={projecoes[id].saldoFinal < 0 ? "neg" : ""}>{moneyShort(projecoes[id].saldoFinal)}</b>
                <small>menor {moneyShort(projecoes[id].menor.valor)}</small>
              </button>
            ))}
          </div>
        </header>
        <Grafico projecoes={projecoes} cenario={cenario} />
        <div className="fluxo90-regras">
          <div>
            <span className="almox-rotulo">Regras do cenário {CENARIOS[cenario].nome.toLowerCase()}{ajustado ? " · ajustadas nesta tela" : ""}</span>
            <div className="fluxo90-lista">{explicar(regras).map((t) => <p key={t}>{t}</p>)}</div>
          </div>
          <div className="fluxo90-ajuste" aria-label="Ajustar o cenário">
            <label><span>Atraso no recebimento (dias)</span><input type="number" min={0} max={90} value={regras.atrasoReceber} onChange={(e) => mudar({ atrasoReceber: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} /></label>
            <label><span>A receber já vencido</span>
              <select className="icms-select" value={regras.vencidoReceber} onChange={(e) => mudar({ vencidoReceber: e.target.value as Regras["vencidoReceber"] })}>
                <option value="hoje">Entra hoje</option><option value="em_30_dias">Entra em 30 dias</option><option value="fora">Fica fora</option>
              </select>
            </label>
            <label className="fluxo90-check"><input type="checkbox" checked={regras.previsoesEntrada} onChange={(e) => mudar({ previsoesEntrada: e.target.checked })} /><span>Previsões de entrada</span></label>
            <label className="fluxo90-check"><input type="checkbox" checked={regras.previsoesSaida} onChange={(e) => mudar({ previsoesSaida: e.target.checked })} /><span>Previsões de saída</span></label>
            {ajustado && <Button variant="ghost" onClick={() => setAjustes((a) => { const n = { ...a }; delete n[cenario]; return n; })}>Voltar às regras do cenário</Button>}
          </div>
        </div>
      </Card>

      <Card className="fin-fluxo">
        <h2 className="fluxo90-titulo">Semana a semana · {CENARIOS[cenario].nome}</h2>
        <div className="fin-tabela-rolagem">
          <table className="fin-tabela fluxo90-semanas">
            <thead><tr><th>Semana</th><th>Entradas</th><th>Saídas</th><th>Resultado</th><th>Saldo no fim</th><th>Parcelas</th></tr></thead>
            <tbody>
              {p.semanas.map((s, i) => (
                <Fragment key={s.inicio}>
                  <tr className={aberta === i ? "atual" : ""}>
                    <th><button type="button" className="fin-link" aria-expanded={aberta === i} onClick={() => setAberta(aberta === i ? null : i)}>{curta(s.inicio)} a {curta(s.fim)}{i === 0 ? " (inclui vencidos)" : ""}</button></th>
                    <td>{money(s.entra)}</td><td>{money(s.sai)}</td>
                    <td className={s.entra - s.sai < 0 ? "neg" : ""}>{money(s.entra - s.sai)}</td>
                    <td className={s.saldoFinal < 0 ? "neg" : ""}>{money(s.saldoFinal)}</td>
                    <td className="fraco">{s.parcelas.length}</td>
                  </tr>
                  {aberta === i && (
                    <tr className="fluxo90-detalhe"><td colSpan={6}>
                      {s.parcelas.length ? (
                        <div className="fluxo90-itens">
                          {s.parcelas.slice(0, 12).map((x) => (
                            <div key={x.id} className="item">
                              <span className={x.direcao === "entra" ? "entra" : "sai"}>{x.direcao === "entra" ? "Entra" : "Sai"}</span>
                              <b>{x.quem ?? "—"}</b>
                              <small>{x.descricao ?? x.documento ?? ""} · vence {data(x.vencimento)}{diasEntre(x.vencimento, dados.hoje) > 0 ? " (vencida)" : ""}</small>
                              {x.previsao && <Status tone="neutral">Previsão</Status>}
                              {x.emAprovacao && <Status tone="attention">Em aprovação</Status>}
                              <em>{money(x.valor)}</em>
                            </div>
                          ))}
                          {s.parcelas.length > 12 && <p className="mais">e mais {s.parcelas.length - 12} parcela(s) menores</p>}
                        </div>
                      ) : <small>Nada nesta semana.</small>}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="fin-fluxo">
        <h2 className="fluxo90-titulo">De onde sai o saldo de partida</h2>
        <div className="fluxo90-contas">
          {dados.contas.map((c) => {
            const atrasada = atrasadas.some((a) => a.id === c.id);
            return (
              <div key={c.id} className={atrasada ? "atrasada" : ""}>
                <b>{c.nome}</b>
                <small>{c.ultimo ? `Saldo pelo extrato até ${data(c.ultimo)}` : "Sem extrato importado"}</small>
                <strong>{money(c.saldo)}</strong>
                {atrasada && (
                  <label><span>Extrato atrasado: saldo de hoje para a simulação</span>
                    <input inputMode="decimal" placeholder={c.saldo.toFixed(2).replace(".", ",")} value={digitado[c.id] === undefined ? "" : String(digitado[c.id]).replace(".", ",")}
                      onChange={(e) => { const v = e.target.value.trim(); const n = Number(v.replace(/\./g, "").replace(",", ".")); setDigitado((d) => ({ ...d, [c.id]: v === "" || !Number.isFinite(n) ? undefined : n })); }} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
        <p className="fin-nota">O saldo digitado vale só nesta tela e não é gravado. Para o saldo certo ficar para todos, importe o extrato em Bancos e conciliação.</p>
      </Card>

      {(vencido.n > 0 || dados.fora.aReceberN + dados.fora.aPagarN + dados.fora.previsoesN > 0) && (
        <Callout variant="warning" title="O que pode distorcer a projeção">
          {vencido.n > 0 && <span className="portal-aviso">{vencido.n} parcela(s) a pagar vencidas nos últimos 90 dias ({money(vencido.valor)}) saem hoje em todos os cenários. Se já foram pagas, falta dar a baixa em Contas a pagar.</span>}
          {dados.fora.aReceberN + dados.fora.aPagarN > 0 && <span className="portal-aviso">Vencido há mais de 90 dias fica fora: {money(dados.fora.aReceber)} a receber ({dados.fora.aReceberN}) e {money(dados.fora.aPagar)} a pagar ({dados.fora.aPagarN}).</span>}
          {dados.fora.previsoesN > 0 && <span className="portal-aviso">Previsões vencidas há mais de 90 dias também ficam fora: {money(dados.fora.previsoes)} em {dados.fora.previsoesN}.</span>}
        </Callout>
      )}
    </>
  );
}

/** Linha do saldo dia a dia nos três cenários, com a linha do zero. */
function Grafico({ projecoes, cenario }: { projecoes: Record<CenarioId, Projecao>; cenario: CenarioId }) {
  const L = 900, A = 220, M = 8;
  const todos = ORDEM_CENARIOS.flatMap((id) => projecoes[id].dias.map((d) => d.saldo));
  const max = Math.max(0, ...todos), min = Math.min(0, ...todos);
  const y = (v: number) => M + (A - 2 * M) * (1 - (v - min) / (max - min || 1));
  const x = (i: number) => (i / 90) * L;
  const linha = (id: CenarioId) => projecoes[id].dias.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.saldo).toFixed(1)}`).join(" ");
  const dias = projecoes[cenario].dias;
  return (
    <figure className="fluxo90-grafico">
      <svg width="100%" height={A} viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" role="img" aria-label="Saldo dia a dia nos próximos 90 dias">
        <line x1={0} x2={L} y1={y(0)} y2={y(0)} className="zero" />
        {ORDEM_CENARIOS.filter((id) => id !== cenario).map((id) => <path key={id} d={linha(id)} stroke={COR[id]} className="outro" />)}
        <path d={linha(cenario)} stroke={COR[cenario]} className="atual" />
      </svg>
      <figcaption>
        <span>{curta(dias[0].data)}</span><span>{curta(dias[30].data)}</span><span>{curta(dias[60].data)}</span><span>{curta(dias[90].data)}</span>
      </figcaption>
      <div className="fluxo90-eixo"><span>{moneyShort(max)}</span><span>{moneyShort(min)}</span></div>
    </figure>
  );
}
