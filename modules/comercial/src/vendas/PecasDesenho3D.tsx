"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Carregando, EscolherArquivo, Modal, Status } from "../../../../packages/design-system";
import { VisualizarArquivo } from "../../../../app/components/visualizar-arquivo";
import { api, dataHora } from "../../../fiscal/src/comum";
import { lerNumeroBr } from "../../../../lib/numero-br";
import {
  ROTULO_TIPO, TIPOS_PECA, classificar, ehPeca, linhas, medidas, resumoPorTipo,
  type CorpoMedido, type Liga, type RegraSobremetal, type TipoPeca,
} from "../../../../lib/comercial/peso-3d";

/**
 * Orçamento › Peças do desenho 3D (ROADMAP C-19). O Rafael anexa o STEP do cliente; o medidor 3D mede
 * cada peça em segundo plano e aqui aparecem o tipo sugerido (ele corrige), a liga, as medidas, o peso
 * acabado e o bruto (sobremetal pela regra em "Ligas e sobremetal"). "Usar no item" leva o peso ao item.
 */

type Medicao = {
  id: string; attachment_id: string | null; nome_arquivo: string | null; situacao: "pendente" | "medindo" | "pronto" | "erro"; erro: string | null;
  versao_motor: string | null; tempo_ms: number | null; corpos: CorpoMedido[]; imagens: string[];
  ajustes: Record<string, { tipo?: string; liga_id?: string | null }>; liga_id: string | null; created_by_name: string | null; created_at: string; medido_em: string | null;
  /** Em andamento: as etapas que o medidor já avisou. */
  etapas?: { texto: string; em: string }[];
};
type Dados = { medicoes: Medicao[]; ligas: Liga[]; regras: RegraSobremetal[]; podeOperar: boolean; medidorLigado: boolean };
export type ItemParaPeso = { chave: string; rotulo: string };

