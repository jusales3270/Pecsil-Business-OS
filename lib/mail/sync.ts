import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarOriginalSistema } from "../documentos/guardar";
import { graphGet, graphGetBytes, lerConfigGraph, type GraphConfig, type RespostaGraph } from "./graph-client";
import {
  decidirAnexo,
  desdeQuandoBaixarAnexos,
  deveGuardar,
  interpretarAnexo,
  interpretarMensagem,
  proximoPasso,
  urlAnexos,
  urlConteudoAnexo,
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
/** Mensagens com anexo por rodada; o resto fica para a próxima. */
const MENSAGENS_COM_ANEXO_POR_RODADA = 20;
/** Tentativas por mensagem antes de desistir dos anexos dela (o erro fica na mensagem). */
const TENTATIVAS_ANEXO = 3;

export type ResultadoConta = {
  conta: string;
  novas: number;
  ignoradas: number;
  paginas: number;
  incompleta: boolean;
  anexos: number;
  anexosComErro: number;
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

export type DepsAnexos = {
  listar: (alvo: string) => Promise<RespostaGraph>;
  baixar: (alvo: string) => Promise<Uint8Array>;
  guardar: typeof guardarOriginalSistema;
};

const depsAnexos = (config: GraphConfig): DepsAnexos => ({
  listar: (alvo) => graphGet(config, alvo),
  baixar: (alvo) => graphGetBytes(config, alvo),
  guardar: guardarOriginalSistema,
});

type MensagemComAnexo = { id: string; graph_id: string; from_address: string; attachments_tries: number };

/**
 * Segunda etapa da rodada: os anexos das mensagens guardadas. O arquivo vai para Documentos › Comercial
 * (mesmo arquivo não duplica) e fica ligado à mensagem em `mail_attachments` — é de lá que o desenho
 * do pedido segue para o orçamento. O que não é guardado (link, e-mail anexado, logotipo, acima de
 * 50 MB) fica registrado com o motivo.
 */
export async function baixarAnexos(db: Cliente, organizationId: string, conta: ContaMonitorada, deps: DepsAnexos, agora: Date = new Date()) {
  const r = { guardados: 0, falhas: 0 };
  // Caixa só com Mail.ReadBasic não lê anexo.
  if (!conta.readsBody) return r;
  const { data, error } = await db
    .from("mail_messages")
    .select("id, graph_id, from_address, attachments_tries")
    .eq("account_id", conta.id)
    .eq("has_attachments", true)
    .is("attachments_synced_at", null)
    .lt("attachments_tries", TENTATIVAS_ANEXO)
    .gte("received_at", desdeQuandoBaixarAnexos(agora))
    .order("received_at", { ascending: false })
    .limit(MENSAGENS_COM_ANEXO_POR_RODADA);
  if (error) throw new Error(`Não foi possível ler as mensagens com anexo: ${error.message}`);

  for (const m of (data ?? []) as MensagemComAnexo[]) {
    // Trava: conta a tentativa antes do trabalho; se outra rodada já pegou, segue adiante.
    const { data: pegou } = await db
      .from("mail_messages")
      .update({ attachments_tries: m.attachments_tries + 1 })
      .eq("id", m.id)
      .eq("attachments_tries", m.attachments_tries)
      .is("attachments_synced_at", null)
      .select("id");
    if (!pegou?.length) continue;
    try {
      const { data: jaTem } = await db.from("mail_attachments").select("graph_attachment_id").eq("message_id", m.id);
      const feitos = new Set(((jaTem ?? []) as { graph_attachment_id: string }[]).map((x) => x.graph_attachment_id));
      const lista = await deps.listar(urlAnexos(conta.mailboxId, m.graph_id));
      const itens = Array.isArray(lista.value) ? (lista.value as Record<string, unknown>[]) : [];
      for (const bruto of itens) {
        const anexo = interpretarAnexo(bruto);
        if (!anexo || feitos.has(anexo.graphId)) continue;
        const decisao = decidirAnexo(anexo);
        let documentId: string | null = null;
        if (decisao.guardar) {
          const dados = await deps.baixar(urlConteudoAnexo(conta.mailboxId, m.graph_id, anexo.graphId));
          const guardado = await deps.guardar(db, organizationId, {
            modulo: "comercial",
            feature: "comercial.caixa",
            origem: "email",
            arquivo: { nome: anexo.nome, tipo: anexo.tipoMime, dados },
            titulo: `${anexo.nome} · e-mail de ${m.from_address}`,
            autor: `E-mail · ${conta.address}`,
            entidade: { tipo: "email", id: m.id },
            // Anexo de e-mail pode trazer dado de pessoa (currículo, documento): fica fora do texto lido.
            mascararDadoPessoal: true,
          });
          documentId = guardado.id || null;
          r.guardados += 1;
        }
        const { error: eAnexo } = await db.from("mail_attachments").insert({
          organization_id: organizationId,
          message_id: m.id,
          graph_attachment_id: anexo.graphId,
          name: anexo.nome,
          content_type: anexo.tipoMime,
          size_bytes: anexo.tamanho,
          inline: anexo.inline,
          especie: anexo.especie,
          document_id: documentId,
          motivo: decisao.guardar ? null : decisao.motivo,
        });
        if (eAnexo && eAnexo.code !== "23505") throw new Error(`Não foi possível registrar o anexo: ${eAnexo.message}`);
      }
      await db.from("mail_messages").update({ attachments_synced_at: new Date().toISOString(), attachments_error: null }).eq("id", m.id);
    } catch (erro) {
      r.falhas += 1;
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await db.from("mail_messages").update({ attachments_error: mensagem.slice(0, 500) }).eq("id", m.id);
    }
  }
  return r;
}

/** Uma rodada em uma caixa. */
export async function sincronizarConta(db: Cliente, config: GraphConfig, linha: LinhaConta, deps: DepsAnexos = depsAnexos(config)): Promise<ResultadoConta> {
  const conta = paraConta(linha);
  const resultado: ResultadoConta = { conta: conta.address, novas: 0, ignoradas: 0, paginas: 0, incompleta: false, anexos: 0, anexosComErro: 0 };
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

    const anexos = await baixarAnexos(db, linha.organization_id, conta, deps);
    resultado.anexos = anexos.guardados;
    resultado.anexosComErro = anexos.falhas;
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
