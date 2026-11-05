import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const state = { document: null, storageError: null, calls: [] };
globalThis.__rhStorageSecurity = state;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/lib/data/rh-documents-client.ts") && specifier === "../supabase/client") {
      const source = `export function createSupabaseBrowserClient() {
        const s=globalThis.__rhStorageSecurity;
        return {
          from() { return {
            select() { const q={eq(){return q},async maybeSingle(){s.calls.push('read');return {data:s.document,error:null}}}; return q },
            delete() { s.calls.push('delete-record'); return {eq(){return {async select(){return {data:[{id:'doc'}],error:null}}}}} }
          } },
          storage: {from(){return {async remove(paths){s.calls.push('delete-file');s.paths=paths;return {error:s.storageError}}}}}
        }
      }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { deleteRhDocument } = await import("../lib/data/rh-documents-client.ts");
const path = "org/documento/arquivo.pdf";
function reset() {
  Object.assign(state, { document: { id: "doc", object_path: path, storage_bucket: "rh-documents" }, storageError: null, calls: [], paths: null });
}
test("RH: arquivo só é removido após conferir o documento e antes dos metadados", async () => {
  reset(); await deleteRhDocument("doc", path);
  assert.deepEqual(state.calls, ["read", "delete-file", "delete-record"]);
  assert.deepEqual(state.paths, [path]);
});
test("RH: recusa de Storage preserva o registro e é devolvida à pessoa", async () => {
  reset(); state.storageError = new Error("Acesso recusado");
  await assert.rejects(deleteRhDocument("doc", path), /Acesso recusado/);
  assert.deepEqual(state.calls, ["read", "delete-file"]);
});
test("RH: caminho substituído ou documento invisível não remove arquivo nem metadados", async () => {
  reset(); await assert.rejects(deleteRhDocument("doc", "outro/arquivo.pdf"), /RH_MUTATION_DENIED/);
  assert.deepEqual(state.calls, ["read"]);
  reset(); state.document = null;
  await assert.rejects(deleteRhDocument("doc", path), /RH_MUTATION_DENIED/);
  assert.deepEqual(state.calls, ["read"]);
});
