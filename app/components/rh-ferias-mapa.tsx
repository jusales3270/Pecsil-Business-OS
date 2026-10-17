"use client";

import { useEffect, useMemo, useState } from "react";
import { Callout, Card, Status } from "../../packages/design-system";
import { montarMapa, type Celula, type Concessivo, type DadosMapa, type Linha } from "../../lib/rh/ferias-mapa";

/**
 * RH › Férias e ausências › Mapa por setor (R-03). Os próximos 12 meses por setor: quem está de férias
 * (aprovadas ou registradas), que parte do setor fica fora e quando vence o prazo de concessão de cada
 * saldo. Os saldos com o prazo já vencido (férias em dobro) ficam à parte.
 */

const data = (v: string) => v.slice(0, 10).split("-").reverse().join("/");
const pct = (p: number) => `${Math.round(p * 100)}%`;
type Aberto = { linha: Linha; celula?: Celula; vencidos?: boolean };

export function FeriasPorSetor() {
  const [dados, setDados] = useState<DadosMapa | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<Aberto | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/rh/ferias-mapa", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, body: null }))
      .then(({ ok, body }) => { if (!vivo) return; if (ok) setDados(body as DadosMapa); else setErro(body?.error ?? "Não foi possível montar o mapa."); });
    return () => { vivo = false; };
  }, []);
  const mapa = useMemo(() => (dados ? montarMapa(dados) : null), [dados]);
  if (erro) return <div className="finance-empty"><b>{erro}</b></div>;
  if (!dados || !mapa) return <div className="finance-empty"><small>Montando o mapa…</small></div>;
  const mesNome = (chave: string) => mapa.meses.find((m) => m.chave === chave)?.rotulo ?? chave;

  return (
    <Card className="ferias-mapa">
      <div className="card-head">
        <div>
          <p className="eyebrow">PLANEJAMENTO DE EQUIPE</p>
          <h2>Mapa de férias por setor</h2>
          <p>De {mapa.meses[0].rotulo} a {mapa.meses.at(-1)!.rotulo}: quem sai em cada mês e quando vence o prazo para conceder cada saldo.</p>
        </div>
        <span className="ferias-mapa-resumo">
          {mapa.vencidos > 0 && <Status tone="danger">{mapa.vencidos} com prazo vencido</Status>}
          {mapa.vencemNaJanela > 0 && <Status tone="attention">{mapa.vencemNaJanela} vencem em 12 meses</Status>}
        </span>
      </div>
      {mapa.vencidos > 0 && (
        <Callout variant="warning" title="Prazo de concessão vencido">
          Pela CLT (art. 137), férias concedidas depois do prazo são pagas em dobro. Alguns períodos são antigos: confira se não há gozo que deixou de ser lançado.
        </Callout>
      )}
      <div className="ferias-mapa-rolagem">
        <table className="ferias-mapa-tabela">
          <thead>
            <tr><th>Setor</th><th>Vencidas</th>{mapa.meses.map((m) => <th key={m.chave}>{m.rotulo}</th>)}</tr>
          </thead>
          <tbody>
            {mapa.linhas.map((l) => (
              <tr key={l.setor.id}>
                <th><b>{l.setor.nome}</b><small>{l.setor.ativos} ativo(s)</small></th>
                <td>{l.vencidos.length ? <button type="button" className="ferias-cel vencidas" onClick={() => setAberto({ linha: l, vencidos: true })}>{l.vencidos.length}</button> : <span className="ferias-zero">—</span>}</td>
                {l.celulas.map((c) => {
                  const vazia = !c.fora.length && !c.vencem.length;
                  return (
                    <td key={c.mes}>
                      {vazia ? <span className="ferias-zero" /> : (
                        <button type="button" className={`ferias-cel${c.parte >= 0.5 ? " metade" : ""}`} style={{ ["--parte" as string]: String(Math.min(1, c.parte)) }}
                          aria-label={`${l.setor.nome}, ${mesNome(c.mes)}: ${c.fora.length} de férias${c.vencem.length ? `, ${c.vencem.length} prazo(s) vencendo` : ""}`}
                          onClick={() => setAberto({ linha: l, celula: c })}>
                          {c.fora.length ? <b>{c.fora.length}</b> : null}
                          {c.vencem.length ? <i title="Prazo de concessão vence neste mês">!{c.vencem.length}</i> : null}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ferias-mapa-legenda">
        <span><i className="fora" /> Pessoas de férias no mês (cor mais forte = maior parte do setor)</span>
        <span><i className="vence">!</i> Prazo de concessão vence no mês</span>
        <span><i className="metade" /> Metade do setor ou mais fora</span>
      </div>
      {aberto && <Detalhe aberto={aberto} mesNome={mesNome} fechar={() => setAberto(null)} />}
    </Card>
  );
}

function Detalhe({ aberto, mesNome, fechar }: { aberto: Aberto; mesNome: (c: string) => string; fechar: () => void }) {
  const { linha, celula, vencidos } = aberto;
  const conc = (c: Concessivo) => (
    <div key={`${c.employee}-${c.vence}`} className="item">
      <b>{c.nome}</b>
      <small>Período {data(c.aquisitivoInicio)} a {data(c.aquisitivoFim)} · {c.saldo} dia(s) de saldo · prazo {data(c.vence)}</small>
    </div>
  );
  return (
    <section className="ferias-mapa-detalhe" aria-label="Detalhe do mapa">
      <header>
        <b>{linha.setor.nome}{celula ? ` · ${mesNome(celula.mes)}` : " · prazo vencido"}</b>
        <button type="button" className="almox-link" onClick={fechar}>Fechar</button>
      </header>
      {vencidos && linha.vencidos.map(conc)}
      {celula && celula.fora.length > 0 && (
        <>
          <span className="almox-rotulo">De férias ({celula.fora.length} de {linha.setor.ativos}, {pct(celula.parte)} do setor)</span>
          {celula.fora.map((f) => <div key={f.employee} className="item"><b>{f.nome}</b><small>{data(f.inicio)} a {data(f.fim)} · {f.diasNoMes} dia(s) neste mês</small></div>)}
        </>
      )}
      {celula && celula.vencem.length > 0 && (
        <>
          <span className="almox-rotulo">Prazo de concessão vence neste mês</span>
          {celula.vencem.map(conc)}
        </>
      )}
    </section>
  );
}
