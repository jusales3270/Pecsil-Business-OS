"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";

/**
 * Fundação › Conectores (docs/PLANO-CONECTOR.md): as fontes de dados de fora (ERP, banco antigo, pasta), só do
 * proprietário. O serviço conector roda perto da fonte (na Pecsil, no próprio servidor da plataforma, na rede do
 * GRV), lê só com um usuário de leitura e manda para a área de chegada: a descoberta do esquema e os registros
 * dos objetos configurados. Nada daqui muda um cadastro sozinho: o de-para é sugerido pela regra e decidido por
 * quem cuida daquele cadastro.
 */
type Tipo = { tipo: string; rotulo: string; degrau: number };
type Objeto = { nome: string; consulta: string; chave: string[]; registros: number };
type Tabela = { nome: string; linhas: number | null; colunas: { nome: string; tipo: string }[] };
type Lote = { tipo: string; objeto: string | null; recebidos: number; novos: number; alterados: number; iguais: number; erro: string | null; created_at: string };
type Depara = { id: string; objeto: string; chave: string; entidade: string; destino_nome: string | null; motivo: string | null };
type Fonte = {
  id: string; nome: string; sistema: string | null; tipo: string; degrau: number; ativo: boolean; objetos: Objeto[]; intervalo_min: number; descobrir: boolean;
  descoberta: { banco: { produto: string; versao: string | null } | null; tabelas: Tabela[]; em: string } | null;
  ultimo_contato: string | null; versao_conector: string | null; ultimo_erro: string | null;
  situacao: { estado: "desativada" | "nunca" | "ok" | "atrasada" | "erro"; rotulo: string }; lotes: Lote[]; depara: Depara[];
};
type Dados = { tipos: Tipo[]; degraus: Record<string, string>; fontes: Fonte[] };
type Segredo = { fonte: string; segredo: string };

const TOM: Record<Fonte["situacao"]["estado"], "success" | "attention" | "danger" | "neutral"> = { ok: "success", atrasada: "attention", erro: "danger", nunca: "neutral", desativada: "neutral" };
const ENTIDADES = [{ v: "fornecedor", r: "Fornecedor (pelo CNPJ/CPF)" }, { v: "cliente", r: "Cliente (pelo CNPJ/CPF)" }, { v: "material", r: "Material (pelo código)" }, { v: "produto", r: "Produto (pelo código)" }];
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR"));

async function chamar(corpo?: Record<string, unknown>, busca = "") {
  const r = await fetch(`/api/foundation/conectores${busca}`, corpo ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) } : { cache: "no-store" });
  return { ok: r.ok, d: await r.json().catch(() => ({})) };
}

export function Conectores({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [nova, setNova] = useState<{ nome: string; sistema: string; tipo: string } | null>(null);
  const [segredo, setSegredo] = useState<Segredo | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const { ok, d } = await chamar();
    if (!ok) { setErro(d.error || "Não foi possível ler os conectores."); return; }
    setErro(""); setDados(d as Dados);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const acao = async (corpo: Record<string, unknown>, feito: string) => {
    setOcupado(true);
    const { ok, d } = await chamar(corpo);
    setOcupado(false);
    notify(ok ? (typeof d.novas === "number" ? `${feito}: ${d.novas} sugestão(ões) nova(s).` : feito) : d.error || "Não foi possível.");
    if (ok && d.segredo) setSegredo({ fonte: String(d.id ?? corpo.fonte), segredo: d.segredo });
    if (ok) void carregar();
    return ok;
  };

  if (erro) return <Callout variant="warning" title="Conectores">{erro}</Callout>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">DADOS DE FORA</p>
          <h1>Conectores</h1>
          <p>Trazem para a plataforma os dados de outro sistema (o GRV, um banco antigo, uma pasta). Só leitura na origem; tudo entra na área de chegada e só vira cadastro pelo de-para aprovado pela área.</p>
        </div>
        <div className="icms-acoes">
          <Button type="button" variant="secondary" onClick={() => void carregar()} disabled={ocupado}>Atualizar</Button>
          {!nova && <Button type="button" onClick={() => setNova({ nome: "", sistema: "", tipo: dados.tipos[0]?.tipo ?? "firebird" })}>Adicionar fonte</Button>}
        </div>
      </div>

      {nova && (
        <form className="wa-form con-form" onSubmit={(e) => { e.preventDefault(); void acao({ acao: "criar", ...nova }, "Fonte criada. Guarde o segredo abaixo: ele aparece uma vez só.").then((ok) => { if (ok) setNova(null); }); }}>
          <b>Nova fonte de dados</b>
          <label>Nome<input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} maxLength={60} placeholder="Ex.: GRV" required /></label>
          <label>Sistema de origem<input value={nova.sistema} onChange={(e) => setNova({ ...nova, sistema: e.target.value })} maxLength={60} placeholder="Ex.: GRV Sistemas" /></label>
          <label>Tipo
            <select value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value })}>
              {dados.tipos.map((t) => <option key={t.tipo} value={t.tipo}>{t.rotulo}</option>)}
            </select>
          </label>
          <div className="wa-acoes">
            <Button type="button" variant="secondary" onClick={() => setNova(null)}>Cancelar</Button>
            <Button type="submit" disabled={ocupado}>{ocupado ? "Criando…" : "Criar"}</Button>
          </div>
        </form>
      )}

      {!dados.fontes.length
        ? <div className="finance-empty almox-vazio"><b>Nenhuma fonte ainda</b><small>Adicione a primeira (o GRV) e instale o serviço conector perto dela com o segredo que aparecer.</small></div>
        : dados.fontes.map((f) => <CartaoFonte key={f.id} f={f} degraus={dados.degraus} segredo={segredo?.fonte === f.id ? segredo.segredo : null} fecharSegredo={() => setSegredo(null)} acao={acao} ocupado={ocupado} notify={notify} />)}

      <Callout variant="info" title="Como funciona">
        {"O serviço conector roda perto da fonte (na Pecsil, no próprio servidor da plataforma, que está na rede do GRV) com um usuário do banco só de leitura, pedido à TI. A senha desse banco fica só no serviço; a plataforma guarda só o hash do segredo do conector. Cada registro entra uma vez só: igual não entra de novo; alterado vira nova versão."}
      </Callout>
    </>
  );
}

