"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";
import { WhatsappListas } from "./whatsapp-listas";

/**
 * Fundação › WhatsApp (PLANO-WHATSAPP): os números da plataforma. Cada número (canal) tem nome, departamento,
 * a descrição do que atende e a SARA responsável; é uma instância da Evolution, conectada pelo QR Code
 * (WhatsApp Web) ou, numa etapa seguinte, pela API oficial da Meta. Dentro de cada número, as listas de quem
 * fala com ele (interna e externa). Só o proprietário.
 */
type Estado = "sem_configuracao" | "fora_do_ar" | "sem_instancia" | "desconectado" | "aguardando_qr" | "conectado" | "api_oficial";
type Situacao = { estado: Estado; numero: string | null; nome: string | null; detalhe?: string };
type Sara = { modulo: string; rotulo: string };
type Canal = { id: string; instancia: string; nome: string; departamento: string | null; descricao: string | null; sara: Sara | null; sara_modulo: string | null; conexao: "whatsapp_web" | "api_oficial"; ativo: boolean; situacao: Situacao };
type Dados = { canais: Canal[]; saras: Sara[]; configurada: boolean };
type FormCanal = { id?: string; nome: string; departamento: string; descricao: string; sara_modulo: string; conexao: "whatsapp_web" | "api_oficial" };

const ROTULO: Record<Estado, [string, "success" | "attention" | "danger" | "neutral" | "info"]> = {
  conectado: ["Conectado", "success"],
  aguardando_qr: ["Esperando a leitura do QR Code", "attention"],
  desconectado: ["Desconectado", "attention"],
  sem_instancia: ["Ainda não conectado", "neutral"],
  fora_do_ar: ["Evolution sem resposta", "danger"],
  sem_configuracao: ["Sem configuração no servidor", "danger"],
  api_oficial: ["API oficial (etapa seguinte)", "info"],
};
const DEPARTAMENTOS = ["Comunicação interna", "Comercial", "Atendimento a clientes", "Compras", "Fiscal", "Financeiro", "RH", "Produção", "Fundição", "Almoxarifado", "TI", "Portaria"];
const VAZIO: FormCanal = { nome: "", departamento: "", descricao: "", sara_modulo: "", conexao: "whatsapp_web" };

async function chamar(corpo?: Record<string, unknown>) {
  const r = await fetch("/api/foundation/whatsapp", corpo
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }
    : { cache: "no-store" });
  return { ok: r.ok, d: await r.json().catch(() => ({})) };
}

export function WhatsappCanal({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState<FormCanal | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const { ok, d } = await chamar();
    if (!ok) { setErro(d.error || "Não foi possível ler os números."); return null; }
    setErro(""); setDados(d as Dados);
    return d as Dados;
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const salvar = async () => {
    if (!form) return;
    setOcupado(true);
    const { ok, d } = await chamar({ acao: "salvar_canal", canal: form.id ?? null, ...form });
    setOcupado(false);
    if (!ok) { notify(d.error || "Não foi possível salvar."); return; }
    notify(form.id ? "Número alterado." : "Número incluído. Agora conecte o chip pelo QR Code.");
    setForm(null);
    void carregar();
  };

  if (erro) return <Callout variant="warning" title="WhatsApp">{erro}</Callout>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">CANAIS DA PLATAFORMA</p>
          <h1>WhatsApp</h1>
          <p>Os números de WhatsApp da Pecsil, cada um com o departamento que atende e a SARA responsável. Dentro de cada número, as listas de quem pode falar com ele.</p>
        </div>
        <div className="icms-acoes">
          <Button type="button" variant="secondary" onClick={() => void carregar()} disabled={ocupado}>Atualizar</Button>
          {!form && <Button type="button" onClick={() => setForm({ ...VAZIO })}>Adicionar número</Button>}
        </div>
      </div>

      {form && <FormularioCanal form={form} saras={dados.saras} ocupado={ocupado} mudar={(c) => setForm((f) => (f ? { ...f, ...c } : f))} salvar={() => void salvar()} cancelar={() => setForm(null)} />}

      {!dados.canais.length
        ? <div className="finance-empty almox-vazio"><b>Nenhum número cadastrado</b><small>Adicione o primeiro número e conecte o chip pelo QR Code.</small></div>
        : dados.canais.map((c) => (
          <CartaoCanal key={c.id} canal={c} notify={notify} recarregar={carregar} editar={() => setForm({ id: c.id, nome: c.nome, departamento: c.departamento ?? "", descricao: c.descricao ?? "", sara_modulo: c.sara_modulo ?? "", conexao: c.conexao })} />
        ))}

      <Callout variant="info" title="Como usar os números pelo QR Code">
        Cada número conectado pelo QR Code é um WhatsApp Web automatizado: use com quem aceitou receber, em volume baixo e sem disparo em massa, porque o WhatsApp não é oficial nesse modo e o número pode ser bloqueado. Para falar com muitos fornecedores e clientes, o caminho é um número na API oficial da Meta, numa etapa seguinte.
      </Callout>
    </>
  );
}