/** O mesmo limite da rota de anexos (o servidor recusa acima disso). */
const LIMITE_STEP = 50 * 1024 * 1024;
const mb = (b: number) => `${(b / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const kg = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;
const mm = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function PecasDesenho3D({ quoteId, editavel, itens, ocupado, onAnexar, onUsarPeso, notify }: {
  quoteId: string; editavel: boolean; itens: ItemParaPeso[]; ocupado: boolean;
  onAnexar: (arquivos: File[]) => Promise<string | null>; onUsarPeso: (chave: string, kg: number) => void; notify: (m: string) => void;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [imagem, setImagem] = useState<{ medicao: string; corpo: string; nome: string } | null>(null);
  const [regrasAbertas, setRegrasAbertas] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Dados>(`/api/comercial/orcamentos/${quoteId}/medicoes`);
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, [quoteId]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  // Enquanto mede, confere de 5 em 5 segundos.
  const medindo = Boolean(dados?.medicoes.some((m) => m.situacao === "pendente" || m.situacao === "medindo"));
  useEffect(() => {
    if (!medindo) return;
    const t = setInterval(() => { void carregar(); }, 2000);
    return () => clearInterval(t);
  }, [medindo, carregar]);

  const ajustar = async (medicao: string, corpo: string | null, mudanca: { tipo?: string; liga_id?: string | null }) => {
    const r = await api(`/api/comercial/orcamentos/${quoteId}/medicoes/${medicao}`, { method: "PATCH", body: JSON.stringify(corpo ? { corpo, ...mudanca } : mudanca) });
    if (!r.ok) notify(r.error);
    void carregar();
  };
  const medirDeNovo = async (medicao: string) => {
    const r = await api(`/api/comercial/orcamentos/${quoteId}/medicoes/${medicao}`, { method: "POST" });
    notify(r.ok ? "Medindo de novo…" : r.error);
    setTimeout(() => { void carregar(); }, 1500);
  };
  const [erroAnexo, setErroAnexo] = useState("");
  // Enquanto o arquivo sobe (13 MB levam alguns segundos), a caixa de progresso já aparece.
  const [enviando, setEnviando] = useState<{ nome: string; tamanho: number; desde: number } | null>(null);
  const anexar = async (arquivos: File[]) => {
    const f = arquivos[0];
    if (!f) return;
    setErroAnexo("");
    if (!/\.(step|stp)$/i.test(f.name)) { setErroAnexo(`"${f.name}" não é um STEP (.step ou .stp). DWG e PDF vão em Anexos › Outros.`); return; }
    if (f.size > LIMITE_STEP) { setErroAnexo(`"${f.name}" tem ${mb(f.size)}: o limite do desenho 3D é 50 MB.`); return; }
    setEnviando({ nome: f.name, tamanho: f.size, desde: Date.now() });
    const falha = await onAnexar(arquivos).finally(() => setEnviando(null));
    if (falha) setErroAnexo(`Não foi possível anexar "${f.name}": ${falha}`);
    void carregar();
  };

  const pode = editavel && Boolean(dados?.podeOperar);

  return (
    <section className="almox-bloco fiscal-config-bloco">
      <header>
        <h2>Peças do desenho 3D</h2>
        {dados?.podeOperar && <Button variant="ghost" compact onClick={() => setRegrasAbertas(true)}>Ligas e sobremetal</Button>}
      </header>
      <p className="fiscal-nota-ajuda">Anexe o STEP que o cliente mandou: a plataforma mede cada peça (leva de meio minuto a dois minutos) e mostra o peso acabado e o bruto, com o sobremetal da regra. Confira o tipo de cada peça e use o peso no item. DWG e PDF vão em Anexos › Outros.</p>
      {dados && !dados.medidorLigado && <Callout variant="warning" title="Medidor 3D desligado">O serviço que mede o STEP ainda não está ligado no servidor. O arquivo fica guardado e a medição sai quando ele for ligado (Medir de novo).</Callout>}
      {erro && <p className="fiscal-nota-ajuda" role="alert">{erro}</p>}
      {erroAnexo && <Callout variant="danger" title="O desenho não foi anexado">{erroAnexo}</Callout>}
      {pode && <EscolherArquivo compacto rotulo="Anexar STEP do cliente" aceita=".step,.stp" onEscolher={(f) => void anexar(f)} ocupado={ocupado} textoOcupado="Guardando…" />}
      {enviando && <ProgressoMedicao desde={enviando.desde} etapas={[{ texto: `Enviando ${enviando.nome} (${mb(enviando.tamanho)}) para a plataforma`, em: new Date(enviando.desde).toISOString() }]} />}

      {dados?.medicoes.map((m) => (
        <Medida key={m.id} quoteId={quoteId} m={m} dados={dados} pode={pode} itens={itens}
          onAjustar={(corpo, mud) => void ajustar(m.id, corpo, mud)} onMedirDeNovo={() => void medirDeNovo(m.id)}
          onImagem={(corpo, nome) => setImagem({ medicao: m.id, corpo, nome })}
          onUsarPeso={(chave, valor, rotulo) => { onUsarPeso(chave, valor); notify(`${rotulo}: ${kg(valor)} no item. Salve o orçamento para gravar.`); }} />
      ))}

      {imagem && (
        <VisualizarArquivo nome={`${imagem.nome}.png`} url={`/api/comercial/orcamentos/${quoteId}/medicoes/${imagem.medicao}/imagem?corpo=${encodeURIComponent(imagem.corpo)}`}
          baixar={`/api/comercial/orcamentos/${quoteId}/medicoes/${imagem.medicao}/imagem?corpo=${encodeURIComponent(imagem.corpo)}`} onFechar={() => setImagem(null)} />
      )}
      {regrasAbertas && <RegrasPeso onFechar={(mudou) => { setRegrasAbertas(false); if (mudou) void carregar(); }} notify={notify} />}
    </section>
  );
}

function Medida({ quoteId, m, dados, pode, itens, onAjustar, onMedirDeNovo, onImagem, onUsarPeso }: {
  quoteId: string; m: Medicao; dados: Dados; pode: boolean; itens: ItemParaPeso[];
  onAjustar: (corpo: string | null, mudanca: { tipo?: string; liga_id?: string | null }) => void; onMedirDeNovo: () => void;
  onImagem: (corpo: string, nome: string) => void; onUsarPeso: (chave: string, kg: number, rotulo: string) => void;
}) {
  const [verFora, setVerFora] = useState(false);
  const ls = useMemo(() => linhas(m.corpos ?? [], m.ajustes ?? {}, dados.ligas, m.liga_id, dados.regras), [m, dados.ligas, dados.regras]);
  const resumo = useMemo(() => resumoPorTipo(ls), [ls]);
  // Voltou ao tipo sugerido: o ajuste some (a linha deixa de dizer "escolhido no orçamento").
  const sugestao = useMemo(() => classificar(m.corpos ?? []), [m.corpos]);
  const pecas = ls.filter((l) => ehPeca(l.tipo));
  const fora = ls.filter((l) => !ehPeca(l.tipo));
  const tem = (corpo: string) => m.imagens.includes(corpo);

  return (
    <div className="vnd-medicao">
      <div className="vnd-medicao-cabeca">
        {m.attachment_id
          ? <a className="almox-link vnd-medicao-arquivo" href={`/api/comercial/orcamentos/${quoteId}/anexos?anexo=${m.attachment_id}`} target="_blank" rel="noreferrer">{m.nome_arquivo ?? "Desenho 3D"}</a>
          : <b>{m.nome_arquivo ?? "Desenho 3D"}</b>}
        {m.situacao === "pronto" && <Status tone="success">Medido</Status>}
        {(m.situacao === "pendente" || m.situacao === "medindo") && <Status tone="info">Medindo…</Status>}
        {m.situacao === "erro" && <Status tone="danger">Não mediu</Status>}
        <small>{m.created_by_name ?? "—"} · {dataHora(m.created_at)}{m.situacao === "pronto" && m.tempo_ms ? ` · medido em ${Math.max(1, Math.round(m.tempo_ms / 1000))} s` : ""}</small>
        {m.situacao === "pronto" && (
          <label className="vnd-medicao-liga"><span>Liga</span>
            <select value={m.liga_id ?? ""} disabled={!pode} onChange={(e) => onAjustar(null, { liga_id: e.target.value || null })}>
              {dados.ligas.map((l) => <option key={l.id} value={l.id}>{l.nome} · {String(l.densidade_g_cm3).replace(".", ",")} g/cm³</option>)}
            </select>
          </label>
        )}
        {tem("montagem") && <button type="button" className="almox-link" onClick={() => onImagem("montagem", m.nome_arquivo ?? "montagem")}>Ver a montagem</button>}
      </div>

      {m.situacao === "erro" && (
        <p className="fiscal-nota-ajuda" role="alert">{m.erro ?? "A medição falhou."} {pode && <button type="button" className="almox-link" onClick={onMedirDeNovo}>Medir de novo</button>}</p>
      )}
      {(m.situacao === "pendente" || m.situacao === "medindo") && (
        <ProgressoMedicao desde={new Date(m.created_at).getTime()}
          etapas={m.etapas?.length ? m.etapas : [{ texto: m.situacao === "pendente" ? "Arquivo guardado: esperando a vez no medidor" : "Medindo as peças no servidor", em: m.created_at }]} />
      )}

      {m.situacao === "pronto" && (
        <>
          {resumo.length > 0 ? (
            <div className="vnd-tabela vnd-pecas3d-resumo" role="table" aria-label="Peso por peça">
              <div className="cabeca" role="row"><span>Peça</span><span className="r">Acabado</span><span className="r">Bruto</span><span>Sobremetal</span></div>
              {resumo.map((t) => {
                const regra = ls.find((l) => l.tipo === t.tipo && l.peso)?.peso?.sobremetal;
                return (
                  <div role="row" key={t.tipo}>
                    <span className="nome">{ROTULO_TIPO[t.tipo]}<small>{t.corpos > 1 ? `${t.corpos} corpos${t.tipo === "forma" || t.tipo === "bloco" ? " (metades)" : ""}` : "1 corpo"}</small></span>
                    <span className="r">{kg(t.acabado_kg)}</span>
                    <span className="r"><b>{kg(t.bruto_kg)}</b></span>
                    <span>{regra ? `+${mm(regra.mm_diametro)} mm no Ø, +${mm(regra.mm_comprimento)} mm no comprimento` : "sem sobremetal"}</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="fiscal-nota-ajuda">Nenhuma peça reconhecida: escolha o tipo de cada corpo abaixo.</p>}
          {pode && itens.length > 0 && resumo.length > 0 && (
            <UsarNoItem itens={itens} pecas={resumo.map((t) => ({ tipo: t.tipo, rotulo: `${ROTULO_TIPO[t.tipo]} · ${kg(t.bruto_kg)}`, kg: t.bruto_kg }))}
              onUsar={(chave, peca) => onUsarPeso(chave, peca.kg, ROTULO_TIPO[peca.tipo])} />
          )}

          <div className="vnd-tabela vnd-pecas3d" role="table" aria-label="Corpos do desenho">
            <div className="cabeca" role="row"><span>Imagem</span><span>Na montagem</span><span>Tipo</span><span className="r">Acabado</span><span className="r">Bruto</span></div>
            {[...pecas, ...(verFora ? fora : [])].map((l) => {
              const med = medidas(l.corpo);
              const nome = l.corpo.componente || l.corpo.nome;
              return (
                <div role="row" key={l.corpo.nome} className={ehPeca(l.tipo) ? undefined : "vnd-pecas3d-fora"}>
                  <span>{tem(l.corpo.nome)
                    ? <button type="button" className="vnd-pecas3d-img" onClick={() => onImagem(l.corpo.nome, nome)} aria-label={`Ver ${nome}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- imagem da rota autenticada do orçamento, sem otimização */}
                      <img src={`/api/comercial/orcamentos/${quoteId}/medicoes/${m.id}/imagem?corpo=${encodeURIComponent(l.corpo.nome)}`} alt="" loading="lazy" /></button>
                    : <small>—</small>}</span>
                  <span className="nome">{nome}
                    <small>{med && "diametro" in med ? `Ø${mm(med.diametro)} × ${mm(med.comprimento)} mm` : med ? `${med.lados.map(mm).join(" × ")} mm` : ""}{l.corpo.ocorrencias > 1 ? ` · aparece ${l.corpo.ocorrencias}× na montagem` : ""}</small>
                    <small>{l.motivo}</small>
                  </span>
                  <span>
                    <select aria-label={`Tipo de ${nome}`} value={l.tipo} disabled={!pode} onChange={(e) => onAjustar(l.corpo.nome, { tipo: e.target.value === sugestao.get(l.corpo.nome)?.tipo ? "" : e.target.value })}>
                      {TIPOS_PECA.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t as TipoPeca]}</option>)}
                    </select>
                  </span>
                  <span className="r">{l.peso ? kg(l.peso.acabado_kg) : "—"}</span>
                  <span className="r">{l.peso ? kg(l.peso.bruto_kg) : "fora do peso"}</span>
                </div>
              );
            })}
          </div>
          {fora.length > 0 && (
            <button type="button" className="almox-link" onClick={() => setVerFora((v) => !v)}>
              {verFora ? "Esconder o que ficou fora do peso" : `Ver o que ficou fora do peso (${fora.length}: garrafa, pré-forma, ferragem)`}
            </button>
          )}
          <p className="fiscal-nota-ajuda">Peso = volume do STEP × densidade da liga. Bruto = a peça com o sobremetal seguindo o contorno. Motor {m.versao_motor ?? "—"}.</p>
        </>
      )}
    </div>
  );

}

