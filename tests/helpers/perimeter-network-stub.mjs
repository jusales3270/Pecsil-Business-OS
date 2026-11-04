/** Pré-carregado só pelos testes: substitui TODAS as chamadas de rede do auditor. */
import { isIP } from "node:net";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";

const scenario = process.env.PERIMETER_TEST_CASE;
const sockets = [];
globalThis.__perimeterTestIsIP = isIP;
globalThis.__perimeterTestSocket = (options, callback) => {
  const socket = new EventEmitter();
  socket.destroy = () => {};
  socket.authorized = scenario !== "invalid-tls";
  socket.getPeerCertificate = () => ({ subject: { CN: "perimeter.example.test" }, issuer: { O: "Test CA" }, valid_to: "Jan 01 00:00:00 2099 GMT" });
  sockets.push({ address: options.host, port: options.port, tls: !!callback, servername: options.servername });
  queueMicrotask(() => {
    if (callback) {
      if (options.servername !== "perimeter.example.test") throw new Error("Identidade TLS não usa HOST.");
      if (scenario === "tls-stall") return; // Nenhum evento: só o prazo absoluto termina a checagem.
      if (scenario === "tls-close") socket.emit("close"); else callback();
    } else if (scenario === "local-error") socket.emit("error", { code: "ENETUNREACH" });
    else if (options.port === 443 || scenario === "exposed" && options.port === 8001) socket.emit("connect");
    else if (scenario === "filtered") socket.emit("timeout");
    else socket.emit("error", { code: "ECONNREFUSED" });
  });
  return socket;
};
globalThis.__perimeterTestLookup = async () => {
  if (scenario === "dns-fails") throw new Error("DNS simulado indisponível");
  if (scenario === "empty") return [];
  if (scenario === "v4-only") return [{ address: "198.51.100.1" }];
  if (scenario === "v6-only") return [{ address: "2001:db8::1" }];
  return [{ address: "198.51.100.1" }, { address: "2001:db8::1" }];
};
const modulo = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:net") return { url: modulo("export const isIP=globalThis.__perimeterTestIsIP; export const connect=globalThis.__perimeterTestSocket;"), shortCircuit: true };
    if (specifier === "node:tls") return { url: modulo("export const connect=globalThis.__perimeterTestSocket;"), shortCircuit: true };
    if (specifier === "node:dns/promises") return { url: modulo("export const lookup=globalThis.__perimeterTestLookup;"), shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
process.on("exit", () => { console.log("PERIMETER_MOCK " + JSON.stringify(sockets)); });
