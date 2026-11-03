"use client";

/* eslint-disable @next/next/no-img-element -- prévia local da foto enviada (dado em memória) */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Carregando, Modal, useEscolherArquivo } from "../../../packages/design-system";
import { reduzirFoto, type Foto } from "../../../lib/sara/foto-cliente";
import { CameraFoto } from "../../../app/components/camera-foto";

/**
 * Registrar não conformidade pela tela (pedido do proprietário, 03/11/2026): a janela padrão da plataforma
 * com câmera ou galeria. A SARA da Qualidade lê a foto, a pessoa conta por texto ou voz o que aconteceu,
 * onde e quando, e a SARA devolve o resumo no cartão. Só o Permitir grava. É a mesma conversa e a mesma
 * ação da SARA do painel: nada aqui grava por fora.
 */

type Cartao = { id: string; resumo: string; detalhes: string[]; situacao: string; feito: string | null; erro: string | null };
type Msg = { papel: "pessoa" | "sara"; texto: string; foto?: string; erro?: boolean; cartao?: Cartao };
type Resposta = { ok: boolean; body: { conversa?: string; texto?: string; acoes?: Cartao[]; error?: string; situacao?: string; feito?: string } | null };

const SARA = "/api/sara/qualidade";
const PRIMEIRA = "Quero registrar uma não conformidade com esta foto.";
const OUTRA = "Mais uma foto da mesma ocorrência.";

const Ico = ({ children }: { children: ReactNode }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>;
const IconeCamera = () => <Ico><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Ico>;
const IconeGaleria = () => <Ico><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></Ico>;
const IconeMicrofone = () => <Ico><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Ico>;
const IconeParar = () => <Ico><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></Ico>;

/** Texto da SARA sem a marcação de negrito e itálico (a janela mostra texto corrido). */
const limpo = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, "$1$2");

async function postar(url: string, corpo: unknown): Promise<Resposta> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) })
    .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
}

