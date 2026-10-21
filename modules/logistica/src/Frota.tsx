"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, Modal, Segmented, Status } from "../../../packages/design-system";
import { getRhDocumentUrl } from "../../../lib/data/rh-documents-client";
import { chamarLogistica, comTraco, dataHora, haQuanto, useAgora } from "./tipos";

/**
 * Frota e motoristas: o cadastro é da plataforma e o Fleetbase recebe o espelho (placa e modelo do veículo; do
 * motorista, só o nome). O motorista é um colaborador do RH: a CNH é a que está nos documentos do RH (a tela
 * mostra se está lá e se foi conferida; abrir o arquivo é de quem tem documentos do RH). Quem tem a permissão de
 * frota "operar" cadastra; quem tem a de entregas vê.
 */
type Veiculo = { id: string; placa: string; tipo: string; marca: string | null; modelo: string | null; ano: number | null; capacidade_kg: number | null; observacao: string | null; ativo: boolean; fleetbase_veiculo: string | null; erro: string | null };
/** CNH como está nos documentos do RH; `caminho` só vem para quem tem a credencial de documentos do RH. */
type Cnh = { titulo: string; conferida: boolean; enviada_em: string; caminho: string | null };
type Motorista = { id: string; employee_id: string; nome: string; veiculo_id: string | null; ativo: boolean; fleetbase_motorista: string | null; erro: string | null; online: boolean; posicaoEm: string | null; cnh: Cnh | null };
type Dados = { servico: boolean; podeOperar: boolean; veiculos: Veiculo[]; motoristas: Motorista[] };

const TIPOS = [{ value: "caminhao", label: "Caminhão" }, { value: "van", label: "Van" }, { value: "utilitario", label: "Utilitário" }, { value: "carro", label: "Carro" }, { value: "moto", label: "Moto" }, { value: "outro", label: "Outro" }] as const;
const rotuloTipo = (t: string) => TIPOS.find((x) => x.value === t)?.label ?? t;
const placaBonita = comTraco;

