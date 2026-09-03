import { create } from 'zustand';
import type { User, UserRole, Cotacao, Compra, Notificacao, Page, TipoNotificacao, Divisao } from '@/types';
import { supabase } from '@/lib/supabase';

// Seed users
const seedUsers: User[] = [
  { id: 1, name: 'Orçamentista', email: 'orcamento@empresa.com', role: 'ORCAMENTISTA' },
  { id: 2, name: 'Ricardo', email: 'ricardo@empresa.com', role: 'GESTOR' },
];

const seedCotacoes: Cotacao[] = [];
const seedCompras: Compra[] = [];
const seedNotificacoes: Notificacao[] = [];

// Load from localStorage or use seed
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return fallback;
}

interface AppState {
  // Auth
  user: User | null;
  login: (role: UserRole, gestorName?: string) => void;
  logout: () => void;

  // Page
  currentPage: Page;
  setPage: (page: Page) => void;

  // Divisão
  currentDivisao: Divisao;
  setDivisao: (divisao: Divisao) => void;

  // Data
  cotacoes: Cotacao[];
  compras: Compra[];
  notificacoes: Notificacao[];
  activeCotacaoIdForModal: number | null;
  setActiveCotacaoIdForModal: (id: number | null) => void;
  dashboardAction: { type: 'VIEW' | 'EDIT' | 'DELETE'; cotacaoId: number } | null;
  setDashboardAction: (action: { type: 'VIEW' | 'EDIT' | 'DELETE'; cotacaoId: number } | null) => void;

  // Sync
  fetchInitialData: () => Promise<void>;

  // Cotacao CRUD
  addCotacao: (data: Omit<Cotacao, 'id' | 'createdAt' | 'updatedAt' | 'aprovadoPor' | 'motivoRejeicao' | 'dataDecisao' | 'deletedAt' | 'status'>) => Promise<Cotacao>;
  updateCotacao: (id: number, data: Partial<Cotacao>) => Promise<void>;
  deleteCotacao: (id: number) => Promise<void>;
  approveCotacao: (id: number) => Promise<void>;
  rejectCotacao: (id: number, motivo: string) => Promise<void>;
  revertCotacaoParaPendente: (id: number) => Promise<void>;
  revertProdutoParaPendente: (cotacaoId: number, produtoId: string) => Promise<void>;
  decidirProduto: (cotacaoId: number, produtoId: string, status: 'APROVADO' | 'REJEITADO', motivo?: string) => Promise<void>;
  comprarCotacao: (cotacaoId: number, compraData: Omit<Compra, 'id' | 'cotacaoId' | 'createdAt'>) => Promise<void>;

  // Notifications
  markNotificacaoLida: (id: number) => Promise<void>;
  markAllLidas: () => Promise<void>;
  addNotificacao: (n: Omit<Notificacao, 'id' | 'createdAt'>) => Promise<void>;

  // Computed helpers
  getCotacoesByUser: (userId: number, divisao?: Divisao) => Cotacao[];
  getCotacoesPendentes: (divisao?: Divisao) => Cotacao[];
  getStatsOrcamentista: (userId: number, divisao?: Divisao) => { total: number; pendentes: number; aprovados: number; comprados: number; totalAprovadoAguardando: number };
  getStatsGestor: () => { totalPendente: number; qtdPendentes: number; aprovadosMes: number; rejeitadosMes: number; totalComprado: number };
}

