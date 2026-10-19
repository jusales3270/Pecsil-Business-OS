"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FichaDoCerebro } from "../../../app/components/ficha-cerebro";
import { Button, Modal, Segmented, Status } from "../../../packages/design-system";
import { FAMILIAS, PENDENCIAS, type GrupoMaterial, type Material } from "../../../lib/almoxarifado/materiais";
import { Icone, chamar, money, qtd } from "./tipos";

/**
 * Almoxarifado › Materiais (docs/PLANO-ALMOXARIFADO.md, M1): o catálogo com o código do GRV. Busca pelo
 * código (com ou sem traço) ou pelo nome sem acento; material novo ganha o código pelo grupo. É daqui
 * que a lista de materiais da OS (na Forja) e, depois, o pedido, a cotação e o recebimento escolhem.
 */

type Dados = { materiais: Material[]; temMais: boolean; grupos: GrupoMaterial[]; podeOperar: boolean };
type Form = Record<string, string | boolean>;
const vazio = (familia = "uso_consumo"): Form => ({ codigo: "", descricao: "", group_id: "", familia, subgrupo: "", unidade: "UN", unidade_compra: "", ncm: "", plano_contas: "", controla_estoque: false, ativo: true, observacoes: "" });
const doMaterial = (m: Material): Form => ({
  codigo: m.codigo, descricao: m.descricao, group_id: m.group_id ?? "", familia: m.familia, subgrupo: m.subgrupo ?? "", unidade: m.unidade, unidade_compra: m.unidade_compra ?? "",
  ncm: m.ncm ?? "", plano_contas: m.plano_contas ?? "", controla_estoque: m.controla_estoque, ativo: m.ativo, observacoes: m.observacoes ?? "",
});
const rotuloGrupo = (g: GrupoMaterial) => `${g.prefixo}-${g.codigo} · ${g.nome}`;
const LIMITE = 200;

