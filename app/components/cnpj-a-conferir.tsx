"use client";

import { useCallback, useEffect, useState } from "react";
import { cnpjFormatado } from "../../lib/cadastros/cnpj";

/**
 * "CNPJ a conferir" (captura automática a cada nota, 12/10/2026). Cada nota com CNPJ já se liga
 * sozinha ao fornecedor que tem aquele CNPJ; o que sobra vem para cá, para alguém decidir:
 *   completar — gravar o CNPJ no fornecedor que ainda não tem;
 *   novo      — cadastrar o fornecedor, ou dizer qual fornecedor já cadastrado é;
 *   conflito  — possível duplicado (ou filial): marcar para a unificação, ou ignorar.
 * Aparece em Compras › Fornecedores e em Fundação › Cadastros. Sem pendência, não ocupa espaço.
 */

type Forn = { id: string; name: string; tax_id: string | null } | null;
type Pendencia = {
  id: string; tipo: "completar" | "novo" | "conflito"; cnpj: string; nome_na_nota: string | null;
  origem_tipo: "nota_icms" | "recebimento" | "documento"; created_at: string; fornecedor: Forn; outro: Forn;
};

const ORIGEM: Record<Pendencia["origem_tipo"], string> = { nota_icms: "nota do Painel do ICMS", recebimento: "recebimento do Almoxarifado", documento: "XML de nota guardado" };

export function CnpjAConferir({ onMudou }: { onMudou?: () => void }) {
  const [lista, setLista] = useState<Pendencia[]>([]);
  const [podeDecidir, setPodeDecidir] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<{ id: string; name: string }[]>([]);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/cadastros/fornecedores/cnpj", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const corpo = await r.json();
    setLista(corpo.pendencias ?? []);
    setPodeDecidir(Boolean(corpo.podeDecidir));
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  useEffect(() => {
    if (!escolhendo || busca.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/cadastros/fornecedores/cnpj?busca=${encodeURIComponent(busca.trim())}`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) setOpcoes((await r.json()).fornecedores ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [busca, escolhendo]);

  const decidir = async (p: Pendencia, decisao: string, supplierId?: string) => {
    setOcupado(p.id); setErro("");
    const r = await fetch(`/api/cadastros/fornecedores/cnpj/${p.id}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisao, supplierId }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) { setErro((await r?.json().catch(() => ({})))?.error ?? "Não foi possível registrar."); return; }
    setEscolhendo(null); setBusca(""); setOpcoes([]);
    await carregar();
    onMudou?.();
  };

  if (!lista.length) return null;
  return (
    <section className="cnpj-conferir" aria-label="CNPJ a conferir">
      <header>
        <h3>CNPJ a conferir <small>({lista.length})</small></h3>
        <p>Notas com CNPJ que o cadastro ainda não reconhece. Confirme para a nota ficar ligada ao fornecedor certo.</p>
      </header>
      {erro && <p className="cnpj-conferir-erro" role="alert">{erro}</p>}
      {lista.map((p) => (
        <div key={p.id} className="cnpj-item">
          <div className="cnpj-item-texto">
            {p.tipo === "completar" && <><b>{p.fornecedor?.name ?? p.nome_na_nota}</b><small>A {ORIGEM[p.origem_tipo]} trouxe o CNPJ <span className="mono">{cnpjFormatado(p.cnpj)}</span>{p.nome_na_nota && p.nome_na_nota !== p.fornecedor?.name ? ` (como "${p.nome_na_nota}")` : ""}. O fornecedor ainda não tem CNPJ no cadastro.</small></>}
            {p.tipo === "novo" && <><b>{p.nome_na_nota ?? "Fornecedor sem nome na nota"}</b><small>CNPJ <span className="mono">{cnpjFormatado(p.cnpj)}</span>, de uma {ORIGEM[p.origem_tipo]}. Nenhum fornecedor do cadastro tem esse CNPJ nem esse nome.</small></>}
            {p.tipo === "conflito" && <><b>Possível duplicado: {p.fornecedor?.name}{p.outro ? ` × ${p.outro.name}` : ""}</b><small>{p.outro
              ? <>A {ORIGEM[p.origem_tipo]} aponta para <b>{p.fornecedor?.name}</b>, mas o CNPJ <span className="mono">{cnpjFormatado(p.cnpj)}</span> é de <b>{p.outro.name}</b>.</>
              : <><b>{p.fornecedor?.name}</b> já tem o CNPJ <span className="mono">{cnpjFormatado(p.fornecedor?.tax_id)}</span>, e a {ORIGEM[p.origem_tipo]} trouxe <span className="mono">{cnpjFormatado(p.cnpj)}</span> (pode ser filial).</>}</small></>}
          </div>
          {podeDecidir && (
            <div className="cnpj-item-acoes">
              {p.tipo === "completar" && <button type="button" className="ds-button primary compact" disabled={ocupado === p.id} onClick={() => void decidir(p, "gravar")}>Gravar CNPJ</button>}
              {p.tipo === "novo" && <>
                <button type="button" className="ds-button primary compact" disabled={ocupado === p.id || !p.nome_na_nota} onClick={() => void decidir(p, "cadastrar")}>Cadastrar fornecedor</button>
                <button type="button" className="doc-link" onClick={() => { setEscolhendo(escolhendo === p.id ? null : p.id); setBusca(p.nome_na_nota?.split(" ")[0] ?? ""); setOpcoes([]); }}>É um já cadastrado…</button>
              </>}
              {p.tipo === "conflito" && <button type="button" className="ds-button secondary compact" disabled={ocupado === p.id} onClick={() => void decidir(p, "unificar")}>Marcar para unificar</button>}
              <button type="button" className="doc-link perigo" disabled={ocupado === p.id} onClick={() => void decidir(p, "recusar")}>{p.tipo === "completar" ? "Não é este" : "Ignorar"}</button>
            </div>
          )}
          {escolhendo === p.id && (
            <div className="cnpj-escolher">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do fornecedor no cadastro" aria-label="Buscar fornecedor sem CNPJ" />
              {opcoes.map((o) => <button key={o.id} type="button" className="doc-link" disabled={ocupado === p.id} onClick={() => void decidir(p, "ligar", o.id)}>{o.name}</button>)}
              {busca.trim().length >= 2 && !opcoes.length && <small>Nenhum fornecedor sem CNPJ com esse nome.</small>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
