import type { Metadata } from "next";
import { RastreioCliente } from "../../components/rastreio-cliente";

export const metadata: Metadata = { title: "Rastreio da entrega", robots: { index: false, follow: false } };

/** Link de rastreio do cliente (docs/PLANO-LOGISTICA.md §3): página pública, sem login. */
export default async function RastreioPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  return <RastreioCliente codigo={codigo} />;
}
