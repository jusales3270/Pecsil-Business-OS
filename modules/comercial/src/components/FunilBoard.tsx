"use client";

import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Status } from "../../../../packages/design-system";

type Etapa = { id: string; code: string; label: string; kind: "aberto" | "ganho" | "perdido" };

type CardFunil = {
  id: string;
  stageId: string;
  title: string;
  kind: "pedido" | "cobranca" | "duvida" | "outro";
  customerId: string | null;
  customerName: string | null;
  valueCents: number | null;
  dueDate: string | null;
  position: number;
  status: "aberto" | "ganho" | "perdido";
  lostReason: string | null;
  origem: "manual" | "email";
  updatedAt: string;
};

type Quadro = { etapas: Etapa[]; cards: CardFunil[]; clientes: { id: string; name: string }[]; canEdit: boolean };

const TIPOS: { value: CardFunil["kind"]; label: string }[] = [
  { value: "pedido", label: "Pedido" },
  { value: "cobranca", label: "Cobrança" },
  { value: "duvida", label: "Dúvida" },
  { value: "outro", label: "Outro" },
];

const TIPO_LABEL = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]));

const money = (cents: number | null) =>
  cents === null ? null : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dia = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR") : null);

/**
 * Funil em Kanban.
 *
 * Arrastar usa a API nativa do navegador — sem biblioteca. Como arrastar não
 * funciona no celular nem no teclado, todo card também tem "Mover para", e é
 * por ali que o toque e o leitor de tela trabalham.
 *
 * A posição dentro da coluna é decidida no servidor (ponto médio entre os
 * vizinhos). A tela manda em que índice o card caiu e o `updatedAt` que ela
 * viu: se outra pessoa mexeu no card antes, a resposta é 409 e o quadro
 * recarrega em vez de sobrescrever.
 */
export function FunilBoard({ notify }: { notify: (message: string) => void }) {
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState(false);
  const [perdendo, setPerdendo] = useState<{ card: CardFunil; etapa: Etapa } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async (signal?: AbortSignal) => {
    const resposta = await fetch("/api/comercial/funil", { cache: "no-store", signal });
    if (!resposta.ok) {
      setErro(resposta.status === 403 ? "Sem acesso ao funil." : "Não foi possível carregar o funil.");
      setQuadro({ etapas: [], cards: [], clientes: [], canEdit: false });
      return;
    }
    setErro("");
    setQuadro(await resposta.json());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => carregar(controller.signal))
      .catch((motivo: Error) => {
        if (motivo.name !== "AbortError") setErro(motivo.message);
      });
    return () => controller.abort();
  }, [carregar]);

  const porEtapa = useMemo(() => {
    const mapa = new Map<string, CardFunil[]>();
    for (const etapa of quadro?.etapas ?? []) mapa.set(etapa.id, []);
    for (const card of quadro?.cards ?? []) {
      mapa.set(card.stageId, [...(mapa.get(card.stageId) ?? []), card]);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.position - b.position);
    return mapa;
  }, [quadro]);

  async function mover(card: CardFunil, etapa: Etapa, index?: number, lostReason?: string) {
    if (etapa.kind === "perdido" && !lostReason) {
      setPerdendo({ card, etapa });
      return;
    }
    setOcupado(true);
    const resposta = await fetch(`/api/comercial/funil/cards/${card.id}/mover`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: etapa.id, index, expectedUpdatedAt: card.updatedAt, lostReason }),
    });
    setOcupado(false);
    if (resposta.status === 409) {
      setErro("Outra pessoa mexeu neste card enquanto você olhava. O quadro foi recarregado.");
      await carregar();
      return;
    }
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      setErro(corpo.error ?? "Não foi possível mover o card.");
      return;
    }
    setErro("");
    setPerdendo(null);
    notify(`"${card.title}" → ${etapa.label}`);
    await carregar();
  }

  const soltar = async (event: DragEvent<HTMLDivElement>, etapa: Etapa) => {
    event.preventDefault();
    setAlvo(null);
    const cardId = event.dataTransfer.getData("text/plain") || arrastando;
    setArrastando(null);
    const card = quadro?.cards.find((item) => item.id === cardId);
    if (!card || card.stageId === etapa.id) return;
    await mover(card, etapa);
  };

  const etapas = quadro?.etapas ?? [];
  const canEdit = Boolean(quadro?.canEdit);

  return (
    <div className="comercial-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">COMERCIAL · CRM</p>
          <h1>Funil</h1>
          <p>Pedidos, cobranças e dúvidas em acompanhamento, por etapa.</p>
        </div>
        {canEdit && (
          <Button
            onClick={() => {
              // Recarrega antes de abrir: cliente cadastrado agora mesmo, em
              // CRM › Clientes, tem que aparecer na lista deste formulário.
              void carregar();
              setNovo(true);
            }}
          >
            + Novo card
          </Button>
        )}
      </div>

      {erro && <p className="user-admin-error">{erro}</p>}

      <div className="funil-quadro">
        {etapas.map((etapa) => {
          const cards = porEtapa.get(etapa.id) ?? [];
          const total = cards.reduce((soma, card) => soma + (card.valueCents ?? 0), 0);
          return (
            <div
              key={etapa.id}
              className={`funil-coluna${alvo === etapa.id ? " alvo" : ""}${etapa.kind !== "aberto" ? " fechada" : ""}`}
              onDragOver={(event) => {
                if (!canEdit) return;
                event.preventDefault();
                setAlvo(etapa.id);
              }}
              onDragLeave={() => setAlvo((atual) => (atual === etapa.id ? null : atual))}
              onDrop={(event) => void soltar(event, etapa)}
            >
              <header>
                <b>{etapa.label}</b>
                <small>
                  {cards.length} {cards.length === 1 ? "card" : "cards"}
                  {total > 0 && ` · ${money(total)}`}
                </small>
              </header>
              <div className="funil-cards">
                {cards.map((card) => (
                  <article
                    key={card.id}
                    className={`funil-card${arrastando === card.id ? " arrastando" : ""}`}
                    draggable={canEdit}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", card.id);
                      event.dataTransfer.effectAllowed = "move";
                      setArrastando(card.id);
                    }}
                    onDragEnd={() => setArrastando(null)}
                  >
                    <b>{card.title}</b>
                    <small>
                      {card.customerName ?? "Sem cliente"} · {TIPO_LABEL[card.kind]}
                      {card.origem === "email" && " · do e-mail"}
                    </small>
                    <span className="funil-card-meta">
                      {money(card.valueCents) && <b>{money(card.valueCents)}</b>}
                      {dia(card.dueDate) && <small>prazo {dia(card.dueDate)}</small>}
                    </span>
                    {card.lostReason && <small className="funil-card-motivo">Perdido: {card.lostReason}</small>}
                    {canEdit && (
                      <label className="funil-mover">
                        <span>Mover para</span>
                        <select
                          value=""
                          disabled={ocupado}
                          onChange={(event) => {
                            const destino = etapas.find((item) => item.id === event.target.value);
                            if (destino) void mover(card, destino);
                          }}
                        >
                          <option value="">Escolha a etapa…</option>
                          {etapas
                            .filter((item) => item.id !== etapa.id)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                  </article>
                ))}
                {cards.length === 0 && <p className="funil-vazia">Nenhum card aqui.</p>}
              </div>
            </div>
          );
        })}
        {quadro && etapas.length === 0 && <div className="user-admin-empty">O funil ainda não tem etapas.</div>}
      </div>

      {novo && quadro && (
        <NovoCardForm
          clientes={quadro.clientes}
          onClose={() => setNovo(false)}
          onSaved={async (titulo) => {
            notify(`Card "${titulo}" criado na Triagem.`);
            setNovo(false);
            await carregar();
          }}
        />
      )}

      {perdendo && (
        <MotivoPerdaForm
          card={perdendo.card}
          onClose={() => setPerdendo(null)}
          onConfirm={(motivo) => mover(perdendo.card, perdendo.etapa, undefined, motivo)}
        />
      )}
    </div>
  );
}

