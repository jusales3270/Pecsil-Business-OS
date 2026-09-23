import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { graphGet, lerConfigGraph, type GraphConfig, type RespostaGraph } from "./graph-client";
import {
  deveGuardar,
  interpretarMensagem,
  proximoPasso,
  urlPrimeiraRodada,
  type ContaMonitorada,
  type Mensagem,
} from "./sync-core";

/**
 * Sincronização das caixas monitoradas.
 *
 * Leitura incremental: cada caixa guarda o `@odata.deltaLink` da última rodada,
 * e na próxima só chega o que mudou. A primeira rodada de uma caixa lê a
 * Entrada inteira (mais recentes primeiro) — é o único momento caro.
 *
 * Roda no servidor, sem sessão de usuário: quem chama é a tarefa agendada, por
 * dentro do contêiner. Por isso usa a chave de serviço, e por isso a rota que
 * chega aqui exige segredo próprio.
 */

/** Páginas por rodada. Segura a primeira leitura de uma caixa grande. */
const MAX_PAGINAS = 20;

export type ResultadoConta = {
  conta: string;
  novas: number;
  ignoradas: number;
  paginas: number;
  incompleta: boolean;
  erro?: string;
};

type Cliente = SupabaseClient;

type LinhaConta = {
  id: string;
  organization_id: string;
  address: string;
  mailbox_id: string;
  mode: "todos" | "remetentes_conhecidos";
  reads_body: boolean;
  delta_link: string | null;
};

const paraConta = (linha: LinhaConta): ContaMonitorada => ({
  id: linha.id,
  address: linha.address,
  mailboxId: linha.mailbox_id,
  mode: linha.mode,
  readsBody: linha.reads_body,
  deltaLink: linha.delta_link,
});

/** Remetentes conhecidos (clientes e fornecedores) da organização. */
async function lerConhecidos(db: Cliente, organizationId: string) {
  const { data, error } = await db
    .from("party_emails")
    .select("email, customer_id, supplier_id")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`Não foi possível ler os e-mails conhecidos: ${error.message}`);
  const enderecos = new Set<string>();
  const donos = new Map<string, { customerId: string | null; supplierId: string | null }>();
  for (const linha of data ?? []) {
    enderecos.add(linha.email);
    donos.set(linha.email, { customerId: linha.customer_id, supplierId: linha.supplier_id });
  }
  return { enderecos, donos };
}

/** Grava as mensagens novas; repetida não duplica (unique + ignoreDuplicates). */
async function gravar(db: Cliente, organizationId: string, conta: ContaMonitorada, mensagens: Mensagem[], donos: Map<string, { customerId: string | null; supplierId: string | null }>) {
  if (!mensagens.length) return 0;
  const linhas = mensagens.map((mensagem) => {
    const dono = donos.get(mensagem.fromAddress);
    return {
      organization_id: organizationId,
      account_id: conta.id,
      graph_id: mensagem.graphId,
      internet_message_id: mensagem.internetMessageId,
      conversation_id: mensagem.conversationId,
      from_name: mensagem.fromName,
      from_address: mensagem.fromAddress,
      to_addresses: mensagem.toAddresses,
      subject: mensagem.subject,
      received_at: mensagem.receivedAt,
      has_attachments: mensagem.hasAttachments,
      body_text: mensagem.bodyText,
      customer_id: dono?.customerId ?? null,
      supplier_id: dono?.supplierId ?? null,
    };
  });
  const { data, error } = await db
    .from("mail_messages")
    .upsert(linhas, { onConflict: "organization_id,internet_message_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Não foi possível gravar as mensagens: ${error.message}`);
  return data?.length ?? 0;
}

/** Uma rodada em uma caixa. */
export async function sincronizarConta(db: Cliente, config: GraphConfig, linha: LinhaConta): Promise<ResultadoConta> {
  const conta = paraConta(linha);
  const resultado: ResultadoConta = { conta: conta.address, novas: 0, ignoradas: 0, paginas: 0, incompleta: false };
  try {
    const { enderecos, donos } = await lerConhecidos(db, linha.organization_id);
    let url: string | null = conta.deltaLink ?? urlPrimeiraRodada(conta.mailboxId);
    let proximoDelta: string | null = null;

    while (url && resultado.paginas < MAX_PAGINAS) {
      const resposta: RespostaGraph = await graphGet(config, url);
      resultado.paginas += 1;
      const itens = Array.isArray(resposta.value) ? (resposta.value as Record<string, unknown>[]) : [];
      const guardar: Mensagem[] = [];
      for (const item of itens) {
        const mensagem = interpretarMensagem(item, conta);
        if (!mensagem) continue;
        if (!deveGuardar(mensagem, conta, enderecos)) {
          resultado.ignoradas += 1;
          continue;
        }
        guardar.push(mensagem);
      }
      resultado.novas += await gravar(db, linha.organization_id, conta, guardar, donos);

      const passo = proximoPasso(resposta);
      if (passo.tipo === "fim") {
        proximoDelta = passo.url;
        url = null;
      } else if (passo.tipo === "pagina") {
        url = passo.url;
      } else {
        url = null;
      }
    }

    // Parou no limite de páginas: guarda o ponto para continuar na próxima
    // rodada, senão a caixa grande nunca termina de entrar.
    if (url) {
      resultado.incompleta = true;
      proximoDelta = url;
    }

    await db
      .from("mail_accounts")
      .update({
        delta_link: proximoDelta ?? conta.deltaLink,
        last_sync_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
      })
      .eq("id", conta.id);
    return resultado;
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await db
      .from("mail_accounts")
      .update({ last_error: mensagem.slice(0, 500), last_error_at: new Date().toISOString() })
      .eq("id", conta.id);
    return { ...resultado, erro: mensagem };
  }
}

/** Todas as caixas ativas. */
export async function sincronizarTudo(db: Cliente): Promise<{ contas: ResultadoConta[]; erro?: string }> {
  const config = lerConfigGraph();
  if (!config) {
    return { contas: [], erro: "Conexão com a Microsoft não configurada (MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET)." };
  }
  const { data, error } = await db
    .from("mail_accounts")
    .select("id, organization_id, address, mailbox_id, mode, reads_body, delta_link")
    .eq("active", true)
    .order("address");
  if (error) return { contas: [], erro: `Não foi possível ler as caixas: ${error.message}` };
  if (!data?.length) return { contas: [], erro: "Nenhuma caixa de e-mail cadastrada." };

  const contas: ResultadoConta[] = [];
  for (const linha of data as LinhaConta[]) {
    contas.push(await sincronizarConta(db, config, linha));
  }
  return { contas };
}