export const useStore = create<AppState>((set, get) => ({
  user: (() => {
    const u = loadFromStorage<User | null>('somacompras_user', null);
    if (u && u.role === 'GESTOR' && u.name === 'Gestor') {
      u.name = 'Ricardo';
      u.email = 'ricardo@empresa.com';
      try {
        localStorage.setItem('somacompras_user', JSON.stringify(u));
      } catch { /* ignore */ }
    }
    return u;
  })(),
  currentPage: loadFromStorage('somacompras_page', 'login'),
  currentDivisao: loadFromStorage<Divisao>('somacompras_divisao', 'USINAGEM'),
  cotacoes: loadFromStorage('somacompras_cotacoes', seedCotacoes),
  compras: loadFromStorage('somacompras_compras', seedCompras),
  notificacoes: loadFromStorage('somacompras_notificacoes', seedNotificacoes),
  activeCotacaoIdForModal: null,
  setActiveCotacaoIdForModal: (id) => set({ activeCotacaoIdForModal: id }),
  dashboardAction: null,
  setDashboardAction: (action) => set({ dashboardAction: action }),

  login: (role: UserRole, gestorName?: string) => {
    let user;
    if (role === 'ORCAMENTISTA') {
      user = seedUsers[0];
    } else {
      if (gestorName === 'Domingo Duque') {
        user = { id: 3, name: 'Domingo Duque', email: 'domingo@empresa.com', role: 'GESTOR' as const };
      } else {
        user = seedUsers[1]; // Ricardo
      }
    }
    set({ user, currentPage: 'dashboard' });
    localStorage.setItem('somacompras_user', JSON.stringify(user));
    localStorage.setItem('somacompras_page', 'dashboard');
    get().fetchInitialData(); // Trigger fetch immediately on login
  },

  logout: () => {
    set({ user: null, currentPage: 'login' });
    localStorage.removeItem('somacompras_user');
    localStorage.removeItem('somacompras_page');
  },

  setPage: (page: Page) => {
    set({ currentPage: page });
    localStorage.setItem('somacompras_page', page);
  },

  setDivisao: (divisao: Divisao) => {
    set({ currentDivisao: divisao });
    localStorage.setItem('somacompras_divisao', JSON.stringify(divisao));
  },

  fetchInitialData: async () => {
    try {
      // 1. Fetch cotacoes
      const { data: cotacoesData, error: cotError } = await supabase
        .from('cotacoes')
        .select('*');

      if (cotError) throw cotError;

      // 2. Fetch cotacao_produtos
      const { data: produtosData, error: prodError } = await supabase
        .from('cotacao_produtos')
        .select('*');

      if (prodError) throw prodError;

      // 3. Fetch compras
      const { data: comprasData, error: compError } = await supabase
        .from('compras')
        .select('*');

      if (compError) throw compError;

      // 4. Fetch notificacoes
      const { data: notificacoesData, error: notError } = await supabase
        .from('notificacoes')
        .select('*');

      if (notError) throw notError;

      // Map database data to frontend format
      const cotacoes: Cotacao[] = (cotacoesData || []).map(c => {
        const subProds = (produtosData || []).filter(p => p.cotacao_id === c.id);
        return {
          id: Number(c.id),
          fornecedor: c.fornecedor,
          divisao: c.divisao || 'USINAGEM',
          status: c.status,
          userId: isNaN(Number(c.user_id)) ? 1 : Number(c.user_id),
          aprovadoPor: c.aprovado_por,
          motivoRejeicao: c.motivo_rejeicao,
          dataDecisao: c.data_decisao,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          deletedAt: c.deleted_at,
          produtos: subProds.map(p => ({
            id: String(p.id),
            produto: p.produto,
            valorUnit: Number(p.valor_unit),
            quantidade: Number(p.quantidade),
            unidade: p.unidade,
            icms: Number(p.icms),
            ipi: Number(p.ipi),
            prazo: p.prazo,
            obs: p.obs,
            status: p.status,
            motivoRejeicao: p.motivo_rejeicao,
          })),
          produto: c.produto || undefined,
          valorUnit: c.valor_unit ? Number(c.valor_unit) : undefined,
          quantidade: c.quantidade ? Number(c.quantidade) : undefined,
          unidade: c.unidade || undefined,
          icms: c.icms ? Number(c.icms) : undefined,
          ipi: c.ipi ? Number(c.ipi) : undefined,
          prazo: c.prazo || undefined,
          obs: c.obs || undefined,
        };
      });

      const compras: Compra[] = (comprasData || []).map(c => ({
        id: Number(c.id),
        cotacaoId: Number(c.cotacao_id),
        fornecedor: c.fornecedor,
        produto: c.produto,
        quantidade: Number(c.quantidade),
        unidade: c.unidade,
        valorUnit: Number(c.valor_unit),
        total: Number(c.total),
        nf: c.nf,
        dataCompra: c.data_compra,
        obs: c.obs,
        createdAt: c.created_at,
      }));

      const notificacoes: Notificacao[] = (notificacoesData || []).map(n => ({
        id: Number(n.id),
        userId: isNaN(Number(n.user_id)) ? 1 : Number(n.user_id),
        cotacaoId: n.cotacao_id ? Number(n.cotacao_id) : null,
        tipo: n.tipo as TipoNotificacao,
        mensagem: n.mensagem,
        lida: n.lida,
        createdAt: n.created_at,
      }));

      set({ cotacoes, compras, notificacoes });

      // Sync local storage as fallback
      localStorage.setItem('somacompras_cotacoes', JSON.stringify(cotacoes));
      localStorage.setItem('somacompras_compras', JSON.stringify(compras));
      localStorage.setItem('somacompras_notificacoes', JSON.stringify(notificacoes));
    } catch (err) {
      console.error('Error fetching initial data from Supabase:', err);
    }
  },

  addCotacao: async (data) => {
    let cotacaoId: number | null = null;
    try {
      // 1. Insert header
      const { data: headerData, error: headerErr } = await supabase
        .from('cotacoes')
        .insert({
          fornecedor: data.fornecedor,
          status: 'PENDENTE',
          user_id: String(data.userId || '1'),
          divisao: data.divisao,
          produto: data.produto,
          valor_unit: data.valorUnit,
          quantidade: data.quantidade,
          unidade: data.unidade,
          icms: data.icms,
          ipi: data.ipi,
          prazo: data.prazo,
          obs: data.obs,
        })
        .select()
        .single();

      if (headerErr) {
        console.error('Error inserting cotacao header:', headerErr);
      } else if (headerData?.id) {
        cotacaoId = Number(headerData.id);

        // 2. Insert products
        const productsToInsert = (data.produtos || []).map(p => ({
          cotacao_id: cotacaoId,
          produto: p.produto,
          valor_unit: p.valorUnit,
          quantidade: p.quantidade,
          unidade: p.unidade,
          icms: p.icms,
          ipi: p.ipi,
          prazo: p.prazo,
          obs: p.obs,
          status: 'PENDENTE',
        }));

        if (productsToInsert.length > 0) {
          const { error: prodErr } = await supabase
            .from('cotacao_produtos')
            .insert(productsToInsert);

          if (prodErr) {
            console.error('Error inserting products:', prodErr);
          }
        }

        // 3. Create notification in Supabase
        try {
          await supabase.from('notificacoes').insert({
            user_id: '2', // Gestor profile ID
            cotacao_id: cotacaoId,
            tipo: 'NOVA_COTACAO_PENDENTE',
            mensagem: `Nova cotação #${cotacaoId} de ${data.fornecedor} aguardando aprovação`,
            lida: false,
          });
        } catch { /* ignore */ }

        // Sync all data
        await get().fetchInitialData();
      }
    } catch (err) {
      console.error('Falha ao conectar com o banco de dados:', err);
    }

    // Se já foi sincronizado e achou no store:
    if (cotacaoId) {
      const found = get().cotacoes.find(c => c.id === cotacaoId);
      if (found) return found;
    }

    // Fallback: garante a inclusão imediata no estado local
    const fallbackId = cotacaoId || Date.now();
    const fallbackCotacao: Cotacao = {
      id: fallbackId,
      fornecedor: data.fornecedor,
      divisao: data.divisao,
      status: 'PENDENTE',
      userId: Number(data.userId) || 1,
      aprovadoPor: null,
      motivoRejeicao: null,
      dataDecisao: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      produto: data.produto,
      valorUnit: data.valorUnit,
      quantidade: data.quantidade,
      unidade: data.unidade,
      icms: data.icms,
      ipi: data.ipi,
      prazo: data.prazo,
      obs: data.obs,
      produtos: (data.produtos || []).map((p, idx) => ({
        ...p,
        id: p.id || String(fallbackId + idx + 1),
        status: 'PENDENTE',
      })),
    };

    set(state => {
      const exists = state.cotacoes.some(c => c.id === fallbackId);
      if (exists) return state;
      const cotacoes = [fallbackCotacao, ...state.cotacoes];
      try {
        localStorage.setItem('somacompras_cotacoes', JSON.stringify(cotacoes));
      } catch { /* ignore */ }
      return { cotacoes };
    });

    return fallbackCotacao;
  },

  updateCotacao: async (id, data) => {
    // 1. Update header in Supabase
    const { error: headerErr } = await supabase
      .from('cotacoes')
      .update({
        fornecedor: data.fornecedor,
        status: data.status,
        aprovado_por: data.aprovadoPor,
        motivo_rejeicao: data.motivoRejeicao,
        data_decisao: data.dataDecisao,
        divisao: data.divisao,
        produto: data.produto,
        valor_unit: data.valorUnit,
        quantidade: data.quantidade,
        unidade: data.unidade,
        icms: data.icms,
        ipi: data.ipi,
        prazo: data.prazo,
        obs: data.obs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (headerErr) {
      console.error('Error updating cotacao header:', headerErr);
    }

    // 2. Update products in Supabase (if products are provided)
    if (data.produtos) {
      // Separate approved products (to preserve) from others (to replace)
      const approvedProducts = data.produtos.filter(p => p.status === 'APROVADO');
      const otherProducts = data.produtos.filter(p => p.status !== 'APROVADO');

      // Get IDs of approved products to preserve
      const approvedIds = approvedProducts
        .map(p => Number(p.id))
        .filter(id => !isNaN(id) && id > 0);

      // Delete only non-approved products for this cotacao
      // (preserving approved ones in the database)
      if (approvedIds.length > 0) {
        // Delete all products that are NOT in the approved list
        const { data: existingProducts } = await supabase
          .from('cotacao_produtos')
          .select('id')
          .eq('cotacao_id', id);

        if (existingProducts) {
          const idsToDelete = existingProducts
            .map(p => p.id)
            .filter(pid => !approvedIds.includes(pid));

          if (idsToDelete.length > 0) {
            await supabase
              .from('cotacao_produtos')
              .delete()
              .in('id', idsToDelete);
          }
        }
      } else {
        // No approved products to preserve — safe to delete all
        await supabase.from('cotacao_produtos').delete().eq('cotacao_id', id);
      }

      // Insert the non-approved (new/edited) products
      const productsToInsert = otherProducts.map(p => ({
        cotacao_id: id,
        produto: p.produto,
        valor_unit: p.valorUnit,
        quantidade: p.quantidade,
        unidade: p.unidade,
        icms: p.icms,
        ipi: p.ipi,
        prazo: p.prazo,
        obs: p.obs,
        status: p.status || 'PENDENTE',
        motivo_rejeicao: p.motivoRejeicao || null,
      }));

      if (productsToInsert.length > 0) {
        await supabase.from('cotacao_produtos').insert(productsToInsert);
      }
    }

    // Reload all data
    await get().fetchInitialData();
  },

  deleteCotacao: async (id) => {
    const { error } = await supabase
      .from('cotacoes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Error soft-deleting cotacao:', error);
    }
    await get().fetchInitialData();
  },

  approveCotacao: async (id) => {
    const state = get();
    const user = state.user;
    if (!user) return;
    const cotacao = state.cotacoes.find(c => c.id === id);
    if (!cotacao) return;

    const dataDecisao = new Date().toISOString();

    // 1. Update header status
    await supabase
      .from('cotacoes')
      .update({
        status: 'APROVADO',
        aprovado_por: user.name,
        data_decisao: dataDecisao,
        updated_at: dataDecisao,
      })
      .eq('id', id);

    // 2. Update all products status to APROVADO
    await supabase
      .from('cotacao_produtos')
      .update({ status: 'APROVADO' })
      .eq('cotacao_id', id);

    // 3. Create notification
    await supabase.from('notificacoes').insert({
      user_id: String(cotacao.userId),
      cotacao_id: id,
      tipo: 'COTACAO_APROVADA',
      mensagem: `Sua cotação #${id} foi APROVADA pelo ${user.name}`,
      lida: false,
    });

    await get().fetchInitialData();
  },

  rejectCotacao: async (id, motivo) => {
    const state = get();
    const user = state.user;
    if (!user) return;
    const cotacao = state.cotacoes.find(c => c.id === id);
    if (!cotacao) return;

    const dataDecisao = new Date().toISOString();

    // 1. Update header status
    await supabase
      .from('cotacoes')
      .update({
        status: 'REJEITADO',
        aprovado_por: user.name,
        motivo_rejeicao: motivo,
        data_decisao: dataDecisao,
        updated_at: dataDecisao,
      })
      .eq('id', id);

    // 2. Update all products status to REJEITADO
    await supabase
      .from('cotacao_produtos')
      .update({ status: 'REJEITADO', motivo_rejeicao: motivo })
      .eq('cotacao_id', id);

    // 3. Create notification
    await supabase.from('notificacoes').insert({
      user_id: String(cotacao.userId),
      cotacao_id: id,
      tipo: 'COTACAO_REJEITADA',
      mensagem: `Sua cotação #${id} foi REJEITADA. Motivo: ${motivo}`,
      lida: false,
    });

    await get().fetchInitialData();
  },

  revertCotacaoParaPendente: async (id) => {
    const state = get();
    const user = state.user;
    if (!user) return;
    const cotacao = state.cotacoes.find(c => c.id === id);
    if (!cotacao) return;

    // 1. Update header status to PENDENTE
    await supabase
      .from('cotacoes')
      .update({
        status: 'PENDENTE',
        aprovado_por: null,
        motivo_rejeicao: null,
        data_decisao: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // 2. Update all products status to PENDENTE
    await supabase
      .from('cotacao_produtos')
      .update({ status: 'PENDENTE', motivo_rejeicao: null })
      .eq('cotacao_id', id);

    await get().fetchInitialData();
  },

  revertProdutoParaPendente: async (cotacaoId, produtoId) => {
    const state = get();
    const user = state.user;
    if (!user) return;
    const cotacao = state.cotacoes.find(c => c.id === cotacaoId);
    if (!cotacao) return;

    // 1. Update product status to PENDENTE
    await supabase
      .from('cotacao_produtos')
      .update({ status: 'PENDENTE', motivo_rejeicao: null })
      .eq('id', Number(produtoId));

    // 2. Update quotation status to PENDENTE
    await supabase
      .from('cotacoes')
      .update({
        status: 'PENDENTE',
        aprovado_por: null,
        motivo_rejeicao: null,
        data_decisao: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cotacaoId);

    await get().fetchInitialData();
  },

  decidirProduto: async (cotacaoId, produtoId, status, motivo) => {
    const state = get();
    const user = state.user;
    if (!user) return;
    const cotacao = state.cotacoes.find(c => c.id === cotacaoId);
    if (!cotacao) return;

    // 1. Update the product status
    const { error: prodErr } = await supabase
      .from('cotacao_produtos')
      .update({ status, motivo_rejeicao: motivo || null })
      .eq('id', Number(produtoId));

    if (prodErr) {
      console.error('Error updating product status in Supabase:', prodErr);
    }

    // 2. Query products to check overall decision status
    const { data: productsData } = await supabase
      .from('cotacao_produtos')
      .select('*')
      .eq('cotacao_id', cotacaoId);

    const updatedProdutos = productsData || [];
    const hasApproved = updatedProdutos.some(p => p.status === 'APROVADO');
    const hasPending = updatedProdutos.some(p => p.status === 'PENDENTE');

    if (!hasPending) {
      // All items decided
      const newStatus = hasApproved ? 'APROVADO' : 'REJEITADO';
      const dataDecisao = new Date().toISOString();

      await supabase
        .from('cotacoes')
        .update({
          status: newStatus,
          aprovado_por: user.name,
          data_decisao: dataDecisao,
          updated_at: dataDecisao,
        })
        .eq('id', cotacaoId);

      // Create notification
      await supabase.from('notificacoes').insert({
        user_id: String(cotacao.userId),
        cotacao_id: cotacaoId,
        tipo: newStatus === 'APROVADO' ? 'COTACAO_APROVADA' : 'COTACAO_REJEITADA',
        mensagem: `Sua cotação #${cotacaoId} foi decidida pelo ${user.name} (Status: ${newStatus})`,
        lida: false,
      });
    } else {
      // Still has pending items: quotation status must remain PENDENTE
      await supabase
        .from('cotacoes')
        .update({
          status: 'PENDENTE',
          updated_at: new Date().toISOString(),
        })
        .eq('id', cotacaoId);
    }

    await get().fetchInitialData();
  },

  comprarCotacao: async (cotacaoId, compraData) => {
    // 1. Insert purchase record
    const { error: compErr } = await supabase
      .from('compras')
      .insert({
        cotacao_id: cotacaoId,
        fornecedor: compraData.fornecedor,
        produto: compraData.produto,
        quantidade: compraData.quantidade,
        unidade: compraData.unidade,
        valor_unit: compraData.valorUnit,
        total: compraData.total,
        nf: compraData.nf,
        data_compra: compraData.dataCompra.split('T')[0], // format: YYYY-MM-DD
        obs: compraData.obs,
      });

    if (compErr) {
      console.error('Error inserting purchase record in Supabase:', compErr);
    }

    // 2. Fetch data to check complete purchase status
    const { data: cotacaoData } = await supabase
      .from('cotacoes')
      .select('*')
      .eq('id', cotacaoId)
      .single();

    const { data: productsData } = await supabase
      .from('cotacao_produtos')
      .select('*')
      .eq('cotacao_id', cotacaoId);

    const { data: allCompras } = await supabase
      .from('compras')
      .select('*')
      .eq('cotacao_id', cotacaoId);

    // Check if ALL products have been decided (no pending) and all approved ones are fully purchased
    const allProducts = productsData && productsData.length > 0 ? productsData : [];
    const approvedProducts = allProducts.filter(p => p.status === 'APROVADO');
    const hasPendingProducts = allProducts.some(p => !p.status || p.status === 'PENDENTE');

    let allApprovedFullyPurchased = false;

    if (approvedProducts.length > 0) {
      // For each approved product, check if the total purchased quantity
      // for that specific product meets or exceeds the approved quantity
      allApprovedFullyPurchased = approvedProducts.every(prod => {
        const purchasesForProduct = (allCompras || []).filter(
          c => c.produto === prod.produto
        );
        const totalCompradoProduto = purchasesForProduct.reduce(
          (sum, c) => sum + Number(c.quantidade), 0
        );
        return totalCompradoProduto >= Number(prod.quantidade);
      });
    } else if (allProducts.length === 0) {
      // Legacy: single-product cotacao (no cotacao_produtos rows)
      const totalComprado = (allCompras || []).reduce((sum, c) => sum + Number(c.quantidade), 0);
      allApprovedFullyPurchased = totalComprado >= (cotacaoData?.quantidade || 0);
    }

    // Only mark as COMPRADO if there are no pending products and all approved are purchased
    if (allApprovedFullyPurchased && !hasPendingProducts) {
      await supabase
        .from('cotacoes')
        .update({ status: 'COMPRADO', updated_at: new Date().toISOString() })
        .eq('id', cotacaoId);
    }

    // 3. Create notification
    if (cotacaoData) {
      await supabase.from('notificacoes').insert({
        user_id: String(cotacaoData.user_id),
        cotacao_id: cotacaoId,
        tipo: 'COTACAO_COMPRADA',
        mensagem: `Cotação #${cotacaoId} foi COMPRADA. Total: R$ ${compraData.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        lida: false,
      });
    }

    await get().fetchInitialData();
  },

  markNotificacaoLida: async (id) => {
    await supabase
      .from('notificacoes')
      .update({ lida: true })
      .eq('id', id);
    await get().fetchInitialData();
  },

  markAllLidas: async () => {
    const state = get();
    const userId = state.user?.id;
    if (!userId) return;

    await supabase
      .from('notificacoes')
      .update({ lida: true })
      .eq('user_id', String(userId));
    await get().fetchInitialData();
  },

  addNotificacao: async (n) => {
    await supabase.from('notificacoes').insert({
      user_id: String(n.userId),
      cotacao_id: n.cotacaoId,
      tipo: n.tipo,
      mensagem: n.mensagem,
      lida: n.lida,
    });
    await get().fetchInitialData();
  },

  getCotacoesByUser: (userId, divisao) => {
    return get().cotacoes.filter(c => {
      if (c.userId !== userId || c.deletedAt !== null) return false;
      if (divisao && c.divisao !== divisao) return false;
      return true;
    });
  },

  getCotacoesPendentes: (divisao) => {
    return get().cotacoes.filter(c => {
      if (c.status !== 'PENDENTE' || c.deletedAt !== null) return false;
      if (divisao && c.divisao !== divisao) return false;
      return true;
    });
  },

  getStatsOrcamentista: (userId, divisao) => {
    const cotacoes = get().cotacoes.filter(c => {
      if (c.userId !== userId || c.deletedAt !== null) return false;
      if (divisao && c.divisao !== divisao) return false;
      return true;
    });
    const pendentes = cotacoes.filter(c => c.status === 'PENDENTE');
    const aprovados = cotacoes.filter(c => c.status === 'APROVADO');
    const comprados = cotacoes.filter(c => c.status === 'COMPRADO');
    const totalAprovadoAguardando = aprovados.reduce((sum, c) => sum + calcularTotal(c), 0);
    return {
      total: cotacoes.length,
      pendentes: pendentes.length,
      aprovados: aprovados.length,
      comprados: comprados.length,
      totalAprovadoAguardando,
    };
  },

  getStatsGestor: () => {
    const cotacoes = get().cotacoes.filter(c => c.deletedAt === null);
    const pendentes = cotacoes.filter(c => c.status === 'PENDENTE');
    const totalPendente = pendentes.reduce((sum, c) => sum + calcularTotal(c), 0);
    const now = new Date();
    const mesAtual = now.getMonth();
    const anoAtual = now.getFullYear();
    const aprovadosMes = cotacoes.filter(c => {
      if (!c.dataDecisao || c.status !== 'APROVADO') return false;
      const d = new Date(c.dataDecisao);
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    }).length;
    const rejeitadosMes = cotacoes.filter(c => {
      if (!c.dataDecisao || c.status !== 'REJEITADO') return false;
      const d = new Date(c.dataDecisao);
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    }).length;
    const totalComprado = get().compras.reduce((sum, c) => sum + c.total, 0);
    return {
      totalPendente,
      qtdPendentes: pendentes.length,
      aprovadosMes,
      rejeitadosMes,
      totalComprado,
    };
  },
}));

// Helper: calcular total da cotacao
export function calcularTotal(c: Cotacao | { valorUnit: number; quantidade: number; icms: number; ipi: number }): number {
  if ('produtos' in c && c.produtos && c.produtos.length > 0) {
    return c.produtos.reduce((sum, p) => {
      if (p.status === 'REJEITADO') return sum;
      const bruto = p.valorUnit * p.quantidade;
      const ipi = bruto * (p.ipi / 100);
      return sum + parseFloat((bruto + ipi).toFixed(2));
    }, 0);
  }

  // Safe fallbacks for older objects that might not have these properties
  if ('status' in c && c.status === 'REJEITADO') {
    return 0;
  }

  const valorUnit = 'valorUnit' in c ? (c.valorUnit ?? 0) : 0;
  const quantidade = 'quantidade' in c ? (c.quantidade ?? 0) : 0;
  const ipiPct = 'ipi' in c ? (c.ipi ?? 0) : 0;

  const bruto = valorUnit * quantidade;
  const ipi = bruto * (ipiPct / 100);
  return parseFloat((bruto + ipi).toFixed(2));
}

/**
 * Check if a specific product of a cotação has been fully purchased.
 * Compares total purchased quantity (from compras) against the product's approved quantity.
 */
export function isProductFullyPurchased(
  productName: string,
  productQuantity: number,
  cotacaoId: number,
  compras: Compra[]
): boolean {
  const normalizedName = productName.trim().toLowerCase();
  const purchasesForProduct = compras.filter(
    c => c.cotacaoId === cotacaoId && c.produto.trim().toLowerCase() === normalizedName
  );
  const totalComprado = purchasesForProduct.reduce(
    (sum, c) => sum + Number(c.quantidade), 0
  );
  return totalComprado >= productQuantity;
}

/**
 * Calculate the remaining total for a cotação, excluding products that have been fully purchased.
 */
export function calcularTotalRestante(c: Cotacao, compras: Compra[]): number {
  if (c.produtos && c.produtos.length > 0) {
    return c.produtos.reduce((sum, p) => {
      if (p.status === 'REJEITADO') return sum;
      // Skip fully purchased products
      if (isProductFullyPurchased(p.produto, p.quantidade, c.id, compras)) return sum;
      const bruto = p.valorUnit * p.quantidade;
      const ipi = bruto * (p.ipi / 100);
      return sum + parseFloat((bruto + ipi).toFixed(2));
    }, 0);
  }

  // Legacy single-product cotacao
  if (c.status === 'REJEITADO') return 0;
  
  const valorUnit = c.valorUnit ?? 0;
  const quantidade = c.quantidade ?? 0;
  const ipiPct = c.ipi ?? 0;

  // Check if legacy product is fully purchased
  if (c.produto && isProductFullyPurchased(c.produto, quantidade, c.id, compras)) return 0;

  const bruto = valorUnit * quantidade;
  const ipi = bruto * (ipiPct / 100);
  return parseFloat((bruto + ipi).toFixed(2));
}

/**
 * Count how many products in a cotação are still pending purchase (approved but not yet bought).
 */
export function countProdutosRestantes(c: Cotacao, compras: Compra[]): number {
  if (c.produtos && c.produtos.length > 0) {
    return c.produtos.filter(p => {
      if (p.status === 'REJEITADO') return false;
      return !isProductFullyPurchased(p.produto, p.quantidade, c.id, compras);
    }).length;
  }
  // Legacy
  if (c.produto && isProductFullyPurchased(c.produto, c.quantidade ?? 0, c.id, compras)) return 0;
  return 1;
}

export function formatCotacaoProdutosQtd(c: Cotacao): string {
  if (c.produtos && c.produtos.length > 1) {
    return `${c.produtos.length} itens`;
  }
  const p = (c.produtos && c.produtos[0]) || c;
  return `${p.quantidade ?? 0} ${p.unidade ?? ''}`;
}

export function formatCotacaoProdutosDesc(c: Cotacao): string {
  if (c.produtos && c.produtos.length > 1) {
    return `${c.produtos[0].produto} (+${c.produtos.length - 1} itens)`;
  }
  const p = (c.produtos && c.produtos[0]) || c;
  return p.produto || '';
}

export function formatCurrency(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('pt-BR');
}

export function formatCurrencyInput(val: string): string {
  // Remove all non-digits
  const digits = val.replace(/\D/g, '');
  if (!digits) return '0,00';

  // Parse to integer
  const num = parseInt(digits, 10);
  // Convert to cents
  const value = num / 100;

  // Format with thousand separators (.) and decimal separator (,)
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function parseCurrencyInput(val: string): number {
  if (!val) return 0;
  // Convert masked string (e.g. "1.234,56") to float (1234.56)
  const clean = val.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * Get the visual display status for a cotação based on its product-level statuses.
 * This is the single source of truth for how the status badge should appear.
 */
export function getStatusDisplay(c: Cotacao, compras?: Compra[]): { label: string; bg: string; text: string } {
  // COMPRADO is final — only trust this if truly all items are done
  if (c.status === 'COMPRADO') {
    return { label: 'Comprado', bg: 'bg-[#e3f2fd]', text: 'text-[#1565c0]' };
  }

  // REJEITADO is final
  if (c.status === 'REJEITADO') {
    return { label: 'Rejeitado', bg: 'bg-[#ffebee]', text: 'text-[#c62828]' };
  }

  const produtos = c.produtos && c.produtos.length > 0 ? c.produtos : null;

  if (produtos) {
    const hasApproved = produtos.some(p => p.status === 'APROVADO');
    const hasRejected = produtos.some(p => p.status === 'REJEITADO');
    const hasPending = produtos.some(p => !p.status || p.status === 'PENDENTE');
    const allApproved = produtos.every(p => p.status === 'APROVADO');
    const hasDecided = hasApproved || hasRejected;

    // Check for purchased items (only when APROVADO status)
    if (c.status === 'APROVADO' && compras) {
      const approvedProds = produtos.filter(p => p.status === 'APROVADO');
      const hasPurchasedItems = approvedProds.some(p =>
        isProductFullyPurchased(p.produto, p.quantidade, c.id, compras)
      );
      const allApprovedPurchased = approvedProds.every(p =>
        isProductFullyPurchased(p.produto, p.quantidade, c.id, compras)
      );

      if (hasPurchasedItems) {
        // If there are still pending items, the cotação is NOT fully done
        if (hasPending) {
          return { label: 'Aprovado Parcialmente', bg: 'bg-[#fffde7] border border-[#f57f17]/20', text: 'text-[#f57f17]' };
        }
        // All items decided, check if all approved are purchased
        if (allApprovedPurchased) {
          return { label: 'Comprado', bg: 'bg-[#e3f2fd]', text: 'text-[#1565c0]' };
        }
        // Some approved purchased, some approved not yet purchased
        return { label: 'Comprado Parcial', bg: 'bg-[#e3f2fd] border border-[#1565c0]/20', text: 'text-[#1565c0]' };
      }
    }

    // APROVADO status (all decided, at least one approved)
    if (c.status === 'APROVADO') {
      if (allApproved) {
        return { label: 'Aprovado', bg: 'bg-[#e8f5e9]', text: 'text-[#2e7d32]' };
      }
      // Mix of approved and rejected (all decided)
      return { label: 'Aprovado (Parcial)', bg: 'bg-[#fffde7] border border-[#f57f17]/20', text: 'text-[#f57f17]' };
    }

    // PENDENTE status but has decisions made
    if (c.status === 'PENDENTE' && hasDecided) {
      if (hasApproved && hasPending) {
        return { label: 'Aprovado (Parcial)', bg: 'bg-[#fffde7] border border-[#f57f17]/20', text: 'text-[#f57f17]' };
      }
      if (hasRejected && hasPending) {
        return { label: 'Em Análise', bg: 'bg-[#fff3e0] border border-[#e65100]/20', text: 'text-[#e65100]' };
      }
    }
  }

  // Default: PENDENTE with no decisions
  return { label: 'Aguardando', bg: 'bg-[#fff3e0]', text: 'text-[#e65100]' };
}

/**
 * Calculate total only for PENDENTE products (items not yet decided by gestor).
 * Used in the listing to show the remaining amount awaiting decision.
 */
export function calcularTotalPendente(c: Cotacao): number {
  if (c.produtos && c.produtos.length > 0) {
    // If no product has been decided yet, return full total
    const hasDecision = c.produtos.some(p => p.status === 'APROVADO' || p.status === 'REJEITADO');
    if (!hasDecision) {
      return c.produtos.reduce((sum, p) => {
        const bruto = p.valorUnit * p.quantidade;
        const ipi = bruto * (p.ipi / 100);
        return sum + parseFloat((bruto + ipi).toFixed(2));
      }, 0);
    }

    // Only sum PENDENTE items
    return c.produtos.reduce((sum, p) => {
      if (p.status && p.status !== 'PENDENTE') return sum;
      const bruto = p.valorUnit * p.quantidade;
      const ipi = bruto * (p.ipi / 100);
      return sum + parseFloat((bruto + ipi).toFixed(2));
    }, 0);
  }

  // Legacy single-product cotacao
  if (c.status === 'REJEITADO' || c.status === 'APROVADO') return 0;
  const valorUnit = c.valorUnit ?? 0;
  const quantidade = c.quantidade ?? 0;
  const ipiPct = c.ipi ?? 0;
  const bruto = valorUnit * quantidade;
  const ipi = bruto * (ipiPct / 100);
  return parseFloat((bruto + ipi).toFixed(2));
}
