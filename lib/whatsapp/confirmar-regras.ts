/**
 * Regras puras de "confirmar pelo WhatsApp" (PLANO-WHATSAPP §5), sem dependências: testadas sem o banco e usadas
 * pela tela das Guias. O caminho com o banco e a Evolution fica em confirmar.ts.
 */

/** Ações que PODEM ser liberadas e a área dona de cada uma (a mesma lista da função sara_whatsapp_confirmar_salvar). */
export const PODE_PELO_WHATSAPP: Record<string, { modulo: string; rotulo: string }> = {
  abrir_chamado_ti: { modulo: "ti", rotulo: "Abrir chamado de TI" },
  registrar_incidente: { modulo: "ti", rotulo: "Registrar incidente de TI" },
  atender_chamado_ti: { modulo: "ti", rotulo: "Atender chamado de TI" },
  cadastrar_equipamento: { modulo: "ti", rotulo: "Cadastrar equipamento" },
  anotar_na_biblioteca: { modulo: "fundicao", rotulo: "Anotar na Biblioteca" },
  incluir_terceiro: { modulo: "rh", rotulo: "Incluir terceiro no quadro" },
  entrada_de_producao: { modulo: "producao", rotulo: "Dar entrada de produção" },
};

export const VALIDADE_ENQUETE_MS = 15 * 60_000;
export const OPCOES_ENQUETE = [{ id: "sim", texto: "Sim" }, { id: "nao", texto: "Não" }];

/** Meia-noite de hoje em Brasília, em ISO (o limite é por dia). */
export function inicioDoDia(agora: Date = new Date()): string {
  return new Date(Date.parse(`${new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00-03:00`)).toISOString();
}

/** A pergunta da enquete (o WhatsApp corta o nome da enquete em ~255 caracteres). */
export function perguntaDaEnquete(resumo: string): string {
  const r = resumo.replace(/\s+/g, " ").trim();
  return `Confirma? ${r.length > 230 ? `${r.slice(0, 229)}…` : r}`;
}

export type AcaoPendente = { id: string; organization_id: string; modulo: string; ferramenta: string; resumo: string; risco: string; situacao: string; expira_em: string; profile_id: string };
export type MotivoSemEnquete = "nao_liberada" | "risco_alto" | "nao_pendente" | "outra_pessoa" | "limite_do_dia" | "ja_tem_enquete";

/** Regra pura: a ação pode virar enquete agora? */
export function podeVirarEnquete(a: AcaoPendente, o: { perfil: string; liberada: { ate_por_dia: number } | null; usadasHoje: number; temAberta: boolean; agora?: number }): { ok: true } | { ok: false; motivo: MotivoSemEnquete } {
  if (!PODE_PELO_WHATSAPP[a.ferramenta] || !o.liberada) return { ok: false, motivo: "nao_liberada" };
  if (a.risco === "alto") return { ok: false, motivo: "risco_alto" };
  if (a.situacao !== "pendente" || Date.parse(a.expira_em) <= (o.agora ?? Date.now())) return { ok: false, motivo: "nao_pendente" };
  if (a.profile_id !== o.perfil) return { ok: false, motivo: "outra_pessoa" };
  if (o.usadasHoje >= o.liberada.ate_por_dia) return { ok: false, motivo: "limite_do_dia" };
  if (o.temAberta) return { ok: false, motivo: "ja_tem_enquete" };
  return { ok: true };
}
