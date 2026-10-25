"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";
import { WhatsappListas } from "./whatsapp-listas";

/**
 * Fundação › WhatsApp (PLANO-WHATSAPP): os números da plataforma. Cada número (canal) tem nome, departamento,
 * descrição, o comportamento da SARA ali (prompt de sistema; complementa a SARA) e o modelo; é uma instância da
 * Evolution, conectada pelo QR Code (WhatsApp Web, sem API oficial: decisão do proprietário, 24/10/2026). Dentro
 * de cada número, a allowlist: só quem está nela fala com ele, cada pessoa com a sua SARA. Só o proprietário.
 */
type Estado = "sem_configuracao" | "fora_do_ar" | "sem_instancia" | "desconectado" | "aguardando_qr" | "conectado" | "api_oficial";
type Situacao = { estado: Estado; numero: string | null; nome: string | null; detalhe?: string };
type Modelo = { provedor: string; id: string; rotulo: string; nota: string };
type Movimento = { respondidas: number; ignoradas: number; fora_da_lista: number; falhas: number };
type Canal = { id: string; instancia: string; nome: string; departamento: string | null; descricao: string | null; prompt: string | null; modelo: string | null; conexao: "whatsapp_web" | "api_oficial"; ativo: boolean; situacao: Situacao;
  recebimento: { ligado: boolean; erro?: string } | null; movimento: Movimento };
type Agendado = { id: string; para_nome: string; quando: string; texto: string | null; documentos: number; situacao: string; tentativas: number; erro: string | null; enviado_em: string | null };
type Dados = { canais: Canal[]; modelos: Modelo[]; configurada: boolean; agendados?: Agendado[] };
type FormCanal = { id?: string; nome: string; departamento: string; descricao: string; prompt: string; modelo: string; conexao: "whatsapp_web" | "api_oficial" };

const ROTULO: Record<Estado, [string, "success" | "attention" | "danger" | "neutral" | "info"]> = {
  conectado: ["Conectado", "success"],
  aguardando_qr: ["Esperando a leitura do QR Code", "attention"],
  desconectado: ["Desconectado", "attention"],
  sem_instancia: ["Ainda não conectado", "neutral"],
  fora_do_ar: ["Evolution sem resposta", "danger"],
  sem_configuracao: ["Sem configuração no servidor", "danger"],
  api_oficial: ["API oficial (não usada)", "neutral"],
};
const DEPARTAMENTOS = ["Comunicação interna", "Comercial", "Atendimento a clientes", "Compras", "Fiscal", "Financeiro", "RH", "Produção", "Fundição", "Almoxarifado", "TI", "Portaria"];
const VAZIO: FormCanal = { nome: "", departamento: "", descricao: "", prompt: "", modelo: "", conexao: "whatsapp_web" };
const EXEMPLO_PROMPT = "Ex.: Você atende os funcionários da Pecsil pelo WhatsApp. Seja direta e cordial, trate todos pelo primeiro nome e responda só sobre o trabalho. Em dúvida sobre um número, diga de onde veio. Se a pessoa pedir algo fora da sua área, diga quem pode ajudar.";

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
          <p>Os números de WhatsApp da Pecsil, cada um com o departamento que atende, o comportamento da SARA e o modelo. Dentro de cada número, a allowlist: só quem está nela fala com ele.</p>
        </div>
        <div className="icms-acoes">
          <Button type="button" variant="secondary" onClick={() => void carregar()} disabled={ocupado}>Atualizar</Button>
          {!form && <Button type="button" onClick={() => setForm({ ...VAZIO })}>Adicionar número</Button>}
        </div>
      </div>

      {form && <FormularioCanal form={form} modelos={dados.modelos} ocupado={ocupado} mudar={(c) => setForm((f) => (f ? { ...f, ...c } : f))} salvar={() => void salvar()} cancelar={() => setForm(null)} />}

      {!dados.canais.length
        ? <div className="finance-empty almox-vazio"><b>Nenhum número cadastrado</b><small>Adicione o primeiro número e conecte o chip pelo QR Code.</small></div>
        : dados.canais.map((c) => (
          <CartaoCanal key={c.id} canal={c} notify={notify} recarregar={carregar} editar={() => setForm({ id: c.id, nome: c.nome, departamento: c.departamento ?? "", descricao: c.descricao ?? "", prompt: c.prompt ?? "", modelo: c.modelo ?? "", conexao: c.conexao })} modelos={dados.modelos} />
        ))}

      {(dados.agendados ?? []).length > 0 && <Agendados lista={dados.agendados ?? []} notify={notify} recarregar={carregar} />}

      <Callout variant="info" title="Como usar os números pelo QR Code">
        Cada número conectado pelo QR Code é um WhatsApp Web automatizado, pela Evolution: use com quem está nas listas, em volume baixo e sem disparo em massa, porque o WhatsApp não é oficial nesse modo e o número pode ser bloqueado. Para fornecedores e clientes, prefira um número separado do Chip interno.
      </Callout>
    </>
  );
}

