"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportDocument } from "../../components/report-layout";
import type { EmitenteOrdem, OrdemCompra } from "../../../lib/compras/ordem-compra";
import type { Saving } from "../../../lib/compras/comparativo";

/**
 * Ordem de Compra da cotação aprovada, no modelo do sistema antigo (nº 14805):
 * cabeçalho com logo e os dados da empresa (Fiscal › Configuração), quadro do fornecedor, materiais,
 * frete/pagamento/prazos, totais, observação e as notas fixas. A4 paisagem;
 * o PDF sai pelo "Salvar como PDF" do navegador. O número é o da cotação.
 */

type Estado = { status: "loading" } | { status: "error"; mensagem: string } | { status: "ready"; ordem: OrdemCompra; emitente: EmitenteOrdem; saving: Saving | null };

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

function OrdemDeCompra({ ordem, emitente: e, saving }: { ordem: OrdemCompra; emitente: EmitenteOrdem; saving: Saving | null }) {
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
          <b>{e.razaoSocial}</b>
          {e.endereco && <span>{e.endereco}</span>}
          {e.cidade && <span>{e.cidade}</span>}
          {e.telefones && <span>Fone: {e.telefones}</span>}
          <span>CNPJ: {e.cnpj}{e.ie ? ` - IE: ${e.ie}` : ""}</span>
          {e.site && <span>{e.site}</span>}
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
      {saving && (saving.vsMaior > 0 || (saving.vsUltimaCompra ?? 0) !== 0 || (saving.ganhoPagamentoDias ?? 0) > 0) && (
        <p className="oc-saving">
          <b>Economia na compra:</b>{" "}
          {[
            saving.vsMaior > 0 ? `R$ ${reais(saving.vsMaior)} frente à maior das ${saving.concorrentes + 1} cotações` : null,
            saving.vsUltimaCompra !== null && saving.vsUltimaCompra !== 0 ? (saving.vsUltimaCompra > 0 ? `R$ ${reais(saving.vsUltimaCompra)} abaixo da última compra` : `R$ ${reais(-saving.vsUltimaCompra)} acima da última compra`) : null,
            saving.ganhoPagamentoDias && saving.ganhoPagamentoDias > 0 ? `${saving.ganhoPagamentoDias} dias a mais de prazo de pagamento` : null,
          ].filter(Boolean).join(" · ")}
        </p>
      )}
      {ordem.parcial && <p className="oc-aviso-parcial">Itens rejeitados ou ainda em aprovação nesta cotação não constam desta ordem de compra.</p>}

      <footer className="oc-rodape">
        <div className="oc-notas">
          {e.notas.length > 0 && <b>Notas:</b>}
          {e.notas.length > 0 && (
            <ol>
              {e.notas.map((trechos, i) => (
                <li key={i}>{i + 1} - {trechos.map((t, k) => (t.negrito ? <strong key={k}>{t.texto}</strong> : <span key={k}>{t.texto}</span>))}</li>
              ))}
            </ol>
          )}
        </div>
        <div className="oc-assinaturas">
          {ordem.direta
            ? <p>Compra direta · autorizada por: <span>{ordem.aprovadoPor ?? ""}</span></p>
            : <p>Aprovado eletronicamente por: <span>{ordem.aprovadoPor ?? ""}</span></p>}
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
        return body as { ordem: OrdemCompra; emitente: EmitenteOrdem; saving: Saving | null };
      })
      .then(({ ordem, emitente, saving }) => { if (ativo) setEstado({ status: "ready", ordem, emitente, saving: saving ?? null }); })
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
      <OrdemDeCompra ordem={estado.ordem} emitente={estado.emitente} saving={estado.saving} />
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
