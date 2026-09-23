/**
 * O Node roda TypeScript direto, mas não completa a extensão que falta: o
 * código do app escreve `import "./planned"` porque quem resolve isso é o
 * empacotador do Next. Este gancho faz o mesmo no `node --test`, para os testes
 * poderem importar módulos que têm dependências relativas (registry, access).
 *
 * Importe ESTE arquivo primeiro e traga o resto com `await import(...)`: a
 * resolução dos imports estáticos acontece antes de qualquer execução.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const EXTENSOES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      for (const extensao of EXTENSOES) {
        const candidato = new URL(specifier + extensao, context.parentURL);
        if (existsSync(fileURLToPath(candidato))) return { url: candidato.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
