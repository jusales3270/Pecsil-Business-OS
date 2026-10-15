"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented, Status } from "../../../../packages/design-system";
import { TIPOS_PECA } from "../../../../lib/comercial/vendas";
import { api } from "../../../fiscal/src/comum";

/**
 * Comercial › Vendas › Produtos — o "material" do GRV (P15): código interno, NCM, desenho e
 * material de cada peça. O código sai do grupo no formato do GRV (5-24-00040). "Clonar" é o atalho
 * do Rafael: a peça nova nasce com os dados da parecida.
 */

export type Produto = {
  id: string; codigo: string; descricao: string; group_id: string | null; customer_id: string | null; tipo_peca: string | null;
  unidade: string; ncm: string | null; origem: number; material: string | null; desenho_codigo: string | null; desenho_revisao: string | null;
  nome_cliente: string | null; peso_liquido: number | null; observacoes: string | null; ativo: boolean; cloned_from: string | null;
  created_by_name: string | null; updated_at: string;
};
export type Grupo = { id: string; codigo: string; nome: string; prefixo: string; proximo: number };
type Cliente = { id: string; name: string };
export type DadosProdutos = { produtos: Produto[]; grupos: Grupo[]; clientes: Cliente[]; podeOperar: boolean };
type Dados = DadosProdutos;

const ORIGENS = ["0 · Nacional", "1 · Estrangeira, importação direta", "2 · Estrangeira, mercado interno", "3 · Nacional, mais de 40% importado", "4 · Nacional, processo básico", "5 · Nacional, até 40% importado", "6 · Estrangeira direta, sem similar", "7 · Estrangeira mercado interno, sem similar", "8 · Nacional, mais de 70% importado"];
export type Form = Record<string, string>;
export const vazio = (): Form => ({ codigo: "", descricao: "", group_id: "", customer_id: "", tipo_peca: "", unidade: "PC", ncm: "", origem: "0", material: "", desenho_codigo: "", desenho_revisao: "", nome_cliente: "", peso_liquido: "", observacoes: "", cloned_from: "" });
const doProduto = (p: Produto, clone = false): Form => ({
  codigo: clone ? "" : p.codigo, descricao: p.descricao, group_id: p.group_id ?? "", customer_id: p.customer_id ?? "", tipo_peca: p.tipo_peca ?? "",
  unidade: p.unidade, ncm: p.ncm ?? "", origem: String(p.origem ?? 0), material: p.material ?? "", desenho_codigo: p.desenho_codigo ?? "",
  desenho_revisao: p.desenho_revisao ?? "", nome_cliente: p.nome_cliente ?? "", peso_liquido: p.peso_liquido === null ? "" : String(p.peso_liquido).replace(".", ","),
  observacoes: p.observacoes ?? "", cloned_from: clone ? p.id : "",
});