function FormularioCanal({ form, saras, ocupado, mudar, salvar, cancelar }: { form: FormCanal; saras: Sara[]; ocupado: boolean; mudar: (c: Partial<FormCanal>) => void; salvar: () => void; cancelar: () => void }) {
  return (
    <form className="wa-form wa-form-canal" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
      <b>{form.id ? "Alterar número" : "Novo número da plataforma"}</b>
      <label>Nome<input value={form.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={60} placeholder="Ex.: Comercial, Atendimento a clientes" required /></label>
      <label>Departamento
        <input value={form.departamento} onChange={(e) => mudar({ departamento: e.target.value })} maxLength={60} list="wa-departamentos" placeholder="A qual departamento se destina" />
        <datalist id="wa-departamentos">{DEPARTAMENTOS.map((d) => <option key={d} value={d} />)}</datalist>
      </label>
      <label>SARA responsável
        <select value={form.sara_modulo} onChange={(e) => mudar({ sara_modulo: e.target.value })}>
          <option value="">Escolha…</option>
          {saras.map((s) => <option key={s.modulo} value={s.modulo}>{s.rotulo}</option>)}
        </select>
      </label>
      {!form.id && (
        <label>Conexão
          <select value={form.conexao} onChange={(e) => mudar({ conexao: e.target.value as FormCanal["conexao"] })}>
            <option value="whatsapp_web">Chip pelo QR Code (WhatsApp Web)</option>
            <option value="api_oficial" disabled>API oficial da Meta (etapa seguinte)</option>
          </select>
        </label>
      )}
      <label className="wa-obs">Descrição<textarea value={form.descricao} onChange={(e) => mudar({ descricao: e.target.value })} maxLength={400} rows={2} placeholder="Para que serve este número e quem ele atende" /></label>
      <div className="wa-acoes">
        <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
        <Button type="submit" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</Button>
      </div>
    </form>
  );
}

function CartaoCanal({ canal, notify, recarregar, editar }: { canal: Canal; notify: (m: string) => void; recarregar: () => Promise<Dados | null>; editar: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [numero, setNumero] = useState("");
  const [texto, setTexto] = useState("");
  const [confirmar, setConfirmar] = useState<"desconectar" | "remover" | null>(null);
  const [verListas, setVerListas] = useState(false);
  const s = canal.situacao;

  const acao = useCallback(async (corpo: Record<string, unknown>) => chamar({ canal: canal.id, ...corpo }), [canal.id]);
  const conectar = useCallback(async () => {
    setOcupado(true);
    const { ok, d } = await acao({ acao: "conectar" });
    setOcupado(false);
    if (!ok) { notify(d.error || "Não foi possível pedir o QR Code."); return; }
    if (d.conectado) { setQr(null); void recarregar(); return; }
    setQr(d.qr ?? null);
  }, [acao, notify, recarregar]);

  // Com o QR na tela: confere a conexão a cada 4 s e renova o QR a cada 25 s (ele vence em ~30 s).
  useEffect(() => {
    if (!qr) return;
    const olhar = setInterval(() => {
      void recarregar().then((x) => {
        const agora = x?.canais.find((c) => c.id === canal.id)?.situacao;
        if (agora?.estado === "conectado") { setQr(null); notify(`${canal.nome}: chip conectado.`); }
      });
    }, 4000);
    const renovar = setInterval(() => { void conectar(); }, 25_000);
    return () => { clearInterval(olhar); clearInterval(renovar); };
  }, [qr, recarregar, conectar, notify, canal.id, canal.nome]);

  const simples = async (corpo: Record<string, unknown>, feito: string) => {
    setOcupado(true); setConfirmar(null);
    const { ok, d } = await acao(corpo);
    setOcupado(false);
    notify(ok ? feito : d.error || "Não foi possível.");
    if (ok) void recarregar();
  };
  const testar = async () => {
    setOcupado(true);
    const { ok, d } = await acao({ acao: "teste", numero, texto });
    setOcupado(false);
    notify(ok ? "Mensagem de teste enviada." : d.error || "Não foi possível enviar.");
  };

  const [rotulo, tom] = ROTULO[s.estado];
  const web = canal.conexao === "whatsapp_web";
  const podeConectar = web && canal.ativo && ["sem_instancia", "desconectado", "aguardando_qr"].includes(s.estado);

  return (
    <section className={`wa-canal${canal.ativo ? "" : " inativo"}`} aria-label={`WhatsApp ${canal.nome}`}>
      <header>
        <div>
          <h2>{canal.nome}{canal.departamento ? <small className="wa-depto"> · {canal.departamento}</small> : null}</h2>
          <small>{s.estado === "conectado" ? `${s.numero ?? "número não informado"}${s.nome ? ` · ${s.nome}` : ""}` : s.detalhe ?? (web ? "Chip pelo QR Code (WhatsApp Web)." : "API oficial da Meta.")}</small>
          <p className="wa-canal-info">
            <span><b>SARA responsável:</b> {canal.sara?.rotulo ?? <em className="wa-falta">nenhuma: este número não responde ninguém</em>}</span>
            {canal.descricao && <span>{canal.descricao}</span>}
          </p>
        </div>
        <div className="wa-canal-estado">
          {!canal.ativo && <Status tone="neutral">Desativado</Status>}
          <Status tone={tom}>{rotulo}</Status>
        </div>
      </header>

      <div className="wa-acoes">
        {podeConectar && !qr && <Button type="button" onClick={() => void conectar()} disabled={ocupado}>{ocupado ? "Pedindo o QR Code…" : "Conectar o chip"}</Button>}
        <Button type="button" variant="secondary" onClick={editar}>Alterar</Button>
        <Button type="button" variant="secondary" onClick={() => setVerListas((v) => !v)} aria-expanded={verListas}>{verListas ? "Esconder quem fala com este número" : "Quem fala com este número"}</Button>
        <Button type="button" variant="ghost" onClick={() => void simples({ acao: canal.ativo ? "desativar" : "ativar" }, canal.ativo ? "Número desativado." : "Número ativado.")} disabled={ocupado}>{canal.ativo ? "Desativar" : "Ativar"}</Button>
        {s.estado === "conectado" && confirmar !== "desconectar" && <Button type="button" variant="ghost" onClick={() => setConfirmar("desconectar")} disabled={ocupado}>Desconectar o chip</Button>}
        {confirmar !== "remover" && <Button type="button" variant="ghost" onClick={() => setConfirmar("remover")} disabled={ocupado}>Remover</Button>}
      </div>
      {confirmar && (
        <div className="wa-acoes wa-confirmar">
          <small>{confirmar === "desconectar"
            ? "A plataforma deixa de enviar e receber por este número até alguém ler um QR Code de novo."
            : "O número sai da plataforma: o chip é desconectado e as listas dele são apagadas. Isso não se desfaz."}</small>
          <Button type="button" variant="secondary" onClick={() => setConfirmar(null)}>Cancelar</Button>
          <Button type="button" onClick={() => void simples({ acao: confirmar }, confirmar === "desconectar" ? "Chip desconectado." : "Número removido.")}>{confirmar === "desconectar" ? "Confirmar desconexão" : "Confirmar remoção"}</Button>
        </div>
      )}

      {qr && (
        <div className="wa-qr">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URL, gerado pela Evolution e renovado a cada 25 s */}
          <img src={qr} alt={`QR Code para conectar o chip do WhatsApp ${canal.nome}`} />
          <ol>
            <li>No celular com o chip de <b>{canal.nome}</b>, abra o <b>WhatsApp</b>.</li>
            <li>Toque em <b>Configurações</b> (ou nos três pontos) › <b>Aparelhos conectados</b> › <b>Conectar um aparelho</b>.</li>
            <li>Aponte a câmera para este QR Code. Ele se renova sozinho a cada 25 segundos.</li>
          </ol>
          <Button type="button" variant="secondary" onClick={() => setQr(null)}>Cancelar</Button>
        </div>
      )}

      {s.estado === "conectado" && (
        <form className="wa-teste" onSubmit={(e) => { e.preventDefault(); void testar(); }}>
          <b>Mensagem de teste</b>
          <label>Número com DDD<input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="tel" placeholder="15 91234-5678" /></label>
          <label>Mensagem<input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} placeholder={`Teste do WhatsApp "${canal.nome}" do Pecsil Business OS.`} /></label>
          <Button type="submit" disabled={ocupado || numero.replace(/\D/g, "").length < 10}>{ocupado ? "Enviando…" : "Enviar teste"}</Button>
        </form>
      )}

      {verListas && <WhatsappListas notify={notify} canal={{ id: canal.id, nome: canal.nome, sara: canal.sara, conectado: s.estado === "conectado" && web }} />}
    </section>
  );
}
