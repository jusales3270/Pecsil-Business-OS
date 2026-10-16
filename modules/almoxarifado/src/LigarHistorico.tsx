"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Status } from "../../../packages/design-system";
import { BuscaMaterial, type MaterialEscolhido } from "./BuscaMaterial";
import { chamar } from "./tipos";

/**
 * Almoxarifado › Ligar histórico (A-01 · PLANO-ALMOXARIFADO M2): as compras e cotações de antes
 * do catálogo ganham o material. A sugestão é por regra (o código escrito no texto, senão o nome
 * mais parecido, com a nota de semelhança); quem confirma é o Almoxarifado ou o Compras.
 */
type Sugestao = MaterialEscolhido & { nota: number; por: "codigo" | "nome" };
type Item = { texto: string; ocorrencias: number; exemplo: string; sugestao: Sugestao | null };

export function LigarHistorico({ notify }: { notify: (m: string) => void }) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [trocando, setTrocando] = useState<Record<string, { texto: string; material: MaterialEscolhido | null }>>({});

  const carregar = useCallback(async () => {
    const r = await chamar<{ total: number; itens: Item[] }>("/api/almoxarifado/materiais/historico");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setItens(r.data.itens);
    setTotal(r.data.total);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const decidir = async (item: Item, material: MaterialEscolhido | null) => {
    setOcupado(item.texto);
    const r = await chamar<{ linhas: number }>("/api/almoxarifado/materiais/historico", { method: "POST", body: JSON.stringify({ texto: item.texto, material_id: material?.id ?? null }) });
    setOcupado(null);
    if (!r.ok) { notify(r.error); return; }
    notify(material ? `Ligado a ${material.codigo}: ${r.data.linhas} linha(s) do histórico.` : "Pulado: sai da lista.");
    setItens((atual) => (atual ?? []).filter((x) => x.texto !== item.texto));
    setTotal((t) => Math.max(0, t - 1));
  };

  if (erro) return <div className="finance-empty almox-vazio"><b>{erro}</b></div>;
  if (!itens) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;

  return (
    <div className="almox-historico">
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">ALMOXARIFADO · CATÁLOGO</p>
          <h1>Ligar histórico</h1>
          <p>Compras e cotações de antes do catálogo, agrupadas pelo texto. Confira a sugestão e ligue ao material: vale para todas as linhas com o mesmo texto. Se não for material de estoque, pule.</p>
        </div>
      </div>
      <Callout variant="info" title={`${total} texto(s) sem material`}>A sugestão é por regra, sem IA: primeiro o código do material escrito no texto; senão, o nome mais parecido do catálogo, com a semelhança de 0 a 100%. Ligar não muda o texto original.</Callout>
      {!itens.length && <div className="finance-empty almox-vazio"><b>Tudo ligado</b><small>Não há texto do histórico sem material.</small></div>}
      <div className="almox-historico-lista">
        {itens.map((item) => {
          const troca = trocando[item.texto];
          // Sugestão forte (código no texto ou nome ≥ 60% parecido) já vem escolhida; a fraca é só um
          // "talvez": a pessoa precisa usar a sugestão ou procurar outro material antes de ligar.
          const forte = Boolean(item.sugestao && (item.sugestao.por === "codigo" || item.sugestao.nota >= 0.6));
          const escolhido = troca ? troca.material : forte ? item.sugestao : null;
          return (
            <article key={item.texto} className="almox-historico-item">
              <header>
                <div><b>{item.exemplo}</b><small>{item.ocorrencias} linha(s) no histórico</small></div>
              </header>
              {troca ? (
                <BuscaMaterial valor={troca.texto} material={troca.material} ariaLabel={`Material para ${item.exemplo}`} autoFocus
                  onDigitar={(v) => setTrocando((x) => ({ ...x, [item.texto]: { texto: v, material: null } }))}
                  onEscolher={(m) => setTrocando((x) => ({ ...x, [item.texto]: { texto: m.descricao, material: m } }))} />
              ) : item.sugestao ? (
                <p className={`almox-historico-sugestao${forte ? "" : " fraca"}`}>
                  {!forte && <em>Talvez:</em>}
                  <span className="vnd-codigo">{item.sugestao.codigo}</span> {item.sugestao.descricao} <small>{item.sugestao.unidade}</small>
                  <Status tone={item.sugestao.por === "codigo" || item.sugestao.nota >= 0.9 ? "success" : item.sugestao.nota >= 0.6 ? "attention" : "neutral"}>
                    {item.sugestao.por === "codigo" ? "código no texto" : `nome ${Math.round(item.sugestao.nota * 100)}% parecido`}
                  </Status>
                </p>
              ) : <p className="almox-historico-sugestao sem">Sem sugestão: procure o material ou pule.</p>}
              <footer>
                <Button type="button" variant="secondary" compact disabled={ocupado === item.texto} onClick={() => void decidir(item, null)}>Pular</Button>
                {!troca && item.sugestao && !forte && <Button type="button" variant="secondary" compact onClick={() => setTrocando((x) => ({ ...x, [item.texto]: { texto: item.sugestao!.descricao, material: item.sugestao } }))}>Usar a sugestão</Button>}
                {!troca && <Button type="button" variant="secondary" compact onClick={() => setTrocando((x) => ({ ...x, [item.texto]: { texto: "", material: null } }))}>{item.sugestao ? "Outro material" : "Procurar material"}</Button>}
                <Button type="button" compact disabled={!escolhido || ocupado === item.texto} onClick={() => escolhido && void decidir(item, escolhido)}>
                  {ocupado === item.texto ? "Ligando…" : escolhido ? `Ligar a ${escolhido.codigo}` : "Ligar"}
                </Button>
              </footer>
            </article>
          );
        })}
      </div>
      {itens.length > 0 && total > itens.length && <p className="almox-nota-ajuda">Mostrando os {itens.length} textos mais frequentes. Os próximos aparecem ao decidir estes (ou ao recarregar).</p>}
    </div>
  );
}
