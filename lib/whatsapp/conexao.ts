import type { SupabaseClient } from "@supabase/supabase-js";
import { situacao, type EstadoCanal, type Situacao } from "./evolution";

/**
 * Vigia da conexão dos números (pedido do proprietário em 25/10/2026): se o chip de um número ativo cai (celular
 * desligado, aparelho desconectado, Evolution fora), a SARA para de responder e ninguém fica sabendo. A tarefa de
 * 10 em 10 minutos confere cada número; caído, confere de novo 30 s depois (a conexão às vezes oscila e volta
 * sozinha) e, se continuar, avisa o proprietário no sino UMA vez. Quando volta, avisa que voltou.
 * O aviso não vai pelo WhatsApp: é justamente ele que está fora.
 */
export const CAIDO: EstadoCanal[] = ["desconectado", "aguardando_qr", "sem_instancia", "fora_do_ar"];
export const ROTULO_CAIDO: Partial<Record<EstadoCanal, string>> = {
  desconectado: "o chip foi desconectado (o celular saiu de Aparelhos conectados ou perdeu a sessão)",
  aguardando_qr: "o chip está esperando a leitura de um QR Code",
  sem_instancia: "o número não existe mais na Evolution",
  fora_do_ar: "a Evolution não respondeu",
};
const marca = (nome: string) => `WhatsApp «${nome}»`;
export const tituloCaiu = (nome: string) => `⚠️ ${marca(nome)} fora do ar`;
export const tituloVoltou = (nome: string) => `✅ ${marca(nome)} voltou`;

type Deps = { situacao: (instancia: string) => Promise<Situacao>; esperar: (ms: number) => Promise<void> };
const PADRAO: Deps = { situacao: (i) => situacao(i), esperar: (ms) => new Promise((r) => setTimeout(r, ms)) };
export type Vigia = { conferidos: number; caidos: number; avisos: number };

/** `somente`: restringe quem é avisado (teste; em produção, todos os proprietários). */
export async function vigiarConexoes(admin: SupabaseClient, deps: Partial<Deps> = {}, somente?: string[]): Promise<Vigia> {
  const d = { ...PADRAO, ...deps };
  const r: Vigia = { conferidos: 0, caidos: 0, avisos: 0 };
  const { data: canais } = await admin.from("whatsapp_canais").select("id, organization_id, nome, instancia").eq("ativo", true).eq("conexao", "whatsapp_web");
  if (!canais?.length) return r;
  const { data: donos } = await admin.from("profiles").select("id, organization_id").eq("is_owner", true).eq("status", "active");
  for (const c of canais as { id: string; organization_id: string; nome: string; instancia: string }[]) {
    let s = await d.situacao(c.instancia);
    if (s.estado === "sem_configuracao") continue;
    r.conferidos++;
    if (CAIDO.includes(s.estado)) {
      await d.esperar(30_000);
      s = await d.situacao(c.instancia);
    }
    const caido = CAIDO.includes(s.estado);
    if (caido) r.caidos++;
    for (const dono of ((donos ?? []) as { id: string; organization_id: string }[]).filter((x) => x.organization_id === c.organization_id && (!somente || somente.includes(x.id)))) {
      // O último aviso deste número para este dono decide: caído já avisado não repete; voltou só depois de um "caiu".
      const { data: ultimo } = await admin.from("notifications").select("title").eq("recipient_profile_id", dono.id).like("title", `%${marca(c.nome)}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle<{ title: string }>();
      const avisouQueda = Boolean(ultimo?.title?.startsWith(tituloCaiu(c.nome)));
      if (caido && !avisouQueda) {
        await admin.from("notifications").insert({ organization_id: c.organization_id, recipient_profile_id: dono.id, module_code: "fundacao", severity: "critical",
          title: tituloCaiu(c.nome), action_url: "/?view=WhatsApp",
          body: `${(ROTULO_CAIDO[s.estado] ?? "o número não está conectado")[0].toUpperCase()}${(ROTULO_CAIDO[s.estado] ?? "o número não está conectado").slice(1)}. Enquanto isso, a SARA não recebe nem envia por este número; um envio agendado tenta de novo por 30 minutos e, se o número não voltar, fica como "falhou". Abra Fundação › WhatsApp para reconectar.` });
        r.avisos++;
      } else if (!caido && avisouQueda) {
        await admin.from("notifications").insert({ organization_id: c.organization_id, recipient_profile_id: dono.id, module_code: "fundacao", severity: "info",
          title: tituloVoltou(c.nome), action_url: "/?view=WhatsApp", body: "O número está conectado de novo: a SARA volta a receber e enviar por ele." });
        r.avisos++;
      }
    }
  }
  return r;
}
