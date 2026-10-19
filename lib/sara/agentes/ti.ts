import { dataBR, link, num, plural, termo, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";
import { lerPainel, resumoSaude } from "../../ti/vigia.mjs";

/**
 * SARA da TI (T-06): a saúde do servidor e do backup (lida agora do vigia externo na nuvem), o
 * histórico de quedas, a fila de chamados e o inventário. Quem decide é o supervisor de TI.
 * Não lê telefone de alerta, token nem nada do cofre: só o que o painel do vigia entrega.
 */

const M = "ti";
const SAUDE = ["ti.saude"];
const CHAMADOS = ["ti.chamados"];
const INVENTARIO = ["ti.ativos", "ti.saude", "ti.chamados"];
const tela = (secao: string): Abrir => ({ modulo: M, secao, rotulo: `TI › ${secao}` });
const fonte = (secao: string) => ({ rotulo: `TI › ${secao}`, link: link(M, secao) });
const fonteVigia = { rotulo: "Vigia externo (nuvem)", link: link(M, "Painel") };

const CATEGORIA: Record<string, string> = {
  energia: "energia", internet: "internet", rede: "rede ou porta", servidor: "servidor", estacao: "computador",
  sistema: "sistema", backup: "backup", alarme_falso: "alarme falso", outro: "outro",
};
const SITUACAO: Record<string, string> = { aberto: "aberto", em_atendimento: "em atendimento", aguardando: "aguardando", resolvido: "resolvido", cancelado: "cancelado" };
const EM_ABERTO = ["aberto", "em_atendimento", "aguardando"];
const horas = (de: string, ate?: string | null) => Math.round((((ate ? Date.parse(ate) : Date.now()) - Date.parse(de)) / 3_600_000) * 10) / 10;
const minutos = (de: string, ate?: string | null) => Math.round(((ate ? Date.parse(ate) : Date.now()) - Date.parse(de)) / 60_000);
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function lerSaude(limiteMs = 8000) {
  const { VIGIA_URL, VIGIA_CHAVE, VIGIA_TOKEN, VIGIA_ALVO } = process.env;
  const lido = await lerPainel({ url: VIGIA_URL, chave: VIGIA_CHAVE, token: VIGIA_TOKEN, alvo: VIGIA_ALVO || undefined, dias: 3, limiteMs });
  return lido.ok ? { ok: true as const, saude: resumoSaude(lido.painel) } : { ok: false as const, erro: lido.erro };
}

type IncidenteLinha = { origem: string; alvo_nome: string | null; inicio: string; fim: string | null; categoria: string | null; causa_vigia: string | null; causa: string | null; confirmado_em: string | null; ti_ativos: { nome: string } | null };
type ChamadoLinha = {
  numero: number; titulo: string; categoria: string; prioridade: string; situacao: string; local: string | null; solicitante_nome: string;
  responsavel_nome: string | null; prazo: string; primeira_resposta_em: string | null; resolvido_em: string | null; solucao: string | null; created_at: string;
};

const ferramentas: Ferramenta[] = [
  {
    nome: "ti_saude", rotulo: "saúde do servidor e do backup", exige: SAUDE,
    descricao: "Situação AGORA, lida do vigia externo na nuvem: servidor da fábrica (no ar ou fora, ligado há quanto tempo, último sinal, disco e memória livres, carga, e se Business OS, banco e Forja respondem por dentro), o último backup (há quantas horas, tamanho, atrasado ou não), os testes de fora (ligados ou não), os alertas por WhatsApp (configurados, quantos números) e o que está fora agora. O nobreak ainda não é lido.",
    esquema: { type: "object", properties: {} },
    rodar: async () => {
      const r = await lerSaude();
      if (!r.ok) return { dados: { vigia: "sem resposta", erro: r.erro, dica: "O histórico de quedas já copiado continua em ti_incidentes." }, fontes: [fonteVigia] };
      const s = r.saude;
      return {
        dados: {
          lido_em: s.lidoEm,
          servidor: s.servidor && {
            estado: s.servidor.estado === "ok" ? "no ar" : s.servidor.estado === "fora" ? "fora do ar" : "sem informação",
            ligado_ha_horas: s.servidor.ligadoHaS === null ? null : Math.round((s.servidor.ligadoHaS / 3600) * 10) / 10,
            ultimo_sinal: s.servidor.ultimoSinal ? hora(s.servidor.ultimoSinal) : null,
            disco_livre_pct: s.servidor.discoLivrePct, memoria_livre_pct: s.servidor.memoriaLivrePct, carga_1min: s.servidor.carga1m, nucleos: s.servidor.cpus,
            servicos_por_dentro: s.servidor.servicos.map((x) => ({ servico: ({ plataforma: "Business OS", banco: "banco", forja: "Forja" } as Record<string, string>)[x.nome] ?? x.nome, responde: x.ok, ms: x.ms })),
          },
          backup: s.backup && {
            ultimo: s.backup.ultimo ? hora(s.backup.ultimo) : null, ha_horas: s.backup.horasDesde, atrasado: s.backup.atrasado,
            tamanho_mb: Math.round(s.backup.totalBytes / 1e5) / 10, arquivos: s.backup.arquivos.length, onde: "nuvem, criptografado (só o proprietário tem a chave)",
          },
          testes_de_fora: s.externos.map((e) => ({ teste: e.nome, ligado: e.ativo, estado: e.ativo ? e.estado : "desligado (o firewall da fábrica bloqueia a nuvem; falta liberar o IP 100.60.102.71)" })),
          alerta_whatsapp: { configurado: s.alertas.canalConfigurado, numeros: s.alertas.destinatarios },
          fora_agora: s.foraAgora.map((f) => ({ o_que: f.nome, desde: hora(f.desde), causa_provavel: f.causa })),
          nobreak: "ainda sem leitura (entra com o nobreak gerenciável, T-01)",
        },
        fontes: [fonteVigia],
        abrir: tela("Painel"),
      };
    },
  },
  {
    nome: "ti_incidentes", rotulo: "histórico de quedas", exige: SAUDE,
    descricao: "Quedas e incidentes de TI num período (padrão: 30 dias): o que caiu, início, duração, categoria (energia, internet, servidor…; 'a confirmar' quando a TI ainda não confirmou), causa provável do vigia e causa confirmada. Traz o total por categoria (vezes e horas fora). Alarmes falsos ficam fora, a não ser que peça.",
    esquema: { type: "object", properties: { dias: { type: "integer" }, categoria: { type: "string", enum: Object.keys(CATEGORIA) }, incluir_alarmes_falsos: { type: "boolean" } } },
    rodar: async (sb, e) => {
      const dias = num(e.dias, 30, 1, 400);
      let q = sb.from("ti_incidentes").select("origem, alvo_nome, inicio, fim, categoria, causa_vigia, causa, confirmado_em, ti_ativos(nome)")
        .gte("inicio", new Date(Date.now() - dias * 86_400_000).toISOString()).order("inicio", { ascending: false }).limit(500);
      if (typeof e.categoria === "string" && CATEGORIA[e.categoria]) q = q.eq("categoria", e.categoria);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const lista = ((data ?? []) as unknown as IncidenteLinha[]).filter((i) => e.incluir_alarmes_falsos === true || i.categoria !== "alarme_falso");
      const porCategoria = new Map<string, { vezes: number; minutos: number }>();
      for (const i of lista) {
        const k = i.categoria ? CATEGORIA[i.categoria] ?? i.categoria : "a confirmar";
        const x = porCategoria.get(k) ?? { vezes: 0, minutos: 0 };
        porCategoria.set(k, { vezes: x.vezes + 1, minutos: x.minutos + minutos(i.inicio, i.fim) });
      }
      return {
        dados: {
          periodo_dias: dias, quedas: lista.length,
          horas_fora_no_total: Math.round((lista.reduce((s, i) => s + minutos(i.inicio, i.fim), 0) / 60) * 10) / 10,
          sem_causa_confirmada: lista.filter((i) => !i.confirmado_em).length,
          por_categoria: [...porCategoria.entries()].map(([categoria, v]) => ({ categoria, vezes: v.vezes, horas_fora: Math.round((v.minutos / 60) * 10) / 10 })),
          incidentes: lista.slice(0, 40).map((i) => ({
            o_que: i.ti_ativos?.nome ?? i.alvo_nome, inicio: hora(i.inicio), fim: i.fim ? hora(i.fim) : "ainda fora", minutos_fora: minutos(i.inicio, i.fim),
            categoria: i.categoria ? CATEGORIA[i.categoria] ?? i.categoria : "a confirmar", confirmada: Boolean(i.confirmado_em),
            causa: i.causa ?? null, causa_provavel_do_vigia: i.causa_vigia, registrado_por: i.origem === "vigia" ? "vigia" : "TI",
          })),
        },
        fontes: [fonte("Incidentes")],
        abrir: tela("Incidentes"),
      };
    },
  },
  {
    nome: "ti_chamados", rotulo: "chamados de TI", exige: CHAMADOS,
    descricao: "Fila de chamados de TI (padrão: em aberto): número, título, categoria, prioridade, situação, quem abriu, quem atende, prazo (e se venceu), horas desde a abertura; resolvidos trazem a solução e se foi no prazo. Traz o resumo: em aberto, vencidos, sem responsável, resolvidos no período e quantos no prazo.",
    esquema: { type: "object", properties: { situacao: { type: "string", enum: ["em_aberto", "vencidos", "resolvidos", "todos"] }, dias: { type: "integer" }, busca: { type: "string" } } },
    rodar: async (sb, e) => {
      const situacao = String(e.situacao ?? "em_aberto");
      const dias = num(e.dias, 30, 1, 400);
      let q = sb.from("ti_chamados").select("numero, titulo, categoria, prioridade, situacao, local, solicitante_nome, responsavel_nome, prazo, primeira_resposta_em, resolvido_em, solucao, created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (situacao === "em_aberto" || situacao === "vencidos") q = q.in("situacao", EM_ABERTO);
      else q = q.gte("created_at", new Date(Date.now() - dias * 86_400_000).toISOString());
      if (situacao === "resolvidos") q = q.eq("situacao", "resolvido");
      const t = termo(e.busca);
      if (t) q = q.or(`titulo.ilike.%${t}%,solicitante_nome.ilike.%${t}%,categoria.ilike.%${t}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const agora = Date.now();
      let lista = (data ?? []) as ChamadoLinha[];
      if (situacao === "vencidos") lista = lista.filter((c) => Date.parse(c.prazo) < agora);
      const abertos = lista.filter((c) => EM_ABERTO.includes(c.situacao));
      const resolvidos = lista.filter((c) => c.situacao === "resolvido");
      return {
        dados: {
          filtro: situacao, ...(situacao === "resolvidos" || situacao === "todos" ? { periodo_dias: dias } : {}), quantidade: lista.length,
          resumo: {
            em_aberto: abertos.length, vencidos: abertos.filter((c) => Date.parse(c.prazo) < agora).length, sem_responsavel: abertos.filter((c) => !c.responsavel_nome).length,
            resolvidos: resolvidos.length, resolvidos_no_prazo: resolvidos.filter((c) => c.resolvido_em && Date.parse(c.resolvido_em) <= Date.parse(c.prazo)).length,
          },
          chamados: lista.slice(0, 40).map((c) => ({
            numero: c.numero, titulo: c.titulo, categoria: c.categoria, prioridade: c.prioridade, situacao: SITUACAO[c.situacao] ?? c.situacao,
            quem_abriu: c.solicitante_nome, quem_atende: c.responsavel_nome ?? "ninguém ainda", local: c.local, aberto_ha_horas: horas(c.created_at),
            prazo: hora(c.prazo), vencido: EM_ABERTO.includes(c.situacao) && Date.parse(c.prazo) < agora,
            ...(c.situacao === "resolvido" ? { resolvido_em: c.resolvido_em ? hora(c.resolvido_em) : null, no_prazo: Boolean(c.resolvido_em && Date.parse(c.resolvido_em) <= Date.parse(c.prazo)), solucao: c.solucao } : {}),
          })),
        },
        fontes: [fonte("Chamados")],
        abrir: tela("Chamados"),
      };
    },
  },
  {
    nome: "ti_inventario", rotulo: "inventário de TI", exige: INVENTARIO,
    descricao: "Equipamentos e sistemas da TI: número, nome, tipo, local, IP, modelo, sistema operacional, se é crítico e a situação (em uso, reserva, em manutenção, baixado). Busca por nome, local, IP ou modelo; filtra por tipo.",
    esquema: { type: "object", properties: { busca: { type: "string" }, tipo: { type: "string", enum: ["servidor", "estacao", "notebook", "rede", "coletor_cnc", "impressora", "nobreak", "camera", "sistema", "outro"] }, so_criticos: { type: "boolean" } } },
    rodar: async (sb, e) => {
      let q = sb.from("ti_ativos").select("numero, nome, tipo, local, responsavel, fabricante, modelo, ip, sistema_operacional, critico, situacao").neq("situacao", "baixado").order("numero").limit(300);
      if (typeof e.tipo === "string") q = q.eq("tipo", e.tipo);
      if (e.so_criticos === true) q = q.eq("critico", true);
      const t = termo(e.busca);
      if (t) q = q.or(`nome.ilike.%${t}%,local.ilike.%${t}%,ip.ilike.%${t}%,modelo.ilike.%${t}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { dados: { quantidade: (data ?? []).length, equipamentos: (data ?? []).slice(0, 60) }, fontes: [fonte("Inventário")], abrir: tela("Inventário") };
    },
  },
];

const telas: Tela[] = [
  { id: "ti_painel", modulo: M, secao: "Painel", rotulo: "TI › Painel", exige: SAUDE, serve: "ver o servidor, o backup e os testes de fora agora" },
  { id: "ti_incidentes", modulo: M, secao: "Incidentes", rotulo: "TI › Incidentes", exige: SAUDE, serve: "ver o histórico de quedas, confirmar a causa ou registrar um incidente" },
  { id: "ti_chamados", modulo: M, secao: "Chamados", rotulo: "TI › Chamados", exige: CHAMADOS, serve: "atender a fila de chamados de TI" },
  { id: "ti_inventario", modulo: M, secao: "Inventário", rotulo: "TI › Inventário", exige: INVENTARIO, serve: "consultar ou cadastrar equipamentos" },
];

const regras: Agente["regras"] = [
  {
    exige: SAUDE,
    gerar: async (sb) => {
      const saida: Alerta[] = [];
      const r = await lerSaude(5000);
      if (r.ok) {
        for (const f of r.saude.foraAgora) saida.push({
          chave: `ti.fora:${f.alvo}:${f.desde}`, nivel: "urgente", titulo: `${f.nome} fora do ar desde ${hora(f.desde)}`, detalhe: `Provável: ${f.causa}.`, abrir: tela("Painel"),
        });
        const b = r.saude.backup;
        if (b?.atrasado && !r.saude.foraAgora.some((f) => f.alvo === "backup-pecsil")) saida.push({
          chave: `ti.backup_atrasado:${b.ultimo ?? "nunca"}`, nivel: "urgente", titulo: "O backup diário está atrasado",
          detalhe: b.ultimo ? `O último foi em ${hora(b.ultimo)} (há ${b.horasDesde} h).` : "Nenhum backup registrado ainda.", abrir: tela("Painel"),
        });
        const disco = r.saude.servidor?.discoLivrePct;
        if (disco !== null && disco !== undefined && disco < 15) saida.push({
          chave: `ti.disco:${Math.floor(disco)}`, nivel: "urgente", titulo: `Disco do servidor com ${disco}% livre`, detalhe: "Abaixo de 15%: o banco e o backup podem parar.", abrir: tela("Painel"),
        });
      }
      const { data } = await sb.from("ti_incidentes").select("id, categoria, confirmado_em").is("confirmado_em", null)
        .gte("inicio", new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(200);
      const aConfirmar = (data ?? []).filter((i: { categoria: string | null }) => i.categoria !== "alarme_falso");
      if (aConfirmar.length) saida.push({
        chave: `ti.a_confirmar:${aConfirmar.map((i: { id: string }) => i.id.slice(0, 8)).join(",")}`, nivel: "aviso",
        titulo: `${plural(aConfirmar.length, "queda sem causa confirmada", "quedas sem causa confirmada")}`,
        detalhe: "Confirmar a causa (energia, internet, servidor) é o que forma o histórico para cobrar a concessionária ou a operadora.", abrir: tela("Incidentes"),
      });
      return saida;
    },
  },
  {
    exige: CHAMADOS,
    gerar: async (sb) => {
      const saida: Alerta[] = [];
      const { data } = await sb.from("ti_chamados").select("numero, titulo, prioridade, prazo, responsavel_nome, created_at").in("situacao", EM_ABERTO).order("prazo").limit(200);
      const lista = (data ?? []) as { numero: number; titulo: string; prioridade: string; prazo: string; responsavel_nome: string | null; created_at: string }[];
      const vencidos = lista.filter((c) => Date.parse(c.prazo) < Date.now());
      if (vencidos.length) saida.push({
        chave: `ti.vencidos:${vencidos.map((c) => c.numero).join(",")}`, nivel: "urgente",
        titulo: `${plural(vencidos.length, "chamado com prazo vencido", "chamados com prazo vencido")}`,
        detalhe: vencidos.slice(0, 3).map((c) => `#${c.numero} ${c.titulo} (venceu ${hora(c.prazo)})`).join(" · "), abrir: tela("Chamados"),
      });
      const soltos = lista.filter((c) => !c.responsavel_nome && Date.parse(c.prazo) >= Date.now());
      if (soltos.length) saida.push({
        chave: `ti.sem_responsavel:${soltos.map((c) => c.numero).join(",")}`, nivel: soltos.some((c) => c.prioridade === "urgente") ? "urgente" : "aviso",
        titulo: `${plural(soltos.length, "chamado sem ninguém atendendo", "chamados sem ninguém atendendo")}`,
        detalhe: soltos.slice(0, 3).map((c) => `#${c.numero} ${c.titulo} (aberto em ${dataBR(c.created_at)})`).join(" · "), abrir: tela("Chamados"),
      });
      return saida;
    },
  },
];

const MANUAL = `Você é a SARA da TI do Business OS.
Telas:
- Painel: o servidor da fábrica (no ar, ligado há quanto tempo, disco, memória, se Business OS, banco e Forja respondem), o backup diário, os testes de fora e os alertas por WhatsApp. Tudo lido do vigia externo, que roda na nuvem e percebe a queda mesmo com o servidor desligado.
- Incidentes: as quedas registradas pelo vigia (entram sozinhas) e as registradas pela TI. A causa do vigia é uma REGRA (o sinal do servidor parou × a fábrica responde de fora × o servidor reiniciou), não uma confirmação: diga "provável" até a TI confirmar.
- Chamados: a fila da TI. Qualquer pessoa da empresa abre e acompanha os seus em "Chamados de TI", no menu da conta (canto superior direito); não precisa do módulo de TI.
- Inventário: servidores, computadores, rede, coletores das CNCs e sistemas.
- Regras: categorias e prazos dos chamados.
Ainda não existe: leitura do nobreak (depende do nobreak gerenciável, T-01) e acessos remotos auditados (dependem da ferramenta que substitui o AnyDesk, T-05).
O backup sai criptografado para a nuvem; só o proprietário tem a chave para abrir.
Quem decide: o supervisor de TI, Cesar Augusto Santos (regras dos chamados, causa das quedas, escolha das ferramentas); compras e recursos (nobreak, link reserva, chip do WhatsApp) são do proprietário.`;

export const ti: Agente = {
  sara: {
    modulo: M, nome: "SARA da TI", rotulo: "TI", feature: M, permissao: "ti.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["O servidor e o backup estão bem?", "Quantas quedas tivemos este mês e por quê?", "Quais chamados estão vencidos?", "Como calcular a autonomia de um nobreak?"],
  },
  ferramentas, regras,
};