export function Materiais({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [familia, setFamilia] = useState<string>("");
  const [grupo, setGrupo] = useState("");
  const [inativos, setInativos] = useState(false);
  const [aberto, setAberto] = useState<{ material: Material | null; form: Form } | null>(null);

  const carregar = useCallback(async (q: string, f: string, g: string, ina: boolean) => {
    const p = new URLSearchParams({ q, limite: String(LIMITE) });
    if (f) p.set("familia", f);
    if (g) p.set("grupo", g);
    if (ina) p.set("inativos", "1");
    const r = await chamar<Dados>(`/api/almoxarifado/materiais?${p}`);
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  // A busca vai ao banco (9 mil itens): espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => { void carregar(busca, familia, grupo, inativos); }, busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca, familia, grupo, inativos]);

  const grupos = useMemo(() => (dados?.grupos ?? []).filter((g) => !familia || g.familia === familia), [dados, familia]);
  const nomeGrupo = useMemo(() => new Map((dados?.grupos ?? []).map((g) => [g.id, rotuloGrupo(g)])), [dados]);
  const recarregar = () => void carregar(busca, familia, grupo, inativos);

  return (
    <>
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">ALMOXARIFADO · CATÁLOGO</p><h1>Materiais</h1><p>Matéria-prima, embalagem, produto intermediário e uso e consumo, com o código do GRV. Busque pelo código (com ou sem traço) ou pelo nome.</p></div>
        {dados?.podeOperar && <Button onClick={() => setAberto({ material: null, form: vazio(familia || "uso_consumo") })}><Icone nome="mais" size={16} /> Novo material</Button>}
      </div>
      <div className="almox-filtros vnd-filtros">
        <input className="vnd-busca" type="search" placeholder="Código ou nome: 2-07, 20700589, broca 10mm…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar material" />
        <select className="vnd-busca almox-filtro-select" value={familia} onChange={(e) => { setFamilia(e.target.value); setGrupo(""); }} aria-label="Família">
          <option value="">Todas as famílias</option>
          {Object.entries(FAMILIAS).filter(([k]) => k !== "outro").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="vnd-busca almox-filtro-select" value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo">
          <option value="">Todos os grupos</option>
          {grupos.map((g) => <option key={g.id} value={g.id}>{rotuloGrupo(g)}</option>)}
        </select>
        <Segmented<"ativos" | "todos"> options={[{ value: "ativos", label: "Ativos" }, { value: "todos", label: "Com inativos" }]} value={inativos ? "todos" : "ativos"} onChange={(v) => setInativos(v === "todos")} ariaLabel="Situação" compact />
      </div>

      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <section className="almox-bloco">
          {dados.materiais.length ? (
            <div className="almox-tabela almox-materiais" role="table" aria-label="Materiais">
              <div className="cabeca" role="row"><span>Código</span><span>Material</span><span>Grupo</span><span>Unid.</span><span>NCM</span><span>Estoque</span><span /></div>
              {dados.materiais.map((m) => (
                <div role="row" key={m.id} className={m.ativo ? undefined : "almox-inativo"}>
                  <span className="vnd-codigo">{m.codigo}</span>
                  <span className="nome">{m.descricao}<small>{[FAMILIAS[m.familia as keyof typeof FAMILIAS], m.subgrupo].filter(Boolean).join(" · ")}</small></span>
                  <span>{m.group_id ? nomeGrupo.get(m.group_id) ?? "—" : "—"}</span>
                  <span>{m.unidade}</span>
                  <span>{m.ncm ? m.ncm.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3") : <Status tone="attention">Sem NCM</Status>}</span>
                  <span>{!m.ativo ? <Status tone="neutral">Inativo</Status> : m.controla_estoque ? <Status tone="info">Controla</Status> : <small className="vnd-dica">só catálogo</small>}</span>
                  <span><button type="button" className="almox-link" onClick={() => setAberto({ material: m, form: doMaterial(m) })}>Abrir</button></span>
                </div>
              ))}
            </div>
          ) : (
            <div className="finance-empty almox-vazio"><b>Nenhum material nesta busca</b><small>Troque a busca ou os filtros{inativos ? "" : ", ou inclua os inativos"}.</small></div>
          )}
          {dados.temMais && <p className="fiscal-nota-ajuda">Mostrando os {LIMITE} primeiros: refine a busca ou escolha a família e o grupo.</p>}
        </section>
      )}

      {aberto && dados && (
        <MaterialModal material={aberto.material} inicial={aberto.form} grupos={dados.grupos} podeOperar={dados.podeOperar} notify={notify}
          onClose={() => setAberto(null)} onSalvo={() => { setAberto(null); recarregar(); }} />
      )}
    </>
  );
}

function MaterialModal({ material, inicial, grupos, podeOperar, notify, onClose, onSalvo }: {
  material: Material | null; inicial: Form; grupos: GrupoMaterial[]; podeOperar: boolean; notify: (m: string) => void; onClose: () => void; onSalvo: () => void;
}) {
  const [f, setF] = useState<Form>(inicial);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const grupo = grupos.find((g) => g.id === f.group_id);
  const proximo = grupo ? `${grupo.prefixo}-${grupo.codigo}-${String(grupo.proximo).padStart(5, "0")}` : null;
  const escolherGrupo = (id: string) => {
    const g = grupos.find((x) => x.id === id);
    // Grupo novo: a família e o "controla estoque" vêm dele (dá para mudar depois).
    setF((x) => ({ ...x, group_id: id, ...(g && !material ? { familia: g.familia, controla_estoque: g.controla_estoque } : {}) }));
  };

  const gravar = async (mudar?: Partial<Form>) => {
    setEnviando(true); setErro("");
    const corpo = JSON.stringify({ ...f, ...mudar });
    const r = material
      ? await chamar(`/api/almoxarifado/materiais/${material.id}`, { method: "PATCH", body: corpo })
      : await chamar<{ codigo: string }>("/api/almoxarifado/materiais", { method: "POST", body: corpo });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    notify(material ? (mudar?.ativo === false ? "Material inativado: sai da busca do dia a dia, o histórico continua." : mudar?.ativo ? "Material reativado." : "Material atualizado.") : `Material ${(r.data as { codigo: string }).codigo} cadastrado.`);
    onSalvo();
  };

  return (
    <Modal eyebrow="ALMOXARIFADO · MATERIAL" title={material ? `${material.codigo} · ${material.descricao}` : "Novo material"}
      subtitle={material?.origem === "grv" ? "Veio do cadastro do GRV (carga de 15/10/2026)." : undefined} onClose={onClose}>
      <form className="almox-form" onSubmit={(e) => { e.preventDefault(); void gravar(); }}>
        {material && material.pendencias.length > 0 && (
          <div className="almox-pendencias">{material.pendencias.map((p) => <Status key={p} tone="attention">{PENDENCIAS[p] ?? p}</Status>)}</div>
        )}
        <fieldset className="nfe-form" disabled={!podeOperar || enviando}>
          <div className="fiscal-campos nfe-campos">
            <label className="nfe-largo"><span>Grupo</span>
              <select value={String(f.group_id)} onChange={(e) => escolherGrupo(e.target.value)}>
                <option value="">—</option>
                {grupos.map((g) => <option key={g.id} value={g.id}>{rotuloGrupo(g)}</option>)}
              </select>
            </label>
            <label><span>Código{!material && <small> · {proximo ? `vazio = ${proximo}` : "ou escolha o grupo"}</small>}</span>
              <input value={String(f.codigo)} maxLength={30} disabled={Boolean(material)} onChange={(e) => set("codigo", e.target.value.toUpperCase())} placeholder={!material && proximo ? proximo : ""} />
            </label>
            <label className="nfe-cheio"><span>Nome do material</span><input value={String(f.descricao)} maxLength={200} onChange={(e) => set("descricao", e.target.value.toUpperCase())} placeholder="BROCA HSS Ø10 MM" /></label>
            <label><span>Família</span>
              <select value={String(f.familia)} onChange={(e) => set("familia", e.target.value)}>
                {Object.entries(FAMILIAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label><span>Subgrupo</span><input value={String(f.subgrupo)} maxLength={60} onChange={(e) => set("subgrupo", e.target.value.toUpperCase())} /></label>
            <label><span>Unidade de estoque</span><input value={String(f.unidade)} maxLength={8} onChange={(e) => set("unidade", e.target.value.toUpperCase())} placeholder="PÇ, KG, M" /></label>
            <label><span>Unidade de compra</span><input value={String(f.unidade_compra)} maxLength={8} onChange={(e) => set("unidade_compra", e.target.value.toUpperCase())} placeholder="CX, CT" /></label>
            <label><span>NCM<small> · 8 dígitos</small></span><input inputMode="numeric" value={String(f.ncm)} onChange={(e) => set("ncm", e.target.value.replace(/\D/g, "").slice(0, 8))} /></label>
            <label className="nfe-largo"><span>Plano de contas</span><input value={String(f.plano_contas)} maxLength={60} onChange={(e) => set("plano_contas", e.target.value.toUpperCase())} placeholder="FIXADORES, EMBALAGEM…" /></label>
            <label className="nfe-check"><input type="checkbox" checked={Boolean(f.controla_estoque)} onChange={(e) => set("controla_estoque", e.target.checked)} /><span>Controla estoque (saldo e custo médio)</span></label>
            <label className="nfe-cheio nfe-texto"><span>Observações</span><textarea rows={2} maxLength={2000} value={String(f.observacoes)} onChange={(e) => set("observacoes", e.target.value)} /></label>
          </div>
        </fieldset>
        {material && (
          <p className="fiscal-nota-ajuda">
            {material.tipo_item ? `Tipo no GRV: ${material.tipo_item}. ` : ""}
            Custo de referência {money(Number(material.custo_referencia))}{material.saldo_grv !== null ? ` · saldo no GRV ${qtd(Number(material.saldo_grv))} ${material.unidade} (só referência: o estoque abre com a contagem)` : ""}.
            {material.created_by_name ? ` Cadastrado por ${material.created_by_name}.` : ""}
          </p>
        )}
        {material && <FichaDoCerebro tipo="material" chave={material.id} />}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          {material && podeOperar && (
            <Button type="button" variant="secondary" onClick={() => void gravar({ ativo: !material.ativo })} disabled={enviando}>{material.ativo ? "Inativar" : "Reativar"}</Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose} disabled={enviando}>Fechar</Button>
          {podeOperar && <Button type="submit" disabled={enviando}>{enviando ? "Gravando…" : material ? "Gravar" : "Cadastrar"}</Button>}
        </footer>
      </form>
    </Modal>
  );
}