function FormularioCanal({ form, modelos, ocupado, mudar, salvar, cancelar }: { form: FormCanal; modelos: Modelo[]; ocupado: boolean; mudar: (c: Partial<FormCanal>) => void; salvar: () => void; cancelar: () => void }) {
  return (
    <form className="wa-form wa-form-canal" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
      <b>{form.id ? "Alterar número" : "Novo número da plataforma"}</b>
      <label>Nome<input value={form.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={60} placeholder="Ex.: Comercial, Atendimento a clientes" required /></label>
      <label>Departamento
        <input value={form.departamento} onChange={(e) => mudar({ departamento: e.target.value })} maxLength={60} list="wa-departamentos" placeholder="A qual departamento se destina" />
        <datalist id="wa-departamentos">{DEPARTAMENTOS.map((d) => <option key={d} value={d} />)}</datalist>
      </label>
      <label>Modelo
        <select value={form.modelo} onChange={(e) => mudar({ modelo: e.target.value })}>
          <option value="">O da SARA de cada pessoa</option>
          {modelos.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
        </select>
        <small>{modelos.find((m) => m.id === form.modelo)?.nota ?? "Cada pessoa usa o modelo da SARA dela."}</small>
      </label>
      <label className="wa-obs">Descrição<textarea value={form.descricao} onChange={(e) => mudar({ descricao: e.target.value })} maxLength={400} rows={2} placeholder="Para que serve este número e quem ele atende" /></label>
      <label className="wa-obs wa-prompt">Comportamento da SARA neste número (prompt de sistema)
        <textarea value={form.prompt} onChange={(e) => mudar({ prompt: e.target.value })} maxLength={4000} rows={7} placeholder={EXEMPLO_PROMPT} />
        <small>Tom, assunto e limites deste número. Complementa a SARA: as regras de segurança (permissões de cada pessoa, só assuntos da empresa, nada feito sem confirmação) continuam valendo e não podem ser desligadas aqui. {form.prompt.length}/4000</small>
      </label>
      <div className="wa-acoes">
        <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
        <Button type="submit" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</Button>
      </div>
    </form>
  );
}

function CartaoCanal({ canal, notify, recarregar, editar, modelos }: { canal: Canal; notify: (m: string) => void; recarregar: () => Promise<Dados | null>; editar: () => void; modelos: Modelo[] }) {
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [numero, setNumero] = useState("");
  const [texto, setTexto] = useState("");
  const [confirmar, setConfirmar] = useState<"desconectar" | "remover" | null>(null);
  const [verListas, setVerListas] = useState(false);
  const [interativo, setInterativo] = useState<string | null>(null);
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
  const testarInterativo = async () => {
    setOcupado(true);
    const { ok, d } = await acao({ acao: "teste_interativo", numero });
    setOcupado(false);
    const nomes: Record<string, string> = { botoes: "Botões", lista: "Lista", enquete: "Enquete" };
    const r = (d.resultados ?? []) as { forma: string; ok: boolean; erro?: string }[];
    const texto = ok ? r.map((x) => `${nomes[x.forma] ?? x.forma}: ${x.ok ? "enviado" : `não saiu (${x.erro})`}`).join(" · ") : d.error || "Não foi possível enviar.";
    // O resultado fica na tela (o aviso some em segundos): é o que o teste quer mostrar.
    setInterativo(texto);
    notify(texto);
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
            <span><b>Modelo:</b> {modelos.find((m) => m.id === canal.modelo)?.rotulo ?? "o da SARA de cada pessoa"}</span>
            <span><b>Comportamento:</b> {canal.prompt ? <span className="wa-prompt-resumo" title={canal.prompt}>{canal.prompt.length > 160 ? `${canal.prompt.slice(0, 159)}…` : canal.prompt}</span> : <em className="wa-falta">sem prompt próprio: a SARA de cada pessoa, no jeito padrão</em>}</span>
            {canal.descricao && <span>{canal.descricao}</span>}
            {canal.recebimento && (canal.recebimento.ligado
              ? <span className="wa-movimento">Últimos 7 dias: {canal.movimento.respondidas} {canal.movimento.respondidas === 1 ? "respondida" : "respondidas"}
                  {canal.movimento.fora_da_lista ? ` · ${canal.movimento.fora_da_lista} de números fora da lista (ignoradas)` : ""}
                  {canal.movimento.falhas ? ` · ${canal.movimento.falhas} com falha` : ""}</span>
              : <em className="wa-falta">Recebimento de mensagens desligado: {canal.recebimento.erro ?? "a Evolution não aceitou o webhook"}</em>)}
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
        <Button type="button" variant="secondary" onClick={() => setVerListas((v) => !v)} aria-expanded={verListas}>{verListas ? "Esconder a allowlist" : "Allowlist"}</Button>
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
          <Button type="button" variant="secondary" onClick={() => void testarInterativo()} disabled={ocupado || numero.replace(/\D/g, "").length < 10}
            title="Manda a mesma pergunta em botões, lista e enquete, para ver o que aparece no celular e o que volta">Enviar botões e enquete</Button>
          {interativo && <small className="wa-teste-resultado" role="status">{interativo}. Toque numa opção de cada uma no celular: a resposta da SARA mostra o que chegou à plataforma.</small>}
        </form>
      )}

      {verListas && <WhatsappListas notify={notify} canal={{ id: canal.id, nome: canal.nome, conectado: s.estado === "conectado" && web }} />}
    </section>
  );
}

