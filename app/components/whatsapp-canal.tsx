"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";

/**
 * Fundação › WhatsApp (PLANO-WHATSAPP, W1): o canal da plataforma pelo chip interno (Evolution API, WhatsApp
 * Web). Só o proprietário. Mostra a situação, o QR Code para conectar (renovado sozinho enquanto espera a
 * leitura), a mensagem de teste e o desconectar. Regras de uso do chip ficam à vista: só a equipe interna,
 * pouco volume, sem disparo em massa (risco de banimento do número).
 */
type Estado = "sem_configuracao" | "fora_do_ar" | "sem_instancia" | "desconectado" | "aguardando_qr" | "conectado";
type Situacao = { estado: Estado; numero: string | null; nome: string | null; detalhe?: string };

const ROTULO: Record<Estado, [string, "success" | "attention" | "danger" | "neutral"]> = {
  conectado: ["Conectado", "success"],
  aguardando_qr: ["Esperando a leitura do QR Code", "attention"],
  desconectado: ["Desconectado", "attention"],
  sem_instancia: ["Ainda não conectado", "neutral"],
  fora_do_ar: ["Evolution sem resposta", "danger"],
  sem_configuracao: ["Sem configuração no servidor", "danger"],
};

async function chamar(corpo?: Record<string, unknown>) {
  const r = await fetch("/api/foundation/whatsapp", corpo
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }
    : { cache: "no-store" });
  return { ok: r.ok, d: await r.json().catch(() => ({})) };
}

export function WhatsappCanal({ notify }: { notify: (m: string) => void }) {
  const [s, setS] = useState<Situacao | null>(null);
  const [erro, setErro] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [numero, setNumero] = useState("");
  const [texto, setTexto] = useState("");
  const [confirmar, setConfirmar] = useState(false);

  const carregar = useCallback(async () => {
    const { ok, d } = await chamar();
    if (!ok) { setErro(d.error || "Não foi possível ler o canal."); return null; }
    setErro(""); setS(d as Situacao);
    return d as Situacao;
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const conectar = useCallback(async () => {
    setOcupado(true);
    const { ok, d } = await chamar({ acao: "conectar" });
    setOcupado(false);
    if (!ok) { notify(d.error || "Não foi possível pedir o QR Code."); return; }
    if (d.conectado) { setQr(null); void carregar(); return; }
    setQr(d.qr ?? null);
    void carregar();
  }, [carregar, notify]);

  // Com o QR na tela: confere a conexão a cada 4 s e renova o QR a cada 25 s (ele vence em ~30 s).
  useEffect(() => {
    if (!qr) return;
    const olhar = setInterval(() => { void carregar().then((x) => { if (x?.estado === "conectado") { setQr(null); notify("Chip conectado."); } }); }, 4000);
    const renovar = setInterval(() => { void conectar(); }, 25_000);
    return () => { clearInterval(olhar); clearInterval(renovar); };
  }, [qr, carregar, conectar, notify]);

  const testar = async () => {
    setOcupado(true);
    const { ok, d } = await chamar({ acao: "teste", numero, texto });
    setOcupado(false);
    notify(ok ? "Mensagem de teste enviada." : d.error || "Não foi possível enviar.");
  };
  const sair = async () => {
    setOcupado(true); setConfirmar(false);
    const { ok, d } = await chamar({ acao: "desconectar" });
    setOcupado(false);
    notify(ok ? "Chip desconectado da plataforma." : d.error || "Não foi possível desconectar.");
    void carregar();
  };

  if (erro) return <Callout variant="warning" title="WhatsApp">{erro}</Callout>;
  if (!s) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;
  const [rotulo, tom] = ROTULO[s.estado];
  const podeConectar = ["sem_instancia", "desconectado", "aguardando_qr"].includes(s.estado);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">CANAL DA PLATAFORMA</p>
          <h1>WhatsApp</h1>
          <p>O chip interno da PecSil, pela Evolution API no nosso servidor. Por ele saem os alertas para a equipe e, nas próximas etapas, a conversa com a SARA.</p>
        </div>
        <div className="icms-acoes"><Button type="button" variant="secondary" onClick={() => void carregar()} disabled={ocupado}>Atualizar</Button></div>
      </div>

      <section className="wa-canal" aria-label="Chip interno">
        <header>
          <div>
            <h2>Chip interno</h2>
            <small>{s.estado === "conectado" ? `${s.numero ?? "número não informado"}${s.nome ? ` · ${s.nome}` : ""}` : s.detalhe ?? "WhatsApp Web, ligado à plataforma como um aparelho conectado."}</small>
          </div>
          <Status tone={tom}>{rotulo}</Status>
        </header>

        {podeConectar && !qr && (
          <div className="wa-acoes"><Button type="button" onClick={() => void conectar()} disabled={ocupado}>{ocupado ? "Pedindo o QR Code…" : "Conectar o chip"}</Button></div>
        )}
        {qr && (
          <div className="wa-qr">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URL, gerado pela Evolution e renovado a cada 25 s */}
            <img src={qr} alt="QR Code para conectar o chip interno ao WhatsApp da plataforma" />
            <ol>
              <li>No celular com o chip interno, abra o <b>WhatsApp</b>.</li>
              <li>Toque em <b>Configurações</b> (ou nos três pontos) › <b>Aparelhos conectados</b> › <b>Conectar um aparelho</b>.</li>
              <li>Aponte a câmera para este QR Code. Ele se renova sozinho a cada 25 segundos.</li>
            </ol>
            <Button type="button" variant="secondary" onClick={() => setQr(null)}>Cancelar</Button>
          </div>
        )}

        {s.estado === "conectado" && (
          <>
            <form className="wa-teste" onSubmit={(e) => { e.preventDefault(); void testar(); }}>
              <b>Mensagem de teste</b>
              <label>Número com DDD<input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="tel" placeholder="15 99662-2530" /></label>
              <label>Mensagem<input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} placeholder="Teste do canal de WhatsApp do PecSil Business OS." /></label>
              <Button type="submit" disabled={ocupado || numero.replace(/\D/g, "").length < 10}>{ocupado ? "Enviando…" : "Enviar teste"}</Button>
            </form>
            <div className="wa-acoes">
              {!confirmar
                ? <Button type="button" variant="secondary" onClick={() => setConfirmar(true)} disabled={ocupado}>Desconectar o chip</Button>
                : <><small>A plataforma deixa de enviar e receber pelo WhatsApp até alguém ler um QR Code de novo.</small>
                  <Button type="button" variant="secondary" onClick={() => setConfirmar(false)}>Cancelar</Button>
                  <Button type="button" onClick={() => void sair()}>Confirmar desconexão</Button></>}
            </div>
          </>
        )}
      </section>

      <Callout variant="info" title="Como usar o chip interno">
        Só com gente da empresa que aceitou receber, em volume baixo e sem disparo em massa: o WhatsApp Web automatizado não é oficial e o número pode ser bloqueado. Mensagens para fornecedores e clientes vão por um número na API oficial da Meta, numa etapa seguinte.
      </Callout>
    </>
  );
}
