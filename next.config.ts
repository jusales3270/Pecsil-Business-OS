import type { NextConfig } from "next";

// Versão da build: muda a cada deploy. Vai embutida no navegador e no
// servidor; quando as duas diferem, o app aberto é de uma versão anterior e
// mostra o aviso "Nova versão disponível" (app/components/update-notice.tsx).
// Não é segredo: é só um identificador da build.
const buildVersion = process.env.SOURCE_COMMIT?.slice(0, 12) || new Date().toISOString();

const nextConfig: NextConfig = {
  // O pdfjs roda no servidor (leitura de extrato e relatório em PDF) e não deve ser empacotado.
  // O tesseract.js (OCR local, Etapa 3) sobe um worker próprio a partir do node_modules.
  // O modelo de significado (Etapa 5B) usa o motor ONNX nativo, que também não deve ser empacotado.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js", "@huggingface/transformers", "onnxruntime-node"],
  experimental: {
    // Com o proxy.ts, o Next guarda só 10 MB do corpo de cada pedido e corta o resto: o STEP de montagem do
    // orçamento (C-19, até 50 MB) chegava pela metade e o anexo era recusado sem gravar nada (06/11/2026).
    proxyClientMaxBodySize: "60mb",
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: buildVersion,
  },
};

export default nextConfig;