export function Frota({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [veiculo, setVeiculo] = useState<Veiculo | "novo" | null>(null);
  const [motorista, setMotorista] = useState<Motorista | "novo" | null>(null);
  const agora = useAgora();

  const carregar = useCallback(async () => {
    const r = await chamarLogistica<Dados>("/api/logistica/frota");
    if (!r.ok) { setErro(r.error); return; }
    setErro(""); setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const salvou = async (msg: string) => { setVeiculo(null); setMotorista(null); notify(msg); await carregar(); };
  // A janela abre no clique (senão o navegador bloqueia) e recebe o link do arquivo quando ele chega.
  const verCnh = async (caminho: string) => {
    const janela = window.open("about:blank", "_blank");
    try {
      const url = await getRhDocumentUrl(caminho);
      if (janela) { janela.opener = null; janela.location.href = url; } else window.location.assign(url);
    } catch {
      janela?.close();
      setErro("Não foi possível abrir a CNH agora: o arquivo é do RH e precisa da credencial de documentos do RH.");
    }
  };
  const placaDe = (id: string | null) => dados?.veiculos.find((v) => v.id === id)?.placa ?? null;

  return (
    <>
      <div className="finance-page-head almox-head">
        <div>
          <p className="eyebrow">LOGÍSTICA · FROTA</p>
          <h1>Frota e motoristas</h1>
          <p>Os caminhões e quem dirige. O motorista é um colaborador do RH: a CNH e os demais documentos ficam no RH. O serviço de entregas recebe só a placa e o modelo do veículo e o nome do motorista.</p>
        </div>
      </div>
      {erro && <Callout variant="danger" title="Não carregou">{erro}</Callout>}
      {dados && !dados.servico && <Callout variant="warning" title="Serviço de entregas desligado">O cadastro fica gravado e vai para o serviço de entregas quando ele estiver ligado (salve de novo).</Callout>}
      <div className="almox-painel">
        <section className="almox-bloco">
          <div className="almox-bloco-topo">
            <div><p className="eyebrow">VEÍCULOS</p><h2>{dados ? `${dados.veiculos.filter((v) => v.ativo).length} em uso` : "…"}</h2></div>
            {dados?.podeOperar && <Button compact onClick={() => setVeiculo("novo")}>Novo veículo</Button>}
          </div>
          <ul className="logi-frota">
            {(dados?.veiculos ?? []).map((v) => (
              <li key={v.id}>
                <b>{placaBonita(v.placa)}{!v.ativo ? " (desativado)" : ""}</b>
                <small>{[rotuloTipo(v.tipo), [v.marca, v.modelo].filter(Boolean).join(" "), v.ano, v.capacidade_kg ? `${Number(v.capacidade_kg).toLocaleString("pt-BR")} kg` : null].filter(Boolean).join(" · ")}</small>
                {v.erro && <small className="logi-erro">{v.erro}</small>}
                <span className="logi-frota-acoes">
                  <Status tone={!v.ativo ? "neutral" : v.fleetbase_veiculo ? "success" : "attention"}>{!v.ativo ? "desativado" : v.fleetbase_veiculo ? "no serviço" : "falta enviar"}</Status>
                  {dados?.podeOperar && <Button variant="ghost" compact onClick={() => setVeiculo(v)}>Editar</Button>}
                </span>
              </li>
            ))}
            {dados && !dados.veiculos.length && <li className="ti-nota">Nenhum veículo cadastrado.{dados.podeOperar ? " Use “Novo veículo”." : ""}</li>}
          </ul>
        </section>
        <section className="almox-bloco">
          <div className="almox-bloco-topo">
            <div><p className="eyebrow">MOTORISTAS</p><h2>{dados ? `${dados.motoristas.filter((m) => m.ativo).length} ativo(s)` : "…"}</h2></div>
            {dados?.podeOperar && <Button compact onClick={() => setMotorista("novo")}>Novo motorista</Button>}
          </div>
          <ul className="logi-frota">
            {(dados?.motoristas ?? []).map((m) => (
              <li key={m.id}>
                <b>{m.nome}{!m.ativo ? " (desativado)" : ""}</b>
                <small>{placaDe(m.veiculo_id) ? `veículo de costume ${placaBonita(placaDe(m.veiculo_id)!)} · ` : ""}{m.posicaoEm ? `posição ${haQuanto(m.posicaoEm, agora)}` : "sem posição ainda (o app do motorista vem na próxima etapa)"}</small>
                <small className={m.cnh ? "" : "logi-erro"}>
                  {m.cnh ? <>CNH no RH: {m.cnh.titulo} · {m.cnh.conferida ? "conferida" : "ainda não conferida"} · enviada em {dataHora(m.cnh.enviada_em).split(",")[0]}
                    {m.cnh.caminho && <> · <button type="button" className="logi-link" onClick={() => void verCnh(m.cnh!.caminho!)}>Ver CNH</button></>}</>
                    : "Sem CNH nos documentos do RH"}
                </small>
                {m.erro && <small className="logi-erro">{m.erro}</small>}
                <span className="logi-frota-acoes">
                  <Status tone={!m.ativo ? "neutral" : m.online ? "success" : m.fleetbase_motorista ? "info" : "attention"}>{!m.ativo ? "desativado" : m.online ? "online" : m.fleetbase_motorista ? "offline" : "falta enviar"}</Status>
                  {dados?.podeOperar && <Button variant="ghost" compact onClick={() => setMotorista(m)}>Editar</Button>}
                </span>
              </li>
            ))}
            {dados && !dados.motoristas.length && <li className="ti-nota">Nenhum motorista cadastrado.{dados.podeOperar ? " Use “Novo motorista” e escolha o colaborador do RH." : ""}</li>}
          </ul>
        </section>
      </div>
      {veiculo && <FormVeiculo atual={veiculo === "novo" ? null : veiculo} onFechar={() => setVeiculo(null)} onSalvo={(v) => void salvou(v.erro ? `Veículo ${placaBonita(v.placa)} salvo, mas não foi ao serviço de entregas: ${v.erro}` : `Veículo ${placaBonita(v.placa)} salvo.`)} />}
      {motorista && dados && <FormMotorista atual={motorista === "novo" ? null : motorista} veiculos={dados.veiculos.filter((v) => v.ativo)} jaCadastrados={new Set(dados.motoristas.map((m) => m.employee_id))}
        onFechar={() => setMotorista(null)} onSalvo={(m) => void salvou(m.erro ? `Motorista ${m.nome} salvo, mas não foi ao serviço de entregas: ${m.erro}` : `Motorista ${m.nome} salvo.`)} />}
    </>
  );
}

function FormVeiculo({ atual, onFechar, onSalvo }: { atual: Veiculo | null; onFechar: () => void; onSalvo: (v: Veiculo) => void }) {
  const [f, setF] = useState({
    placa: atual?.placa ?? "", tipo: atual?.tipo ?? "caminhao", marca: atual?.marca ?? "", modelo: atual?.modelo ?? "",
    ano: atual?.ano ? String(atual.ano) : "", capacidade_kg: atual?.capacidade_kg ? String(atual.capacidade_kg) : "", observacao: atual?.observacao ?? "",
  });
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const mudar = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const placa = f.placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const placaOk = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa);
  const salvar = async (ativo?: boolean) => {
    setIndo(true); setErro("");
    const r = await chamarLogistica<Veiculo>("/api/logistica/frota", { method: "POST", body: JSON.stringify({ tipo: "veiculo", dados: { ...f, placa, id: atual?.id, ...(ativo === undefined ? {} : { ativo }) } }) });
    setIndo(false);
    if (!r.ok) { setErro(r.error); return; }
    onSalvo(r.data);
  };
  return (
    <Modal eyebrow="LOGÍSTICA · FROTA" title={atual ? `Veículo ${placaBonita(atual.placa)}` : "Novo veículo"} onClose={onFechar}>
      <div className="logi-form">
        {erro && <Callout variant="danger" title="Não deu">{erro}</Callout>}
        <div className="logi-campos">
          <label className="logi-campo"><span>Placa</span><input value={f.placa} maxLength={8} onChange={(e) => mudar("placa", e.target.value)} placeholder="ABC1D23" aria-invalid={Boolean(f.placa) && !placaOk} /></label>
          <label className="logi-campo"><span>Tipo</span><select value={f.tipo} onChange={(e) => mudar("tipo", e.target.value)}>{TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
          <label className="logi-campo"><span>Marca</span><input value={f.marca} maxLength={60} onChange={(e) => mudar("marca", e.target.value)} placeholder="Volkswagen" /></label>
          <label className="logi-campo"><span>Modelo</span><input value={f.modelo} maxLength={80} onChange={(e) => mudar("modelo", e.target.value)} placeholder="Delivery 11.180" /></label>
          <label className="logi-campo"><span>Ano</span><input value={f.ano} inputMode="numeric" maxLength={4} onChange={(e) => mudar("ano", e.target.value.replace(/\D/g, ""))} placeholder="2021" /></label>
          <label className="logi-campo"><span>Capacidade (kg)</span><input value={f.capacidade_kg} inputMode="numeric" onChange={(e) => mudar("capacidade_kg", e.target.value.replace(/[^\d]/g, ""))} placeholder="6000" /></label>
        </div>
        <label className="logi-campo"><span>Observação</span><textarea rows={2} maxLength={500} value={f.observacao} onChange={(e) => mudar("observacao", e.target.value)} /></label>
        <div className="logi-rodape">
          {atual && <Button variant="ghost" disabled={indo} onClick={() => void salvar(!atual.ativo)}>{atual.ativo ? "Desativar" : "Reativar"}</Button>}
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          <Button disabled={indo || !placaOk} onClick={() => void salvar()}>{indo ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function FormMotorista({ atual, veiculos, jaCadastrados, onFechar, onSalvo }: {
  atual: Motorista | null; veiculos: Veiculo[]; jaCadastrados: Set<string>; onFechar: () => void; onSalvo: (m: Motorista) => void;
}) {
  const [colaboradores, setColaboradores] = useState<{ id: string; nome: string; cargo: string | null; cnh: boolean }[] | null>(null);
  const [employee, setEmployee] = useState(atual?.employee_id ?? "");
  const [veiculoId, setVeiculoId] = useState(atual?.veiculo_id ?? "");
  const [filtro, setFiltro] = useState<"motoristas" | "todos">("motoristas");
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  useEffect(() => {
    if (atual) return;
    let vivo = true;
    void chamarLogistica<{ colaboradores: { id: string; nome: string; cargo: string | null; cnh: boolean }[] }>("/api/logistica/frota?colaboradores=1").then((r) => {
      if (!vivo) return;
      if (r.ok) setColaboradores(r.data.colaboradores); else setErro(r.error);
    });
    return () => { vivo = false; };
  }, [atual]);
  const lista = (colaboradores ?? []).filter((c) => !jaCadastrados.has(c.id) && (filtro === "todos" || /motorista/i.test(c.cargo ?? "")));
  const salvar = async (ativo?: boolean) => {
    setIndo(true); setErro("");
    const r = await chamarLogistica<Motorista>("/api/logistica/frota", { method: "POST", body: JSON.stringify({ tipo: "motorista", dados: { id: atual?.id, employee_id: employee, veiculo_id: veiculoId || null, ...(ativo === undefined ? {} : { ativo }) } }) });
    setIndo(false);
    if (!r.ok) { setErro(r.error); return; }
    onSalvo(r.data);
  };
  return (
    <Modal eyebrow="LOGÍSTICA · FROTA" title={atual ? atual.nome : "Novo motorista"} subtitle={atual ? undefined : "Escolha o colaborador no cadastro do RH. A CNH e os documentos ficam no RH."} onClose={onFechar}>
      <div className="logi-form">
        {erro && <Callout variant="danger" title="Não deu">{erro}</Callout>}
        {!atual && (
          <>
            <Segmented<"motoristas" | "todos"> options={[{ value: "motoristas", label: "Cargo motorista" }, { value: "todos", label: "Todos os colaboradores" }]} value={filtro} onChange={setFiltro} ariaLabel="Quem mostrar" />
            {!colaboradores ? <p className="ti-nota">Carregando o cadastro do RH…</p> : (
              <ul className="logi-escolhas" role="listbox" aria-label="Colaboradores do RH">
                {lista.map((c) => (
                  <li key={c.id}><button type="button" role="option" aria-selected={employee === c.id} className={employee === c.id ? "on" : ""} onClick={() => setEmployee(c.id)}>
                    <b>{c.nome}</b><small>{c.cargo ?? "sem cargo"} · {c.cnh ? "CNH no RH" : "sem CNH no RH"}</small>
                  </button></li>
                ))}
                {!lista.length && <li className="ti-nota">{filtro === "motoristas" ? "Nenhum colaborador com cargo de motorista sem cadastro. Veja “Todos os colaboradores”." : "Nenhum colaborador disponível."}</li>}
              </ul>
            )}
          </>
        )}
        <label className="logi-campo"><span>Veículo de costume (opcional)</span>
          <select value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
            <option value="">Nenhum</option>
            {veiculos.map((v) => <option key={v.id} value={v.id}>{placaBonita(v.placa)}{v.modelo ? ` · ${v.modelo}` : ""}</option>)}
          </select>
        </label>
        <div className="logi-rodape">
          {atual && <Button variant="ghost" disabled={indo} onClick={() => void salvar(!atual.ativo)}>{atual.ativo ? "Desativar" : "Reativar"}</Button>}
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          <Button disabled={indo || (!atual && !employee)} onClick={() => void salvar()}>{indo ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