/** Tempo corrido, no jeito de falar: "42 s", "1 min 12 s". */
const decorrido = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

/**
 * O que está acontecendo enquanto mede (leva de meio minuto a alguns minutos): a etapa atual em itálico, com o
 * spinner, as já feitas embaixo e o tempo correndo. Sem isso, parecia que o envio tinha falhado.
 */
function ProgressoMedicao({ desde, etapas }: { desde: number; etapas: { texto: string; em: string }[] }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const atual = etapas.at(-1);
  const feitas = etapas.slice(0, -1);
  return (
    <div className="vnd-progresso" role="status" aria-live="polite">
      <div className="vnd-progresso-atual">
        <Carregando tamanho={14} />
        <em>{atual?.texto ?? "Preparando"}…</em>
        <span className="vnd-progresso-tempo">{decorrido(agora - desde)}</span>
      </div>
      {feitas.length > 0 && (
        <ol className="vnd-progresso-feitas">
          {feitas.map((e, k) => <li key={`${e.em}-${k}`}><span aria-hidden>✓</span> {e.texto}</li>)}
        </ol>
      )}
      <small>Costuma levar de meio minuto a três minutos. Pode continuar o orçamento: o resultado aparece aqui sozinho.</small>
    </div>
  );
}

type PecaPeso = { tipo: TipoPeca; rotulo: string; kg: number };
/** Levar o peso bruto de uma peça ao item do orçamento (o item grava com o Salvar). */
function UsarNoItem({ itens, pecas, onUsar }: { itens: ItemParaPeso[]; pecas: PecaPeso[]; onUsar: (chave: string, peca: PecaPeso) => void }) {
  const [chave, setChave] = useState(itens[0]?.chave ?? "");
  const [tipo, setTipo] = useState<TipoPeca>(pecas[0]?.tipo ?? "forma");
  const item = itens.some((i) => i.chave === chave) ? chave : itens[0]?.chave ?? "";
  const peca = pecas.find((p) => p.tipo === tipo) ?? pecas[0];
  return (
    <div className="vnd-usar-peso">
      <span>Levar ao item</span>
      <select aria-label="Peça" value={peca?.tipo ?? ""} onChange={(e) => setTipo(e.target.value as TipoPeca)}>
        {pecas.map((p) => <option key={p.tipo} value={p.tipo}>{p.rotulo}</option>)}
      </select>
      <span aria-hidden>→</span>
      <select aria-label="Item do orçamento" value={item} onChange={(e) => setChave(e.target.value)}>
        {itens.map((i) => <option key={i.chave} value={i.chave}>{i.rotulo}</option>)}
      </select>
      <Button variant="secondary" compact onClick={() => item && peca && onUsar(item, peca)}>Usar no item</Button>
    </div>
  );
}

