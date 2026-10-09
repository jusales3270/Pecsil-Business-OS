"use client";

import { useState } from "react";
import { Button, Modal, Segmented } from "../../../packages/design-system";
import { Icone, UNIDADES, chamar } from "./tipos";

type Linha = { produto: string; quantidade: string; unidade: string; observacao: string };
const vazia = (): Linha => ({ produto: "", quantidade: "", unidade: "UN", observacao: "" });

/** Pedido de material ao Compras: itens, divisão e urgência. Quem cota é avisado na hora. */
export function PedidoModal({ onClose, onCriado, endpoint = "/api/almoxarifado/solicitacoes", divisaoFixa, eyebrow = "Almoxarifado · novo pedido" }: {
  onClose: () => void;
  onCriado: (numero: number) => void;
  /** Rota que grava o pedido (Almoxarifado ou Fundição). */
  endpoint?: string;
  /** Divisão definida por quem pede (a Fundição só pede para a Fundição): esconde a escolha. */
  divisaoFixa?: "USINAGEM" | "FUNDICAO";
  eyebrow?: string;
}) {
  const [divisao, setDivisao] = useState<"USINAGEM" | "FUNDICAO">(divisaoFixa ?? "USINAGEM");
  const [urgente, setUrgente] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([vazia()]);
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const mudar = (index: number, campo: keyof Linha, valor: string) => setLinhas((atual) => atual.map((linha, i) => (i === index ? { ...linha, [campo]: valor } : linha)));
  const numero = (texto: string) => Number(texto.replace(/\./g, "").replace(",", "."));

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    const itens = linhas.filter((linha) => linha.produto.trim());
    if (!itens.length) { setErro("Informe ao menos um item."); return; }
    if (itens.some((linha) => !(numero(linha.quantidade) > 0))) { setErro("Toda linha precisa de quantidade."); return; }
    setSalvando(true);
    setErro("");
    const res = await chamar<{ numero: number }>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        divisao, urgencia: urgente ? "urgente" : "normal", observacao,
        itens: itens.map((linha) => ({ produto: linha.produto.trim(), quantidade: numero(linha.quantidade), unidade: linha.unidade, observacao: linha.observacao.trim() })),
      }),
    });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    onCriado(res.data.numero);
  };

  return (
    <Modal eyebrow={eyebrow} title="Pedir material ao Compras" subtitle="Quem cota recebe o aviso na hora. Você acompanha a cotação, a aprovação e a compra por aqui." onClose={onClose}>
      <form className="almox-form" onSubmit={salvar}>
        <div className="almox-form-linha">
          {divisaoFixa ? <span /> : (
            <label><span>Divisão</span>
              <Segmented<"USINAGEM" | "FUNDICAO"> options={[{ value: "USINAGEM", label: "Usinagem" }, { value: "FUNDICAO", label: "Fundição" }]} value={divisao} onChange={setDivisao} ariaLabel="Divisão" />
            </label>
          )}
          <label className="almox-marca"><input type="checkbox" checked={urgente} onChange={(event) => setUrgente(event.target.checked)} /> <span>Urgente — está parando o trabalho</span></label>
        </div>

        <div className="almox-itens-form" role="table" aria-label="Itens do pedido">
          <div className="cabeca" role="row"><span>Material</span><span>Quantidade</span><span>Unidade</span><span>Observação</span><span /></div>
          {linhas.map((linha, index) => (
            <div key={index} role="row">
              <input value={linha.produto} onChange={(event) => mudar(index, "produto", event.target.value)} placeholder="Ex.: Broca HSS 10 mm" aria-label={`Material ${index + 1}`} autoFocus={index === 0} />
              <input value={linha.quantidade} onChange={(event) => mudar(index, "quantidade", event.target.value)} inputMode="decimal" placeholder="0" aria-label={`Quantidade ${index + 1}`} />
              <select value={linha.unidade} onChange={(event) => mudar(index, "unidade", event.target.value)} aria-label={`Unidade ${index + 1}`}>
                {UNIDADES.map((unidade) => <option key={unidade}>{unidade}</option>)}
              </select>
              <input value={linha.observacao} onChange={(event) => mudar(index, "observacao", event.target.value)} placeholder="Marca, medida, aplicação…" aria-label={`Observação ${index + 1}`} />
              <button type="button" className="almox-icone-botao" onClick={() => setLinhas((atual) => (atual.length > 1 ? atual.filter((_, i) => i !== index) : [vazia()]))} aria-label={`Remover item ${index + 1}`}><Icone nome="lixo" size={16} /></button>
            </div>
          ))}
          <button type="button" className="almox-adicionar" onClick={() => setLinhas((atual) => [...atual, vazia()])}><Icone nome="mais" size={16} /> Adicionar item</button>
        </div>

        <label className="almox-largo"><span>Observação para o Compras</span>
          <textarea rows={2} value={observacao} onChange={(event) => setObservacao(event.target.value)} placeholder="Opcional: para quando precisa, fornecedor de costume…" />
        </label>

        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando ? "Enviando…" : "Enviar pedido"}</Button>
        </footer>
      </form>
    </Modal>
  );
}
