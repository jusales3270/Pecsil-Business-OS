"use client";

import { useEffect, useState } from "react";
import { Callout, Status } from "../../../packages/design-system";
import { type Motorista, chamarLogistica, haQuanto, useAgora } from "./tipos";

/** Frota: veículos e motoristas como estão no Fleetbase (o cadastro é feito no console de despacho). */
type Veiculo = { id: string; placa: string | null; modelo: string | null; ano: string | null; situacao: string | null; online: boolean };

export function Frota() {
  const [dados, setDados] = useState<{ servico: boolean; veiculos: Veiculo[]; motoristas: Motorista[] } | null>(null);
  const [erro, setErro] = useState("");
  const agora = useAgora();
  useEffect(() => {
    let vivo = true;
    void chamarLogistica<{ servico: boolean; veiculos: Veiculo[]; motoristas: Motorista[] }>("/api/logistica/frota").then((r) => {
      if (!vivo) return;
      if (r.ok) setDados(r.data); else setErro(r.error);
    });
    return () => { vivo = false; };
  }, []);

  return (
    <>
      <div className="finance-page-head almox-head">
        <div>
          <p className="eyebrow">LOGÍSTICA · FROTA</p>
          <h1>Frota</h1>
          <p>Caminhões e motoristas. O cadastro, a escala e a manutenção ficam no console de despacho (Fleetbase); aqui é a leitura.</p>
        </div>
      </div>
      {erro && <Callout variant="danger" title="Não carregou">{erro}</Callout>}
      {dados && !dados.servico && <Callout variant="warning" title="Serviço de entregas desligado">Sem o Fleetbase ligado, não há frota para mostrar.</Callout>}
      <div className="almox-painel">
        <section className="almox-bloco">
          <div className="almox-bloco-topo"><div><p className="eyebrow">VEÍCULOS</p><h2>{dados ? `${dados.veiculos.length} cadastrado(s)` : "…"}</h2></div></div>
          <ul className="logi-frota">
            {(dados?.veiculos ?? []).map((v) => (
              <li key={v.id}><b>{v.placa ?? "sem placa"}</b><small>{[v.modelo, v.ano].filter(Boolean).join(" · ") || "—"}</small><Status tone={v.online ? "success" : "neutral"}>{v.online ? "em uso" : "parado"}</Status></li>
            ))}
            {dados && !dados.veiculos.length && <li className="ti-nota">Nenhum veículo cadastrado no Fleetbase.</li>}
          </ul>
        </section>
        <section className="almox-bloco">
          <div className="almox-bloco-topo"><div><p className="eyebrow">MOTORISTAS</p><h2>{dados ? `${dados.motoristas.length} cadastrado(s)` : "…"}</h2></div></div>
          <ul className="logi-frota">
            {(dados?.motoristas ?? []).map((m) => (
              <li key={m.id}><b>{m.nome}</b><small>{m.veiculo?.placa ? `${m.veiculo.placa} · ` : ""}{m.posicao ? `posição ${haQuanto(m.atualizado, agora)}` : "sem posição ainda"}</small><Status tone={m.online ? "success" : "neutral"}>{m.online ? "online" : "offline"}</Status></li>
            ))}
            {dados && !dados.motoristas.length && <li className="ti-nota">Nenhum motorista cadastrado no Fleetbase.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
