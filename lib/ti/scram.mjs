/**
 * Verificador SCRAM-SHA-256 de uma senha, no formato que o Postgres aceita em
 * `ALTER ROLE … PASSWORD 'SCRAM-SHA-256$…'`. Assim a senha em si nunca vai ao
 * banco: só o verificador, que não permite recuperá-la (RFC 5802 / 7677).
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

export function verificadorScram(senha, { sal = randomBytes(16), iteracoes = 4096 } = {}) {
  const salgada = pbkdf2Sync(Buffer.from(senha.normalize("NFKC"), "utf8"), sal, iteracoes, 32, "sha256");
  const chaveCliente = createHmac("sha256", salgada).update("Client Key").digest();
  const guardada = createHash("sha256").update(chaveCliente).digest();
  const chaveServidor = createHmac("sha256", salgada).update("Server Key").digest();
  return `SCRAM-SHA-256$${iteracoes}:${sal.toString("base64")}$${guardada.toString("base64")}:${chaveServidor.toString("base64")}`;
}

/** Senha forte só com letras e números (cabe em URL de conexão sem escapar). */
export const senhaAleatoria = (bytes = 24) => randomBytes(bytes).toString("base64url").replace(/[-_]/g, "x");
