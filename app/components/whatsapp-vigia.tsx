"use client";

import { useState } from "react";
import { Button, Status } from "../../packages/design-system";

/**
 * Vigia no WhatsApp (Fundação › WhatsApp, 03/11/2026): o proprietário muda pela tela, sem mexer no código, os dias e a hora
 * da Vigia, se ela manda os gargalos pelo WhatsApp e para quem (lista de transmissão, só pessoas da empresa: cada uma recebe
 * só o que as credenciais dela enxergam). E um envio avulso: um texto para um ou mais números, agora ou num horário.
 */

export type ContatoVigia = { id: string; lista: string; nome: string; pessoa: string | null; final: string; canal: string };
export type DadosVigia = { config: { dias: number[]; hora: string; whatsapp: boolean }; agenda: string; transmissao: string[]; contatos: ContatoVigia[] };

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const rotulo = (c: ContatoVigia) => `${c.nome}${c.pessoa && c.pessoa !== c.nome ? ` (${c.pessoa})` : ""} · final ${c.final}${c.canal ? ` · ${c.canal}` : ""}`;

export function VigiaWhatsapp({ dados, chamar, notify, recarregar }: {
  dados: DadosVigia;
  chamar: (corpo: Record<string, unknown>) => Promise<{ ok: boolean; d: { error?: string; agendados?: number } }>;
  notify: (m: string) => void;
  recarregar: () => Promise<unknown>;
}) {
  const [dias, setDias] = useState<number[]>(dados.config.dias);
  const [hora, setHora] = useState(dados.config.hora);
  const [whatsapp, setWhatsapp] = useState(dados.config.whatsapp);
  const [lista, setLista] = useState<string[]>(dados.transmissao);
  const [texto, setTexto] = useState("");
  const [para, setPara] = useState<string[]>([]);
  const [quando, setQuando] = useState("");
  const [ocupado, setOcupado] = useState<"salvar" | "enviar" | null>(null);
  const internos = dados.contatos.filter((c) => c.lista === "interna");
  const alternar = (xs: string[], id: string) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);

  const salvar = async () => {
    setOcupado("salvar");
    const { ok, d } = await chamar({ acao: "salvar_vigia", config: { dias, hora, whatsapp }, transmissao: lista });
    setOcupado(null);
    notify(ok ? "Vigia salva." : d.error || "Não foi possível salvar.");
    if (ok) void recarregar();
  };
  const enviar = async () => {
    if (!confirm(`Agendar a mensagem para ${para.length} ${para.length === 1 ? "número" : "números"}${quando ? "" : " agora"}?`)) return;
    setOcupado("enviar");
    const { ok, d } = await chamar({ acao: "enviar_avulso", contatos: para, texto, quando: quando ? new Date(quando).toISOString() : null });
    setOcupado(null);
    notify(ok ? `Mensagem agendada para ${d.agendados} ${d.agendados === 1 ? "número" : "números"}. Ela aparece em Envios agendados.` : d.error || "Não foi possível agendar.");
    if (ok) { setTexto(""); setPara([]); setQuando(""); void recarregar(); }
  };

  return (
    <section className="wa-canal wa-vigia" aria-label="Vigia">
      <header>
        <div>
          <h2>Vigia</h2>
          <small>Roda {dados.agenda}: lê os avisos de todas as áreas e o que está parado, liga uma coisa à outra e leva cada gargalo a quem decide, como Decisão para você{dados.config.whatsapp ? ", e manda pelo WhatsApp para a lista de transmissão" : ""}.</small>
        </div>
        <Status tone={dados.config.whatsapp ? "success" : "neutral"}>{dados.config.whatsapp ? "WhatsApp ligado" : "Só no sino"}</Status>
      </header>

      <form className="wa-form" onSubmit={(ev) => { ev.preventDefault(); void salvar(); }}>
        <fieldset className="wa-vigia-dias">
          <legend>Dias</legend>
          {DIAS.map((d, i) => (
            <button key={d} type="button" aria-pressed={dias.includes(i)} onClick={() => setDias((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i].sort()))}>{d}</button>
          ))}
        </fieldset>
        <label>Hora<input type="time" value={hora} onChange={(ev) => setHora(ev.target.value)} required /></label>
        <label className="wa-vigia-ligar"><input type="checkbox" checked={whatsapp} onChange={(ev) => setWhatsapp(ev.target.checked)} /> Mandar os gargalos pelo WhatsApp para a lista de transmissão</label>
        <fieldset className="wa-vigia-lista wa-obs">
          <legend>Lista de transmissão · {lista.length} {lista.length === 1 ? "pessoa" : "pessoas"}</legend>
          <small>Só pessoas da empresa. Cada uma recebe só os gargalos das áreas que as credenciais dela enxergam, e só quando houver gargalo novo.</small>
          {!internos.length && <small>Nenhuma pessoa na lista interna dos números. Inclua pela allowlist de cada número.</small>}
          {internos.map((c) => (
            <label key={c.id}><input type="checkbox" checked={lista.includes(c.id)} onChange={() => setLista((x) => alternar(x, c.id))} /> {rotulo(c)}</label>
          ))}
        </fieldset>
        <div className="wa-acoes">
          {!dias.length && <small>Sem nenhum dia marcado, a Vigia não roda sozinha.</small>}
          <Button type="submit" disabled={ocupado !== null}>{ocupado === "salvar" ? "Salvando…" : "Salvar a Vigia"}</Button>
        </div>
      </form>

      <form className="wa-form wa-vigia-avulso" onSubmit={(ev) => { ev.preventDefault(); void enviar(); }}>
        <b>Mensagem avulsa</b>
        <label className="wa-obs">Mensagem<textarea value={texto} onChange={(ev) => setTexto(ev.target.value)} maxLength={4000} rows={4} placeholder="Ex.: Pessoal, amanhã o expediente começa às 8h por causa da manutenção do compressor." required /></label>
        <fieldset className="wa-vigia-lista wa-obs">
          <legend>Para · {para.length} {para.length === 1 ? "número" : "números"}</legend>
          {dados.contatos.map((c) => (
            <label key={c.id}><input type="checkbox" checked={para.includes(c.id)} onChange={() => setPara((x) => alternar(x, c.id))} /> {rotulo(c)}{c.lista === "externa" ? " · externo" : ""}</label>
          ))}
        </fieldset>
        <label>Quando (vazio = agora)<input type="datetime-local" value={quando} onChange={(ev) => setQuando(ev.target.value)} /></label>
        <div className="wa-acoes">
          <small>Sai pelos envios agendados: nada sai entre 20h e 7h nem aos domingos. No máximo 30 números por envio.</small>
          <Button type="submit" disabled={ocupado !== null || !texto.trim() || !para.length}>{ocupado === "enviar" ? "Agendando…" : "Agendar o envio"}</Button>
        </div>
      </form>
    </section>
  );
}