function CartaoFonte({ f, degraus, segredo, fecharSegredo, acao, ocupado, notify }: {
  f: Fonte; degraus: Record<string, string>; segredo: string | null; fecharSegredo: () => void;
  acao: (corpo: Record<string, unknown>, feito: string) => Promise<boolean>; ocupado: boolean; notify: (m: string) => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const [objetos, setObjetos] = useState<{ nome: string; consulta: string; chave: string }[] | null>(null);
  const [intervalo, setIntervalo] = useState(f.intervalo_min);
  const [amostra, setAmostra] = useState<{ objeto: string; registros: { chave: string; dados: unknown; versao: number }[] } | null>(null);
  const [sugerir, setSugerir] = useState<{ objeto: string; campo: string; entidade: string } | null>(null);

  const editar = () => setObjetos(f.objetos.map((o) => ({ nome: o.nome, consulta: o.consulta, chave: o.chave.join(", ") })));
  const usarTabela = (t: Tabela) => {
    const base = objetos ?? f.objetos.map((o) => ({ nome: o.nome, consulta: o.consulta, chave: o.chave.join(", ") }));
    if (base.some((o) => o.nome.toLowerCase() === t.nome.toLowerCase())) { notify(`"${t.nome}" já está nos objetos.`); return; }
    setObjetos([...base, { nome: t.nome, consulta: `SELECT * FROM ${t.nome}`, chave: t.colunas[0]?.nome ?? "" }]);
  };
  const verAmostra = async (objeto: string) => {
    const r = await fetch(`/api/foundation/conectores?fonte=${f.id}&objeto=${encodeURIComponent(objeto)}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setAmostra({ objeto, registros: d.registros ?? [] }); else notify(d.error || "Não foi possível ler a amostra.");
  };
  const tabelas = f.descoberta?.tabelas ?? [];

  return (
    <section className={`wa-canal con-fonte${f.ativo ? "" : " inativo"}`} aria-label={`Fonte ${f.nome}`}>
      <header>
        <div>
          <h2>{f.nome}{f.sistema ? <small className="wa-depto"> · {f.sistema}</small> : null}</h2>
          <small>{degraus[f.degrau] ?? ""} · {f.tipo}{f.versao_conector ? ` · conector ${f.versao_conector}` : ""} · último contato {quando(f.ultimo_contato)}</small>
          {f.ultimo_erro && <p className="con-erro" role="alert">Último erro do conector: {f.ultimo_erro}</p>}
        </div>
        <div className="wa-canal-estado"><Status tone={TOM[f.situacao.estado]}>{f.situacao.rotulo}</Status></div>
      </header>

      {segredo && (
        <div className="con-segredo" role="status">
          <b>Configuração do serviço conector (o segredo aparece só agora)</b>
          <pre>{`PLATAFORMA_URL=${typeof window !== "undefined" ? window.location.origin : ""}\nCONECTOR_FONTE=${f.id}\nCONECTOR_SEGREDO=${segredo}`}</pre>
          <div className="wa-acoes">
            <Button type="button" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(`CONECTOR_FONTE=${f.id}\nCONECTOR_SEGREDO=${segredo}`).then(() => notify("Copiado."), () => notify("Não foi possível copiar.")); }}>Copiar</Button>
            <Button type="button" onClick={fecharSegredo}>Já guardei</Button>
          </div>
        </div>
      )}

      <div className="wa-acoes">
        <Button type="button" variant="secondary" onClick={() => void acao({ acao: "descobrir", fonte: f.id }, "Descoberta pedida: o conector faz na próxima tarefa.")} disabled={ocupado || f.descobrir}>{f.descobrir ? "Descoberta pedida" : "Descobrir de novo"}</Button>
        <Button type="button" variant="secondary" onClick={() => (objetos ? setObjetos(null) : editar())}>{objetos ? "Fechar objetos" : "Objetos a extrair"}</Button>
        <Button type="button" variant="ghost" onClick={() => void acao({ acao: "novo_segredo", fonte: f.id }, "Segredo trocado: atualize o serviço conector.")} disabled={ocupado}>Trocar segredo</Button>
        <Button type="button" variant="ghost" onClick={() => void acao({ acao: f.ativo ? "desativar" : "ativar", fonte: f.id }, f.ativo ? "Fonte desativada." : "Fonte ativada.")} disabled={ocupado}>{f.ativo ? "Desativar" : "Ativar"}</Button>
        {!confirmar && <Button type="button" variant="ghost" onClick={() => setConfirmar(true)}>Remover</Button>}
      </div>
      {confirmar && (
        <div className="wa-acoes wa-confirmar">
          <small>A fonte sai com tudo o que chegou dela (registros, remessas e de-para). Isso não se desfaz.</small>
          <Button type="button" variant="secondary" onClick={() => setConfirmar(false)}>Cancelar</Button>
          <Button type="button" onClick={() => void acao({ acao: "remover", fonte: f.id }, "Fonte removida.")}>Confirmar remoção</Button>
        </div>
      )}

      <details className="con-bloco" open={!f.objetos.length && tabelas.length > 0}>
        <summary>Descoberta do esquema {f.descoberta ? `· ${tabelas.length} tabelas${f.descoberta.banco ? ` · ${f.descoberta.banco.produto}${f.descoberta.banco.versao ? ` ${f.descoberta.banco.versao}` : ""}` : ""} · ${quando(f.descoberta.em)}` : "· ainda não feita"}</summary>
        {!tabelas.length
          ? <small className="sara-guia-nota">Quando o conector se conectar, ele lista as tabelas, as colunas e quantas linhas cada uma tem.</small>
          : (
            <div className="fin-tabela-rolagem con-rolagem">
              <table className="wa-tabela">
                <thead><tr><th>Tabela</th><th className="num">Linhas</th><th>Colunas</th><th><span className="sr-only">Ações</span></th></tr></thead>
                <tbody>
                  {tabelas.slice(0, 200).map((t) => (
                    <tr key={t.nome}>
                      <td>{t.nome}</td><td className="num">{num(t.linhas)}</td>
                      <td><small>{t.colunas.slice(0, 8).map((c) => c.nome).join(", ")}{t.colunas.length > 8 ? ` +${t.colunas.length - 8}` : ""}</small></td>
                      <td className="wa-linha-acoes"><Button type="button" variant="ghost" onClick={() => usarTabela(t)}>Extrair</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </details>

      {objetos && (
        <form className="wa-form con-objetos" onSubmit={(e) => { e.preventDefault(); void acao({ acao: "salvar_objetos", fonte: f.id, objetos: objetos.map((o) => ({ ...o, chave: o.chave.split(",") })), intervalo_min: intervalo }, "Objetos salvos.").then((ok) => { if (ok) setObjetos(null); }); }}>
          <b>Objetos a extrair</b>
          <small className="sara-guia-nota">Cada objeto é uma consulta só de leitura (SELECT) e os campos que identificam o registro (a chave). O conector recusa qualquer comando que grave.</small>
          {objetos.map((o, i) => (
            <fieldset key={i} className="con-objeto">
              <label>Nome<input value={o.nome} onChange={(e) => setObjetos(objetos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} maxLength={120} required /></label>
              <label>Chave<input value={o.chave} onChange={(e) => setObjetos(objetos.map((x, j) => (j === i ? { ...x, chave: e.target.value } : x)))} placeholder="CODIGO ou SERIE, NUMERO" required /></label>
              <label className="wa-obs">Consulta<textarea value={o.consulta} onChange={(e) => setObjetos(objetos.map((x, j) => (j === i ? { ...x, consulta: e.target.value } : x)))} rows={2} maxLength={4000} required /></label>
              <Button type="button" variant="ghost" onClick={() => setObjetos(objetos.filter((_, j) => j !== i))}>Tirar</Button>
            </fieldset>
          ))}
          <label>Intervalo (minutos)<input type="number" min={5} max={1440} value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value) || 60)} /></label>
          <div className="wa-acoes">
            <Button type="button" variant="secondary" onClick={() => setObjetos([...objetos, { nome: "", consulta: "SELECT * FROM ", chave: "" }])}>Adicionar objeto</Button>
            <Button type="submit" disabled={ocupado}>Salvar objetos</Button>
          </div>
        </form>
      )}

      {f.objetos.length > 0 && (
        <div className="fin-tabela-rolagem con-rolagem">
          <table className="wa-tabela">
            <thead><tr><th>Objeto</th><th>Chave</th><th className="num">Registros</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {f.objetos.map((o) => (
                <tr key={o.nome}>
                  <td>{o.nome}</td><td>{o.chave.join(", ")}</td><td className="num">{num(o.registros)}</td>
                  <td className="wa-linha-acoes">
                    <Button type="button" variant="ghost" onClick={() => void verAmostra(o.nome)} disabled={!o.registros}>Amostra</Button>
                    <Button type="button" variant="ghost" onClick={() => setSugerir({ objeto: o.nome, campo: "", entidade: "fornecedor" })} disabled={!o.registros}>Ligar a cadastro</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {amostra && (
        <div className="con-bloco">
          <b>Amostra de {amostra.objeto} (as 20 últimas alterações)</b>
          <pre className="con-amostra">{amostra.registros.map((r) => `${r.chave}${r.versao > 1 ? ` (v${r.versao})` : ""}: ${JSON.stringify(r.dados)}`).join("\n") || "Nada ainda."}</pre>
          <Button type="button" variant="ghost" onClick={() => setAmostra(null)}>Fechar</Button>
        </div>
      )}

      {sugerir && (
        <form className="wa-form" onSubmit={(e) => { e.preventDefault(); void acao({ acao: "sugerir", fonte: f.id, ...sugerir }, "Sugestões pela regra").then((ok) => { if (ok) setSugerir(null); }); }}>
          <b>Ligar {sugerir.objeto} a um cadastro da plataforma</b>
          <label>Cadastro
            <select value={sugerir.entidade} onChange={(e) => setSugerir({ ...sugerir, entidade: e.target.value })}>
              {ENTIDADES.map((x) => <option key={x.v} value={x.v}>{x.r}</option>)}
            </select>
          </label>
          <label>Campo da origem<input value={sugerir.campo} onChange={(e) => setSugerir({ ...sugerir, campo: e.target.value })} placeholder="Ex.: CGC, CNPJ, CODIGO" required /></label>
          <small className="sara-guia-nota">A regra só sugere quando há UM cadastro com o mesmo documento ou código. Quem cuida daquele cadastro aprova.</small>
          <div className="wa-acoes">
            <Button type="button" variant="secondary" onClick={() => setSugerir(null)}>Cancelar</Button>
            <Button type="submit" disabled={ocupado}>Sugerir</Button>
          </div>
        </form>
      )}

      {f.depara.length > 0 && (
        <div className="con-bloco">
          <b>De-para para decidir ({f.depara.length})</b>
          <div className="fin-tabela-rolagem con-rolagem">
            <table className="wa-tabela">
              <thead><tr><th>Origem</th><th>Cadastro</th><th>Por quê</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {f.depara.slice(0, 50).map((x) => (
                  <tr key={x.id}>
                    <td>{x.objeto} {x.chave}</td><td>{x.destino_nome ?? "—"} <small>({x.entidade})</small></td><td><small>{x.motivo ?? "—"}</small></td>
                    <td className="wa-linha-acoes">
                      <Button type="button" variant="ghost" onClick={() => void acao({ acao: "decidir", fonte: f.id, depara: x.id, aprovar: true }, "De-para aprovado.")} disabled={ocupado}>Aprovar</Button>
                      <Button type="button" variant="ghost" onClick={() => void acao({ acao: "decidir", fonte: f.id, depara: x.id, aprovar: false }, "De-para recusado.")} disabled={ocupado}>Recusar</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {f.lotes.length > 0 && (
        <details className="con-bloco">
          <summary>Últimas remessas</summary>
          <ul className="con-lotes">
            {f.lotes.map((l, i) => (
              <li key={i}>{quando(l.created_at)} · {l.tipo === "descoberta" ? `descoberta (${num(l.recebidos)} tabelas)` : `${l.objeto}: ${num(l.recebidos)} recebidos, ${num(l.novos)} novos, ${num(l.alterados)} alterados, ${num(l.iguais)} iguais`}{l.erro ? <small className="wa-falta"> · {l.erro}</small> : null}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
