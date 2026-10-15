import assert from "node:assert/strict";
import test from "node:test";
import { ordenarMenu, ordenarPorRotulo } from "../lib/menu-ordem.ts";

test("menus em ordem alfabética, sem ligar para acento e maiúscula; Painel/Dashboard no topo", () => {
  const rotulos = (l) => ordenarMenu(l.map((label) => ({ label }))).map((i) => i.label);
  assert.deepEqual(rotulos(["Solicitações", "Painel", "Recebidos", "A caminho", "Compras diretas"]), ["Painel", "A caminho", "Compras diretas", "Recebidos", "Solicitações"]);
  assert.deepEqual(rotulos(["Notas recebidas", "Máscaras de impostos", "A faturar", "Escritório contábil", "Configuração"]), ["A faturar", "Configuração", "Escritório contábil", "Máscaras de impostos", "Notas recebidas"]);
  assert.deepEqual(rotulos(["Vendas", "CRM", "Compras"]), ["Compras", "CRM", "Vendas"]);
  assert.deepEqual(rotulos(["Terceiros", "Dashboard", "Visitas", "Configurações"]), ["Dashboard", "Configurações", "Terceiros", "Visitas"]);
  assert.deepEqual(ordenarPorRotulo([["Relatórios", "r"], ["Painel", "p"], ["Bancos e conciliação", "b"]], ([l]) => l).map(([l]) => l), ["Painel", "Bancos e conciliação", "Relatórios"]);
});
