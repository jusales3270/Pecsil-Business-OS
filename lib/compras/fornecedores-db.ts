/** Colunas e formato do cadastro de fornecedores, compartilhados pelas rotas do Compras. */

export const SUPPLIER_COLUMNS =
  "id, name, tax_id, active, merged_into, legal_name, trade_name, state_registration, contact_name, phone, email, address, city, state, postal_code, payment_terms, divisions, category, notes";

export type SupplierRow = {
  id: string;
  name: string;
  tax_id: string | null;
  active: boolean;
  merged_into: string | null;
  legal_name: string | null;
  trade_name: string | null;
  state_registration: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  payment_terms: string | null;
  divisions: string[] | null;
  category: string | null;
  notes: string | null;
};

export type SummaryRow = {
  supplier_id: string;
  cotacoes: number;
  aprovadas: number;
  rejeitadas: number;
  compradas: number;
  pendentes: number;
  compras: number;
  total_comprado: number;
  primeira_compra: string | null;
  ultima_compra: string | null;
  ultima_cotacao: string | null;
  divisoes: string[] | null;
};

/** Cadastro → formato da tela (camelCase). */
export function toSupplier(row: SupplierRow, aliases: string[] = []) {
  return {
    id: row.id,
    name: row.name,
    taxId: row.tax_id,
    active: row.active,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    stateRegistration: row.state_registration,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    paymentTerms: row.payment_terms,
    divisions: row.divisions ?? [],
    category: row.category,
    notes: row.notes,
    aliases,
  };
}
