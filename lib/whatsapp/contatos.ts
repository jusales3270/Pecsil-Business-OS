import { modeloValido } from "../sara/modelos.ts";
import { numeroWhatsApp } from "./evolution.ts";

/**
 * Os números (canais) de WhatsApp da Pecsil e a allowlist de cada um (PLANO-WHATSAPP; decisões do proprietário em
 * 24 e 25/10/2026). Número: nome, departamento, descrição, o PROMPT (como a SARA se comporta ali; complementa a SARA)
 * e o MODELO. Allowlist: só quem está nela fala com o número; cada pessoa é um usuário da plataforma (o nome digitado
 * é só apelido) com a SARA de que recebe e envia informação, sempre com a credencial dela. Lista externa
 * (fornecedores e clientes): fica para depois. Regras puras: conferem a entrada antes do banco (que confere de novo).
 */

export type Lista = "interna" | "externa";
export type Categoria = "fornecedor" | "cliente" | "outro";
export type SaraOpcao = { modulo: string; rotulo: string; permissao: string };

export type Canal = { nome: string; departamento: string | null; descricao: string | null; prompt: string | null; provedor: "anthropic"; modelo: string | null };
export type ContatoInterno = { lista: "interna"; numero: string; profile_id: string; sara_modulo: string; nome: string | null; observacao: string | null };
export type ContatoExterno = { lista: "externa"; numero: string; nome: string; categoria: Categoria; supplier_id: string | null; customer_id: string | null; observacao: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown, max: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, max) : null; };

/** As SARAs que o usuário pode usar: as que a credencial dele libera (o proprietário, todas). */
export function sarasDoUsuario(saras: SaraOpcao[], permissoes: Set<string>, dono: boolean): SaraOpcao[] {
  return saras.filter((s) => dono || permissoes.has(s.permissao));
}

/** O prompt do número: texto livre com quebras de linha (até 4.000 caracteres). */
const prompt = (v: unknown) => { const t = String(v ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); return t ? t.slice(0, 4000) : null; };

/** Confere os dados de um canal (número da plataforma): nome, departamento, descrição, prompt e modelo. */
export function validarCanal(e: Record<string, unknown>): Canal | { erro: string } {
  const nome = texto(e.nome, 60);
  if (!nome || nome.length < 2) return { erro: "Dê um nome ao número (ex.: Comercial, Atendimento a clientes)." };
  const departamento = texto(e.departamento, 60);
  if (departamento && departamento.length < 2) return { erro: "O departamento ficou curto demais." };
  const p = prompt(e.prompt);
  if (p && p.length < 20) return { erro: "O comportamento ficou curto demais: descreva como a SARA deve agir neste número." };
  const modelo = texto(e.modelo, 60);
  if (modelo && !modeloValido("anthropic", modelo)) return { erro: "Escolha um dos modelos da lista." };
  return { nome, departamento, descricao: texto(e.descricao, 400), prompt: p, provedor: "anthropic", modelo };
}

/**
 * Confere uma pessoa da allowlist: usuário da plataforma, a SARA dela e o número. `sarasDoUsuario`: as SARAs que
 * a credencial do usuário libera (sem isso a SARA não teria o que responder a ele).
 */
export function validarInterno(e: Record<string, unknown>, sarasDoUsuario: string[]): ContatoInterno | { erro: string } {
  const n = numeroWhatsApp(e.numero);
  if ("erro" in n) return n;
  const perfil = String(e.profile_id ?? "");
  if (!UUID.test(perfil)) return { erro: "Escolha a pessoa na lista de usuários da plataforma." };
  const sara = texto(e.sara_modulo, 30);
  if (!sara) return { erro: "Escolha de qual SARA esta pessoa recebe e envia informação." };
  if (!sarasDoUsuario.includes(sara)) return { erro: "A credencial deste usuário não libera essa SARA. Libere em Pessoas e Acessos ou escolha outra." };
  return { lista: "interna", numero: n.numero, profile_id: perfil, sara_modulo: sara, nome: texto(e.nome, 60), observacao: texto(e.observacao, 300) };
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