export function Produtos({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"ativos" | "todos">("ativos");
  const [aberto, setAberto] = useState<{ produto: Produto | null; form: Form } | null>(null);
  const [grupos, setGrupos] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/comercial/produtos");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const clientes = useMemo(() => new Map((dados?.clientes ?? []).map((c) => [c.id, c.name])), [dados]);
  const termo = busca.trim().toLowerCase();
  const lista = (dados?.produtos ?? []).filter((p) => (filtro === "todos" || p.ativo)
    && (!termo || [p.codigo, p.descricao, p.desenho_codigo ?? "", clientes.get(p.customer_id ?? "") ?? ""].some((t) => t.toLowerCase().includes(termo))));

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">COMERCIAL · VENDAS</p><h1>Produtos</h1><p>As peças que a PecSil vende: código interno, NCM, desenho e material. Os orçamentos e as notas usam este cadastro.</p></div>
        {dados?.podeOperar && (
          <div className="icms-acoes">
            <Button variant="secondary" onClick={() => setGrupos(true)}>Grupos e códigos</Button>
            <Button onClick={() => setAberto({ produto: null, form: vazio() })}>Novo produto</Button>
          </div>
        )}
      </div>

      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          <div className="almox-filtros vnd-filtros">
            <input className="vnd-busca" type="search" placeholder="Buscar por código, descrição, desenho ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar produto" />
            <Segmented<"ativos" | "todos"> options={[{ value: "ativos", label: "Ativos" }, { value: "todos", label: "Todos" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
          </div>
          <section className="almox-bloco">
            {lista.length ? (
              <div className="vnd-tabela vnd-produtos" role="table">
                <div className="cabeca" role="row"><span>Código</span><span>Descrição</span><span>Cliente</span><span>NCM</span><span>Desenho</span><span /></div>
                {lista.map((p) => (
                  <div role="row" key={p.id}>
                    <span className="vnd-codigo">{p.codigo}</span>
                    <span className="nome">{p.descricao}<small>{[p.tipo_peca ? TIPOS_PECA[p.tipo_peca] : null, p.material, p.nome_cliente].filter(Boolean).join(" · ") || "—"}</small></span>
                    <span>{clientes.get(p.customer_id ?? "") ?? "—"}</span>
                    <span>{p.ncm ? p.ncm.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3") : <Status tone="attention">Sem NCM</Status>}</span>
                    <span>{p.desenho_codigo ? `${p.desenho_codigo}${p.desenho_revisao ? ` rev. ${p.desenho_revisao}` : ""}` : "—"}</span>
                    <span className="fiscal-dfe-acoes">
                      {!p.ativo && <Status tone="neutral">Inativo</Status>}
                      <button type="button" className="almox-link" onClick={() => setAberto({ produto: p, form: doProduto(p) })}>Abrir</button>
                      {dados.podeOperar && <button type="button" className="almox-link" onClick={() => setAberto({ produto: null, form: doProduto(p, true) })}>Clonar</button>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="finance-empty">
                <b>{dados.produtos.length ? "Nenhum produto nesta busca" : "Nenhum produto cadastrado ainda"}</b>
                <small>{dados.produtos.length ? "Troque a busca ou o filtro." : "Cadastre o primeiro produto, ou aguarde a importação dos materiais do GRV."}</small>
              </div>
            )}
          </section>
        </>
      )}

      {aberto && dados && (
        <ProdutoModal inicial={aberto.form} produto={aberto.produto} dados={dados} notify={notify}
          onClose={() => setAberto(null)} onSalvo={() => { setAberto(null); void carregar(); }}
          onClonar={(p) => setAberto({ produto: null, form: doProduto(p, true) })} />
      )}
      {grupos && dados && <GruposModal grupos={dados.grupos} onClose={() => setGrupos(false)} onMudou={() => void carregar()} notify={notify} />}
    </div>
  );
}

/** Também usado no orçamento: "Cadastrar produto" abre este mesmo formulário e o item já sai com a peça nova. */
export function ProdutoModal({ inicial, produto, dados, notify, onClose, onSalvo, onClonar }: {
  inicial: Form; produto: Produto | null; dados: Dados; notify: (m: string) => void; onClose: () => void; onSalvo: (novo?: { id: string; codigo: string }) => void; onClonar?: (p: Produto) => void;
}) {
  const [f, setF] = useState<Form>(inicial);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const pode = dados.podeOperar;
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const grupo = dados.grupos.find((g) => g.id === f.group_id);
  const proximo = grupo ? `${grupo.prefixo}-${grupo.codigo}-${String(grupo.proximo).padStart(5, "0")}` : null;

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    setEnviando(true); setErro("");
    const corpo = JSON.stringify({ ...f, ativo: produto ? produto.ativo : true });
    const r = produto
      ? await api(`/api/comercial/produtos/${produto.id}`, { method: "PATCH", body: corpo })
      : await api<{ codigo: string }>("/api/comercial/produtos", { method: "POST", body: corpo });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    notify(produto ? "Produto atualizado." : `Produto ${(r.data as { codigo: string }).codigo} cadastrado.`);
    onSalvo(produto ? undefined : (r.data as { id: string; codigo: string }));
  };
  const alternarAtivo = async () => {
    if (!produto) return;
    setEnviando(true);
    const r = await api(`/api/comercial/produtos/${produto.id}`, { method: "PATCH", body: JSON.stringify({ ...doProduto(produto), ativo: !produto.ativo }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    notify(produto.ativo ? "Produto desativado: sai das listas, o histórico continua." : "Produto reativado.");
    onSalvo();
  };
  const excluir = async () => {
    if (!produto) return;
    setEnviando(true);
    const r = await api(`/api/comercial/produtos/${produto.id}`, { method: "DELETE" });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    notify("Produto excluído.");
    onSalvo();
  };

  return (
    <Modal eyebrow="COMERCIAL · PRODUTOS" title={produto ? `${produto.codigo} · ${produto.descricao}` : f.cloned_from ? "Novo produto (clonado)" : "Novo produto"}
      subtitle={f.cloned_from && !produto ? "Os dados vieram da peça de origem: ajuste o que mudou (descrição, desenho, revisão, material)." : undefined} onClose={onClose}>
      <form className="almox-form" onSubmit={salvar}>
        <fieldset className="nfe-form" disabled={!pode || enviando}>
          <div className="fiscal-campos nfe-campos">
            <label><span>Grupo</span>
              <select value={f.group_id} onChange={(e) => set("group_id", e.target.value)}>
                <option value="">—</option>
                {dados.grupos.map((g) => <option key={g.id} value={g.id}>{g.codigo} · {g.nome}</option>)}
              </select>
            </label>
            <label><span>Código interno{!produto && <small> · {proximo ? `vazio = ${proximo}` : "ou escolha o grupo"}</small>}</span><input value={f.codigo} maxLength={30} onChange={(e) => set("codigo", e.target.value.toUpperCase())} placeholder={!produto && proximo ? proximo : ""} /></label>
            <label className="nfe-cheio"><span>Descrição</span><input value={f.descricao} maxLength={120} onChange={(e) => set("descricao", e.target.value.toUpperCase())} placeholder="ANEL GFA. CERVEJA 600ML 420GR ART. 25TT009 GG-25" /></label>
            <label className="nfe-largo"><span>Cliente<small> · de quem é a peça</small></span>
              <select value={f.customer_id} onChange={(e) => set("customer_id", e.target.value)}>
                <option value="">—</option>
                {dados.clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label><span>Tipo de peça</span>
              <select value={f.tipo_peca} onChange={(e) => set("tipo_peca", e.target.value)}>
                <option value="">—</option>
                {Object.entries(TIPOS_PECA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label><span>Unidade</span><input value={f.unidade} maxLength={6} onChange={(e) => set("unidade", e.target.value.toUpperCase())} /></label>
            <label><span>NCM<small> · 8 dígitos</small></span><input inputMode="numeric" value={f.ncm} onChange={(e) => set("ncm", e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="84805000" /></label>
            <label className="nfe-largo"><span>Origem da mercadoria</span>
              <select value={f.origem} onChange={(e) => set("origem", e.target.value)}>{ORIGENS.map((o, k) => <option key={k} value={k}>{o}</option>)}</select>
            </label>
            <label><span>Material</span><input value={f.material} maxLength={60} onChange={(e) => set("material", e.target.value.toUpperCase())} placeholder="96A, E3, GG-25…" /></label>
            <label><span>Desenho</span><input value={f.desenho_codigo} maxLength={60} onChange={(e) => set("desenho_codigo", e.target.value)} placeholder="25TT009-13-01" /></label>
            <label><span>Revisão</span><input value={f.desenho_revisao} maxLength={20} onChange={(e) => set("desenho_revisao", e.target.value)} /></label>
            <label><span>Peso líquido (kg)</span><input inputMode="decimal" value={f.peso_liquido} onChange={(e) => set("peso_liquido", e.target.value)} /></label>
            <label className="nfe-cheio"><span>Nome no cliente<small> · como o cliente chama a peça (ex.: em inglês, com o código dele)</small></span><input value={f.nome_cliente} maxLength={120} onChange={(e) => set("nome_cliente", e.target.value)} /></label>
            <label className="nfe-cheio nfe-texto"><span>Observações</span><textarea rows={2} maxLength={2000} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></label>
          </div>
        </fieldset>
        {produto?.created_by_name && <p className="fiscal-nota-ajuda">Cadastrado por {produto.created_by_name}.</p>}
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          {produto && pode && (
            <>
              <Button type="button" variant="ghost" className="almox-perigo" onClick={() => void excluir()} disabled={enviando}>Excluir</Button>
              <Button type="button" variant="secondary" onClick={() => void alternarAtivo()} disabled={enviando}>{produto.ativo ? "Desativar" : "Reativar"}</Button>
              {onClonar && <Button type="button" variant="secondary" onClick={() => onClonar(produto)} disabled={enviando}>Clonar</Button>}
            </>
          )}
          <Button type="button" variant="secondary" onClick={onClose} disabled={enviando}>Fechar</Button>
          {pode && <Button type="submit" disabled={enviando}>{enviando ? "Gravando…" : produto ? "Gravar" : "Cadastrar"}</Button>}
        </footer>
      </form>
    </Modal>
  );
}

function GruposModal({ grupos, onClose, onMudou, notify }: { grupos: Grupo[]; onClose: () => void; onMudou: () => void; notify: (m: string) => void }) {
  const [f, setF] = useState({ id: "", codigo: "", nome: "", prefixo: "5", proximo: "1" });
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    setEnviando(true); setErro("");
    const r = await api("/api/comercial/produtos/grupos", { method: "POST", body: JSON.stringify({ ...f, id: f.id || undefined, proximo: Number(f.proximo) }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    notify(f.id ? "Grupo atualizado." : "Grupo criado.");
    setF({ id: "", codigo: "", nome: "", prefixo: "5", proximo: "1" });
    onMudou();
  };
  return (
    <Modal eyebrow="COMERCIAL · PRODUTOS" title="Grupos e códigos" subtitle="O código interno sai do grupo: prefixo-grupo-sequência (ex.: 5-24-00040)" onClose={onClose}>
      <div className="almox-form">
        {grupos.length > 0 && (
          <div className="vnd-tabela vnd-grupos" role="table">
            <div className="cabeca" role="row"><span>Grupo</span><span>Nome</span><span>Próximo código</span><span /></div>
            {grupos.map((g) => (
              <div role="row" key={g.id}>
                <span className="vnd-codigo">{g.codigo}</span><span>{g.nome}</span>
                <span className="vnd-codigo">{g.prefixo}-{g.codigo}-{String(g.proximo).padStart(5, "0")}</span>
                <span><button type="button" className="almox-link" onClick={() => setF({ id: g.id, codigo: g.codigo, nome: g.nome, prefixo: g.prefixo, proximo: String(g.proximo) })}>Editar</button></span>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={salvar} className="almox-form">
          <div className="fiscal-campos nfe-campos">
            <label><span>Código do grupo</span><input value={f.codigo} maxLength={6} onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase() })} placeholder="24" /></label>
            <label className="nfe-largo"><span>Nome</span><input value={f.nome} maxLength={60} onChange={(e) => setF({ ...f, nome: e.target.value.toUpperCase() })} placeholder="ANEL" /></label>
            <label><span>Prefixo</span><input value={f.prefixo} maxLength={6} onChange={(e) => setF({ ...f, prefixo: e.target.value.toUpperCase() })} /></label>
            <label><span>Próximo número<small> · para continuar o GRV</small></span><input inputMode="numeric" value={f.proximo} onChange={(e) => setF({ ...f, proximo: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></label>
          </div>
          {erro && <p className="almox-erro" role="alert">{erro}</p>}
          <footer>
            {f.id && <Button type="button" variant="ghost" onClick={() => setF({ id: "", codigo: "", nome: "", prefixo: "5", proximo: "1" })}>Novo grupo</Button>}
            <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
            <Button type="submit" disabled={enviando}>{enviando ? "Gravando…" : f.id ? "Gravar grupo" : "Criar grupo"}</Button>
          </footer>
        </form>
      </div>
    </Modal>
  );
}
