import { createClient } from '@supabase/supabase-js';
import { visitasIniciais, veiculosIniciais, terceirosIniciais, recebidosIniciais } from '../data/dados';

const supabaseUrl =
  process.env.NEXT_PUBLIC_PORTARIA_SUPABASE_URL ||
  'https://hukhlzcrjbtqseszfxyq.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_PORTARIA_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1a2hsemNyamJ0cXNlc3pmeHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDc3ODksImV4cCI6MjA5MzgyMzc4OX0.gYY_SBYaskuE1IAztWTkjhixjg6zuYuf7hkofL_x-ds';

export const supabase = createClient(supabaseUrl, supabaseKey);

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Cliente Admin (com service_role) usado APENAS para criação de usuários.
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// ─── VISITANTES (Reconhecimento Facial) ───────────────────────────────────────

export async function buscarVisitantePorFace(descriptor: Float32Array) {
  const vectorArray = Array.from(descriptor);
  const { data, error } = await supabase.rpc('match_visitantes', {
    query_embedding: vectorArray,
    match_threshold: 0.5,
    match_count: 1
  });
  if (error) { console.error('Erro na busca vetorial:', error); return null; }
  return data && data.length > 0 ? data[0] : null;
}

export async function buscarVisitantesPorNome(nome: string) {
  if (!nome || nome.trim().length < 2) return [];
  const { data, error } = await supabase
    .from('visitantes')
    .select('nome, empresa, documento, contato')
    .ilike('nome', `%${nome}%`)
    .limit(10);
  if (error) {
    console.error('Erro ao buscar visitantes por nome:', error);
    return [];
  }
  return data || [];
}

export async function salvarVisitante(
  nome: string, empresa: string, documento: string, contato: string, descriptor?: Float32Array
) {
  if (!nome) return null;
  const vectorArray = descriptor ? Array.from(descriptor) : null;

  // Verificamos se já existe um visitante com o mesmo nome para evitar duplicidades
  const { data: existente, error: errBusca } = await supabase
    .from('visitantes')
    .select('id')
    .eq('nome', nome)
    .maybeSingle();

  if (errBusca) {
    console.error('Erro ao buscar visitante existente:', errBusca);
  }

  if (existente) {
    // Atualiza os dados do visitante existente
    const updateData: Record<string, any> = { empresa, documento, contato };
    if (vectorArray) {
      updateData.face_descriptor = vectorArray;
    }
    const { error: errUpdate } = await supabase
      .from('visitantes')
      .update(updateData)
      .eq('id', existente.id);

    if (errUpdate) {
      console.error('Erro ao atualizar visitante:', errUpdate);
      throw errUpdate;
    }
    return existente.id;
  } else {
    // Insere um novo visitante
    const { data: novo, error: errInsert } = await supabase
      .from('visitantes')
      .insert([{ nome, empresa, documento, contato, face_descriptor: vectorArray }])
      .select('id')
      .single();

    if (errInsert) {
      console.error('Erro ao inserir visitante:', errInsert);
      throw errInsert;
    }
    return novo.id;
  }
}
// ─── VISITAS ──────────────────────────────────────────────────────────────────

export async function fetchVisitas() {
  try {
    const { data, error } = await supabase
      .from('visitas')
      .select('id, data, empresa, visitante, horario_entrada, horario_saida, documento, contato, responsavel, placa_veiculo, notas_fiscais, nota_fiscal, valor_nfe, descricao, created_at')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      const parsed = data.map((v: Record<string, unknown>) => ({
        id: v.id as string,
        data: v.data as string,
        empresa: (v.empresa as string) || '',
        visitante: (v.visitante as string) || '',
        horarioEntrada: (v.horario_entrada as string) || '',
        horarioSaida: (v.horario_saida as string) || '',
        documento: (v.documento as string) || '',
        contato: (v.contato as string) || '',
        responsavel: (v.responsavel as string) || '',
        placaVeiculo: (v.placa_veiculo as string) || '-',
        notasFiscais: Array.isArray(v.notas_fiscais) && v.notas_fiscais.length > 0
          ? v.notas_fiscais as { numero: string; valor: number }[]
          : (v.nota_fiscal && v.nota_fiscal !== '-'
            ? [{ numero: v.nota_fiscal as string, valor: (v.valor_nfe as number) || 0 }]
            : [{ numero: '', valor: 0 }]),
        descricao: (v.descricao as string) || '',
        fotoBase64: undefined,
      }));
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('portaria_visitas', JSON.stringify(parsed)); } catch { /* ignore */ }
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[Portaria] Conexão remota a visitas indisponível, usando fallback local.');
  }

  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem('portaria_visitas');
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }
  }
  return visitasIniciais;
}

export async function fetchFotoVisita(id: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from('visitas')
      .select('foto_base64')
      .eq('id', id)
      .single();
    if (error) return undefined;
    return (data?.foto_base64 as string) || undefined;
  } catch {
    return undefined;
  }
}