export function RegistrarNc({ onClose, onRegistrada }: { onClose: () => void; onRegistrada: (aviso: string) => void }) {
  const [conversa, setConversa] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [registrada, setRegistrada] = useState(false);
  const [gravando, setGravando] = useState<number | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState("");
  const [cameraAberta, setCameraAberta] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const gravador = useRef<{ rec: MediaRecorder; enviar: boolean; limite: ReturnType<typeof setTimeout> } | null>(null);
  const conversaRef = useRef<string | null>(null);
  const registradaRef = useRef(false);
  useEffect(() => { conversaRef.current = conversa; registradaRef.current = registrada; }, [conversa, registrada]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs, pensando]);

  const perguntar = async (pergunta: string, foto?: Foto, voz = false) => {
    if (pensando || registrada) return;
    setErro("");
    setMsgs((m) => [...m, { papel: "pessoa", texto: foto ? "" : pergunta, foto: foto?.previa }]);
    setPensando(true);
    const r = await postar(SARA, { pergunta, conversa, voz, imagem: foto ? { tipo: foto.tipo, dados: foto.dados } : null });
    setPensando(false);
    if (!r.ok || !r.body?.texto) { setMsgs((m) => [...m, { papel: "sara", texto: r.body?.error ?? "A SARA está indisponível agora. Tente de novo.", erro: true }]); return; }
    if (r.body.conversa) setConversa(r.body.conversa);
    const cartao = r.body.acoes?.find((a) => a.situacao === "pendente");
    setMsgs((m) => [...m, { papel: "sara", texto: limpo(r.body?.texto ?? ""), cartao }]);
  };

  const comFoto = async (arquivos: File[]) => {
    const f = arquivos.find((a) => a.type.startsWith("image/"));
    if (!f) { setErro("Escolha uma imagem (foto)."); return; }
    setPreparando(true);
    let foto: Foto | null = null;
    try { foto = await reduzirFoto(f); } catch { setErro("Não foi possível ler esta imagem. Tente outra."); }
    setPreparando(false);
    if (foto) await perguntar(msgs.some((m) => m.foto) ? OUTRA : PRIMEIRA, foto);
  };
  const camera = useEscolherArquivo((a) => void comFoto(a));
  const galeria = useEscolherArquivo((a) => void comFoto(a));
  // A câmera abre dentro da janela (computador e celular). Sem câmera pela página (ex.: endereço sem HTTPS), o campo
  // com capture ainda abre a câmera no celular.
  const abrirCamera = () => { setErro(""); if (typeof navigator.mediaDevices?.getUserMedia === "function") setCameraAberta(true); else camera.abrir(); };
  const fotoDaCamera = (f: File) => { setCameraAberta(false); void comFoto([f]); };

  const decidir = async (c: Cartao, permitir: boolean) => {
    setDecidindo(c.id);
    const r = await postar(`${SARA}/acoes/${c.id}`, { permitir });
    setDecidindo(null);
    const situacao = r.body?.situacao ?? (r.ok ? "" : "falhou");
    setMsgs((m) => m.map((x) => (x.cartao?.id === c.id ? { ...x, cartao: { ...c, situacao, feito: r.body?.feito ?? null, erro: r.ok ? null : r.body?.error ?? "Sem conexão." } } : x)));
    if (situacao === "executada") { setRegistrada(true); onRegistrada(String(r.body?.feito ?? "Não conformidade registrada.")); return; }
    if (situacao === "recusada") setMsgs((m) => [...m, { papel: "sara", texto: "Nada foi registrado. Diga o que corrigir." }]);
    else if (situacao === "expirada") setMsgs((m) => [...m, { papel: "sara", texto: "O resumo venceu e nada foi registrado. Confirme de novo o relato." }]);
    else if (situacao === "falhou") setMsgs((m) => [...m, { papel: "sara", texto: String(r.body?.texto ?? r.body?.error ?? "Não foi registrado."), erro: true }]);
  };

  const pararGravacao = (enviar: boolean) => {
    const g = gravador.current;
    if (!g) return;
    g.enviar = enviar; clearTimeout(g.limite);
    if (g.rec.state !== "inactive") g.rec.stop();
  };
  const falar = async () => {
    if (gravando) { pararGravacao(true); return; }
    setErro("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setErro("Este aparelho não grava áudio no navegador. Escreva o relato."); return; }
    let fluxo: MediaStream;
    try { fluxo = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setErro("Não foi possível usar o microfone. Libere o microfone para a plataforma nas permissões do navegador."); return; }
    const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t));
    const rec = new MediaRecorder(fluxo, tipo ? { mimeType: tipo } : undefined);
    const partes: Blob[] = [];
    const g = { rec, enviar: false, limite: setTimeout(() => pararGravacao(true), 60_000) };
    gravador.current = g;
    rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
    rec.onstop = async () => {
      fluxo.getTracks().forEach((t) => t.stop());
      gravador.current = null; setGravando(null);
      if (!g.enviar) return;
      const audio = new Blob(partes, { type: (rec.mimeType || tipo || "audio/webm").split(";")[0] });
      setOuvindo(true);
      const r = await fetch(`${SARA}/voz`, { method: "POST", headers: { "content-type": audio.type }, body: audio })
        .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
      setOuvindo(false);
      if (!r.ok || !r.body?.texto) { setErro(r.body?.error ?? "Sem conexão com o servidor."); return; }
      void perguntar(String(r.body.texto), undefined, true);
    };
    rec.start(500);
    setSegundos(0); setGravando(Date.now());
  };
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos(Math.round((Date.now() - gravando) / 1000)), 500);
    return () => clearInterval(t);
  }, [gravando]);
  // Fechou sem registrar: o microfone desliga e as fotos mandadas nesta janela são descartadas.
  useEffect(() => () => {
    pararGravacao(false);
    if (conversaRef.current && !registradaRef.current) void postar("/api/qualidade/fotos/descartar", { conversa: conversaRef.current });
  }, []);

  const enviar = () => { const t = texto.trim(); if (t.length < 2) return; setTexto(""); void perguntar(t); };
  const ocupado = pensando || preparando || ouvindo || Boolean(gravando);
  const comecou = msgs.length > 0;

  return (
    <Modal eyebrow="QUALIDADE" title="Registrar não conformidade" subtitle="Tire ou escolha a foto; depois conte o que aconteceu, onde e quando. Nada é gravado sem a sua confirmação." onClose={onClose}>
      <input {...camera.inputProps} accept="image/*" capture="environment" />
      <input {...galeria.inputProps} accept="image/*" />
      <div className="qualidade-registro">
        {cameraAberta && <CameraFoto onFoto={fotoDaCamera} onFechar={() => setCameraAberta(false)} onEscolher={() => { setCameraAberta(false); camera.abrir(); }} />}
        {!comecou && !cameraAberta && (
          <div className="qualidade-captura">
            <button type="button" onClick={abrirCamera} disabled={ocupado}>{camera.abrindo ? <Carregando tamanho={22} /> : <IconeCamera />}<b>Tirar foto</b><small>Abre a câmera</small></button>
            <button type="button" onClick={galeria.abrir} disabled={ocupado}>{galeria.abrindo ? <Carregando tamanho={22} /> : <IconeGaleria />}<b>Escolher foto</b><small>Da galeria ou do computador</small></button>
          </div>
        )}
        {comecou && (
          <div className="qualidade-conversa" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={`qualidade-msg ${m.papel}${m.erro ? " erro" : ""}`}>
                {m.foto && <img src={m.foto} alt="Foto enviada" />}
                {m.texto && <p>{m.texto}</p>}
                {m.cartao && (
                  <div className={`sara-acao ${m.cartao.situacao}`} role="group" aria-label="Resumo do registro">
                    <span className="sara-acao-titulo">{m.cartao.situacao === "pendente" ? "Confira o que será registrado" : m.cartao.situacao === "executada" ? "Registrado" : m.cartao.situacao === "recusada" ? "Não registrado" : m.cartao.situacao}</span>
                    <b>{m.cartao.resumo}</b>
                    {m.cartao.detalhes.length > 0 && <ul>{m.cartao.detalhes.map((d, k) => <li key={k}>{d}</li>)}</ul>}
                    {m.cartao.situacao === "pendente" && (
                      <div className="sara-acao-botoes">
                        <button type="button" className="nao" disabled={decidindo === m.cartao.id} onClick={() => m.cartao && void decidir(m.cartao, false)}>Não permitir</button>
                        <button type="button" className="sim" disabled={decidindo === m.cartao.id} onClick={() => m.cartao && void decidir(m.cartao, true)}>{decidindo === m.cartao.id ? "Registrando…" : "Permitir"}</button>
                      </div>
                    )}
                    {m.cartao.feito && <small className="sara-acao-feito">{m.cartao.feito}</small>}
                    {m.cartao.erro && <small className="sara-acao-erro">{m.cartao.erro}</small>}
                  </div>
                )}
              </div>
            ))}
            {(pensando || preparando || ouvindo) && <div className="qualidade-msg sara pensando"><Carregando /> {preparando ? "Preparando a foto…" : ouvindo ? "Ouvindo…" : "A SARA está analisando…"}</div>}
            <div ref={fim} />
          </div>
        )}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        {comecou && !registrada && !cameraAberta && (
          <form className={`qualidade-relato${gravando ? " gravando" : ""}`} onSubmit={(e) => { e.preventDefault(); enviar(); }}>
            <button type="button" className="qualidade-icone" onClick={abrirCamera} disabled={ocupado} aria-label="Tirar mais uma foto" title="Tirar mais uma foto"><IconeCamera /></button>
            <button type="button" className="qualidade-icone" onClick={galeria.abrir} disabled={ocupado} aria-label="Escolher mais uma foto" title="Escolher mais uma foto"><IconeGaleria /></button>
            {gravando
              ? <span className="qualidade-gravando" aria-live="polite"><span className="sara-rec" aria-hidden /> Gravando {`0:${String(segundos).padStart(2, "0")}`}</span>
              : <textarea rows={2} value={texto} maxLength={2000} disabled={pensando} placeholder="O que aconteceu, onde e quando…" aria-label="Relato do ocorrido"
                  onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} />}
            <button type="button" className={`qualidade-icone${gravando ? " ativo" : ""}`} onClick={() => void falar()} disabled={pensando || ouvindo}
              aria-pressed={Boolean(gravando)} aria-label={gravando ? "Parar e enviar o áudio" : "Falar"} title={gravando ? "Parar e enviar" : "Falar"}>
              {gravando ? <IconeParar /> : <IconeMicrofone />}
            </button>
            {!gravando && <Button type="submit" disabled={ocupado || texto.trim().length < 2}>Enviar</Button>}
          </form>
        )}
        {registrada && <footer><Button onClick={onClose}>Fechar</Button></footer>}
      </div>
    </Modal>
  );
}
