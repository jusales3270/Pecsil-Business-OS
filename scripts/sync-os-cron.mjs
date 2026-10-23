#!/usr/bin/env node
/**
 * Sincroniza o espelho das OS do Forja (etapa 2 do plano de custo e margem), roda a fila das guias da
 * SARA (E3: as de agenda que venceram e as disparadas por acontecimentos) e o Bom dia da SARA (J2: de
 * segunda a sábado, das 7h às 11h; fora disso a rota não faz nada). A vigia da SARA central (J3) vem antes
 * do Bom dia: roda uma vez por dia, a partir das 6h30, e os achados entregues já entram no Bom dia.
 *
 * Roda como tarefa agendada do Coolify, DENTRO do contêiner do Business OS, a
 * cada 10 minutos: chama as rotas locais /api/producao/sync-os, /api/sara/guias/rodar, /api/sara/vigia/rodar e
 * /api/sara/bom-dia/rodar
 * com o segredo FORJA_SYNC_SECRET (variável do Coolify). Uma falha não impede a
 * outra; sai com erro se alguma falhar, para a falha aparecer no histórico da tarefa.
 */
const port = process.env.PORT || 3000;
const secret = process.env.FORJA_SYNC_SECRET;
if (!secret) {
  console.error("FORJA_SYNC_SECRET ausente.");
  process.exit(1);
}
let falhou = false;
for (const rota of ["/api/producao/sync-os", "/api/sara/guias/rodar", "/api/sara/vigia/rodar", "/api/sara/bom-dia/rodar"]) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${rota}`, {
      method: "POST",
      headers: { "x-sync-secret": secret },
    });
    const text = await response.text();
    console.log(new Date().toISOString(), rota, response.status, text.slice(0, 500));
    if (!response.ok) falhou = true;
  } catch (error) {
    console.error(new Date().toISOString(), rota, "falha:", error instanceof Error ? error.message : error);
    falhou = true;
  }
}
if (falhou) process.exit(1);
