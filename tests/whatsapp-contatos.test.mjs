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

test("números: o canal tem nome, departamento, descrição e uma SARA que existe", () => {
  assert.deepEqual(validarCanal({ nome: " Comercial ", departamento: "Comercial", descricao: "Pedidos e orçamentos de clientes", sara_modulo: "comercial" }, SARAS),
    { nome: "Comercial", departamento: "Comercial", descricao: "Pedidos e orçamentos de clientes", sara_modulo: "comercial" });
  assert.deepEqual(validarCanal({ nome: "Atendimento" }, SARAS), { nome: "Atendimento", departamento: null, descricao: null, sara_modulo: null }, "SARA pode ficar para depois");
  assert.match(validarCanal({ nome: "A" }, SARAS).erro, /nome/);
  assert.match(validarCanal({ nome: "Fiscal", sara_modulo: "inventada" }, SARAS).erro, /não existe/);
});

test("listas: as SARAs que o usuário pode usar vêm da credencial dele", () => {
  assert.deepEqual(sarasDoUsuario(SARAS, new Set(["fundicao.sara"]), false).map((s) => s.modulo), ["fundicao"]);
  assert.equal(sarasDoUsuario(SARAS, new Set(), true).length, 3, "o proprietário, todas");
  assert.equal(sarasDoUsuario(SARAS, new Set(["fundicao.pedidos"]), false).length, 0);
});

test("listas: interna exige usuário cuja credencial libere a SARA do número", () => {
  assert.deepEqual(validarInterno({ numero: "15 99662-2530", profile_id: P }, true),
    { lista: "interna", numero: "5515996622530", profile_id: P, observacao: null });
  assert.match(validarInterno({ numero: "15 99662-2530", profile_id: P }, false).erro, /não libera a SARA responsável/);
  assert.match(validarInterno({ numero: "15 99662-2530", profile_id: "x" }, true).erro, /usuário/);
  assert.match(validarInterno({ numero: "9966", profile_id: P }, true).erro, /DDD/);
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
