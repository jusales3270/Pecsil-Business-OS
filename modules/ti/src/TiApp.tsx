"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Segmented, Status } from "../../../packages/design-system";
import { useModuleNav } from "../../../lib/module-nav-context";
import { canUseFeature } from "../../access";
import type { ModuleRuntimeProps } from "../../runtime";
import { DetalheChamado, NovoChamado, TabelaChamados } from "./chamados-ui";
import { Incidentes } from "./Incidentes";
import { Inventario } from "./Inventario";
import { RegrasChamados } from "./RegrasChamados";
import {
  type Ativo, type Chamado, type Incidente, type Regras, type Saude,
  CATEGORIA_INCIDENTE, EM_ABERTO, chamarTi, dataHora, duracao, pct, segundosEntre, tamanho, useAgora,
} from "./tipos";

/**
 * TI (T-06, docs/PLANO-TI.md §5): a saúde do servidor e do backup (lida do vigia externo na
 * nuvem), o histórico de quedas, os chamados de toda a empresa e o inventário. Quem decide as
 * regras do módulo é o supervisor de TI.
 */

type Secao = "Painel" | "Chamados" | "Incidentes" | "Inventário" | "Regras";
type Painel = { vigia: { ok: true; saude: Saude } | { ok: false; erro: string }; quedas30: Incidente[]; ativos: { total: number; criticos: number; manutencao: number }; podeRegistrar: boolean };
type Fila = { chamados: Chamado[]; regras: Regras | null; eu: string | null; podeAtender: boolean; podeRegras: boolean };
type Filtro = "abertos" | "meus" | "resolvidos" | "todos";

/** IP de saída da nuvem do vigia: o firewall da fábrica precisa liberar para os testes de fora (T-03). */
const IP_DA_NUVEM = "100.60.102.71";

export default function TiApp({ access, notify, initialSection }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const podeSaude = canUseFeature(access, "ti.saude");
  const podeChamados = canUseFeature(access, "ti.chamados");
  const podeRegras = canUseFeature(access, "ti.chamados", "aprovar");
  const podeInventario = canUseFeature(access, "ti.ativos") || podeSaude || podeChamados;
  const podeEditarAtivo = canUseFeature(access, "ti.ativos", "operar");

  const secoes = useMemo(() => ([
    podeSaude && { id: "Painel" as Secao, icon: "grid" },
    podeChamados && { id: "Chamados" as Secao, icon: "inbox" },
    podeSaude && { id: "Incidentes" as Secao, icon: "alert" },
    podeInventario && { id: "Inventário" as Secao, icon: "box" },
    podeRegras && { id: "Regras" as Secao, icon: "settings" },
  ].filter(Boolean) as { id: Secao; icon: string }[]), [podeSaude, podeChamados, podeInventario, podeRegras]);
  const [secao, setSecao] = useState<Secao>(() => (secoes.find((s) => s.id === initialSection)?.id ?? secoes[0]?.id ?? "Inventário"));

  const [painel, setPainel] = useState<Painel | null>(null);
  const [fila, setFila] = useState<Fila | null>(null);
  const [ativos, setAtivos] = useState<Ativo[] | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const [p, f, a] = await Promise.all([
      podeSaude ? chamarTi<Painel>("/api/ti/painel") : Promise.resolve(null),
      podeChamados ? chamarTi<Fila>("/api/ti/chamados?escopo=todos") : Promise.resolve(null),
      podeInventario ? chamarTi<{ ativos: Ativo[] }>("/api/ti/ativos") : Promise.resolve(null),
    ]);
    const falha = [p, f, a].find((x) => x && !x.ok);
    setErro(falha && !falha.ok ? falha.error : "");
    if (p?.ok) setPainel(p.data);
    if (f?.ok) setFila(f.data);
    if (a?.ok) setAtivos(a.data.ativos);
  }, [podeSaude, podeChamados, podeInventario]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const agora = useAgora();
  const abertos = useMemo(() => (fila?.chamados ?? []).filter((c) => EM_ABERTO.includes(c.situacao)), [fila]);
  const vencidos = agora ? abertos.filter((c) => Date.parse(c.prazo) < agora).length : 0;

  useEffect(() => {
    registerNav({
      moduleId: "ti",
      moduleName: "TI",
      sidebarTree: true,
      items: secoes.map(({ id, icon }) => ({
        id, label: id, icon,
        ...(id === "Chamados" && abertos.length ? { badge: abertos.length, badgeTone: "attention" as const } : {}),
      })),
      activeId: secao,
      onSelect: (id) => setSecao(id as Secao),
    });
  }, [registerNav, secoes, secao, abertos.length, vencidos]);
  useEffect(() => () => registerNav(null), [registerNav]);

  const depois = async (mensagem: string) => { if (mensagem) notify(mensagem); await carregar(); };

  if (!secoes.length) return <div className="almox-modulo"><div className="finance-empty almox-vazio"><b>Sem acesso às telas da TI</b><small>Para abrir um chamado, use “Chamados de TI” no menu da sua conta.</small></div></div>;

  return (
    <div className="almox-modulo">
      {erro && <Callout variant="danger" title="Parte do módulo não carregou">{erro}</Callout>}
      {secao === "Painel" && <PainelSaude painel={painel} fila={podeChamados ? fila : null} abrir={setSecao} agora={agora} />}
      {secao === "Chamados" && <FilaChamados fila={fila} ativos={ativos ?? []} notify={notify} depois={depois} />}
      {secao === "Incidentes" && <Incidentes ativos={ativos ?? []} onAviso={(m) => void depois(m)} />}
      {secao === "Inventário" && (ativos ? <Inventario ativos={ativos} podeEditar={podeEditarAtivo} onSalvo={(m) => void depois(m)} /> : <Carregando />)}
      {secao === "Regras" && (fila?.regras ? <RegrasChamados key={fila.regras.revisado_em ?? "provisorio"} regras={fila.regras} onSalvo={(m) => void depois(m)} /> : <Carregando />)}
    </div>
  );
}

