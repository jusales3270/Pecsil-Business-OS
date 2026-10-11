#!/usr/bin/env node
/**
 * Lê os documentos guardados (Segundo Cérebro, Etapa 3): texto dos que ainda não foram lidos e
 * OCR local dos escaneados e fotos.
 *
 * Roda como tarefa agendada do Coolify, DENTRO do contêiner do Business OS, a cada 5 minutos:
 * chama a rota local /api/documentos/leitura/processar com o segredo DOCUMENTOS_LEITURA_SECRET
 * (variável do Coolify). Sai com erro se a rodada falhar, para a falha aparecer no histórico.
 */
const port = process.env.PORT || 3000;
const secret = process.env.DOCUMENTOS_LEITURA_SECRET;
if (!secret) {
  console.error("DOCUMENTOS_LEITURA_SECRET ausente.");
  process.exit(1);
}
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/documentos/leitura/processar`, {
    method: "POST",
    headers: { "x-leitura-secret": secret },
  });
  const text = await response.text();
  console.log(new Date().toISOString(), response.status, text.slice(0, 500));
  if (!response.ok) process.exit(1);
} catch (error) {
  console.error(new Date().toISOString(), "falha:", error instanceof Error ? error.message : error);
  process.exit(1);
}
