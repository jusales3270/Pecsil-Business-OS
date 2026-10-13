"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Carregando, Status } from "../../packages/design-system";
import { tipoDoArquivo, type TipoArquivo } from "../../lib/arquivos/detectar";
import { sha256Hex } from "../../lib/coleta/hash";
import type { SetorColeta } from "../../lib/coleta/modulos";
import { ROTULO_IGNORADO, classificar, combinar, ignorar, type MotivoIgnorado } from "../../lib/coleta/triagem";
import { classificarConteudo } from "../../lib/leitura/conteudo";
import { paginasPdfNavegador } from "../../lib/leitura/pdf-navegador";
import { lerTexto, type Leitura } from "../../lib/leitura/texto";
import { rotuloDoSetor } from "../../lib/documentos/setores";

/**
 * Coleta de arquivos dentro de um módulo (Segundo Cérebro, Etapa 2). Só para quem o proprietário
 * escolheu nos acessos do módulo ("Coletar arquivos"). A pessoa concede acesso a uma pasta no
 * Chrome/Edge; a plataforma lê a pasta NO PRÓPRIO COMPUTADOR e mostra a lista para conferir. Tudo
 * o que for enviado entra no setor deste módulo: o setor vem da credencial. Arquivo que parece de
 * outro setor vem desmarcado, com aviso. Documento de colaborador e arquivo pessoal não sobem.
 * O CONTEÚDO também é lido aqui (Etapa 3: PDF, Word, Excel, XML) e decide o setor quando a regra
 * é forte; o texto não sobe. Escaneado e foto são lidos depois de guardados (OCR no servidor).
 */

type Pasta = { name: string; kind: "directory"; values: () => AsyncIterable<Entrada> };
type ArquivoHandle = { name: string; kind: "file"; getFile: () => Promise<File> };
type Entrada = Pasta | ArquivoHandle;
type JanelaComPasta = Window & { showDirectoryPicker?: (o?: { mode?: "read"; id?: string; startIn?: string }) => Promise<Pasta> };

type Item = {
  id: string; caminho: string; pasta: string; nome: string; tamanho: number; arquivo: File; hash: string; tipo: TipoArquivo;
  /** Setor que a regra (ou o Clef) reconhece; null = sem setor claro. */
  setor: string | null; motivo: string; rh: boolean; pessoal: boolean; marcado: boolean;
  clef?: { setor: string; confianca: number | null; faixa: string | null; julgamentoId: string | null };
  envio?: "ok" | "repetido" | "erro";
};
type Contagem = { varridos: number; ignorados: Partial<Record<MotivoIgnorado, number>>; pastasPuladas: number; repetidos: number };
type Aceite = { id: string; profile_name: string | null; device_name: string; folder_name: string; accepted_at: string; revoked_at: string | null };
type Execucao = { id: string; consent_id: string; started_at: string; finished_at: string | null; scanned: number; ignored: number; duplicates: number; personal: number; rh: number; too_big: number; proposed: number; uploaded: number };
type Grupo = "deste" | "definir" | "outro" | "rh" | "pessoal";

const CHAVE_PC = "pecsil_coleta_computador";
const PRAZO_LEITURA_MS = 15_000;
/** Lê o texto do arquivo, com prazo: arquivo que demora demais fica só com a regra do nome. */
const lerComPrazo = (dados: Uint8Array) => Promise.race([
  lerTexto(dados, { pdf: paginasPdfNavegador }),
  new Promise<Leitura | null>((ok) => setTimeout(() => ok(null), PRAZO_LEITURA_MS)),
]);
const LIMITE_ARQUIVOS = 5000;
/** "do Financeiro", "da Fundição": Fundição e Produção são femininas. */
const FEMININOS = new Set(["fundicao", "producao"]);
const de = (m: string) => `${FEMININOS.has(m) ? "da" : "do"} ${rotuloDoSetor(m)}`;
const em = (m: string) => `${FEMININOS.has(m) ? "na" : "no"} ${rotuloDoSetor(m)}`;
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function lerComputador(): { id: string; nome: string } | null {
  try { const v = JSON.parse(localStorage.getItem(CHAVE_PC) ?? "null"); return v?.id && v?.nome ? v : null; } catch { return null; }
}

