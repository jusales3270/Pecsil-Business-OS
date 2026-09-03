import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useStore, formatCurrency } from '@/store';
import { supabase } from '@/lib/supabase';
import type { IcmsRow, IcmsPlanilha, IcmsLivroLinha } from '@/types';
import * as XLSX from 'xlsx';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from 'recharts';
import {
  Upload, CheckCircle2, AlertTriangle, FileSpreadsheet,
  Search, Calendar, DollarSign, Receipt, Package, TrendingUp,
  X, Loader2, Trash2,
} from 'lucide-react';
import DivisaoTabs from '@/components/DivisaoTabs';

/* ── Cores para gráficos ── */
const CHART_COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e11d48', '#a855f7', '#0ea5e9', '#65a30d',
];

/* ── Meses em português ── */
const MESES_PT: Record<string, string> = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
  '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
  '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro',
};

function formatMes(mes: string): string {
  const [ano, m] = mes.split('-');
  return `${MESES_PT[m] || m} / ${ano}`;
}

/* ════════════════════════════════════════════════════════════
   IcmsPage - Componente principal
   ════════════════════════════════════════════════════════════ */
export default function IcmsPage() {
  const { user } = useStore();
  if (!user) return null;

  return user.role === 'ORCAMENTISTA' ? <IcmsUploadView /> : <IcmsGestorView />;
}

/* ════════════════════════════════════════════════════════════
   ORÇAMENTISTA - Upload View
   ════════════════════════════════════════════════════════════ */