const SITUACAO_AGENDADO: Record<string, [string, "success" | "attention" | "danger" | "neutral" | "info"]> = {
  agendado: ["Agendado", "info"], enviando: ["Enviando", "attention"], enviado: ["Enviado", "success"], falhou: ["Falhou", "danger"], cancelado: ["Cancelado", "neutral"],
};
const quandoBr = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Envios agendados pelo WhatsApp (a tarefa de 10 em 10 minutos manda o que venceu; nada sai no horário silencioso). */
function Agendados({ lista, notify, recarregar }: { lista: Agendado[]; notify: (m: string) => void; recarregar: () => Promise<Dados | null> }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const cancelar = async (a: Agendado) => {
    setOcupado(a.id);
    const { ok, d } = await chamar({ acao: "cancelar_agendado", agendado: a.id });
    setOcupado(null);
    notify(ok ? `Envio para ${a.para_nome} cancelado.` : d.error || "Não foi possível cancelar.");
    if (ok) void recarregar();
  };
  return (
    <section className="wa-canal" aria-label="Envios agendados">
      <header><div><h2>Envios agendados</h2><small>Saem na primeira rodada depois do horário (de 10 em 10 minutos). Nada sai entre 20h e 7h nem aos domingos.</small></div></header>
      <div className="fin-tabela-rolagem wa-agendados">
        <table className="wa-tabela">
          <thead><tr><th>Quando</th><th>Para</th><th>O quê</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {lista.map((a) => {
              const [rotulo, tom] = SITUACAO_AGENDADO[a.situacao] ?? [a.situacao, "neutral"];
              return (
                <tr key={a.id}>
                  <td>{quandoBr(a.situacao === "enviado" ? a.enviado_em : a.quando)}</td>
                  <td>{a.para_nome}</td>
                  <td><small>{[a.documentos ? `${a.documentos} ${a.documentos === 1 ? "arquivo" : "arquivos"}` : null, a.texto ? `"${a.texto.slice(0, 90)}${a.texto.length > 90 ? "…" : ""}"` : null].filter(Boolean).join(" + ")}</small>{a.erro ? <small className="wa-falta"> · {a.erro}</small> : null}</td>
                  <td><Status tone={tom}>{rotulo}</Status></td>
                  <td className="wa-linha-acoes">{a.situacao === "agendado" && <Button type="button" variant="ghost" disabled={ocupado === a.id} onClick={() => void cancelar(a)}>Cancelar</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
