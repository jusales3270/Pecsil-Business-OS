import { SARAS } from "../sara/modulos";
import type { SaraOpcao } from "./contatos";

/** As SARAs que podem responder por um número de WhatsApp (todas as da plataforma; "warroom" = SARA central). */
export const SARA_OPCOES: SaraOpcao[] = Object.values(SARAS).map((s) => ({ modulo: s.modulo, rotulo: s.central ? "SARA central" : `SARA ${s.rotulo === "TI" ? "da TI" : `de ${s.rotulo}`}`, permissao: s.permissao }));