export async function inserirVisita(visita: {
  data: string; empresa: string; visitante: string;
  horarioEntrada: string; horarioSaida: string; documento: string;
  contato: string; responsavel: string; placaVeiculo: string;
  notasFiscais: { numero: string; valor: number }[];
  descricao: string; fotoBase64?: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('visitas').insert([{
      data: visita.data,
      empresa: visita.empresa,
      visitante: visita.visitante,
      horario_entrada: visita.horarioEntrada || null,
      horario_saida: visita.horarioSaida || null,
      documento: visita.documento,
      contato: visita.contato,
      responsavel: visita.responsavel,
      placa_veiculo: visita.placaVeiculo,
      notas_fiscais: visita.notasFiscais,
      descricao: visita.descricao,
      foto_base64: visita.fotoBase64 || null,
    }]).select('id').single();
    if (!error && data?.id) return data.id;
  } catch (err) {
    console.warn('[Portaria] Erro ao sincronizar visita no Supabase, registrando localmente:', err);
  }
  return `temp-vis-${Date.now()}`;
}

export async function atualizarVisitaDb(v: {
  id: string; data: string; empresa: string; visitante: string;
  horarioEntrada: string; documento: string; contato: string;
  responsavel: string; placaVeiculo: string;
  notasFiscais: { numero: string; valor: number }[];
  descricao: string;
}) {
  try {
    const { error } = await supabase.from('visitas').update({
      data: v.data,
      empresa: v.empresa,
      visitante: v.visitante,
      horario_entrada: v.horarioEntrada || null,
      documento: v.documento,
      contato: v.contato,
      responsavel: v.responsavel,
      placa_veiculo: v.placaVeiculo,
      notas_fiscais: v.notasFiscais,
      descricao: v.descricao,
    }).eq('id', v.id);
    if (error) console.warn('[Portaria] Atualização remota de visita pendente de sync:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao atualizar visita:', err);
  }
}

export async function encerrarVisitaDb(id: string, horarioSaida: string) {
  try {
    const { error } = await supabase
      .from('visitas')
      .update({ horario_saida: horarioSaida })
      .eq('id', id);
    if (error) console.warn('[Portaria] Encerramento remoto pendente de sync:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao encerrar visita:', err);
  }
}

export async function excluirVisitaDb(id: string) {
  try {
    const { error } = await supabase.from('visitas').delete().eq('id', id);
    if (error) console.warn('[Portaria] Exclusão remota pendente de sync:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao excluir visita:', err);
  }
}

// ─── FROTA ────────────────────────────────────────────────────────────────────

export async function fetchFrota() {
  try {
    const { data, error } = await supabase
      .from('frota')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      const parsed = data.map((v: Record<string, unknown>) => ({
        id: v.id as string,
        data: v.data as string,
        motorista: (v.responsavel as string) || '',
        veiculo: (v.veiculo as string) || '',
        horarioSaida: (v.horario_saida as string) || '',
        dataRetorno: (v.data_retorno as string) || '',
        horarioRetorno: (v.horario_retorno as string) || '',
        kmRodados: Math.max(0, (v.km_rodados as number) || 0),
        kmSaida: (v.km_saida as number) || 0,
        kmEntrada: (v.km_entrada as number) || 0,
        destino: (v.destino as string) || '',
        notasFiscais: Array.isArray(v.notas_fiscais) && v.notas_fiscais.length > 0
          ? v.notas_fiscais as { numero: string; valor: number }[]
          : (v.nota_fiscal && v.nota_fiscal !== ''
            ? [{ numero: v.nota_fiscal as string, valor: (v.valor_nfe as number) || 0 }]
            : [{ numero: '', valor: 0 }]),
      }));
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('portaria_frota', JSON.stringify(parsed)); } catch { /* ignore */ }
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[Portaria] Conexão remota a frota indisponível, usando fallback local.');
  }

  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem('portaria_frota');
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }
  }
  return veiculosIniciais;
}

export async function inserirVeiculo(v: {
  data: string; motorista: string; veiculo: string;
  horarioSaida: string; dataRetorno: string; horarioRetorno: string;
  kmRodados: number; kmSaida: number; kmEntrada: number; destino: string;
  notasFiscais: { numero: string; valor: number }[];
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('frota').insert([{
      data: v.data,
      responsavel: v.motorista,
      veiculo: v.veiculo,
      horario_saida: v.horarioSaida || null,
      data_retorno: v.dataRetorno || null,
      horario_retorno: v.horarioRetorno || null,
      km_rodados: Math.max(0, v.kmRodados || 0),
      km_saida: v.kmSaida,
      km_entrada: v.kmEntrada,
      destino: v.destino,
      notas_fiscais: v.notasFiscais,
    }]).select('id').single();
    if (!error && data?.id) return data.id;
  } catch (err) {
    console.warn('[Portaria] Erro ao sincronizar veículo no Supabase, registrando localmente:', err);
  }
  return `temp-frota-${Date.now()}`;
}

