"use client";

import { useCallback, useEffect, useState } from "react";
import { BotaoExcluir, Button, Modal } from "../../packages/design-system";

/**
 * "O que a SARA lembra de mim" (menu da conta): a pessoa vê o que a SARA guardou das conversas e apaga o que quiser.
 * Só a própria pessoa vê; depois de apagar, a SARA não volta a anotar aquela conversa.
 */

type Lembranca = { id: string; tipo: "resumo" | "preferencia"; modulo: string; chave: string | null; texto: string; updated_at: string };
const quando = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const descrever = (m: Lembranca) => (m.tipo === "preferencia" ? `No WhatsApp, prefere resposta por ${m.texto === "audio" ? "áudio" : "texto"}.` : m.texto);

export function MemoriaDaSara({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const [lista, setLista] = useState<Lembranca[] | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const r = await fetch("/api/sara/memoria", { cache: "no-store" });
    const j = await r.json().catch(() => null) as { memoria?: Lembranca[]; error?: string } | null;
    if (!r.ok) { setErro(j?.error ?? "Não foi possível carregar."); return; }
    setErro(""); setLista(j?.memoria ?? []);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const apagar = async (id: string | null) => {
    if (!id && !confirm("Apagar tudo o que a SARA lembra de você?")) return;
    const r = await fetch(id ? `/api/sara/memoria?id=${id}` : "/api/sara/memoria", { method: "DELETE" });
    if (!r.ok) { notify("Não foi possível apagar."); return; }
    notify(id ? "Lembrança apagada." : "Memória apagada.");
    await carregar();
  };

  return (
    <Modal eyebrow="Conta" title="O que a SARA lembra de mim" subtitle="Só você vê. A SARA usa isto para continuar de onde parou, na tela e no WhatsApp." onClose={onClose}>
      <div className="almox-form decisoes">
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        {!erro && !lista && <p className="ds-detail-empty">Carregando…</p>}
        {lista?.length === 0 && <p className="ds-detail-empty">A SARA ainda não guardou nada de você.</p>}
        {lista?.map((m) => (
          <article key={m.id} className="decisao respondida" aria-label={descrever(m)}>
            <p>{descrever(m)}</p>
            <footer>
              <small className="decisao-nota">{quando(m.updated_at)}</small>
              <BotaoExcluir rotulo="Apagar esta lembrança" onClick={() => void apagar(m.id)} />
            </footer>
          </article>
        ))}
        <footer>{Boolean(lista?.length) && <Button variant="secondary" onClick={() => void apagar(null)}>Apagar tudo</Button>}<Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
      </div>
    </Modal>
  );
}