const Carregando = () => <div className="finance-empty almox-vazio"><b>Carregando…</b><small /></div>;

function PainelSaude({ painel, fila, abrir, agora }: { painel: Painel | null; fila: Fila | null; abrir: (s: Secao) => void; agora: number }) {
  const cab = (
    <div className="finance-page-head almox-head">
      <div><p className="eyebrow">TI · PAINEL</p><h1>Saúde da TI</h1><p>O servidor da fábrica avisa o vigia na nuvem a cada minuto; o backup avisa quando termina. Se o aviso para, o vigia registra a queda e manda o alerta, mesmo com o servidor desligado.</p></div>
    </div>
  );
  if (!painel) return <>{cab}<Carregando /></>;
  const saude = painel.vigia.ok ? painel.vigia.saude : null;
  const quedas = painel.quedas30.filter((i) => i.categoria !== "alarme_falso");
  const foraTotal = quedas.reduce((s, i) => s + segundosEntre(i.inicio, i.fim, agora), 0);
  const aConfirmar = quedas.filter((i) => !i.confirmado_em).length;
  const srv = saude?.servidor;
  const bkp = saude?.backup;
  const abertos = (fila?.chamados ?? []).filter((c) => EM_ABERTO.includes(c.situacao));
  const vencidos = agora ? abertos.filter((c) => Date.parse(c.prazo) < agora).length : 0;
  const sinalHa = srv?.ultimoSinal && agora ? (agora - Date.parse(srv.ultimoSinal)) / 1000 : null;

  return (
    <>
      {cab}
      {!painel.vigia.ok && <Callout variant="danger" title="Sem leitura do vigia agora">{painel.vigia.erro} O histórico abaixo é o que já foi copiado para a plataforma.</Callout>}
      {saude?.foraAgora.map((f) => <Callout key={f.alvo} variant="danger" title={`${f.nome}: fora do ar desde ${dataHora(f.desde)}`}>Provável: {f.causa}.</Callout>)}
      <KpiGrid>
        <Kpi label="Servidor" value={!srv ? "—" : srv.estado === "ok" ? "No ar" : srv.estado === "fora" ? "Fora" : "?"} tone={!srv ? "neutral" : srv.estado === "ok" ? "green" : "red"}
          caption={srv ? `ligado há ${duracao(srv.ligadoHaS)} · último sinal há ${duracao(sinalHa)}` : "sem leitura do vigia"} />
        <Kpi label="Backup diário" value={bkp?.horasDesde === null || bkp?.horasDesde === undefined ? "—" : `há ${duracao(bkp.horasDesde * 3600)}`} tone={!bkp ? "neutral" : bkp.atrasado ? "red" : "green"}
          caption={bkp ? `${tamanho(bkp.totalBytes)} criptografados · ${bkp.atrasado ? "ATRASADO (mais de 26 h)" : "fora da fábrica, na nuvem"}` : "sem leitura do vigia"} />
        <Kpi label="Quedas em 30 dias" value={String(quedas.length)} tone={quedas.length ? "amber" : "green"} onOpen={() => abrir("Incidentes")}
          caption={quedas.length ? `${duracao(foraTotal)} fora${aConfirmar ? ` · ${aConfirmar} a confirmar` : ""}` : "nenhuma queda registrada"} />
        {fila && <Kpi label="Chamados em aberto" value={String(abertos.length)} tone={vencidos ? "red" : abertos.length ? "amber" : "green"} onOpen={() => abrir("Chamados")}
          caption={vencidos ? `${vencidos} com prazo vencido` : abertos.length ? "todos dentro do prazo" : "fila vazia"} />}
      </KpiGrid>
      <div className="almox-painel">
        <section className="almox-bloco">
          <div className="almox-bloco-topo"><div><p className="eyebrow">POR DENTRO</p><h2>Servidor da fábrica</h2></div></div>
          {!srv ? <p className="ti-nota">Sem leitura do vigia.</p> : (
            <>
              <dl className="ti-numeros">
                <div><dt>Disco livre</dt><dd className={srv.discoLivrePct !== null && srv.discoLivrePct < 15 ? "ruim" : ""}>{pct(srv.discoLivrePct)}</dd></div>
                <div><dt>Memória livre</dt><dd>{pct(srv.memoriaLivrePct)}</dd></div>
                <div><dt>Carga (1 min)</dt><dd>{srv.carga1m?.toLocaleString("pt-BR") ?? "—"}{srv.cpus ? <small> de {srv.cpus} núcleos</small> : null}</dd></div>
              </dl>
              <div className="ti-servicos">
                {srv.servicos.map((s) => <Status key={s.nome} tone={s.ok ? "success" : "danger"}>{({ plataforma: "Business OS", banco: "Banco", forja: "Forja" } as Record<string, string>)[s.nome] ?? s.nome}{s.ok ? ` · ${s.ms ?? "?"} ms` : " · fora"}</Status>)}
              </div>
            </>
          )}
          {bkp && bkp.arquivos.length > 0 && (
            <div className="almox-pedido-itens">
              <p className="almox-rotulo">Último backup ({bkp.ultimo ? dataHora(bkp.ultimo) : "—"})</p>
              {bkp.arquivos.map((a) => <p key={a.nome}><b>{a.nome.split("/").pop()}</b><em className="valor">{tamanho(a.bytes)}</em></p>)}
            </div>
          )}
        </section>
        <section className="almox-bloco">
          <div className="almox-bloco-topo"><div><p className="eyebrow">DE FORA</p><h2>Avisos e testes externos</h2></div></div>
          <ul className="ti-itens">
            <li>
              <b>Alerta por WhatsApp</b>
              {saude?.alertas.canalConfigurado && saude.alertas.destinatarios
                ? <span><Status tone="success">ligado</Status> {saude.alertas.destinatarios} número(s) recebem</span>
                : <span><Status tone="attention">pendente</Status> {saude && !saude.alertas.canalConfigurado ? "falta o número da empresa na API oficial do WhatsApp" : ""}{saude && !saude.alertas.destinatarios ? `${saude.alertas.canalConfigurado ? "" : " e "}ninguém cadastrado para receber` : ""}. As quedas ficam registradas mesmo assim.</span>}
            </li>
            {(saude?.externos ?? []).map((e) => (
              <li key={e.id}>
                <b>{e.nome}</b>
                {!e.ativo ? <span><Status tone="neutral">desligado</Status> O firewall da fábrica bloqueia a nuvem. Para ligar, o supervisor de TI libera o IP {IP_DA_NUVEM}.</span>
                  : <span><Status tone={e.estado === "ok" ? "success" : e.estado === "fora" ? "danger" : "neutral"}>{e.estado === "ok" ? "respondendo" : e.estado === "fora" ? "fora" : "sem teste ainda"}</Status>{e.ultimaChecagem ? ` último teste ${dataHora(e.ultimaChecagem.em)}` : ""}</span>}
              </li>
            ))}
            <li><b>Nobreak</b><span><Status tone="neutral">sem leitura</Status> Entra quando o nobreak gerenciável estiver ligado ao servidor (T-01).</span></li>
          </ul>
          <div className="almox-bloco-topo"><div><p className="eyebrow">ÚLTIMAS QUEDAS</p></div></div>
          {!quedas.length ? <p className="ti-nota">Nenhuma queda nos últimos 30 dias.</p> : (
            <ul className="ti-itens">
              {quedas.slice(0, 5).map((i) => (
                <li key={i.id}>
                  <b>{i.alvo_nome ?? i.alvo ?? "—"} · {dataHora(i.inicio)}</b>
                  <span>{i.fim ? duracao(segundosEntre(i.inicio, i.fim, agora)) : "fora agora"} · {i.categoria ? `${CATEGORIA_INCIDENTE[i.categoria] ?? i.categoria}${i.confirmado_em ? "" : " (provável)"}` : "causa a confirmar"}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="almox-link" onClick={() => abrir("Incidentes")}>Ver o histórico ›</button>
        </section>
      </div>
    </>
  );
}

function FilaChamados({ fila, ativos, notify, depois }: { fila: Fila | null; ativos: Ativo[]; notify: (m: string) => void; depois: (m: string) => Promise<void> }) {
  const [filtro, setFiltro] = useState<Filtro>("abertos");
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (fila?.chamados ?? [])
      .filter((c) => filtro === "todos" || (filtro === "abertos" && EM_ABERTO.includes(c.situacao)) || (filtro === "resolvidos" && c.situacao === "resolvido")
        || (filtro === "meus" && EM_ABERTO.includes(c.situacao) && c.responsavel_id === fila?.eu))
      .filter((c) => !t || [c.titulo, c.solicitante_nome, c.categoria, c.local, String(c.numero)].some((v) => v && v.toLowerCase().includes(t)))
      // Em aberto: o que vence primeiro no topo.
      .sort((a, b) => (filtro === "abertos" || filtro === "meus" ? Date.parse(a.prazo) - Date.parse(b.prazo) : Date.parse(b.created_at) - Date.parse(a.created_at)));
  }, [fila, filtro, busca]);

  return (
    <>
      <div className="finance-page-head almox-head">
        <div><p className="eyebrow">TI · CHAMADOS</p><h1>Fila de chamados</h1><p>Chamados abertos por qualquer pessoa da empresa, pelo menu da conta. O que vence primeiro aparece no topo; quem abriu é avisado a cada resposta.</p></div>
        {fila?.regras && <Button onClick={() => setNovo(true)}>Abrir chamado</Button>}
      </div>
      {fila?.regras && !fila.regras.revisado_em && <Callout variant="warning" title="Categorias e prazos provisórios">Postos na implantação, até o supervisor de TI revisar em TI › Regras.</Callout>}
      <section className="almox-bloco">
        <div className="almox-filtros">
          <Segmented<Filtro> compact ariaLabel="Filtro" value={filtro} onChange={setFiltro}
            options={[{ value: "abertos", label: "Em aberto" }, { value: "meus", label: "Comigo" }, { value: "resolvidos", label: "Resolvidos" }, { value: "todos", label: "Todos" }]} />
          <input className="almox-busca" placeholder="Buscar título, pessoa, nº…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {!fila ? <Carregando /> : !lista.length
          ? <div className="finance-empty almox-vazio"><b>{filtro === "abertos" ? "Nenhum chamado em aberto" : "Nada neste filtro"}</b><small>Quando alguém chamar a TI, o chamado aparece aqui e você é avisado no sino.</small></div>
          : <TabelaChamados chamados={lista} onAbrir={(c) => setAberto(c.id)} mostrarSolicitante />}
      </section>
      {novo && fila?.regras && <NovoChamado regras={fila.regras} onClose={() => setNovo(false)} onCriado={(n) => { setNovo(false); void depois(`Chamado #${n} aberto.`); }} />}
      {aberto && fila && (
        <DetalheChamado id={aberto} eu={fila.eu} podeAtender={fila.podeAtender} regras={fila.regras} ativos={ativos}
          onClose={() => { setAberto(null); void depois(""); }} onMudou={(m) => notify(m)} />
      )}
    </>
  );
}

