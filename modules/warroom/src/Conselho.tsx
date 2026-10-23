"use client";

import { SARA_CENTRAL } from "../../../lib/sara/central/sara";
import { Vigia } from "./Vigia";

/**
 * War Room › Conselho (E7, J1): a SARA central, o cérebro da empresa inteira. Ela atende em holograma
 * (SaraHolograma, invocado pelo botão ou pela esfera no canto); aqui ficam o que ela faz, perguntas para começar
 * e o quadro da vigia (J3). Próxima etapa: o relatório de crescimento (J4).
 */
const perguntar = (pergunta: string) => window.dispatchEvent(new CustomEvent("pecsil:sara-perguntar", { detail: { pergunta } }));
const invocar = () => window.dispatchEvent(new CustomEvent("pecsil:sara-invocar"));

export function Conselho() {
  return (
    <section className="conselho">
      <header>
        <p className="eyebrow">War Room · Conselho</p>
        <h2>SARA central</h2>
        <p>O cérebro da empresa inteira. Ela pergunta às SARAs de cada área ao mesmo tempo, com as suas permissões, confere cada número e junta tudo numa resposta, com a fonte de cada número e quem decide.</p>
      </header>
      <div className="conselho-como">
        <div><b>Pergunta que cruza áreas</b><span>Fundição, Produção, Compras e Financeiro respondem juntas; ela liga uma coisa à outra.</span></div>
        <div><b>Número conferido</b><span>Todo número tem de estar no que as áreas devolveram. O que não bate aparece marcado.</span></div>
        <div><b>Quem decide</b><span>Ela recomenda e diz de quem é a decisão. Decidir continua sendo da área.</span></div>
      </div>
      <button type="button" className="conselho-invocar" onClick={invocar}><span aria-hidden /> Invocar a SARA central</button>
      <h3>Para começar</h3>
      <div className="conselho-perguntas">
        {SARA_CENTRAL.sugestoes.map((s) => <button key={s} type="button" onClick={() => perguntar(s)}>{s}</button>)}
      </div>
      <Vigia />
      <p className="conselho-nota">Em breve: o relatório semanal de crescimento (ideias, recursos, concorrência e investimentos com justificativa).</p>
    </section>
  );
}
