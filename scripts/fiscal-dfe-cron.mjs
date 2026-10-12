#!/usr/bin/env node
/**
 * Busca na SEFAZ as notas emitidas contra o CNPJ da empresa (Fiscal › Notas recebidas).
 *
 * Roda como tarefa agendada do Coolify, DENTRO do contêiner do Business OS, a cada 15 minutos:
 * chama a rota local /api/fiscal/dfe/processar com o segredo FISCAL_DFE_SECRET (variável do
 * Coolify). A própria rota respeita a hora de espera da SEFAZ por organização; rodar mais vezes
 * não consulta mais. Sai com erro se a rodada falhar, para a falha aparecer no histórico.
 */
const port = process.env.PORT || 3000;
const secret = process.env.FISCAL_DFE_SECRET;
if (!secret) {
  console.error("FISCAL_DFE_SECRET ausente.");
  process.exit(1);
}
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/fiscal/dfe/processar`, {
    method: "POST",
    headers: { "x-fiscal-secret": secret },
  });
  const text = await response.text();
  console.log(new Date().toISOString(), response.status, text.slice(0, 500));
  if (!response.ok) process.exit(1);
} catch (error) {
  console.error(new Date().toISOString(), "falha:", error instanceof Error ? error.message : error);
  process.exit(1);
}
