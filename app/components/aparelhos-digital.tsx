"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../packages/design-system";
import { ativarDigital, digitalAtivaNesteAparelho, digitalDisponivel } from "../../lib/auth/digital-cliente";

/**
 * Aparelhos com "Entrar com a digital" ativa (passkey). Dois usos:
 *   - painel da conta (sem `perfil`): os da própria pessoa, com "Ativar neste celular";
 *   - Pessoas e Acessos (`perfil`): os de outra pessoa, para o proprietário remover.
 * Remover vai para a auditoria (no banco). A biometria nunca chega à plataforma.
 */

type Aparelho = { id: string; aparelho: string | null; created_at: string; last_used_at: string | null };
const quando = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca");

export function AparelhosDigital({ perfil, email, notify }: { perfil?: string; email?: string; notify: (m: string) => void }) {
  const [lista, setLista] = useState<Aparelho[] | null>(null);
  const [podeAtivar, setPodeAtivar] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/auth/digital${perfil ? `?perfil=${perfil}` : ""}`, { cache: "no-store" }).catch(() => null);
    const b = r?.ok ? await r.json().catch(() => null) : null;
    setLista(b?.aparelhos ?? []);
  }, [perfil]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);
  useEffect(() => {
    if (perfil) return;
    let vivo = true;
    void digitalDisponivel().then((ok) => { if (vivo) setPodeAtivar(ok && digitalAtivaNesteAparelho() !== email); });
    return () => { vivo = false; };
  }, [perfil, email]);

  const ativar = async () => {
    if (!email) return;
    setOcupado("ativar");
    const r = await ativarDigital(email);
    setOcupado(null);
    notify(r.ok ? `Digital ativada neste celular (${r.aparelho}).` : r.erro);
    if (r.ok) { setPodeAtivar(false); void carregar(); }
  };
  const remover = async (id: string) => {
    setOcupado(id);
    const r = await fetch(`/api/auth/digital/${id}`, { method: "DELETE" }).catch(() => null);
    setOcupado(null); setConfirmar(null);
    notify(r?.ok ? "Aparelho removido: a digital dele não entra mais." : "Não foi possível remover.");
    void carregar();
  };

  return (
    <div className="digital-aparelhos field-wide">
      <div className="digital-topo">
        <span><b>Entrar com a digital</b><small>{perfil
          ? "Celulares em que esta pessoa ativou a digital. Remova se o aparelho foi perdido ou a pessoa saiu."
          : "No celular, entre com a digital ou o rosto em vez da senha. A biometria fica só no aparelho; a senha continua valendo."}</small></span>
        {!perfil && podeAtivar && <Button compact onClick={() => void ativar()} disabled={ocupado === "ativar"} aria-busy={ocupado === "ativar"}>{ocupado === "ativar" ? "Aguardando a digital…" : "Ativar neste celular"}</Button>}
      </div>
      {lista === null ? <small className="digital-vazio">Carregando…</small> : lista.length ? (
        <ul>
          {lista.map((a) => (
            <li key={a.id}>
              <span><b>{a.aparelho ?? "Celular"}</b><small>Ativada em {quando(a.created_at)} · último uso: {quando(a.last_used_at)}</small></span>
              {confirmar === a.id
                ? <span className="digital-confirmar"><Button compact variant="ghost" onClick={() => setConfirmar(null)}>Cancelar</Button><Button compact className="almox-perigo-cheio" onClick={() => void remover(a.id)} disabled={ocupado === a.id}>Remover</Button></span>
                : <Button compact variant="ghost" className="almox-perigo" onClick={() => setConfirmar(a.id)}>Remover</Button>}
            </li>
          ))}
        </ul>
      ) : <small className="digital-vazio">{perfil ? "Nenhum celular com digital ativa." : podeAtivar ? "Nenhum celular com digital ativa ainda." : "Nenhum celular com digital ativa. Para ativar, entre na plataforma pelo celular."}</small>}
    </div>
  );
}
