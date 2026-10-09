"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportDocument } from "../../components/report-layout";
import { EMPRESA_PECSIL, NOTAS_ORDEM_COMPRA } from "../../../lib/empresa";
import type { OrdemCompra } from "../../../lib/compras/ordem-compra";

/**
 * Ordem de Compra da cotação aprovada, no modelo do sistema antigo (nº 14805):
 * cabeçalho com logo e dados da PecSil, quadro do fornecedor, materiais,
 * frete/pagamento/prazos, totais, observação e as notas fixas. A4 paisagem;
 * o PDF sai pelo "Salvar como PDF" do navegador. O número é o da cotação.
 */

type Estado = { status: "loading" } | { status: "error"; mensagem: string } | { status: "ready"; ordem: OrdemCompra };

const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitario = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantidade = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const pct = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (iso: string | null) => {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split("-").reverse().join("/");
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};
const cnpj = (v: string | null) => (v && /^\d{14}$/.test(v) ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : v ?? "");
const cep = (v: string | null) => (v && /^\d{8}$/.test(v) ? v.replace(/^(\d{5})(\d{3})$/, "$1-$2") : v ?? "");

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return <p><b>{rotulo}:</b> <span>{valor || ""}</span></p>;
}

function OrdemDeCompra({ ordem }: { ordem: OrdemCompra }) {
  const f = ordem.fornecedor;
  return (
    <div className="oc">
      <header className="oc-topo">
        <div className="oc-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- impressão precisa da imagem direta, sem otimização */}
          <img src="/logo-pecsil.png" alt="PecSil" />
        </div>
        <div className="oc-titulo"><h1>Ordem de Compra</h1><p>Nº: {ordem.numero}</p></div>
        <div className="oc-empresa">
          <b>{EMPRESA_PECSIL.razaoSocial}</b>
          <span>{EMPRESA_PECSIL.endereco}</span>
          <span>{EMPRESA_PECSIL.cidade}</span>
          <span>Fone: {EMPRESA_PECSIL.telefones}</span>
          <span>CNPJ: {EMPRESA_PECSIL.cnpj} - IE: {EMPRESA_PECSIL.ie}</span>
          <span>{EMPRESA_PECSIL.site}</span>
        </div>
      </header>

      <section className="oc-fornecedor" aria-label="Fornecedor">
        <div>
          <Campo rotulo="Fornecedor" valor={f.nome} />
          <Campo rotulo="Endereço" valor={f.endereco} />
          <Campo rotulo="Cidade" valor={f.cidade} />
          <Campo rotulo="CNPJ" valor={cnpj(f.cnpj)} />
        </div>
        <div>
          <Campo rotulo="Contato" valor={f.contato} />
          <Campo rotulo="UF" valor={f.uf} />
          <Campo rotulo="IE" valor={f.ie} />
        </div>
        <div>
          <Campo rotulo="CEP" valor={cep(f.cep)} />
          <Campo rotulo="E-mail" valor={f.email} />
          <Campo rotulo="Telefone" valor={f.telefone} />
        </div>
      </section>

      <table className="oc-tabela oc-materiais">
        <thead>
          <tr><th colSpan={8} className="oc-faixa">Materiais</th></tr>
          <tr>
            <th>Item</th><th className="oc-esq">Descrição</th><th>Qtde</th><th>UN</th><th>% ICMS</th><th>% IPI</th>
            <th>Preço unitário<br />c/ ICMS s/IPI (R$)</th><th>Valor total (R$)</th>
          </tr>
        </thead>
        <tbody>
          {ordem.itens.map((l) => (
            <tr key={l.item}>
              <td>{l.item}</td><td className="oc-esq">{l.descricao}</td><td className="oc-num">{quantidade(l.quantidade)}</td><td>{l.unidade.toUpperCase()}</td>
              <td className="oc-num">{pct(l.icms)}</td><td className="oc-num">{pct(l.ipi)}</td><td className="oc-num">{unitario(l.precoUnit)}</td><td className="oc-num">{reais(l.total)}</td>
            </tr>
          ))}
          <tr className="oc-total"><td colSpan={7} className="oc-dir">Total:</td><td className="oc-num">{reais(ordem.totais.itens)}</td></tr>
        </tbody>
      </table>

      <table className="oc-tabela oc-condicoes">
        <tbody>
          <tr>
            <td colSpan={2} className="oc-esq"><b>Transportadora:</b></td>
            <td colSpan={3} className="oc-esq"><b>Frete:</b> {ordem.frete.texto}</td>
            <th>Data de Emissão</th>
            <th>Prazo de entrega</th>
          </tr>
          <tr>
            <td colSpan={5} className="oc-esq"><b>Forma de pagamento:</b> {ordem.formaPagamento}</td>
            <td>{dia(ordem.emissao)}</td>
            <td>{dia(ordem.prazoEntrega)}</td>
          </tr>
          <tr className="oc-rotulos">
            <th>Total dos itens (R$)</th><th>Valor do frete (R$)</th><th>Valor do seguro (R$)</th><th>Valor de outras despesas (R$)</th>
            <th>Valor do ICMS (R$)</th><th>Valor do IPI (R$)</th><th>Valor total do pedido (R$)</th>
          </tr>
          <tr className="oc-valores">
            <td>{reais(ordem.totais.itens)}</td><td>{reais(ordem.totais.frete)}</td><td>{reais(ordem.totais.seguro)}</td><td>{reais(ordem.totais.outras)}</td>
            <td>{reais(ordem.totais.icms)}</td><td>{reais(ordem.totais.ipi)}</td><td><b>{reais(ordem.totais.pedido)}</b></td>
          </tr>
          <tr><td colSpan={7} className="oc-esq oc-obs"><b>Observação:</b> {ordem.observacao ?? ""}</td></tr>
        </tbody>
      </table>
      {ordem.parcial && <p className="oc-aviso-parcial">Itens rejeitados ou ainda em aprovação nesta cotação não constam desta ordem de compra.</p>}

      <footer className="oc-rodape">
        <div className="oc-notas">
          <b>Notas:</b>
          <ol>
            {NOTAS_ORDEM_COMPRA.map((n, i) => {
              // Como no modelo: da nota 3 em diante o texto é em negrito (na 3, depois do rótulo).
              const [rotulo, resto] = i === 2 && n.includes(": ") ? [n.slice(0, n.indexOf(": ") + 2), n.slice(n.indexOf(": ") + 2)] : ["", n];
              return <li key={i}>{i + 1} - {rotulo}{i >= 2 ? <strong>{resto}</strong> : resto}</li>;
            })}
          </ol>
        </div>
        <div className="oc-assinaturas">
          <p>Aprovado eletronicamente por: <span>{ordem.aprovadoPor ?? ""}</span></p>
          <p>Solicitante: <span>{ordem.solicitante}</span></p>
        </div>
      </footer>
    </div>
  );
}

