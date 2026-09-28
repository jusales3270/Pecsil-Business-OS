#!/usr/bin/env node
/**
 * Sincroniza o espelho das OS do Forja (etapa 2 do plano de custo e margem).
 *
 * Roda como tarefa agendada do Coolify, DENTRO do contêiner do Business OS, a
 * cada 10 minutos: chama a rota local /api/producao/sync-os com o segredo
 * FORJA_SYNC_SECRET (variável do Coolify). Sai com erro se a sincronização
 * falhar, para a falha aparecer no histórico da tarefa.
 */
const port = process.env.PORT || 3000;
const secret = process.env.FORJA_SYNC_SECRET;
if (!secret) {
  console.error("FORJA_SYNC_SECRET ausente.");
  process.exit(1);
}
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/producao/sync-os`, {
    method: "POST",
    headers: { "x-sync-secret": secret },
  });
  const text = await response.text();
  console.log(new Date().toISOString(), response.status, text.slice(0, 500));
  if (!response.ok) process.exit(1);
} catch (error) {
  console.error(new Date().toISOString(), "falha:", error instanceof Error ? error.message : error);
  process.exit(1);
}