export function ColetaArquivosView({ notify, setor }: { notify: (msg: string) => void; setor: SetorColeta }) {
  const rotulo = rotuloDoSetor(setor);
  const doSetor = de(setor);
  const no = em(setor);
  const [suporte, setSuporte] = useState<boolean | null>(null);
  const [computador, setComputador] = useState<{ id: string; nome: string } | null>(null);
  // A janela de pastas do navegador pode demorar a abrir: avisa enquanto isso.
  const [abrindoPasta, setAbrindoPasta] = useState(false);
  const [nomePc, setNomePc] = useState("");
  const [etapa, setEtapa] = useState<"inicio" | "lendo" | "conferir" | "enviando" | "fim">("inicio");
  const [pastaNome, setPastaNome] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [contagem, setContagem] = useState<Contagem>({ varridos: 0, ignorados: {}, pastasPuladas: 0, repetidos: 0 });
  const [clefAviso, setClefAviso] = useState("");
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });
  const [leitura, setLeitura] = useState<{ feitos: number; total: number } | null>(null);
  const [historico, setHistorico] = useState<{ aceites: Aceite[]; coletas: Execucao[] } | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setSuporte(typeof (window as JanelaComPasta).showDirectoryPicker === "function" && !/Mobi|Android/i.test(navigator.userAgent));
      setComputador(lerComputador());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const carregarHistorico = useCallback(async () => {
    const r = await fetch(`/api/coleta/acessos?modulo=${setor}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setHistorico(await r.json());
    else if (r?.status === 403) setErro(`Você não tem "Coletar arquivos" ${no}. Peça ao proprietário.`);
  }, [setor, no]);
  useEffect(() => { const t = setTimeout(() => { void carregarHistorico(); }, 0); return () => clearTimeout(t); }, [carregarHistorico]);

  const salvarComputador = () => {
    const nome = nomePc.trim();
    if (nome.length < 2) return;
    const pc = { id: crypto.randomUUID(), nome };
    try { localStorage.setItem(CHAVE_PC, JSON.stringify(pc)); } catch { /* sem armazenamento local: vale só nesta sessão */ }
    setComputador(pc);
  };

  const json = async (url: string, corpo: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b?.error ?? "Falha na comunicação com o servidor.");
    return b;
  };

  const coletar = async () => {
    setErro(""); setClefAviso("");
    const escolher = (window as JanelaComPasta).showDirectoryPicker;
    if (!escolher || !computador) return;
    let raiz: Pasta;
    setAbrindoPasta(true);
    try { raiz = await escolher({ mode: "read", id: `pecsil-coleta-${setor}`, startIn: "documents" }); } catch { return; } // a pessoa cancelou
    finally { setAbrindoPasta(false); }
    try {
      const aceite = await json("/api/coleta/acessos", { modulo: setor, deviceId: computador.id, deviceName: computador.nome, folderName: raiz.name });
      const exec = await json("/api/coleta/execucoes", { aceiteId: aceite.id });
      setRunId(exec.id); setPastaNome(raiz.name); setEtapa("lendo"); setItens([]); setLeitura(null);
      const c: Contagem = { varridos: 0, ignorados: {}, pastasPuladas: 0, repetidos: 0 };
      const lista: Item[] = [];
      const vistos = new Set<string>();
      const percorrer = async (pasta: Pasta, caminho: string) => {
        for await (const entrada of pasta.values()) {
          if (c.varridos >= LIMITE_ARQUIVOS) return;
          const rel = caminho ? `${caminho}/${entrada.name}` : entrada.name;
          if (entrada.kind === "directory") {
            const motivo = ignorar(`${rel}/x`, "x", 0);
            if (motivo === "sistema" || motivo === "midia") { c.pastasPuladas++; continue; }
            await percorrer(entrada, rel);
            continue;
          }
          const arquivo = await entrada.getFile();
          c.varridos++;
          const motivo = ignorar(rel, entrada.name, arquivo.size);
          if (motivo) { c.ignorados[motivo] = (c.ignorados[motivo] ?? 0) + 1; continue; }
          const dados = new Uint8Array(await arquivo.arrayBuffer());
          const hash = await sha256Hex(dados);
          if (vistos.has(hash)) { c.repetidos++; continue; }
          vistos.add(hash);
          const tipo = tipoDoArquivo(dados);
          const k = classificar({ nome: entrada.name, pasta: caminho, tipo });
          lista.push({
            id: crypto.randomUUID(), caminho: rel, pasta: caminho || raiz.name, nome: entrada.name, tamanho: arquivo.size, arquivo, hash, tipo,
            setor: k.setor, motivo: k.motivo, rh: Boolean(k.rh), pessoal: Boolean(k.pessoal),
            // Só vem marcado o que a regra reconhece como deste setor.
            marcado: k.setor === setor && !k.rh && !k.pessoal,
          });
          if (c.varridos % 25 === 0) setContagem({ ...c, ignorados: { ...c.ignorados } });
        }
      };
      await percorrer(raiz, "");
      // Já guardados na plataforma (em qualquer setor) saem da lista; o servidor só responde sim/não.
      const existentes = new Set<string>();
      for (let i = 0; i < lista.length; i += 2000) {
        const r = await json("/api/coleta/conferir", { modulo: setor, hashes: lista.slice(i, i + 2000).map((x) => x.hash) });
        for (const h of r.existentes ?? []) existentes.add(h);
      }
      const novos = lista.filter((x) => !existentes.has(x.hash));
      c.repetidos += lista.length - novos.length;
      setContagem({ ...c, ignorados: { ...c.ignorados } });
      // Conteúdo (Etapa 3): lê o texto aqui mesmo e reclassifica. O texto não sobe.
      for (const [i, x] of novos.entries()) {
        setLeitura({ feitos: i, total: novos.length });
        if (x.rh || x.pessoal) continue;
        const l = await lerComPrazo(new Uint8Array(await x.arquivo.arrayBuffer()));
        if (l?.status === "lido") {
          const k = combinar({ setor: x.setor, confianca: x.setor ? "regra" : "duvida", motivo: x.motivo }, classificarConteudo(l.texto));
          Object.assign(x, { setor: k.setor, motivo: k.motivo, rh: Boolean(k.rh), marcado: k.setor === setor && !k.rh });
        } else if (l?.status === "sem_texto" && l.ocr) {
          x.motivo = `${x.motivo} · ${l.motivo}: o texto é lido depois de guardado`;
        }
      }
      setLeitura({ feitos: novos.length, total: novos.length });
      // Dúvida → Clef (só nome e pasta; só se o uso deste setor estiver ligado).
      const duvidas = novos.filter((x) => !x.setor && !x.rh && !x.pessoal);
      for (let i = 0; i < duvidas.length; i += 50) {
        const lote = duvidas.slice(i, i + 50);
        const r = await json("/api/coleta/classificar", { modulo: setor, itens: lote.map((x) => ({ id: x.id, nome: x.nome, pasta: x.pasta })) });
        if (r.status !== "ok") {
          setClefAviso(r.status === "desligado"
            ? `A triagem pelo Clef está desligada: confira os arquivos "Sem setor claro" e marque os que são ${doSetor}.`
            : `O Clef não está disponível agora: confira os arquivos "Sem setor claro" e marque os que são ${doSetor}.`);
          break;
        }
        for (const s of r.itens ?? []) {
          const x = novos.find((n) => n.id === s.id);
          if (!x || !s.setor) continue;
          x.clef = { setor: s.setor, confianca: s.confianca, faixa: s.faixa, julgamentoId: s.julgamentoId };
          if (s.setor === "pessoal") { x.pessoal = true; x.motivo = "o Clef achou que é pessoal"; continue; }
          x.setor = s.setor;
          x.marcado = s.setor === setor && s.faixa === "alta";
        }
      }
      if (c.varridos >= LIMITE_ARQUIVOS) setClefAviso((a) => `${a ? `${a} ` : ""}A pasta tem mais de ${LIMITE_ARQUIVOS} arquivos: foram lidos os primeiros ${LIMITE_ARQUIVOS}. Colete as subpastas separadamente.`);
      setItens(novos);
      setEtapa("conferir");
    } catch (e) {
      setErro((e as Error).message);
      setEtapa("inicio");
    }
  };

  const alterar = (id: string, mudanca: Partial<Item>) => setItens((lista) => lista.map((x) => (x.id === id ? { ...x, ...mudanca } : x)));
  const selecionados = itens.filter((x) => x.marcado && !x.rh && !x.pessoal);

  const enviar = async () => {
    setEtapa("enviando");
    setProgresso({ feitos: 0, total: selecionados.length });
    for (const [i, x] of selecionados.entries()) {
      const corpo = new FormData();
      corpo.set("modulo", setor);
      corpo.set("arquivo", x.arquivo);
      corpo.set("pasta", x.pasta);
      if (x.clef?.julgamentoId) { corpo.set("julgamentoId", x.clef.julgamentoId); corpo.set("setorSugerido", x.clef.setor); }
      const r = await fetch("/api/coleta/enviar", { method: "POST", body: corpo, cache: "no-store" }).catch(() => null);
      const b = await r?.json().catch(() => ({}));
      alterar(x.id, { envio: r?.ok ? (b?.existente ? "repetido" : "ok") : "erro" });
      setProgresso({ feitos: i + 1, total: selecionados.length });
    }
    if (runId) {
      await json(`/api/coleta/execucoes/${runId}/fim`, {
        scanned: contagem.varridos, ignored: Object.values(contagem.ignorados).reduce((s, n) => s + (n ?? 0), 0) - (contagem.ignorados.grande ?? 0) + contagem.pastasPuladas,
        duplicates: contagem.repetidos, personal: itens.filter((x) => x.pessoal).length, rh: itens.filter((x) => x.rh).length,
        too_big: contagem.ignorados.grande ?? 0, proposed: itens.length,
      }).catch(() => undefined);
    }
    setEtapa("fim");
    notify(`Coleta ${doSetor} concluída.`);
    await carregarHistorico();
  };

  const grupos = useMemo(() => {
    const ordem: Grupo[] = ["deste", "definir", "outro", "rh", "pessoal"];
    const g = new Map<Grupo, Item[]>();
    for (const x of itens) {
      const chave: Grupo = x.rh ? "rh" : x.pessoal ? "pessoal" : !x.setor ? "definir" : x.setor === setor ? "deste" : "outro";
      g.set(chave, [...(g.get(chave) ?? []), x]);
    }
    return ordem.filter((k) => g.has(k)).map((k) => ({ chave: k, itens: g.get(k)! }));
  }, [itens, setor]);
  const tituloGrupo: Record<Grupo, string> = {
    deste: `${maiuscula(doSetor)}`,
    definir: "Sem setor claro: marque os que são deste setor",
    outro: `Parecem de outro setor: se marcar, entram ${no}`,
    rh: "Do RH: não sobe pela coleta (envie em Recursos Humanos › Documentos)",
    pessoal: "Pessoal: não sobe",
  };

  if (erro && !historico) return <div className="coleta"><Cabecalho rotulo={rotulo} doSetor={doSetor} /><Callout variant="warning" title="Sem acesso à coleta">{erro}</Callout></div>;

  return (
    <div className="coleta">
      <Cabecalho rotulo={rotulo} doSetor={doSetor} />
      {suporte === false && <Callout variant="warning" title="Use o Chrome ou o Edge no computador">A coleta lê pastas do computador e só funciona no Chrome ou no Edge, no Windows. No celular e em outros navegadores ela não está disponível.</Callout>}

      {suporte && etapa === "inicio" && (
        <Card className="md-card">
          {!computador ? (
            <div className="coleta-passo">
              <h2>1. Dê um nome a este computador</h2>
              <p>Fica registrado em cada coleta, junto com quem aceitou e a pasta. Ex.: &ldquo;PC Ana – Financeiro&rdquo;.</p>
              <div className="coleta-linha">
                <input value={nomePc} onChange={(e) => setNomePc(e.target.value)} placeholder="Nome do computador" aria-label="Nome do computador" maxLength={80} />
                <Button onClick={salvarComputador} disabled={nomePc.trim().length < 2}>Salvar nome</Button>
              </div>
            </div>
          ) : (
            <div className="coleta-passo">
              <h2>2. Conceder acesso a uma pasta</h2>
              <p>Computador: <b>{computador.nome}</b>. Escolha a pasta para a plataforma ler. Sugestões: <b>Documentos</b>, <b>Área de trabalho</b>, <b>Downloads</b> e a <b>pasta da rede</b> {doSetor}.</p>
              <p className="coleta-nota">O navegador vai pedir permissão. A leitura acontece neste computador: nada sobe agora. O que você aprovar fica guardado nos documentos {doSetor}. Ficam de fora pastas de sistema e de programas, fotos, vídeos e músicas, arquivos compactados e os maiores que 9,5 MB. Documentos de colaborador e arquivos pessoais não sobem.</p>
              <Button className="coleta-botao" onClick={() => void coletar()} disabled={abrindoPasta} aria-busy={abrindoPasta}>
                {abrindoPasta ? <><Carregando /> Abrindo a janela de pastas…</> : <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                  Conceder acesso a uma pasta</>}
              </Button>
            </div>
          )}
          {erro && <p className="almox-erro" role="alert">{erro}</p>}
        </Card>
      )}

      {etapa === "lendo" && (
        <Card className="md-card"><div className="coleta-passo"><h2>Lendo &ldquo;{pastaNome}&rdquo; neste computador…</h2><p>{contagem.varridos} arquivos lidos · {Object.values(contagem.ignorados).reduce((s, n) => s + (n ?? 0), 0)} ignorados · {contagem.pastasPuladas} pastas puladas{leitura ? ` · lendo o conteúdo: ${leitura.feitos} de ${leitura.total}` : ""}</p></div></Card>
      )}

      {(etapa === "conferir" || etapa === "enviando" || etapa === "fim") && (
        <Card className="md-card">
          <div className="coleta-resumo">
            <h2>{etapa === "fim" ? "Coleta concluída" : `Conferir: ${pastaNome}`}</h2>
            <p>{contagem.varridos} lidos · {itens.length} para conferir · {contagem.repetidos} já estavam na plataforma · {contagem.pastasPuladas} pastas puladas · {Object.entries(contagem.ignorados).map(([m, n]) => `${n} ${ROTULO_IGNORADO[m as MotivoIgnorado]}`).join(" · ") || "nada ignorado"}</p>
            {clefAviso && <Callout variant="info" title="Conferir sem o Clef">{clefAviso}</Callout>}
          </div>
          {!itens.length && <div className="user-admin-empty"><b>Nada novo nesta pasta</b><small>Os arquivos já estavam na plataforma ou foram ignorados.</small></div>}
          {grupos.map((g) => (
            <section key={g.chave} className="coleta-grupo">
              <h3>{tituloGrupo[g.chave]} <small>({g.itens.length})</small></h3>
              {g.itens.map((x) => {
                const fora = x.rh || x.pessoal;
                return (
                  <div key={x.id} className={`coleta-item ${fora ? "fora" : ""}`}>
                    <label className="coleta-check"><input type="checkbox" checked={x.marcado && !fora} disabled={fora || etapa !== "conferir"} onChange={(e) => alterar(x.id, { marcado: e.target.checked })} aria-label={`Enviar ${x.nome}`} /></label>
                    <div className="coleta-nome"><b title={x.caminho}>{x.nome}</b>
                      <small>{x.pasta} · {Math.max(1, Math.round(x.tamanho / 1024))} KB · {g.chave === "outro" ? `parece ser ${de(x.setor!)} (${x.motivo})` : x.motivo}</small>
                      {x.clef && <span className="coleta-clef"><Status tone="info">Sugestão do Clef: {x.clef.setor === "pessoal" ? "pessoal" : rotuloDoSetor(x.clef.setor)}{x.clef.confianca !== null ? ` · ${Math.round(x.clef.confianca * 100)}%` : ""}</Status></span>}
                    </div>
                    <span className="coleta-envio">{x.envio === "ok" ? <Status tone="success">Guardado</Status> : x.envio === "repetido" ? <Status tone="neutral">Já estava</Status> : x.envio === "erro" ? <Status tone="danger">Falhou</Status> : null}</span>
                  </div>
                );
              })}
            </section>
          ))}
          <footer className="coleta-rodape">
            {etapa === "conferir" && <><Button variant="secondary" onClick={() => { setEtapa("inicio"); setItens([]); }}>Cancelar</Button><Button onClick={() => void enviar()} disabled={!selecionados.length}>Guardar {no} ({selecionados.length})</Button></>}
            {etapa === "enviando" && <span>Guardando {progresso.feitos} de {progresso.total}…</span>}
            {etapa === "fim" && <><span>{itens.filter((x) => x.envio === "ok").length} guardados · {itens.filter((x) => x.envio === "repetido").length} já estavam · {itens.filter((x) => x.envio === "erro").length} falharam. Para lançar os dados de extratos e notas, use &ldquo;Enviar extrato&rdquo; ou &ldquo;Enviar notas&rdquo; no módulo.</span><Button onClick={() => { setEtapa("inicio"); setItens([]); }}>Nova coleta</Button></>}
          </footer>
        </Card>
      )}

      {historico && (
        <Card className="md-card">
          <div className="coleta-passo"><h2>Acessos concedidos e coletas {doSetor}</h2><p>Cada aceite fica registrado. Revogar encerra o registro; a permissão do navegador termina quando a página é fechada.</p></div>
          {!historico.aceites.length && <p className="coleta-nota">Nenhum acesso concedido ainda.</p>}
          {historico.aceites.map((a) => {
            const execs = historico.coletas.filter((c) => c.consent_id === a.id);
            return (
              <div key={a.id} className="coleta-aceite">
                <div><b>{a.folder_name}</b><small>{a.device_name} · {a.profile_name ?? "—"} · {quando(a.accepted_at)}{a.revoked_at ? ` · revogado em ${quando(a.revoked_at)}` : ""}</small>
                  {execs.map((c) => <small key={c.id}>Coleta de {quando(c.started_at)}: {c.scanned} lidos · {c.uploaded} guardados · {c.duplicates} repetidos · {c.rh} do RH · {c.personal} pessoais</small>)}
                </div>
                {!a.revoked_at && <button type="button" className="doc-link perigo" onClick={async () => {
                  const r = await fetch(`/api/coleta/acessos/${a.id}/revogar`, { method: "POST" }).catch(() => null);
                  notify(r?.ok ? "Acesso revogado." : "Não foi possível revogar."); await carregarHistorico();
                }}>Revogar</button>}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Cabecalho({ rotulo, doSetor }: { rotulo: string; doSetor: string }) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{rotulo.toUpperCase()} · COLETA DE ARQUIVOS</p>
        <h1>Coletar arquivos</h1>
        <p>Encontre extratos, notas, contratos e planilhas {doSetor} esquecidos neste computador e guarde nos documentos do setor. A plataforma lê a pasta aqui mesmo e só envia o que você aprovar. O limite por arquivo é de 9,5 MB.</p>
      </div>
    </div>
  );
}