function OrdemCompraPage() {
  const id = useSearchParams().get("id") ?? "";
  const valido = /^\d{1,12}$/.test(id);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  useEffect(() => {
    if (!valido) return;
    let ativo = true;
    fetch(`/api/compras/ordem/${id}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre na plataforma e abra a ordem de compra de novo.");
        if (response.status === 403) throw new Error("Você não tem acesso ao Compras.");
        if (!response.ok) throw new Error(body?.error || "Não foi possível montar a ordem de compra agora.");
        return body as { ordem: OrdemCompra };
      })
      .then(({ ordem }) => { if (ativo) setEstado({ status: "ready", ordem }); })
      .catch((error: Error) => { if (ativo) setEstado({ status: "error", mensagem: error.message }); });
    return () => { ativo = false; };
  }, [id, valido]);

  const nomeFornecedor = estado.status === "ready" ? ` - ${estado.ordem.fornecedor.nome}` : "";
  const arquivo = `PecSil - Ordem de Compra ${valido ? id : ""}${nomeFornecedor}`.replace(/[\\/:*?"<>|]/g, " ").trim();

  if (!valido) {
    return <ReportDocument fileTitle="PecSil - Ordem de Compra" ready={false} tip="ordem de compra"><p className="report-empty">Cotação inválida. Abra a ordem de compra pela cotação no Compras.</p></ReportDocument>;
  }
  if (estado.status !== "ready") {
    return (
      <ReportDocument fileTitle={arquivo} ready={false} tip="ordem de compra">
        <p className="report-empty">{estado.status === "loading" ? "Montando a ordem de compra…" : estado.mensagem}</p>
      </ReportDocument>
    );
  }
  return (
    <ReportDocument fileTitle={arquivo} ready sheetClassName="oc-folha" tip="ordem de compra">
      {/* Só esta página imprime em A4 paisagem, como o modelo; sai junto quando a página fecha. */}
      <style>{"@page { size: A4 landscape; margin: 8mm 10mm 12mm; }"}</style>
      {estado.ordem.avisos.length > 0 && <p className="oc-avisos" role="note">{estado.ordem.avisos.join(" ")} Complete em Compras › Fornecedores para sair na ordem de compra.</p>}
      <OrdemDeCompra ordem={estado.ordem} />
    </ReportDocument>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <OrdemCompraPage />
    </Suspense>
  );
}
