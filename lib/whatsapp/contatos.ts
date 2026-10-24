import { numeroWhatsApp } from "./evolution.ts";

/**
 * Os números (canais) de WhatsApp da Pecsil e as listas de cada um (PLANO-WHATSAPP, W2; decisões do proprietário
 * em 24/10/2026). Canal: nome, departamento, descrição do que atende e a SARA responsável. Lista interna:
 * alguém da Pecsil, ligado ao usuário da plataforma (fala com a SARA do canal com a credencial dele). Lista
 * externa: fornecedores, clientes e outros (envios e respostas autorizadas pela API oficial, W5).
 * Regras puras: conferem a entrada antes de chegar ao banco (que confere de novo).
 */

export type Lista = "interna" | "externa";
export type Categoria = "fornecedor" | "cliente" | "outro";
export type SaraOpcao = { modulo: string; rotulo: string; permissao: string };

export type Canal = { nome: string; departamento: string | null; descricao: string | null; sara_modulo: string | null };
export type ContatoInterno = { lista: "interna"; numero: string; profile_id: string; observacao: string | null };
export type ContatoExterno = { lista: "externa"; numero: string; nome: string; categoria: Categoria; supplier_id: string | null; customer_id: string | null; observacao: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown, max: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, max) : null; };

/** As SARAs que o usuário pode usar: as que a credencial dele libera (o proprietário, todas). */
export function sarasDoUsuario(saras: SaraOpcao[], permissoes: Set<string>, dono: boolean): SaraOpcao[] {
  return saras.filter((s) => dono || permissoes.has(s.permissao));
}

/** Confere os dados de um canal (número da plataforma). A SARA responsável tem de existir. */
export function validarCanal(e: Record<string, unknown>, saras: SaraOpcao[]): Canal | { erro: string } {
  const nome = texto(e.nome, 60);
  if (!nome || nome.length < 2) return { erro: "Dê um nome ao número (ex.: Comercial, Atendimento a clientes)." };
  const departamento = texto(e.departamento, 60);
  if (departamento && departamento.length < 2) return { erro: "O departamento ficou curto demais." };
  const sara = texto(e.sara_modulo, 30);
  if (sara && !saras.some((s) => s.modulo === sara)) return { erro: "Essa SARA não existe." };
  return { nome, departamento, descricao: texto(e.descricao, 400), sara_modulo: sara };
}

/**
 * Confere um contato da lista interna do canal. `podeSaraDoCanal`: a credencial do usuário libera a SARA
 * responsável pelo canal (sem isso a SARA não teria o que responder a ele).
 */
export function validarInterno(e: Record<string, unknown>, podeSaraDoCanal: boolean): ContatoInterno | { erro: string } {
  const n = numeroWhatsApp(e.numero);
  if ("erro" in n) return n;
  const perfil = String(e.profile_id ?? "");
  if (!UUID.test(perfil)) return { erro: "Escolha o usuário da plataforma." };
  if (!podeSaraDoCanal) return { erro: "A credencial deste usuário não libera a SARA responsável por este número. Libere em Pessoas e Acessos ou escolha outro número." };
  return { lista: "interna", numero: n.numero, profile_id: perfil, observacao: texto(e.observacao, 300) };
}

/** Confere um contato da lista externa. */
export function validarExterno(e: Record<string, unknown>): ContatoExterno | { erro: string } {
  const n = numeroWhatsApp(e.numero);
  if ("erro" in n) return n;
  const nome = texto(e.nome, 120);
  if (!nome || nome.length < 2) return { erro: "Diga o nome do contato (pessoa ou empresa)." };
  const categoria = String(e.categoria ?? "") as Categoria;
  if (!["fornecedor", "cliente", "outro"].includes(categoria)) return { erro: "Escolha se é fornecedor, cliente ou outro." };
  const fornecedor = UUID.test(String(e.supplier_id ?? "")) ? String(e.supplier_id) : null;
  const cliente = UUID.test(String(e.customer_id ?? "")) ? String(e.customer_id) : null;
  if (fornecedor && categoria !== "fornecedor") return { erro: "O vínculo com o cadastro de fornecedores é só para fornecedor." };
  if (cliente && categoria !== "cliente") return { erro: "O vínculo com o cadastro de clientes é só para cliente." };
  return { lista: "externa", numero: n.numero, nome, categoria, supplier_id: fornecedor, customer_id: cliente, observacao: texto(e.observacao, 300) };
}

/** A mensagem de boas-vindas (opcional, o proprietário manda quando quiser): confirma que o número está certo. */
export function boasVindas(primeiroNome: string | null, canal: string, sara: string | null): string {
  return `Olá${primeiroNome ? `, ${primeiroNome}` : ""}. Este número foi ligado ao WhatsApp "${canal}" da Pecsil${sara ? `, atendido pela ${sara}` : ""}. Por aqui você pode conversar por texto ou áudio, com as mesmas permissões que tem na plataforma.`;
}
