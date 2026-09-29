"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button, Card, Status } from "../../../../packages/design-system";

type Conta = {
  id: string;
  address: string;
  label: string;
  mode: "todos" | "remetentes_conhecidos";
  readsBody: boolean;
  active: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  mensagens: number;
  ultimaMensagem: string | null;
};

type Conexao = {
  contas: Conta[];
  aplicativoConfigurado: boolean;
  agendamentoConfigurado: boolean;
  isOwner: boolean;
};

const quando = (valor: string | null) =>
  valor
    ? new Date(valor).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
    : null;

/**
 * Situação da leitura de e-mail. Esta tela existe para responder uma pergunta
 * só: o sistema está lendo a caixa, e desde quando? Nada aqui é inventado —
 * caixa sem rodada aparece como "nunca sincronizou".
 */
export function ConexaoSection({ notify }: { notify: (message: string) => void }) {
  const [dados, setDados] = useState<Conexao | null>(null);
  const [erro, setErro] = useState("");
  const [novaCaixa, setNovaCaixa] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async (signal?: AbortSignal) => {
    const resposta = await fetch("/api/comercial/conexao", { cache: "no-store", signal });
    if (!resposta.ok) {
      setErro(resposta.status === 403 ? "Sem acesso à conexão de e-mail." : "Não foi possível ler a situação da conexão.");
      setDados({ contas: [], aplicativoConfigurado: false, agendamentoConfigurado: false, isOwner: false });
      return;
    }
    setErro("");
    setDados(await resposta.json());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Adiado para fora do corpo do efeito: a primeira gravação de estado não
    // pode acontecer durante ele (é a regra `set-state-in-effect`).
    void Promise.resolve()
      .then(() => carregar(controller.signal))
      .catch((motivo: Error) => {
        if (motivo.name !== "AbortError") setErro(motivo.message);
      });
    return () => controller.abort();
  }, [carregar]);

  async function alterar(conta: Conta, mudanca: { active?: boolean; relerDoComeco?: boolean }, aviso: string) {
    setOcupado(true);
    const resposta = await fetch(`/api/comercial/caixas/${conta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mudanca),
    });
    setOcupado(false);
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      return setErro(corpo.error ?? "Não foi possível alterar a caixa.");
    }
    notify(aviso);
    await carregar();
  }

  const pendencias = dados
    ? [
        !dados.aplicativoConfigurado && "o aplicativo da Microsoft (tenant, cliente e segredo) não está configurado no servidor",
        !dados.agendamentoConfigurado && "o segredo da tarefa agendada (MAIL_SYNC_SECRET) não está configurado",
        dados.contas.length === 0 && "nenhuma caixa de e-mail foi cadastrada",
      ].filter((item): item is string => Boolean(item))
    : [];

  return (
    <div className="comercial-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">COMERCIAL · CRM</p>
          <h1>Conexão de e-mail</h1>
          <p>Caixas que o sistema lê, quando leu pela última vez e o que deu errado.</p>
        </div>
        <Status tone={pendencias.length ? "attention" : "success"}>
          {pendencias.length ? "Incompleta" : "Configurada"}
        </Status>
      </div>

      {erro && <p className="user-admin-error">{erro}</p>}

      {pendencias.length > 0 && (
        <Card className="md-card">
          <p className="md-hint">
            <b>Falta para o CRM começar a receber e-mail:</b>
          </p>
          <ul className="comercial-pendencias">
            {pendencias.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="md-card">
        <div className="md-toolbar">
          <p className="md-hint">
            A caixa <b>comercial</b> entra inteira. A caixa de uma pessoa entra <b>filtrada</b>: só mensagem de cliente ou
            fornecedor já cadastrado, e sem o corpo — nem o corpo chega ao sistema.
          </p>
          {dados?.isOwner && (
            <span>
              <Button onClick={() => setNovaCaixa(true)}>+ Nova caixa</Button>
            </span>
          )}
        </div>
        <div className="md-list">
          {(dados?.contas ?? []).map((conta) => (
            <div className="md-row" key={conta.id}>
              <span className="md-main">
                <b>
                  {conta.label} · {conta.address}
                </b>
                <small>
                  {conta.mode === "todos" ? "Caixa da empresa (tudo)" : "Caixa de pessoa (só remetentes conhecidos)"}
                  {conta.readsBody ? " · lê o corpo" : " · sem o corpo"}
                  {conta.lastError && ` · último erro: ${conta.lastError}`}
                </small>
              </span>
              <span className="md-usage">
                {conta.mensagens} {conta.mensagens === 1 ? "mensagem" : "mensagens"}
                {conta.lastSyncAt ? ` · sincronizada ${quando(conta.lastSyncAt)}` : " · nunca sincronizou"}
              </span>
              <Status tone={conta.lastError ? "danger" : conta.active ? "success" : "neutral"}>
                {conta.lastError ? "Com erro" : conta.active ? "Ativa" : "Pausada"}
              </Status>
              {dados?.isOwner && (
                <span className="md-actions">
                  <Button
                    variant="secondary"
                    compact
                    disabled={ocupado}
                    onClick={() => void alterar(conta, { active: !conta.active }, conta.active ? "Caixa pausada." : "Caixa reativada.")}
                  >
                    {conta.active ? "Pausar" : "Reativar"}
                  </Button>
                  <Button
                    variant="secondary"
                    compact
                    disabled={ocupado}
                    onClick={() => void alterar(conta, { relerDoComeco: true }, "A próxima rodada vai reler a caixa inteira.")}
                  >
                    Reler
                  </Button>
                </span>
              )}
            </div>
          ))}
          {dados && dados.contas.length === 0 && <div className="user-admin-empty">Nenhuma caixa cadastrada ainda.</div>}
        </div>
      </Card>

      {novaCaixa && (
        <NovaCaixaForm
          onClose={() => setNovaCaixa(false)}
          onSaved={async (endereco) => {
            notify(`Caixa ${endereco} cadastrada.`);
            setNovaCaixa(false);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function NovaCaixaForm({ onClose, onSaved }: { onClose: () => void; onSaved: (endereco: string) => Promise<void> }) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"todos" | "remetentes_conhecidos">("todos");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setOcupado(true);
    setErro("");
    const resposta = await fetch("/api/comercial/caixas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, label, mode }),
    });
    setOcupado(false);
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      return setErro(corpo.error ?? "Não foi possível cadastrar a caixa.");
    }
    await onSaved(address.trim().toLowerCase());
  }

  return (
    <div className="employee-layer form-layer">
      <form className="user-admin-form" onSubmit={enviar} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">COMERCIAL · CAIXA DE E-MAIL</p>
            <h2>Nova caixa monitorada</h2>
            <p>O sistema só consegue ler a caixa se o aplicativo tiver o papel dela no Exchange.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="user-admin-fields">
          <label className="field-wide">
            <span>Endereço *</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="comercial@pecsil.com.br" inputMode="email" />
          </label>
          <label>
            <span>Nome *</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Comercial" />
          </label>
          <label className="field-wide">
            <span>Como ler</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="todos">Caixa da empresa — lê tudo, com o corpo</option>
              <option value="remetentes_conhecidos">Caixa de pessoa — só remetentes conhecidos, sem o corpo</option>
            </select>
          </label>
          {mode === "remetentes_conhecidos" && (
            <p className="md-hint field-wide">
              Desta caixa o sistema registra apenas mensagem de cliente ou fornecedor já cadastrado, e guarda remetente,
              assunto e data — nunca o corpo. No Exchange, dê a esta caixa somente o papel <b>Application Mail.ReadBasic</b>.
            </p>
          )}
          {erro && <p className="user-admin-error field-wide">{erro}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Cancelar
          </button>
          <Button type="submit" disabled={ocupado || !address.includes("@") || !label.trim()}>
            {ocupado ? "Salvando…" : "Cadastrar"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
