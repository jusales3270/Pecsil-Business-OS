import type { Agente } from "../base.ts";
import { almoxarifado } from "./almoxarifado.ts";
import { comercial } from "./comercial.ts";
import { compras } from "./compras.ts";
import { fiscal } from "./fiscal.ts";
import { fundicao } from "./fundicao.ts";
import { portaria } from "./portaria.ts";
import { producao } from "./producao.ts";
import { rh } from "./rh.ts";

/**
 * A equipe de SARAs dos módulos (além da do Financeiro, que nasceu primeiro em ferramentas.ts,
 * modulos.ts e alertas.ts). Cada agente: a SARA do módulo, as consultas e as regras dos avisos.
 * Todas com os mesmos guardrails (escopo, dado pessoal, permissões de quem conversa).
 */
export const AGENTES: Agente[] = [compras, almoxarifado, fundicao, comercial, fiscal, rh, portaria, producao];
