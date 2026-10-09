"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Kpi, KpiGrid } from "../../../packages/design-system";
import { useModuleNav } from "../../../lib/module-nav-context";
import type { ModuleRuntimeProps } from "../../runtime";
import { PedidoModal } from "../../almoxarifado/src/PedidoModal";
import { CancelarModal, CartaoPedido, ListaPedidos } from "../../almoxarifado/src/pedidos-ui";
import { Icone, type Pedido, chamar } from "../../almoxarifado/src/tipos";

/**
 * Fundição: painel do Guilherme para pedir material ao Compras e acompanhar cada
 * pedido (em cotação, aprovado, comprado, recebido). Só aparecem os pedidos feitos
 * pela Fundição; o material chega pelo Almoxarifado, e cada passo avisa no sino.
 */
export default function FundicaoApp({ notify }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [podePedir, setPodePedir] = useState(false);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState(false);
  const [cancelar, setCancelar] = useState<Pedido | null>(null);

  const carregar = useCallback(async () => {
    const res = await chamar<{ requests: Pedido[]; canRequest: boolean }>("/api/fundicao/pedidos");
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    setPedidos(res.data.requests);
    setPodePedir(res.data.canRequest);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  useEffect(() => {
    registerNav({
      moduleId: "fundicao",
      moduleName: "Fundição",
      sidebarTree: true,
      items: [{ id: "Pedidos de material", label: "Pedidos de material", icon: "inbox" }],
      activeId: "Pedidos de material",
      onSelect: () => undefined,
    });
  }, [registerNav]);
  useEffect(() => () => registerNav(null), [registerNav]);

  const depois = async (mensagem: string) => { notify(mensagem); await carregar(); };

  const resumo = useMemo(() => {
    const lista = pedidos ?? [];
    return {
      cotando: lista.filter((p) => p.status === "aberta" || p.status === "em_cotacao").length,
      aprovados: lista.filter((p) => p.status === "aprovada").length,
      rejeitados: lista.filter((p) => p.status === "rejeitada").length,
      caminho: lista.filter((p) => p.status === "comprada" || p.status === "parcial").length,
      recebidos: lista.filter((p) => p.status === "recebida").length,
    };
  }, [pedidos]);

  const botaoPedir = podePedir ? <Button onClick={() => setNovo(true)}><Icone nome="mais" size={16} /> Pedir material</Button> : null;
  const cabecalho = (
    <div className="finance-page-head almox-head">
      <div><p className="eyebrow">FUNDIÇÃO · PEDIDOS</p><h1>Pedidos de material</h1><p>Peça ao Compras o que a Fundição precisa. O pedido vai com o seu nome, e você acompanha cada passo por aqui: cotação, aprovação, compra e chegada no Almoxarifado.</p></div>
      {botaoPedir}
    </div>
  );

  return (
    <div className="almox-modulo">
      {erro ? (
        <>{cabecalho}<div className="finance-empty almox-vazio"><b>{erro}</b><small>Tente de novo em instantes.</small></div></>
      ) : !pedidos ? (
        <>{cabecalho}<div className="finance-empty almox-vazio"><b>Carregando…</b><small /></div></>
      ) : (
        <>
          {cabecalho}
          <KpiGrid>
            <Kpi label="Com o Compras" value={String(resumo.cotando)} caption="Aguardando ou em cotação" tone="amber" />
            <Kpi label="Aprovados" value={String(resumo.aprovados)} caption={resumo.rejeitados ? `${resumo.rejeitados} rejeitado(s)` : "Aguardando a compra"} tone="green" />
            <Kpi label="A caminho" value={String(resumo.caminho)} caption="Comprados, chegam pelo Almoxarifado" tone="purple" />
            <Kpi label="Recebidos" value={String(resumo.recebidos)} caption="Material já entregue" tone="blue" />
          </KpiGrid>
          <ListaPedidos
            pedidos={pedidos}
            cabecalho={null}
            vazio={pedidos.length ? "Nenhum pedido neste filtro" : "Nenhum pedido da Fundição ainda"}
            cartao={(p) => <CartaoPedido key={p.id} pedido={p} onCancelar={podePedir ? setCancelar : undefined} />}
          />
        </>
      )}
      {novo && (
        <PedidoModal
          endpoint="/api/fundicao/pedidos"
          divisaoFixa="FUNDICAO"
          eyebrow="Fundição · novo pedido"
          onClose={() => setNovo(false)}
          onCriado={(numero) => { setNovo(false); void depois(`Pedido #${numero} enviado ao Compras.`); }}
        />
      )}
      {cancelar && (
        <CancelarModal
          pedido={cancelar}
          url={`/api/fundicao/pedidos/${cancelar.id}/cancelar`}
          eyebrow="Fundição"
          onClose={() => setCancelar(null)}
          onFeito={() => { const n = cancelar.numero; setCancelar(null); void depois(`Pedido #${n} cancelado.`); }}
        />
      )}
    </div>
  );
}