const PECAS: TipoPeca[] = ["forma", "bloco", "fundo", "plato", "funil", "outro"];
type LigaForm = { id: string | null; nome: string; densidade: string; padrao: boolean };
type RegraForm = { tipo_peca: TipoPeca; liga_id: string; mm_diametro: string; mm_comprimento: string };

/** Ligas (densidade) e a regra do sobremetal por peça. Quem opera orçamentos ajusta; vale para os próximos cálculos. */
function RegrasPeso({ onFechar, notify }: { onFechar: (mudou: boolean) => void; notify: (m: string) => void }) {
  const [ligas, setLigas] = useState<LigaForm[] | null>(null);
  const [regras, setRegras] = useState<RegraForm[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    void (async () => {
      const r = await api<{ ligas: (Liga & { ativo: boolean })[]; regras: RegraSobremetal[] }>("/api/comercial/peso-regras");
      if (!r.ok) { setErro(r.error); return; }
      setLigas(r.data.ligas.filter((l) => l.ativo !== false).map((l) => ({ id: l.id, nome: l.nome, densidade: String(l.densidade_g_cm3).replace(".", ","), padrao: Boolean(l.padrao) })));
      setRegras(r.data.regras.map((x) => ({ tipo_peca: x.tipo_peca as TipoPeca, liga_id: x.liga_id ?? "", mm_diametro: String(x.mm_diametro).replace(".", ","), mm_comprimento: String(x.mm_comprimento).replace(".", ",") })));
    })();
  }, []);

  const salvar = async () => {
    if (!ligas) return;
    setSalvando(true);
    const r = await api("/api/comercial/peso-regras", {
      method: "PUT",
      body: JSON.stringify({
        ligas: ligas.map((l) => ({ id: l.id, nome: l.nome, densidade_g_cm3: lerNumeroBr(l.densidade), padrao: l.padrao })),
        regras: regras.map((x) => ({ tipo_peca: x.tipo_peca, liga_id: x.liga_id || null, mm_diametro: lerNumeroBr(x.mm_diametro), mm_comprimento: lerNumeroBr(x.mm_comprimento) })),
      }),
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.error); return; }
    notify("Ligas e sobremetal gravados.");
    onFechar(true);
  };

  const mudarLiga = (k: number, p: Partial<LigaForm>) => setLigas((l) => l!.map((x, i) => (i === k ? { ...x, ...p } : p.padrao ? { ...x, padrao: false } : x)));
  const mudarRegra = (k: number, p: Partial<RegraForm>) => setRegras((l) => l.map((x, i) => (i === k ? { ...x, ...p } : x)));

  return (
    <Modal eyebrow="COMERCIAL · ORÇAMENTO" title="Ligas e sobremetal" subtitle="O peso do desenho 3D usa a densidade da liga e o sobremetal da peça. A regra da liga específica vence a de qualquer liga." onClose={() => onFechar(false)}>
      {erro && <Callout variant="danger" title="Não gravou">{erro}</Callout>}
      {!ligas ? <p className="fiscal-nota-ajuda">Carregando…</p> : (
        <>
          <h3 className="vnd-regras-titulo">Ligas</h3>
          <div className="vnd-tabela vnd-regras-ligas" role="table" aria-label="Ligas">
            <div className="cabeca" role="row"><span>Nome</span><span className="r">Densidade (g/cm³)</span><span>Padrão</span><span /></div>
            {ligas.map((l, k) => (
              <div role="row" key={l.id ?? `nova-${k}`}>
                <span><input aria-label="Nome da liga" value={l.nome} maxLength={60} onChange={(e) => mudarLiga(k, { nome: e.target.value })} /></span>
                <span className="r"><input aria-label="Densidade" inputMode="decimal" value={l.densidade} onChange={(e) => mudarLiga(k, { densidade: e.target.value })} /></span>
                <span><input type="radio" name="liga-padrao" aria-label={`${l.nome} é a padrão`} checked={l.padrao} onChange={() => mudarLiga(k, { padrao: true })} /></span>
                <span>{!l.id && <button type="button" className="almox-link almox-perigo" onClick={() => setLigas((x) => x!.filter((_, i) => i !== k))}>Tirar</button>}</span>
              </div>
            ))}
          </div>
          <Button variant="ghost" compact onClick={() => setLigas((l) => [...l!, { id: null, nome: "", densidade: "", padrao: false }])}>Adicionar liga</Button>

          <h3 className="vnd-regras-titulo">Sobremetal</h3>
          <p className="fiscal-nota-ajuda">Segue o contorno da peça: metade no raio de cada lado, metade em cada ponta. Peça sem regra não leva sobremetal. Liga nova: grave primeiro e depois crie a regra dela.</p>
          <div className="vnd-tabela vnd-regras-sobremetal" role="table" aria-label="Sobremetal">
            <div className="cabeca" role="row"><span>Peça</span><span>Liga</span><span className="r">Ø (mm)</span><span className="r">Compr. (mm)</span><span /></div>
            {regras.map((x, k) => (
              <div role="row" key={`${x.tipo_peca}-${x.liga_id}-${k}`}>
                <span><select aria-label="Peça" value={x.tipo_peca} onChange={(e) => mudarRegra(k, { tipo_peca: e.target.value as TipoPeca })}>{PECAS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}</select></span>
                <span><select aria-label="Liga" value={x.liga_id} onChange={(e) => mudarRegra(k, { liga_id: e.target.value })}>
                  <option value="">Qualquer liga</option>
                  {ligas.filter((l) => l.id).map((l) => <option key={l.id!} value={l.id!}>{l.nome}</option>)}
                </select></span>
                <span className="r"><input aria-label="Sobremetal no diâmetro" inputMode="decimal" value={x.mm_diametro} onChange={(e) => mudarRegra(k, { mm_diametro: e.target.value })} /></span>
                <span className="r"><input aria-label="Sobremetal no comprimento" inputMode="decimal" value={x.mm_comprimento} onChange={(e) => mudarRegra(k, { mm_comprimento: e.target.value })} /></span>
                <span><button type="button" className="almox-link almox-perigo" onClick={() => setRegras((l) => l.filter((_, i) => i !== k))}>Tirar</button></span>
              </div>
            ))}
          </div>
          <Button variant="ghost" compact onClick={() => setRegras((l) => [...l, { tipo_peca: "fundo", liga_id: "", mm_diametro: "2", mm_comprimento: "4" }])}>Adicionar regra</Button>
          <div className="vnd-regras-acoes">
            <Button variant="secondary" onClick={() => onFechar(false)}>Cancelar</Button>
            <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Gravando…" : "Gravar"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