export async function atualizarVeiculoDb(v: {
  id: string; data: string; motorista: string; veiculo: string;
  horarioSaida: string; dataRetorno: string; horarioRetorno: string;
  kmRodados: number; kmSaida: number; kmEntrada: number; destino: string;
  notasFiscais: { numero: string; valor: number }[];
}) {
  try {
    const { error } = await supabase.from('frota').update({
      data: v.data,
      responsavel: v.motorista,
      veiculo: v.veiculo,
      horario_saida: v.horarioSaida || null,
      data_retorno: v.dataRetorno || null,
      horario_retorno: v.horarioRetorno || null,
      km_rodados: Math.max(0, v.kmRodados || 0),
      km_saida: v.kmSaida,
      km_entrada: v.kmEntrada,
      destino: v.destino,
      notas_fiscais: v.notasFiscais,
    }).eq('id', v.id);
    if (error) console.warn('[Portaria] Atualização remota de frota pendente:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao atualizar veículo:', err);
  }
}

export async function excluirVeiculoDb(id: string) {
  try {
    const { error } = await supabase.from('frota').delete().eq('id', id);
    if (error) console.warn('[Portaria] Exclusão remota de frota pendente:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao excluir veículo:', err);
  }
}

// ─── TERCEIROS ────────────────────────────────────────────────────────────────

export async function fetchTerceiros() {
  try {
    const { data, error } = await supabase
      .from('terceiros')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      const parsed = data.map((t: Record<string, unknown>) => ({
        id: t.id as string,
        nome: t.nome as string,
        data: t.data as string,
        horaEntrada: t.hora_entrada as string,
        horaSaida: (t.hora_saida as string) || undefined,
        minutosTrabalhados: (t.minutos_trabalhados as number) || undefined,
      }));
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('portaria_terceiros', JSON.stringify(parsed)); } catch { /* ignore */ }
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[Portaria] Conexão remota a terceiros indisponível, usando fallback local.');
  }

  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem('portaria_terceiros');
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }
  }
  return terceirosIniciais;
}

export async function inserirTerceiro(t: {
  nome: string;
  data: string;
  horaEntrada: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('terceiros').insert([{
      nome: t.nome,
      data: t.data,
      hora_entrada: t.horaEntrada,
    }]).select('id').single();
    if (!error && data?.id) return data.id;
  } catch (err) {
    console.warn('[Portaria] Erro ao sincronizar terceiro no Supabase, registrando localmente:', err);
  }
  return `temp-terc-${Date.now()}`;
}

export async function encerrarTerceiroDb(id: string, horaSaida: string, minutosTrabalhados: number) {
  try {
    const { error } = await supabase.from('terceiros').update({
      hora_saida: horaSaida,
      minutos_trabalhados: minutosTrabalhados,
    }).eq('id', id);
    if (error) console.warn('[Portaria] Encerramento de terceiro pendente de sync:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao encerrar terceiro:', err);
  }
}

export async function excluirTerceiroDb(id: string) {
  try {
    const { error } = await supabase.from('terceiros').delete().eq('id', id);
    if (error) console.warn('[Portaria] Exclusão de terceiro pendente de sync:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao excluir terceiro:', err);
  }
}

// ─── RECEBIDOS ────────────────────────────────────────────────────────────────

export async function fetchRecebidos() {
  try {
    const { data, error } = await supabase
      .from('encomendas')
      .select('id, data, hora_registro, remetente, destinatario, descricao, created_at')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      const parsed = data.map((e: Record<string, any>) => ({
        id: e.id as string,
        data: e.data as string,
        horaRegistro: e.hora_registro as string,
        remetente: (e.remetente as string) || '',
        destinatario: (e.destinatario as string) || '',
        descricao: (e.descricao as string) || '',
        fotoBase64: undefined,
      }));
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('portaria_recebidos', JSON.stringify(parsed)); } catch { /* ignore */ }
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[Portaria] Conexão remota a recebidos indisponível, usando fallback local.');
  }

  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem('portaria_recebidos');
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }
  }
  return recebidosIniciais;
}

export async function fetchFotoRecebido(id: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from('encomendas')
      .select('foto_base64')
      .eq('id', id)
      .single();
    if (error) return undefined;
    return (data?.foto_base64 as string) || undefined;
  } catch {
    return undefined;
  }
}

export async function inserirRecebido(recebido: {
  data: string;
  horaRegistro: string;
  remetente: string;
  destinatario: string;
  descricao: string;
  fotoBase64?: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('encomendas').insert([{
      data: recebido.data,
      hora_registro: recebido.horaRegistro,
      remetente: recebido.remetente,
      destinatario: recebido.destinatario,
      descricao: recebido.descricao,
      foto_base64: recebido.fotoBase64 || null,
    }]).select('id').single();
    if (!error && data?.id) return data.id;
  } catch (err) {
    console.warn('[Portaria] Erro ao sincronizar recebido no Supabase, registrando localmente:', err);
  }
  return `temp-rec-${Date.now()}`;
}

export async function excluirRecebidoDb(id: string) {
  try {
    const { error } = await supabase.from('encomendas').delete().eq('id', id);
    if (error) console.warn('[Portaria] Exclusão de recebido pendente de sync:', error.message);
  } catch (err) {
    console.warn('[Portaria] Erro ao excluir recebido:', err);
  }
}

