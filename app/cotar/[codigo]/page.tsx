import type { Metadata } from "next";
import { CotarFornecedor } from "../../components/cotar-fornecedor";

export const metadata: Metadata = { title: "Responder cotação", robots: { index: false, follow: false } };

/** Portal do fornecedor por link (A-09): página pública, sem login. */
export default async function CotarPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  return <CotarFornecedor codigo={codigo} />;
}