function NovoCardForm({
  clientes,
  onClose,
  onSaved,
}: {
  clientes: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (titulo: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CardFunil["kind"]>("pedido");
  const [customerId, setCustomerId] = useState("");
  const [value, setValue] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setOcupado(true);
    setErro("");
    const resposta = await fetch("/api/comercial/funil/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind, customerId, value, dueDate }),
    });
    setOcupado(false);
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      return setErro(corpo.error ?? "Não foi possível criar o card.");
    }
    await onSaved(title.trim());
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form" onSubmit={enviar} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">COMERCIAL · FUNIL</p>
            <h2>Novo card</h2>
            <p>O pedido que chegou por telefone ou WhatsApp entra aqui e passa a ser acompanhado.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="user-admin-fields">
          <label className="field-wide">
            <span>Do que se trata *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: 300 moldes para garrafa 600ml" />
          </label>
          <label>
            <span>Tipo</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as CardFunil["kind"])}>
              {TIPOS.map((tipo) => (
                <option key={tipo.value} value={tipo.value}>
                  {tipo.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Cliente</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Sem cliente</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Valor (R$)</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" inputMode="decimal" />
          </label>
          <label>
            <span>Prazo</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          {clientes.length === 0 && (
            <p className="md-hint field-wide">
              Nenhum cliente cadastrado ainda. Dá para criar o card sem cliente e ligar depois, em Fundação › Cadastros ›
              Clientes.
            </p>
          )}
          {erro && <p className="user-admin-error field-wide">{erro}</p>}
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Cancelar
          </button>
          <Button type="submit" disabled={ocupado || !title.trim()}>
            {ocupado ? "Criando…" : "Criar card"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function MotivoPerdaForm({
  card,
  onClose,
  onConfirm,
}: {
  card: CardFunil;
  onClose: () => void;
  onConfirm: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setOcupado(true);
    await onConfirm(motivo.trim());
    setOcupado(false);
  }

  return (
    <div className="employee-layer form-layer" onMouseDown={onClose}>
      <form className="user-admin-form" onSubmit={enviar} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">COMERCIAL · FUNIL</p>
            <h2>Por que foi perdido?</h2>
            <p>“{card.title}”. O motivo fica registrado — é o que permite saber depois por que se perde negócio.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="user-admin-fields">
          <label className="field-wide">
            <span>Motivo *</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: preço acima do concorrente" />
          </label>
        </div>
        <footer>
          <button type="button" className="employee-cancel" onClick={onClose}>
            Cancelar
          </button>
          <Button type="submit" disabled={ocupado || !motivo.trim()}>
            {ocupado ? "Salvando…" : "Marcar como perdido"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
