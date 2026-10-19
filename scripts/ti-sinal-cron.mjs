#!/usr/bin/env node
/**
 * Sinal de vida do servidor da fábrica para o vigia externo (T-03, docs/VIGIA-EXTERNO.md).
 *
 * Roda como tarefa agendada do Coolify, DENTRO do contêiner do Business OS, a
 * cada minuto. Variáveis (no Coolify, nunca NEXT_PUBLIC_): VIGIA_URL, VIGIA_CHAVE
 * (chave pública do projeto do vigia) e VIGIA_TOKEN (o token do alvo). Sai com erro
 * se o envio falhar, para a falha aparecer no histórico da tarefa.
 */
import { enviarSinal, infoDoHost, montarSinal, testarServicos } from "../lib/ti/sinal-de-vida.mjs";

const { VIGIA_URL, VIGIA_CHAVE, VIGIA_TOKEN, VIGIA_ALVO } = process.env;
if (!VIGIA_URL || !VIGIA_CHAVE || !VIGIA_TOKEN) {
  console.error("VIGIA_URL, VIGIA_CHAVE ou VIGIA_TOKEN ausente.");
  process.exit(1);
}
try {
  const info = montarSinal(infoDoHost(), await testarServicos());
  const r = await enviarSinal({ url: VIGIA_URL, chave: VIGIA_CHAVE, token: VIGIA_TOKEN, alvo: VIGIA_ALVO || undefined, info });
  const fora = Object.entries(info.servicos).filter(([, s]) => !s.ok).map(([n]) => n);
  console.log(new Date().toISOString(), "sinal enviado", r.estado ?? "", fora.length ? `fora por dentro: ${fora.join(", ")}` : "");
} catch (error) {
  console.error(new Date().toISOString(), "falha:", error instanceof Error ? error.message : error);
  process.exit(1);
}
