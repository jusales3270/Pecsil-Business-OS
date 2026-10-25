import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { boasVindas, sarasDoUsuario, validarCanal, validarExterno, validarInterno } from "../lib/whatsapp/contatos.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const SARAS = [
  { modulo: "fundicao", rotulo: "SARA de Fundição", permissao: "fundicao.sara" },
  { modulo: "comercial", rotulo: "SARA de Comercial", permissao: "comercial.sara" },
  { modulo: "warroom", rotulo: "SARA central", permissao: "warroom.sara" },
];
const P = "0b8c2a1e-1111-4222-8333-944455556666";

test("números: o canal tem nome, departamento, descrição, o comportamento (prompt) e o modelo (25/10)", () => {
  const prompt = "Você atende os funcionários da Pecsil.\r\nSeja direta.\n\n\n\nResponda só sobre o trabalho.";
  assert.deepEqual(validarCanal({ nome: " Comercial ", departamento: "Comercial", descricao: "Pedidos e orçamentos de clientes", prompt, modelo: "claude-haiku-5-5", sara_modulo: "comercial" }),
    { nome: "Comercial", departamento: "Comercial", descricao: "Pedidos e orçamentos de clientes", prompt: "Você atende os funcionários da Pecsil.\nSeja direta.\n\nResponda só sobre o trabalho.", provedor: "anthropic", modelo: "claude-haiku-5-5" },
    "a SARA não é mais do número (é de cada pessoa da allowlist); o prompt guarda as quebras de linha");
  assert.deepEqual(validarCanal({ nome: "Atendimento" }), { nome: "Atendimento", departamento: null, descricao: null, prompt: null, provedor: "anthropic", modelo: null }, "sem prompt e com o modelo da SARA");
  assert.match(validarCanal({ nome: "A" }).erro, /nome/);
  assert.match(validarCanal({ nome: "Fiscal", modelo: "gpt-qualquer" }).erro, /modelos da lista/);
  assert.match(validarCanal({ nome: "Fiscal", prompt: "Seja breve." }).erro, /curto demais/);
  assert.equal(validarCanal({ nome: "Fiscal", prompt: "x".repeat(5000) }).prompt.length, 4000);
});

test("listas: as SARAs que o usuário pode usar vêm da credencial dele", () => {
  assert.deepEqual(sarasDoUsuario(SARAS, new Set(["fundicao.sara"]), false).map((s) => s.modulo), ["fundicao"]);
  assert.equal(sarasDoUsuario(SARAS, new Set(), true).length, 3, "o proprietário, todas");
  assert.equal(sarasDoUsuario(SARAS, new Set(["fundicao.pedidos"]), false).length, 0);
});

test("allowlist: usuário da plataforma, a SARA de cada pessoa (liberada pela credencial dela) e o apelido", () => {
  assert.deepEqual(validarInterno({ numero: "15 91234-5678", profile_id: P, sara_modulo: "fundicao", nome: " Gui " }, ["fundicao"]),
    { lista: "interna", numero: "5515912345678", profile_id: P, sara_modulo: "fundicao", nome: "Gui", observacao: null });
  assert.match(validarInterno({ numero: "15 91234-5678", profile_id: P, sara_modulo: "comercial" }, ["fundicao"]).erro, /não libera essa SARA/);
  assert.match(validarInterno({ numero: "15 91234-5678", profile_id: P }, ["fundicao"]).erro, /de qual SARA/);
  assert.match(validarInterno({ numero: "15 91234-5678", profile_id: "x", sara_modulo: "fundicao" }, ["fundicao"]).erro, /usuários da plataforma/);
  assert.match(validarInterno({ numero: "9966", profile_id: P, sara_modulo: "fundicao" }, ["fundicao"]).erro, /DDD/);
});

test("allowlist: a migração passa a SARA do número para cada pessoa e não apaga a coluna antes do Deploy", () => {
  const mig = ler("supabase/migrations/202610250002_whatsapp_allowlist.sql");
  assert.match(mig, /update public\.whatsapp_contatos c set sara_modulo = k\.sara_modulo/);
  assert.match(mig, /check \(lista <> 'interna' or sara_modulo is not null\)/);
  assert.match(mig, /provedor text not null default 'anthropic' check \(provedor in \('anthropic'\)\)/);
  assert.doesNotMatch(mig, /drop column/i, "a coluna antiga sai só depois do Deploy");
  const a = ler("lib/whatsapp/atender.ts");
  assert.match(a, /const sara = contato\.sara_modulo;/);
  assert.match(a, /\{ comportamento: canal\.prompt, modelo: canal\.modelo, apelido: contato\.nome \}/);
  const r = ler("lib/sara/responder.ts");
  assert.match(r, /export async function responder\(p: Preparado, modulo: string, corpo: Corpo \| null, doCanal: DoCanal = \{\}\)/, "o prompt do número não vem do corpo da requisição");
  assert.doesNotMatch(r, /corpo\?\.comportamento|corpo\?\.modelo/);
  assert.match(r, /as regras de segurança, de permissão e de escopo da empresa continuam valendo e prevalecem/);
});

test("listas: externa exige nome e categoria; vínculo só com o cadastro da categoria", () => {
  const S = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  assert.deepEqual(validarExterno({ numero: "11 98765-4321", nome: " White  Martins ", categoria: "fornecedor", supplier_id: S }),
    { lista: "externa", numero: "5511987654321", nome: "White Martins", categoria: "fornecedor", supplier_id: S, customer_id: null, observacao: null });
  assert.match(validarExterno({ numero: "11 98765-4321", nome: "X", categoria: "fornecedor" }).erro, /nome/);
  assert.match(validarExterno({ numero: "11 98765-4321", nome: "Fulano", categoria: "parceiro" }).erro, /fornecedor, cliente ou outro/);
  assert.match(validarExterno({ numero: "11 98765-4321", nome: "Fulano", categoria: "cliente", supplier_id: S }).erro, /só para fornecedor/);
  assert.match(validarExterno({ numero: "11 98765-4321", nome: "Fulano", categoria: "fornecedor", customer_id: S }).erro, /só para cliente/);
});

test("listas: boas-vindas com o primeiro nome, o número e a SARA, na grafia da empresa", () => {
  assert.match(boasVindas("Guilherme", "Fundição", "SARA de Fundição"), /^Olá, Guilherme\. Este número foi ligado ao WhatsApp "Fundição" da Pecsil, atendido pela SARA de Fundição\./);
  assert.match(boasVindas(null, "Comercial", null), /^Olá\. Este número foi ligado ao WhatsApp "Comercial" da Pecsil\. /);
  assert.doesNotMatch(boasVindas("x", "y", null), /PecSil/);
});

test("números e listas: só o proprietário; o número é único dentro do mesmo canal; o chip atual vira o primeiro canal", () => {
  const mig = ler("supabase/migrations/202610240002_whatsapp_contatos.sql");
  assert.match(mig, /unique \(canal_id, numero\)/);
  assert.match(mig, /canal_id uuid not null references public\.whatsapp_canais\(id\) on delete cascade/);
  assert.equal((mig.match(/using \(organization_id = \(select public\.current_organization_id\(\)\) and \(select public\.is_owner\(\)\)\)/g) ?? []).length, 2);
  assert.match(mig, /revoke all on public\.whatsapp_canais, public\.whatsapp_contatos from anon/);
  assert.match(mig, /'pecsil-interno', 'Chip interno'/);
  for (const r of ["app/api/foundation/whatsapp/route.ts", "app/api/foundation/whatsapp/contatos/route.ts"]) assert.match(ler(r), /if \(!access\?\.isOwner\)/, r);
});
