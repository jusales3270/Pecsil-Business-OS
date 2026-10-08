import type { NextConfig } from "next";

// Versão da build: muda a cada deploy. Vai embutida no navegador e no
// servidor; quando as duas diferem, o app aberto é de uma versão anterior e
// mostra o aviso "Nova versão disponível" (app/components/update-notice.tsx).
// Não é segredo: é só um identificador da build.
const buildVersion = process.env.SOURCE_COMMIT?.slice(0, 12) || new Date().toISOString();

const nextConfig: NextConfig = {
  // O pdfjs roda no servidor (leitura de extrato e relatório em PDF) e não deve ser empacotado.
  serverExternalPackages: ["pdfjs-dist"],
  env: {
    NEXT_PUBLIC_APP_VERSION: buildVersion,
  },
};

export default nextConfig;