function IcmsUploadView() {
  const [mesSelecionado, setMesSelecionado] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [planilhas, setPlanilhas] = useState<IcmsPlanilha[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [successPopup, setSuccessPopup] = useState(false);
  const [successInfo, setSuccessInfo] = useState({ rows: 0, mes: '' });
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carregar planilhas existentes
  const fetchPlanilhas = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('icms_planilhas')
      .select('*')
      .order('mes', { ascending: false });
    if (data) setPlanilhas(data as IcmsPlanilha[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPlanilhas(); }, [fetchPlanilhas]);

  const mesJaExiste = useMemo(
    () => planilhas.some(p => p.mes === mesSelecionado),
    [planilhas, mesSelecionado]
  );

  // Processar arquivo
  const processFile = useCallback(async (file: File) => {
    if (mesJaExiste) {
      setError(`Já existe uma planilha para ${formatMes(mesSelecionado)}. Exclua-a antes de enviar outra.`);
      return;
    }

    setUploading(true);
    setError('');

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Ler como array de arrays (raw) para encontrar a linha de cabeçalho
      const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      if (rawData.length < 2) {
        setError('A planilha está vazia ou não tem dados suficientes.');
        setUploading(false);
        return;
      }

      // Normalizar texto para comparação (remove acentos, espaços e pontuação como pontos e traços)
      const normalize = (s: any) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

      // Keywords para identificar a linha de cabeçalho
      const headerKeywords = ['fornecedor', 'valor', 'icms', 'ipi', 'tipo', 'nfe', 'emitida', 'fantasia'];

      // Encontrar a linha de cabeçalho
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(rawData.length, 30); i++) {
        const row = rawData[i];
        if (!row || row.length < 3) continue;
        const normalizedCells = row.map(cell => normalize(cell));
        
        const matchCount = headerKeywords.filter(kw => 
          normalizedCells.some(cell => {
            if (cell === kw) return true;
            // Apenas correspondência parcial para termos longos (evita "ed" bater com "fornecedor")
            if (cell.length >= 4 && kw.length >= 4) {
              return cell.includes(kw) || kw.includes(cell);
            }
            return false;
          })
        ).length;

        // Se encontrou pelo menos 3 keywords, é a linha de cabeçalho
        if (matchCount >= 3) {
          headerRowIdx = i;
          break;
        }
      }

      if (headerRowIdx === -1) {
        // Fallback: usar linha 2 (index 1) se falhar detecção, pois é o padrão da planilha
        headerRowIdx = rawData.length >= 2 ? 1 : 0;
      }

      // Mapear cabeçalho
      const headerRow = rawData[headerRowIdx];

      // A partir da linha 2 (índice 1), temos os cabeçalhos. Mapeamos as colunas com flexibilidade:
      const colMap: Record<string, number> = {};
      
      headerRow.forEach((cell: any, colIdx: number) => {
        const normalized = normalize(cell);
        if (!normalized) return;

        if (normalized === 'fantasia') colMap['fantasia'] = colIdx;
        else if (normalized.includes('emitida') || normalized === 'emissao') colMap['emitida'] = colIdx;
        else if (normalized.includes('recebida') || normalized === 'recebimento') colMap['recebida'] = colIdx;
        else if (normalized.includes('fornecedor') || normalized.startsWith('forn')) colMap['fornecedor'] = colIdx;
        else if (normalized === 'nfe' || normalized === 'nf' || normalized === 'notafiscal') colMap['nfe'] = colIdx;
        else if (normalized === 'valor' || normalized === 'valortotal') colMap['valor'] = colIdx;
        else if (normalized === 'vlrcobrado' || normalized === 'valorcobrado') colMap['vlr_cobrado'] = colIdx;
        else if (normalized === 'xml') colMap['xml'] = colIdx;
        else if (normalized === 'lacto' || normalized.includes('lancamento')) colMap['lacto'] = colIdx;
        else if (normalized === 'aut' || normalized.includes('autorizacao')) colMap['aut'] = colIdx;
        else if (normalized === 'icms') colMap['icms'] = colIdx;
        else if (normalized === 'tipo' || normalized === 'categoria') colMap['tipo'] = colIdx;
        else if (normalized === 'f' || normalized === 'fundicao') colMap['f'] = colIdx;
        else if (normalized === 'u' || normalized === 'usinagem') colMap['u'] = colIdx;
        else if (normalized === 'rs' || normalized === 'retiradasocio' || normalized === 'adm' || normalized === 'administrativo') colMap['rs'] = colIdx;
        else if (normalized === 'ipi') colMap['ipi'] = colIdx;
        else if (normalized.startsWith('obs1') || normalized === 'obs') colMap['obs1'] = colIdx;
        else if (normalized.startsWith('obs5')) colMap['obs5'] = colIdx;
      });

      // Função para converter data do Excel (serial number) ou dd/mm/yyyy para yyyy-mm-dd
      const parseDate = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'number') {
          // Excel serial date to JS Date
          const date = new Date((val - 25569) * 86400 * 1000);
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        const str = String(val).trim();
        if (str.includes('/')) {
          const parts = str.split('/');
          if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }
        return str;
      };

      const getVal = (row: any[], field: string): string => {
        const idx = colMap[field];
        if (idx === undefined) return '';
        return String(row[idx] ?? '').trim();
      };

      const getNum = (row: any[], field: string): number => {
        const idx = colMap[field];
        if (idx === undefined) return 0;
        const val = row[idx];
        if (typeof val === 'number') return val;
        return parseFloat(String(val ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      };

      const rows: Omit<IcmsRow, 'id' | 'planilha_id'>[] = [];
      
      // Começamos a ler os dados a partir de headerRowIdx + 1 (ou seja, linha 3 em diante)
      for (let i = headerRowIdx + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 3) continue;

        const fornecedor = getVal(row, 'fornecedor');
        const valor = getNum(row, 'valor');
        
        // Pula linhas totalmente vazias ou de totais
        if (!fornecedor && valor === 0) continue;
        if (fornecedor.toLowerCase().includes('total') || fornecedor.toLowerCase().includes('resumo')) continue;

        // Construir Status a partir de XML, LACTO. e AUT.
        const xml = getVal(row, 'xml');
        const lacto = getVal(row, 'lacto');
        const aut = getVal(row, 'aut');
        const statusParts = [];
        if (xml) statusParts.push(xml);
        if (lacto) statusParts.push(lacto);
        if (aut) statusParts.push(aut);
        const status = statusParts.join('/');

        // Construir Centro de Custo com base nas colunas F, U, RS
        const hasF = getVal(row, 'f');
        const hasU = getVal(row, 'u');
        const hasRS = getVal(row, 'rs');
        const centroParts = [];
        if (hasF) centroParts.push('Fundição');
        if (hasU) centroParts.push('Usinagem');
        if (hasRS) centroParts.push('Administrativo');
        const centro = centroParts.join(' + ') || 'Não classificado';

        // Observações (combinando OBS.1 e OBS.5)
        const obs1 = getVal(row, 'obs1');
        const obs5 = getVal(row, 'obs5');
        const obs = [obs1, obs5].filter(Boolean).join(' | ');

        rows.push({
          fantasia: getVal(row, 'fantasia'),
          emitida: parseDate(row[colMap['emitida']]),
          recebida: parseDate(row[colMap['recebida']]),
          fornecedor: fornecedor || '(sem fornecedor)',
          nfe: getVal(row, 'nfe'),
          valor: valor,
          vlr_cobrado: getNum(row, 'vlr_cobrado'),
          icms: getNum(row, 'icms'),
          ipi: getNum(row, 'ipi'),
          tipo: getVal(row, 'tipo'),
          centro: centro,
          status: status,
          obs: obs,
        });
      }

      // Tentar ler a planilha do Livro de Apuração
      const livroRows: Omit<IcmsLivroLinha, 'id' | 'planilha_id'>[] = [];
      let libroSheetName = '';

      // Busca por palavras-chave nos nomes das abas
      for (const name of workbook.SheetNames) {
        const normName = normalize(name);
        if (normName.includes('apuracao') || normName.includes('livro') || normName.includes('resumo') || normName.includes('planilha3')) {
          libroSheetName = name;
          break;
        }
      }

      // Fallback para a terceira aba se nenhuma corresponder
      if (!libroSheetName && workbook.SheetNames.length >= 3) {
        libroSheetName = workbook.SheetNames[2];
      }

      if (libroSheetName) {
        const worksheet2 = workbook.Sheets[libroSheetName];
        const rawData2: any[][] = XLSX.utils.sheet_to_json(worksheet2, { header: 1, defval: '' });

        if (rawData2.length >= 2) {
          // Encontrar a linha de cabeçalho da apuração (que contém "descricao" ou "credito" ou "debito")
          let headerIdx2 = -1;
          for (let i = 0; i < Math.min(rawData2.length, 10); i++) {
            const row = rawData2[i];
            if (!row || row.length < 2) continue;
            const normalized = row.map(c => normalize(c));
            if (normalized.includes('descricao') || normalized.includes('desc') || normalized.includes('credito') || normalized.includes('debito')) {
              headerIdx2 = i;
              break;
            }
          }

          if (headerIdx2 !== -1) {
            const headerRow2 = rawData2[headerIdx2];
            const colMap2: Record<string, number> = {};
            
            headerRow2.forEach((cell, idx) => {
              const norm = normalize(cell);
              if (norm.includes('data') || norm.includes('mes')) colMap2['data'] = idx;
              else if (norm.includes('descricao') || norm.includes('desc')) colMap2['descricao'] = idx;
              else if (norm.includes('credito')) colMap2['credito'] = idx;
              else if (norm.includes('debito')) colMap2['debito'] = idx;
              else if (norm.includes('saldo') || norm.includes('resultado')) colMap2['saldo'] = idx;
            });

            const getVal2 = (row: any[], field: string): string => {
              const idx = colMap2[field];
              if (idx === undefined) return '';
              return String(row[idx] ?? '').trim();
            };

            const getNum2 = (row: any[], field: string): number => {
              const idx = colMap2[field];
              if (idx === undefined) return 0;
              const val = row[idx];
              if (typeof val === 'number') return val;
              return parseFloat(String(val ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
            };

            for (let i = headerIdx2 + 1; i < rawData2.length; i++) {
              const row = rawData2[i];
              if (!row || row.length < 2) continue;

              const desc = getVal2(row, 'descricao');
              const credito = getNum2(row, 'credito');
              const debito = getNum2(row, 'debito');
              const saldo = getNum2(row, 'saldo');

              // Pular linhas vazias
              if (!desc && credito === 0 && debito === 0) continue;

              livroRows.push({
                data: parseDate(row[colMap2['data']]),
                descricao: desc || '(sem descrição)',
                credito: credito,
                debito: debito,
                saldo: saldo,
              });
            }
          }
        }
      }

      if (rows.length === 0) {
        setError('Nenhum registro válido de dados encontrado após a linha de cabeçalho.');
        setUploading(false);
        return;
      }

      // 1. Criar planilha
      const { data: planilhaData, error: planilhaError } = await supabase
        .from('icms_planilhas')
        .insert({ mes: mesSelecionado })
        .select()
        .single();

      if (planilhaError) {
        if (planilhaError.code === '23505') {
          setError(`Já existe uma planilha para ${formatMes(mesSelecionado)}.`);
        } else {
          setError(`Erro ao criar planilha: ${planilhaError.message}`);
        }
        setUploading(false);
        return;
      }

      // 2. Inserir linhas em lotes de 500
      const planilhaId = (planilhaData as IcmsPlanilha).id!;
      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize).map(r => ({
          ...r,
          planilha_id: planilhaId,
        }));
        const { error: rowsError } = await supabase
          .from('icms_rows')
          .insert(batch);
        if (rowsError) {
          setError(`Erro ao inserir dados: ${rowsError.message}`);
          setUploading(false);
          return;
        }
      }

      // 3. Inserir livro de apuração se houver
      if (livroRows.length > 0) {
        const batchLivro = livroRows.map(r => ({
          ...r,
          planilha_id: planilhaId,
        }));
        const { error: livroError } = await supabase
          .from('icms_livro')
          .insert(batchLivro);
        if (livroError) {
          console.error('Erro ao inserir livro de apuração:', livroError);
        }
      }

      // Sucesso!
      setSuccessInfo({ rows: rows.length, mes: formatMes(mesSelecionado) });
      setSuccessPopup(true);
      await fetchPlanilhas();
    } catch (err: any) {
      setError(`Erro ao processar planilha: ${err.message}`);
    }

    setUploading(false);
  }, [mesSelecionado, mesJaExiste, fetchPlanilhas]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDeletePlanilha = async (planilha: IcmsPlanilha) => {
    if (!confirm(`Tem certeza que deseja excluir a planilha de ${formatMes(planilha.mes)}? Todos os dados serão removidos.`)) return;
    await supabase.from('icms_planilhas').delete().eq('id', planilha.id);
    await fetchPlanilhas();
  };

  return (
    <div className="space-y-6">
      {/* Upload Card */}
      <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Upload size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#212121]">Upload de Planilha ICMS</h2>
            <p className="text-xs text-[#757575]">Envie a planilha de compras/NFs do mês selecionado</p>
          </div>
        </div>

        {/* Seletor de Mês */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-[#757575] uppercase tracking-wider mb-2">
            Mês de referência
          </label>
          <div className="relative">
            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575]" />
            <input
              type="month"
              value={mesSelecionado}
              onChange={(e) => { setMesSelecionado(e.target.value); setError(''); }}
              className="w-full max-w-xs pl-10 pr-4 py-2.5 border border-black/[0.12] rounded-lg text-sm text-[#212121] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          </div>
          {mesJaExiste && (
            <div className="mt-2 flex items-center gap-2 text-amber-600 text-xs">
              <AlertTriangle size={14} />
              <span>Já existe uma planilha para este mês. Exclua-a antes de enviar outra.</span>
            </div>
          )}
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !mesJaExiste && !uploading && fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
            mesJaExiste
              ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
              : dragOver
                ? 'border-primary bg-primary/5'
                : 'border-black/[0.12] hover:border-primary/50 hover:bg-blue-50/30'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
            disabled={mesJaExiste || uploading}
          />

          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={32} className="text-primary animate-spin" />
              <p className="text-sm text-[#757575]">Processando planilha...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
                <FileSpreadsheet size={28} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#212121]">
                  Arraste a planilha aqui ou clique para selecionar
                </p>
                <p className="text-xs text-[#757575] mt-1">
                  Formatos aceitos: .xlsx, .xls, .csv
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
      </div>

      {/* Planilhas Enviadas */}
      <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-6">
        <h3 className="text-sm font-semibold text-[#212121] mb-4">Planilhas Enviadas</h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="text-primary animate-spin" />
          </div>
        ) : planilhas.length === 0 ? (
          <div className="text-center py-8 text-[#757575] text-sm">
            Nenhuma planilha enviada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {planilhas.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-[#fafafa] rounded-lg border border-black/[0.06] hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                    <CheckCircle2 size={16} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#212121]">{formatMes(p.mes)}</p>
                    <p className="text-[10px] text-[#757575]">
                      Enviado em {p.uploaded_at ? new Date(p.uploaded_at).toLocaleString('pt-BR') : '—'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeletePlanilha(p)}
                  className="p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Excluir planilha"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Success Popup (Modal) ── */}
      {successPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSuccessPopup(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate-in fade-in zoom-in-95">
            <button
              onClick={() => setSuccessPopup(false)}
              className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X size={18} className="text-[#757575]" />
            </button>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={36} className="text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-[#212121] mb-2">Upload Concluído!</h3>
              <p className="text-sm text-[#757575] mb-4">
                A planilha de <strong className="text-[#212121]">{successInfo.mes}</strong> foi processada com sucesso.
              </p>
              <div className="bg-green-50 rounded-lg p-3 mb-5">
                <p className="text-sm text-green-800">
                  <strong>{successInfo.rows}</strong> registro{successInfo.rows !== 1 ? 's' : ''} gravado{successInfo.rows !== 1 ? 's' : ''} no sistema
                </p>
              </div>
              <button
                onClick={() => setSuccessPopup(false)}
                className="px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   GESTOR - Visualização View
   ════════════════════════════════════════════════════════════ */
function IcmsGestorView() {
  const { currentDivisao } = useStore();
  const [planilhas, setPlanilhas] = useState<IcmsPlanilha[]>([]);
  const [rows, setRows] = useState<IcmsRow[]>([]);
  const [livroRows, setLivroRows] = useState<IcmsLivroLinha[]>([]);
  const [mesFiltro, setMesFiltro] = useState('todos');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<{ label: string; value: string; icon: React.ReactNode; color: string } | null>(null);

  // Carregar dados
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: planilhaData } = await supabase
        .from('icms_planilhas')
        .select('*')
        .order('mes', { ascending: false });

      if (planilhaData) setPlanilhas(planilhaData as IcmsPlanilha[]);

      let allRows: IcmsRow[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error: batchError } = await supabase
          .from('icms_rows')
          .select('*')
          .order('id', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (batchError || !batch || batch.length === 0) {
          hasMore = false;
        } else {
          allRows = [...allRows, ...batch];
          if (batch.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        }
      }

      setRows(allRows);

      // Carrega o livro de apuração
      const { data: livroData } = await supabase
        .from('icms_livro')
        .select('*')
        .order('id', { ascending: true });

      if (livroData) setLivroRows(livroData as IcmsLivroLinha[]);
      
      setLoading(false);
    })();
  }, []);

  // Filtrar o livro de apuração baseado no mês selecionado
  const filteredLivroRows = useMemo(() => {
    if (mesFiltro === 'todos') {
      return livroRows;
    }
    const planilha = planilhas.find(p => p.mes === mesFiltro);
    return planilha ? livroRows.filter(r => r.planilha_id === planilha.id) : [];
  }, [livroRows, mesFiltro, planilhas]);

  // Saldo final do livro (saldo do último registro ou diferença total)
  const finalSaldo = useMemo(() => {
    if (filteredLivroRows.length === 0) return 0;
    // O último registro costuma ser o saldo final
    const lastRow = filteredLivroRows[filteredLivroRows.length - 1];
    return lastRow.saldo;
  }, [filteredLivroRows]);

  // Filtrar dados com base no mês e busca
  const baseFilteredRows = useMemo(() => {
    let result = rows;

    if (mesFiltro !== 'todos') {
      const planilha = planilhas.find(p => p.mes === mesFiltro);
      if (planilha) {
        result = result.filter(r => r.planilha_id === planilha.id);
      }
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.fornecedor.toLowerCase().includes(q) ||
        r.tipo.toLowerCase().includes(q) ||
        r.centro.toLowerCase().includes(q) ||
        r.nfe.toLowerCase().includes(q)
      );
    }

    return result;
  }, [rows, mesFiltro, planilhas, search]);

  // Contagem para os botões de divisão (Fundição vs Usinagem)
  const divisaoCounts = useMemo(() => {
    const fCount = baseFilteredRows.filter(r => r.centro.includes('Fundição')).length;
    const uCount = baseFilteredRows.filter(r => r.centro.includes('Usinagem')).length;
    return { FUNDICAO: fCount, USINAGEM: uCount };
  }, [baseFilteredRows]);

  // Filtragem final baseada na divisão ativa
  const filteredRows = useMemo(() => {
    const target = currentDivisao === 'FUNDICAO' ? 'Fundição' : 'Usinagem';
    return baseFilteredRows.filter(r => r.centro.includes(target));
  }, [baseFilteredRows, currentDivisao]);

  // Estatísticas
  const stats = useMemo(() => {
    const totalValor = filteredRows.reduce((s, r) => s + r.valor, 0);
    const totalVlrCobrado = filteredRows.reduce((s, r) => s + r.vlr_cobrado, 0);
    const totalIcms = filteredRows.reduce((s, r) => s + r.icms, 0);
    const totalIpi = filteredRows.reduce((s, r) => s + r.ipi, 0);
    const qtdNotas = filteredRows.length;
    return { totalValor, totalVlrCobrado, totalIcms, totalIpi, qtdNotas };
  }, [filteredRows]);

  // Formatador auxiliar de valores em milhares (ex: R$ 4.683,2k)
  const formatValueK = useCallback((val: number): string => {
    if (val >= 1000) {
      const kVal = val / 1000;
      return `R$ ${kVal.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
    }
    return `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  // 1. Dados para o Donut Chart: Valor por centro de custo (calculado sobre baseFilteredRows para exibir a divisão geral)
  const donutData = useMemo(() => {
    const map: Record<string, number> = {};
    baseFilteredRows.forEach(r => {
      const centro = r.centro || 'Não classificado';
      map[centro] = (map[centro] || 0) + r.valor;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ 
        name, 
        value: parseFloat(value.toFixed(2)),
        formattedValue: formatValueK(value),
      }));
  }, [baseFilteredRows, formatValueK]);

  // 2. Dados para o Bar Chart: Top 10 fornecedores (respeita filteredRows)
  const barFornecedoresData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      const nome = r.fornecedor.trim() || 'SEM FORNECEDOR';
      map[nome] = (map[nome] || 0) + r.valor;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({
        name: name.length > 20 ? name.substring(0, 18) + '…' : name,
        fullName: name,
        Valor: parseFloat(value.toFixed(2)),
      }));
  }, [filteredRows]);

  // 3. Dados para o Bar Chart: Categoria de despesa (top 10 despesas + agrupamento de Outros)
  const despesasData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      const tipo = r.tipo.toUpperCase().trim() || 'SEM TIPO';
      map[tipo] = (map[tipo] || 0) + r.valor;
    });

    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const top10 = sorted.slice(0, 10);
    const others = sorted.slice(10);

    const result = top10.map(([name, value]) => ({
      name: name.length > 15 ? name.substring(0, 13) + '…' : name,
      fullName: name,
      Valor: parseFloat(value.toFixed(2)),
    }));

    if (others.length > 0) {
      const othersTotal = others.reduce((sum, [, val]) => sum + val, 0);
      result.push({
        name: `Outros (${others.length})`,
        fullName: 'Outras despesas combinadas',
        Valor: parseFloat(othersTotal.toFixed(2)),
      });
    }

    return result;
  }, [filteredRows]);

  // 4. Dados para o Line Chart: Evolução diária (respeita filteredRows)
  const evolucaoData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRows.forEach(r => {
      if (!r.emitida) return;
      map[r.emitida] = (map[r.emitida] || 0) + r.valor;
    });

    return Object.entries(map)
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([dateStr, value]) => {
        const parts = dateStr.split('-');
        const d = parts[2] || '';
        const m = parts[1] || '';
        return {
          dateLabel: `${d}/${m}`,
          rawDate: dateStr,
          Valor: parseFloat(value.toFixed(2)),
        };
      });
  }, [filteredRows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    );
  }

  if (planilhas.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <FileSpreadsheet size={32} className="text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-[#212121] mb-2">Nenhuma planilha disponível</h3>
        <p className="text-sm text-[#757575]">O orçamentista ainda não enviou nenhuma planilha de ICMS.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Abas de Divisão (Fundição / Usinagem) */}
      <DivisaoTabs counts={divisaoCounts} />

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575]" />
          <select
            value={mesFiltro}
            onChange={(e) => setMesFiltro(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-black/[0.12] rounded-lg text-sm text-[#212121] bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all appearance-none"
          >
            <option value="todos">Todos os meses</option>
            {planilhas.map(p => (
              <option key={p.id} value={p.mes}>{formatMes(p.mes)}</option>
            ))}
          </select>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575]" />
          <input
            type="text"
            placeholder="Buscar fornecedor, tipo, centro..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-black/[0.12] rounded-lg text-sm text-[#212121] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard 
          icon={<DollarSign size={20} />} 
          label="Total NF Valor" 
          value={formatCurrency(stats.totalValor)} 
          color="#2563eb" 
          onClick={() => setSelectedCard({
            label: "Total NF Valor",
            value: formatCurrency(stats.totalValor),
            icon: <DollarSign size={32} />,
            color: "#2563eb"
          })}
        />
        <StatCard 
          icon={<Receipt size={20} />} 
          label="Total Vlr Cobrado" 
          value={formatCurrency(stats.totalVlrCobrado)} 
          color="#10b981" 
          onClick={() => setSelectedCard({
            label: "Total Vlr Cobrado",
            value: formatCurrency(stats.totalVlrCobrado),
            icon: <Receipt size={32} />,
            color: "#10b981"
          })}
        />
        <StatCard 
          icon={<TrendingUp size={20} />} 
          label="Total ICMS" 
          value={formatCurrency(stats.totalIcms)} 
          color="#f59e0b" 
          onClick={() => setSelectedCard({
            label: "Total ICMS",
            value: formatCurrency(stats.totalIcms),
            icon: <TrendingUp size={32} />,
            color: "#f59e0b"
          })}
        />
        <StatCard 
          icon={<Package size={20} />} 
          label="Total IPI" 
          value={formatCurrency(stats.totalIpi)} 
          color="#ef4444" 
          onClick={() => setSelectedCard({
            label: "Total IPI",
            value: formatCurrency(stats.totalIpi),
            icon: <Package size={32} />,
            color: "#ef4444"
          })}
        />
        <StatCard 
          icon={<FileSpreadsheet size={20} />} 
          label="Qtd Registros" 
          value={String(stats.qtdNotas)} 
          color="#8b5cf6" 
          onClick={() => setSelectedCard({
            label: "Qtd Registros",
            value: String(stats.qtdNotas) + " registros",
            icon: <FileSpreadsheet size={32} />,
            color: "#8b5cf6"
          })}
        />
      </div>

      {/* Highlight Banner */}
      <div className="bg-gradient-to-r from-primary to-blue-600 rounded-xl p-5 md:p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-400/20 flex items-center justify-center flex-shrink-0">
            <Receipt size={24} className="text-amber-400" />
          </div>
          <div>
            <p className="text-xl md:text-2xl font-bold">
              {formatCurrency(stats.totalIcms + stats.totalIpi)} — Créditos Fiscais
            </p>
            <p className="text-sm text-white/70 mt-1">
              Total de ICMS + IPI {mesFiltro === 'todos' ? 'em todos os meses' : `em ${formatMes(mesFiltro)}`} • {stats.qtdNotas} registro{stats.qtdNotas !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Grid de Gráficos Otimizados (Estilo Dark Premium) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* 1. Valor por Centro de Custo */}
        <div className="bg-[#111c44] border border-[#1b2559] rounded-2xl p-6 text-white shadow-xl flex flex-col justify-between min-h-[420px]">
          <div>
            <h3 className="text-base font-bold text-white">Valor por centro de custo</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Distribuição do total de compras filtrado</p>
          </div>

          {donutData.length > 0 ? (
            <div className="flex-1 flex flex-col justify-center my-4">
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={75}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {donutData.map((_entry, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{ backgroundColor: '#1b2559', borderColor: '#233076', borderRadius: '8px', color: '#fff' }}
                      itemStyle={{ color: '#fff' }}
                      labelStyle={{ color: '#fff' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legenda Customizada */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 gap-y-3 mt-4 text-[11px] text-slate-300">
                {donutData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-1.5 min-w-0">
                    <span 
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                      style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                    />
                    <span className="truncate" title={`${entry.name} — ${entry.formattedValue}`}>
                      {entry.name} — <strong className="text-white">{entry.formattedValue}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Sem dados para exibir</div>
          )}
        </div>

        {/* 2. Top 10 Fornecedores */}
        <div className="bg-[#111c44] border border-[#1b2559] rounded-2xl p-6 text-white shadow-xl flex flex-col justify-between min-h-[420px]">
          <div>
            <h3 className="text-base font-bold text-white">Top 10 fornecedores</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Por valor total no período filtrado</p>
          </div>

          {barFornecedoresData.length > 0 ? (
            <div className="flex-1 mt-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barFornecedoresData} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222f67" horizontal={false} />
                  <XAxis 
                    type="number" 
                    tick={{ fill: '#a0aec0', fontSize: 9 }} 
                    tickFormatter={(v) => `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`}
                    stroke="#222f67"
                  />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    tick={{ fill: '#a0aec0', fontSize: 9 }} 
                    width={90}
                    stroke="#222f67"
                  />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ backgroundColor: '#1b2559', borderColor: '#233076', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Bar dataKey="Valor" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Sem dados para exibir</div>
          )}
        </div>

        {/* 3. Valor por Categoria de Despesa */}
        <div className="bg-[#111c44] border border-[#1b2559] rounded-2xl p-6 text-white shadow-xl flex flex-col justify-between min-h-[420px]">
          <div>
            <h3 className="text-base font-bold text-white">Valor por categoria de despesa</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Top 10 categorias (TIPO) + agrupamento de outras</p>
          </div>

          {despesasData.length > 0 ? (
            <div className="flex-1 mt-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={despesasData} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222f67" horizontal={false} />
                  <XAxis 
                    type="number" 
                    tick={{ fill: '#a0aec0', fontSize: 9 }} 
                    tickFormatter={(v) => `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`}
                    stroke="#222f67"
                  />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    tick={{ fill: '#a0aec0', fontSize: 9 }} 
                    width={90}
                    stroke="#222f67"
                  />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ backgroundColor: '#1b2559', borderColor: '#233076', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Bar dataKey="Valor" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Sem dados para exibir</div>
          )}
        </div>

        {/* 4. Evolução Diária das Compras */}
        <div className="bg-[#111c44] border border-[#1b2559] rounded-2xl p-6 text-white shadow-xl flex flex-col justify-between min-h-[420px]">
          <div>
            <h3 className="text-base font-bold text-white">Evolução diária das compras</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Valor total emitido por dia, no escopo filtrado</p>
          </div>

          {evolucaoData.length > 0 ? (
            <div className="flex-1 mt-4">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={evolucaoData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222f67" vertical={false} />
                  <XAxis 
                    dataKey="dateLabel" 
                    tick={{ fill: '#a0aec0', fontSize: 9 }} 
                    stroke="#222f67"
                  />
                  <YAxis 
                    tick={{ fill: '#a0aec0', fontSize: 9 }} 
                    tickFormatter={(v) => `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`}
                    stroke="#222f67"
                  />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ backgroundColor: '#1b2559', borderColor: '#233076', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="Valor" 
                    stroke="#fbbf24" 
                    strokeWidth={2}
                    dot={{ fill: '#fbbf24', r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Sem dados para exibir</div>
          )}
        </div>

      </div>

      {/* Livro de Apuração (Tema Dark para sincronizar com os Gráficos) */}
      {filteredLivroRows.length > 0 && (
        <div className="bg-[#111c44] border border-[#1b2559] rounded-2xl p-6 text-white shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-base font-bold text-white">
                Livro de apuração — ICMS {mesFiltro === 'todos' ? 'Total' : formatMes(mesFiltro)}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Saldo anterior, créditos de compras, débitos de vendas e lançamentos específicos do mês
              </p>
            </div>
            
            {/* Saldo Final */}
            <div className="text-left sm:text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Saldo Final {finalSaldo >= 0 ? '(Credor)' : '(Devedor)'}
              </p>
              <p className={`text-2xl font-black mt-0.5 ${finalSaldo >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {formatCurrency(finalSaldo)}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto bg-white rounded-xl border border-black/[0.04]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#111c44] z-10">
                <tr className="border-b border-[#1b2559]/30">
                  <th className="text-left py-3 px-3 font-semibold text-white text-xs uppercase tracking-wider whitespace-nowrap">Data</th>
                  <th className="text-left py-3 px-3 font-semibold text-white text-xs uppercase tracking-wider whitespace-nowrap">Descrição</th>
                  <th className="text-right py-3 px-3 font-semibold text-white text-xs uppercase tracking-wider whitespace-nowrap">Crédito</th>
                  <th className="text-right py-3 px-3 font-semibold text-white text-xs uppercase tracking-wider whitespace-nowrap">Débito</th>
                  <th className="text-right py-3 px-3 font-semibold text-white text-xs uppercase tracking-wider whitespace-nowrap">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filteredLivroRows.map((row, idx) => {
                  const isTotalRow = idx === filteredLivroRows.length - 1;
                  const formattedDate = row.data && row.data !== '—' 
                    ? row.data.split('-').reverse().join('/') 
                    : '—';

                  return (
                    <tr 
                      key={row.id ?? idx} 
                      className={`border-b border-black/[0.04] transition-colors ${
                        isTotalRow 
                          ? 'bg-slate-50 font-bold border-t border-black/[0.08]' 
                          : 'hover:bg-[#fafafa]'
                      }`}
                    >
                      <td className="py-3 px-3 text-[#757575] text-xs">{formattedDate}</td>
                      <td className={`py-3 px-3 ${isTotalRow ? 'text-[#212121] uppercase' : 'text-[#212121]'}`}>
                        {row.descricao}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-green-600">
                        {row.credito > 0 ? formatCurrency(row.credito) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-red-600">
                        {row.debito > 0 ? formatCurrency(row.debito) : '—'}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${row.saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(row.saldo)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabela completa */}
      <div className="bg-white rounded-xl border border-black/[0.08] shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#212121]">
            Registros Detalhados
            <span className="ml-2 text-xs font-normal text-[#757575]">
              ({filteredRows.length} registro{filteredRows.length !== 1 ? 's' : ''})
            </span>
          </h3>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-black/[0.08]">
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">Fornecedor</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">Tipo</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">Centro</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">NF-e</th>
                <th className="text-right py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">Valor</th>
                <th className="text-right py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">Vlr Cobrado</th>
                <th className="text-right py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">ICMS</th>
                <th className="text-right py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">IPI</th>
                <th className="text-left py-2.5 px-3 font-medium text-[#757575] text-xs uppercase whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, idx) => (
                <tr key={r.id ?? idx} className="border-b border-black/[0.04] hover:bg-[#fafafa] transition-colors">
                  <td className="py-2.5 px-3 text-[#212121] max-w-[200px] truncate">{r.fornecedor}</td>
                  <td className="py-2.5 px-3 text-[#212121] max-w-[150px] truncate">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700">
                      {r.tipo || '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[#757575] text-xs max-w-[150px] truncate">{r.centro}</td>
                  <td className="py-2.5 px-3 text-[#757575] text-xs">{r.nfe}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-[#212121]">{formatCurrency(r.valor)}</td>
                  <td className="py-2.5 px-3 text-right text-[#212121]">{formatCurrency(r.vlr_cobrado)}</td>
                  <td className="py-2.5 px-3 text-right font-medium" style={{ color: r.icms > 0 ? '#f59e0b' : '#757575' }}>
                    {r.icms > 0 ? formatCurrency(r.icms) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-medium" style={{ color: r.ipi > 0 ? '#ef4444' : '#757575' }}>
                    {r.ipi > 0 ? formatCurrency(r.ipi) : '—'}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f5f5f5] text-[#616161]">
                      {r.status || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3 max-h-[500px] overflow-y-auto">
          {filteredRows.map((r, idx) => (
            <div key={r.id ?? idx} className="p-3 bg-[#fafafa] rounded-lg border border-black/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#757575]">{r.nfe || '—'}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700">
                  {r.tipo || '—'}
                </span>
              </div>
              <p className="text-sm font-medium text-[#212121] truncate">{r.fornecedor}</p>
              <p className="text-xs text-[#757575] truncate">{r.centro}</p>
              <div className="flex items-center justify-between mt-2">
                <div className="space-x-2 text-[10px]">
                  {r.icms > 0 && <span className="text-amber-600">ICMS: {formatCurrency(r.icms)}</span>}
                  {r.ipi > 0 && <span className="text-red-500">IPI: {formatCurrency(r.ipi)}</span>}
                </div>
                <span className="text-sm font-semibold text-primary">{formatCurrency(r.valor)}</span>
              </div>
            </div>
          ))}
        </div>

        {filteredRows.length === 0 && (
          <div className="text-center py-8 text-[#757575] text-sm">
            Nenhum registro encontrado com os filtros aplicados.
          </div>
        )}
      </div>

      {/* Popup modal para detalhar o valor do card clicado */}
      {selectedCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200">
          {/* Overlay escuro */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-xs" 
            onClick={() => setSelectedCard(null)} 
          />
          {/* Caixa do modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-sm w-full mx-4 border border-black/[0.06] animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setSelectedCard(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
            >
              <X size={18} />
            </button>

            <div className="flex flex-col items-center text-center space-y-4">
              <div 
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto shadow-sm"
                style={{ backgroundColor: `${selectedCard.color}15`, color: selectedCard.color }}
              >
                {selectedCard.icon}
              </div>
              
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  {selectedCard.label}
                </p>
                <h3 className="text-2xl md:text-3xl font-extrabold text-[#212121] tracking-tight mt-1 select-all break-words leading-tight">
                  {selectedCard.value}
                </h3>
              </div>

              <div className="w-full pt-2">
                <button
                  onClick={() => setSelectedCard(null)}
                  className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 active:scale-98 transition-all"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── StatCard component ── */
function StatCard({ 
  icon, 
  label, 
  value, 
  color, 
  onClick 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  color: string;
  onClick?: () => void;
}) {
  // Ajuste dinâmico de tamanho de fonte baseado no comprimento do valor
  const valueFontSizeClass = value.length > 12 
    ? 'text-xs sm:text-sm xl:text-base' 
    : 'text-sm sm:text-base xl:text-lg';

  return (
    <div 
      onClick={onClick}
      className={`bg-white rounded-xl border border-black/[0.08] shadow-sm p-4 hover:shadow-md hover:border-black/[0.15] transition-all duration-200 ${
        onClick ? 'cursor-pointer active:scale-98' : ''
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div 
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" 
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`${valueFontSizeClass} font-bold text-[#212121] truncate`} title={value}>
            {value}
          </p>
          <p className="text-[10px] text-[#757575] uppercase tracking-wider font-semibold truncate" title={label}>
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}
