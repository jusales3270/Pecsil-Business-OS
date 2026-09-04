"use client";

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Users, Car, CalendarDays, Search, Plus, Trash2, Edit3,
  LogIn, FileText, MapPin, Clock,
  Filter, Download, Truck, ChevronDown, ChevronRight, ChevronLeft,
  Phone, CreditCard, UserCircle, X, Check, AlertTriangle, Menu, BarChart3,
  CheckCircle2, LogOut, RefreshCw, Settings, Package
} from 'lucide-react';
import './portaria.css';
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { ScrollArea, ScrollBar } from "./components/ui/scroll-area";
import { Badge } from "./components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Label } from "./components/ui/label";
import { Separator } from "./components/ui/separator";
import type { Visita, ControleVeiculo, RegistroTerceiro, Recebido } from "./types";
import { RESPONSAVEIS, MOTORISTAS, DESCRICOES, VEICULOS, TERCEIROS, DESTINATARIOS } from "./types";
import { CameraCapture } from "./components/CameraCapture";
import { extractFaceDescriptor, base64ToImage } from "./lib/faceApi";
import { buscarVisitantePorFace, buscarVisitantesPorNome, salvarVisitante, fetchVisitas, fetchFotoVisita, fetchFrota, inserirVisita, atualizarVisitaDb, encerrarVisitaDb, excluirVisitaDb, inserirVeiculo, atualizarVeiculoDb, excluirVeiculoDb, fetchTerceiros, inserirTerceiro, encerrarTerceiroDb, excluirTerceiroDb, fetchRecebidos, fetchFotoRecebido, inserirRecebido, excluirRecebidoDb } from "./lib/supabase"; import { useAuth } from "./contexts/AuthContext";
import { Login } from "./pages/Login";
import { GerenciarUsuarios } from "./pages/GerenciarUsuarios";
import { Configuracoes } from "./pages/Configuracoes";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { OfflineBanner } from "./components/OfflineBanner";
import { enqueueOperation } from "./lib/offlineQueue";
import type { IdMapping } from "./lib/offlineQueue";

type PaginaAtiva = 'dashboard' | 'visitas' | 'terceiros' | 'recebidos' | 'veiculos' | 'usuarios' | 'configuracoes';


const formatarMoeda = (valor: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
};

const extrairValorNumericoMoeda = (texto: string) => {
  const apenasNumeros = texto.replace(/\D/g, '');
  return Number(apenasNumeros) / 100;
};

function App({ onExit }: { onExit?: () => void } = {}) {
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [veiculos, setVeiculos] = useState<ControleVeiculo[]>([]);
  const [terceiros, setTerceiros] = useState<RegistroTerceiro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const { user, perfil, loading: authLoading, signOut } = useAuth();
  const [paginaAtiva, setPaginaAtiva] = useState<PaginaAtiva>('dashboard');
  const [busca, setBusca] = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('todos');
  const [filtroDescricao, setFiltroDescricao] = useState('todos');
  const [filtroData, setFiltroData] = useState('');
  const [modalVisitaAberto, setModalVisitaAberto] = useState(false);
  const [modalVeiculoAberto, setModalVeiculoAberto] = useState(false);
  const [visitaEditando, setVisitaEditando] = useState<Visita | null>(null);
  const [veiculoEditando, setVeiculoEditando] = useState<ControleVeiculo | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [modalNFsAberto, setModalNFsAberto] = useState(false);
  const [filtroPeriodoNF, setFiltroPeriodoNF] = useState<'dia' | 'semana' | 'mes' | 'todos'>('dia');
  const [modalKPIAtivo, setModalKPIAtivo] = useState<'visitas_hoje' | 'em_andamento' | 'entregas' | 'tecnicas' | null>(null);
  const [filtroPeriodoKPI, setFiltroPeriodoKPI] = useState<'dia' | 'semana' | 'mes' | 'todos'>('todos');
  const [modalKmFrotaAberto, setModalKmFrotaAberto] = useState(false);
  const [filtroKmFrota, setFiltroKmFrota] = useState<'dia' | 'semana' | 'mes'>('dia');
  const [veiculoExpandido, setVeiculoExpandido] = useState<string | null>(null);

  // States para Recebidos
  const [recebidos, setRecebidos] = useState<Recebido[]>([]);
  const [modalRecebidoAberto, setModalRecebidoAberto] = useState(false);
  const [recebidoDetalhes, setRecebidoDetalhes] = useState<Recebido | null>(null);
  const [buscaRecebido, setBuscaRecebido] = useState('');
  const [filtroDataRecebido, setFiltroDataRecebido] = useState('');
  const [cameraRecebidoOpen, setCameraRecebidoOpen] = useState(false);
  const [formRecebido, setFormRecebido] = useState<Partial<Recebido>>({
    data: '',
    horaRegistro: '',
    remetente: '',
    destinatario: '',
    descricao: '',
    fotoBase64: undefined,
  });

  // ── Hook de conectividade + fila offline ──────────────────────────────────
  const handleIdMappings = useCallback((mappings: IdMapping[]) => {
    mappings.forEach(({ tempId, realId }) => {
      setVisitas(prev => prev.map(v => v.id === tempId ? { ...v, id: realId } : v));
      setVeiculos(prev => prev.map(v => v.id === tempId ? { ...v, id: realId } : v));
      setTerceiros(prev => prev.map(t => t.id === tempId ? { ...t, id: realId } : t));
      setRecebidos(prev => prev.map(e => e.id === tempId ? { ...e, id: realId } : e));
    });
  }, []);

  const { isOnline, pendingCount, isSyncing, justSynced } = useOnlineStatus(handleIdMappings);

  const abrirModalKPI = (tipo: 'visitas_hoje' | 'em_andamento' | 'entregas' | 'tecnicas') => {
    setModalKPIAtivo(tipo);
    if (tipo === 'visitas_hoje') {
      setFiltroPeriodoKPI('dia');
    } else {
      setFiltroPeriodoKPI('todos');
    }
  };

  useEffect(() => {
    if (!user) return;
    async function carregar() {
      setCarregando(true);
      try {
        const [v, f, t, e] = await Promise.all([fetchVisitas(), fetchFrota(), fetchTerceiros(), fetchRecebidos()]);
        setVisitas(v);
        setVeiculos(f);
        setTerceiros(t as RegistroTerceiro[]);
        setRecebidos(e);
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
      } finally {
        setCarregando(false);
      }
    }
    carregar();
  }, [user]);

  useEffect(() => {
    if (!user || !isOnline) return;
    const interval = setInterval(async () => {
      try {
        const [v, f, t, e] = await Promise.all([fetchVisitas(), fetchFrota(), fetchTerceiros(), fetchRecebidos()]);
        setVisitas(v);
        setVeiculos(f);
        setTerceiros(t as RegistroTerceiro[]);
        setRecebidos(e);
        console.log('[Sync] Dados recarregados do Supabase');
      } catch (err) {
        console.error('[Sync] Erro ao recarregar dados:', err);
      }
    }, 5 * 60 * 1000); // 5 minutos
    return () => clearInterval(interval);
  }, [user, isOnline]);

  // States para reconhecimento facial
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isExtractingFace, setIsExtractingFace] = useState(false);
  const [identificacaoModo, setIdentificacaoModo] = useState(false);
  const [visitaDetalhes, setVisitaDetalhes] = useState<Visita | null>(null);
  const [fotoDetalhe, setFotoDetalhe] = useState<string | undefined>(undefined);
  const [carregandoFoto, setCarregandoFoto] = useState(false);

  useEffect(() => {
    if (!visitaDetalhes) { setFotoDetalhe(undefined); return; }
    if (visitaDetalhes.fotoBase64) { setFotoDetalhe(visitaDetalhes.fotoBase64); return; }
    if (visitaDetalhes.id.startsWith('temp-')) { setFotoDetalhe(undefined); return; }
    let ativo = true;
    setCarregandoFoto(true);
    setFotoDetalhe(undefined);
    fetchFotoVisita(visitaDetalhes.id)
      .then((foto) => { if (ativo) setFotoDetalhe(foto); })
      .finally(() => { if (ativo) setCarregandoFoto(false); });
    return () => { ativo = false; };
  }, [visitaDetalhes]);

  const [fotoRecebidoDetalhe, setFotoRecebidoDetalhe] = useState<string | undefined>(undefined);
  const [carregandoFotoRecebido, setCarregandoFotoRecebido] = useState(false);

  useEffect(() => {
    if (!recebidoDetalhes) { setFotoRecebidoDetalhe(undefined); return; }
    if (recebidoDetalhes.fotoBase64) { setFotoRecebidoDetalhe(recebidoDetalhes.fotoBase64); return; }
    if (recebidoDetalhes.id.startsWith('temp-')) { setFotoRecebidoDetalhe(undefined); return; }
    let ativo = true;
    setCarregandoFotoRecebido(true);
    setFotoRecebidoDetalhe(undefined);
    fetchFotoRecebido(recebidoDetalhes.id)
      .then((foto) => { if (ativo) setFotoRecebidoDetalhe(foto); })
      .finally(() => { if (ativo) setCarregandoFotoRecebido(false); });
    return () => { ativo = false; };
  }, [recebidoDetalhes]);

  // States para autocomplete de visitantes
  const [sugestoesVisitantes, setSugestoesVisitantes] = useState<any[]>([]);
  const [indiceSugestaoAtiva, setIndiceSugestaoAtiva] = useState<number>(-1);

  const handleInputChangeVisitante = async (valor: string) => {
    if (visitaEditando) {
      setVisitaEditando({ ...visitaEditando, visitante: valor });
    } else {
      setFormVisita({ ...formVisita, visitante: valor });
    }

    if (valor.trim().length >= 2) {
      try {
        const resultados = await buscarVisitantesPorNome(valor);
        setSugestoesVisitantes(resultados);
        setIndiceSugestaoAtiva(-1);
      } catch (err) {
        console.error('Erro ao buscar sugestões de visitantes:', err);
      }
    } else {
      setSugestoesVisitantes([]);
      setIndiceSugestaoAtiva(-1);
    }
  };

  const selecionarSugestaoVisitante = (sugestao: any) => {
    if (visitaEditando) {
      setVisitaEditando({
        ...visitaEditando,
        visitante: sugestao.nome,
        empresa: sugestao.empresa || '',
        documento: sugestao.documento || '',
        contato: sugestao.contato || '',
      });
    } else {
      setFormVisita({
        ...formVisita,
        visitante: sugestao.nome,
        empresa: sugestao.empresa || '',
        documento: sugestao.documento || '',
        contato: sugestao.contato || '',
      });
    }
    setSugestoesVisitantes([]);
    setIndiceSugestaoAtiva(-1);
  };

  const handleKeyDownVisitante = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (sugestoesVisitantes.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceSugestaoAtiva((prev) =>
        prev < sugestoesVisitantes.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceSugestaoAtiva((prev) =>
        prev > 0 ? prev - 1 : sugestoesVisitantes.length - 1
      );
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      if (indiceSugestaoAtiva >= 0 && indiceSugestaoAtiva < sugestoesVisitantes.length) {
        e.preventDefault();
        selecionarSugestaoVisitante(sugestoesVisitantes[indiceSugestaoAtiva]);
      }
    } else if (e.key === 'Enter') {
      if (indiceSugestaoAtiva >= 0 && indiceSugestaoAtiva < sugestoesVisitantes.length) {
        e.preventDefault();
        selecionarSugestaoVisitante(sugestoesVisitantes[indiceSugestaoAtiva]);
      }
    } else if (e.key === 'Escape') {
      setSugestoesVisitantes([]);
      setIndiceSugestaoAtiva(-1);
    }
  };

  // States — Terceiros
  const [modalTerceiroAberto, setModalTerceiroAberto] = useState(false);
  const [buscaTerceiro, setBuscaTerceiro] = useState('');
  const [filtroDataTerceiro, setFiltroDataTerceiro] = useState('');
  const [formTerceiro, setFormTerceiro] = useState({ nome: '' });

  const terceirosAtivos = terceiros.filter(t => !t.horaSaida);
  const terceirosFiltrados = terceiros.filter(t =>
    (buscaTerceiro === '' || t.nome.toLowerCase().includes(buscaTerceiro.toLowerCase())) &&
    (filtroDataTerceiro === '' || t.data === filtroDataTerceiro)
  );

  const formatarTempo = (minutos: number) => {
    if (!minutos || minutos <= 0) return '-';
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return `${h}h${m.toString().padStart(2, '0')}`;
  };

  const FUSO = 'America/Sao_Paulo';
  const dataSP = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });
  const horaSP = () => {
    const d = new Date();
    const hh = d.toLocaleString('pt-BR', { hour: '2-digit', hour12: false, timeZone: FUSO }).padStart(2, '0');
    const mm = d.toLocaleString('pt-BR', { minute: '2-digit', timeZone: FUSO }).padStart(2, '0');
    return `${hh}:${mm}`;
  };
  const isoSP = () => {
    const d = new Date();
    const data = d.toLocaleDateString('en-CA', { timeZone: FUSO });
    const hora = d.toLocaleTimeString('en-GB', { hour12: false, timeZone: FUSO });
    return `${data}T${hora}`;
  };

  // Extrai HH:MM diretamente da string ISO que já está no fuso de São Paulo.
  // NÃO usar new Date(iso) aqui pois causa reconversão dupla de timezone.
  const formatarHoraISO = (iso?: string) => {
    if (!iso) return '-';
    // A string vem no formato "YYYY-MM-DDTHH:MM:SS" já em horário de SP
    const match = iso.match(/T(\d{2}):(\d{2})/);
    if (match) return `${match[1]}:${match[2]}`;
    // Fallback: tenta extrair HH:MM de qualquer formato
    const timePart = iso.includes('T') ? iso.split('T')[1] : iso;
    const parts = timePart?.split(':');
    if (parts && parts.length >= 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    return iso;
  };

  // Form states - Visitas
  const [formVisita, setFormVisita] = useState<Partial<Visita>>({
    data: dataSP(),
    empresa: '',
    visitante: '',
    horarioEntrada: '',
    horarioSaida: '',
    documento: '',
    contato: '',
    responsavel: '',
    placaVeiculo: '',
    notasFiscais: [{ numero: '', valor: 0 }],
    descricao: 'Visita',
  });

  // Form states - Veiculos
  const [formVeiculo, setFormVeiculo] = useState<Partial<ControleVeiculo>>({
    data: dataSP(),
    motorista: '',
    veiculo: '',
    horarioSaida: '',
    dataRetorno: '',
    horarioRetorno: '',
    kmRodados: 0,
    kmSaida: 0,
    kmEntrada: 0,
    destino: '',
    notasFiscais: [{ numero: '', valor: 0 }],
  });

  const visitasFiltradas = useMemo(() => {
    return visitas.filter((v) => {
      const matchBusca = busca === '' ||
        v.empresa.toLowerCase().includes(busca.toLowerCase()) ||
        v.visitante.toLowerCase().includes(busca.toLowerCase()) ||
        v.documento.toLowerCase().includes(busca.toLowerCase()) ||
        v.placaVeiculo.toLowerCase().includes(busca.toLowerCase()) ||
        v.responsavel.toLowerCase().includes(busca.toLowerCase());
      const matchResponsavel = filtroResponsavel === 'todos' || v.responsavel === filtroResponsavel;
      const matchDescricao = filtroDescricao === 'todos' || v.descricao === filtroDescricao;
      const matchData = filtroData === '' || v.data === filtroData;
      return matchBusca && matchResponsavel && matchDescricao && matchData;
    });
  }, [visitas, busca, filtroResponsavel, filtroDescricao, filtroData]);

  const veiculosFiltrados = useMemo(() => {
    return veiculos.filter((v) => {
      const matchBusca = busca === '' ||
        v.veiculo.toLowerCase().includes(busca.toLowerCase()) ||
        v.destino.toLowerCase().includes(busca.toLowerCase()) ||
        v.motorista.toLowerCase().includes(busca.toLowerCase());
      const matchData = filtroData === '' || v.data === filtroData;
      return matchBusca && matchData;
    });
  }, [veiculos, busca, filtroData]);

  const recebidosFiltrados = useMemo(() => {
    return recebidos.filter((e) => {
      const matchBusca = buscaRecebido === '' ||
        e.remetente.toLowerCase().includes(buscaRecebido.toLowerCase()) ||
        e.destinatario.toLowerCase().includes(buscaRecebido.toLowerCase()) ||
        e.descricao.toLowerCase().includes(buscaRecebido.toLowerCase());
      const matchData = filtroDataRecebido === '' || e.data === filtroDataRecebido;
      return matchBusca && matchData;
    });
  }, [recebidos, buscaRecebido, filtroDataRecebido]);

  const hoje = dataSP();
  const visitasHoje = visitas.filter((v) => v.data === hoje);
  const totalVisitasHoje = visitasHoje.length;
  const visitasEmAndamento = visitasHoje.filter((v) => v.horarioEntrada && !v.horarioSaida).length;
  const totalEntregas = visitas.filter((v) => v.descricao === 'Entrega').length;
  const totalVisitasTecnicas = visitas.filter((v) => v.descricao === 'Visita técnica').length;
  const totalVisitasGerais = visitas.filter((v) => v.descricao === 'Visita').length;

  // Total de NFs de visitas no dia (somente visitas, sem frota)
  const totalNFsHoje = visitasHoje.reduce((acc, v) => {
    if (!v.notasFiscais || v.notasFiscais.length === 0) return acc;
    return acc + v.notasFiscais.reduce((sum, nf) => sum + (nf.valor || 0), 0);
  }, 0);

  const isAdmin = perfil?.role === 'super_admin' || perfil?.role === 'admin';

  // Obter todas as NFs de entrada das visitas com número e valor válidos
  const todasNFsVisitas = useMemo(() => {
    const list: Array<{
      id: string;
      data: string;
      empresa: string;
      visitante: string;
      responsavel: string;
      descricao: string;
      numero: string;
      valor: number;
    }> = [];

    visitas.forEach((v) => {
      if (v.notasFiscais && v.notasFiscais.length > 0) {
        v.notasFiscais.forEach((nf) => {
          if (nf.numero && nf.numero.trim() !== '') {
            list.push({
              id: v.id,
              data: v.data,
              empresa: v.empresa,
              visitante: v.visitante,
              responsavel: v.responsavel,
              descricao: v.descricao,
              numero: nf.numero,
              valor: nf.valor || 0,
            });
          }
        });
      }
    });
    return list;
  }, [visitas]);

  // Filtrar as NFs com base no período selecionado (dia, semana, mês, todos)
  const nfsFiltradas = useMemo(() => {
    const hojeStr = hoje;
    const parseDate = (dStr: string) => new Date(dStr + 'T12:00:00');

    return todasNFsVisitas.filter((nf) => {
      if (filtroPeriodoNF === 'dia') {
        return nf.data === hojeStr;
      }
      if (filtroPeriodoNF === 'semana') {
        const date = parseDate(nf.data);
        const now = new Date();

        // Início da semana corrente (Domingo)
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return date >= startOfWeek && date <= endOfWeek;
      }
      if (filtroPeriodoNF === 'mes') {
        const date = parseDate(nf.data);
        const now = new Date();
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }
      return true; // 'todos'
    });
  }, [todasNFsVisitas, filtroPeriodoNF, hoje]);

  const totalValorNFsFiltradas = useMemo(() => {
    return nfsFiltradas.reduce((sum, nf) => sum + nf.valor, 0);
  }, [nfsFiltradas]);

  const totalQtdNFsFiltradas = nfsFiltradas.length;

  const visitasKPILimitadas = useMemo(() => {
    if (!modalKPIAtivo) return [];

    const hojeStr = hoje;
    const parseDate = (dStr: string) => new Date(dStr + 'T12:00:00');

    let filtradas = visitas;
    if (modalKPIAtivo === 'em_andamento') {
      filtradas = visitas.filter(v => v.horarioEntrada && !v.horarioSaida);
    } else if (modalKPIAtivo === 'entregas') {
      filtradas = visitas.filter(v => v.descricao === 'Entrega');
    } else if (modalKPIAtivo === 'tecnicas') {
      filtradas = visitas.filter(v => v.descricao === 'Visita técnica');
    }

    return filtradas.filter((v) => {
      if (filtroPeriodoKPI === 'dia') {
        return v.data === hojeStr;
      }
      if (filtroPeriodoKPI === 'semana') {
        const date = parseDate(v.data);
        const now = new Date();

        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return date >= startOfWeek && date <= endOfWeek;
      }
      if (filtroPeriodoKPI === 'mes') {
        const date = parseDate(v.data);
        const now = new Date();
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }
      return true; // 'todos'
    });
  }, [visitas, modalKPIAtivo, filtroPeriodoKPI, hoje]);

  const totalQtdKPIFiltrados = visitasKPILimitadas.length;

  // Stats de Frota
  const frotaHoje = veiculos.filter((v) => v.data === hoje);
  const totalFrotaHoje = frotaHoje.length;
  const frotaEmTransito = veiculos.filter((v) => v.horarioSaida && !v.horarioRetorno).length;
  const totalKmRodados = veiculos.reduce((acc, v) => acc + Math.max(0, v.kmRodados || 0), 0);
  const totalRegistrosFrota = veiculos.length;

  // Helper: filtra veículos por período
  const filtrarPorPeriodo = (lista: ControleVeiculo[], periodo: 'dia' | 'semana' | 'mes') => {
    const parseDate = (dStr: string) => new Date(dStr + 'T12:00:00');
    const now = new Date();
    return lista.filter(v => {
      if (periodo === 'dia') return v.data === hoje;
      if (periodo === 'semana') {
        const date = parseDate(v.data);
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        return date >= startOfWeek && date <= endOfWeek;
      }
      if (periodo === 'mes') {
        const date = parseDate(v.data);
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }
      return true;
    });
  };

  // KM agrupado por veículo para o modal
  const kmPorVeiculo = useMemo(() => {
    const filtrados = filtrarPorPeriodo(veiculos, filtroKmFrota);
    const mapa: Record<string, { veiculo: string; kmTotal: number; motoristas: string[]; registros: ControleVeiculo[] }> = {};
    filtrados.forEach(v => {
      const km = Math.max(0, v.kmRodados || 0);
      if (!mapa[v.veiculo]) {
        mapa[v.veiculo] = { veiculo: v.veiculo, kmTotal: 0, motoristas: [], registros: [] };
      }
      mapa[v.veiculo].kmTotal += km;
      if (!mapa[v.veiculo].motoristas.includes(v.motorista)) {
        mapa[v.veiculo].motoristas.push(v.motorista);
      }
      mapa[v.veiculo].registros.push(v);
    });
    return Object.values(mapa).sort((a, b) => b.kmTotal - a.kmTotal);
  }, [veiculos, filtroKmFrota, hoje]);

  const totalKmFiltrado = useMemo(() => kmPorVeiculo.reduce((acc, v) => acc + v.kmTotal, 0), [kmPorVeiculo]);

  const handleFotoCapture = async (base64Image: string) => {
    setIsExtractingFace(true);
    setCameraOpen(false);
    try {
      const img = await base64ToImage(base64Image);
      const descriptor = await extractFaceDescriptor(img);

      if (identificacaoModo && descriptor) {
        // Modo identificação: procurar na base via Supabase (RPC match_visitantes)
        const melhorMatch = await buscarVisitantePorFace(descriptor);

        if (melhorMatch) {
          // Auto preencher o formulário
          setFormVisita(prev => ({
            ...prev,
            visitante: melhorMatch.nome,
            empresa: melhorMatch.empresa,
            documento: melhorMatch.documento,
            contato: melhorMatch.contato,
            fotoBase64: base64Image,
            faceDescriptor: descriptor
          }));
          alert(`Visitante identificado: ${melhorMatch.nome}. Similaridade: ${(melhorMatch.similarity * 100).toFixed(1)}%`);
        } else {
          alert('Visitante não encontrado na base de dados. Por favor, preencha o cadastro.');
          setFormVisita(prev => ({ ...prev, fotoBase64: base64Image, faceDescriptor: descriptor }));
        }
      } else {
        // Modo cadastro normal
        setFormVisita(prev => ({ ...prev, fotoBase64: base64Image, faceDescriptor: descriptor || undefined }));
        if (!descriptor) {
          alert('Aviso: Rosto não detectado claramente na foto. A foto será salva, mas não servirá para identificação automática no futuro.');
        }
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao processar a foto.');
    } finally {
      setIsExtractingFace(false);
      setIdentificacaoModo(false);
    }
  };

  const adicionarVisita = async () => {
    if (!formVisita.empresa || !formVisita.visitante || !formVisita.responsavel) return;

    // Otimista: fecha o modal imediatamente com um id temporário
    const tempId = `temp-${Date.now()}`;
    const novaVisita: Visita = {
      id: tempId,
      data: formVisita.data || hoje,
      empresa: formVisita.empresa || '',
      visitante: formVisita.visitante || '',
      horarioEntrada: formVisita.horarioEntrada || '',
      horarioSaida: formVisita.horarioSaida || '',
      documento: formVisita.documento || '',
      contato: formVisita.contato || '',
      responsavel: formVisita.responsavel || '',
      placaVeiculo: formVisita.placaVeiculo || '-',
      notasFiscais: formVisita.notasFiscais || [{ numero: '', valor: 0 }],
      descricao: formVisita.descricao || 'Visita',
      fotoBase64: formVisita.fotoBase64,
      faceDescriptor: formVisita.faceDescriptor,
    };

    setVisitas(prev => [novaVisita, ...prev]);
    setModalVisitaAberto(false);
    const faceDesc = formVisita.faceDescriptor;
    resetFormVisita();

    // Payload serializável (sem Float32Array) para a fila offline
    const payloadVisita = {
      data: novaVisita.data, empresa: novaVisita.empresa, visitante: novaVisita.visitante,
      horarioEntrada: novaVisita.horarioEntrada, horarioSaida: novaVisita.horarioSaida,
      documento: novaVisita.documento, contato: novaVisita.contato,
      responsavel: novaVisita.responsavel, placaVeiculo: novaVisita.placaVeiculo,
      notasFiscais: novaVisita.notasFiscais, descricao: novaVisita.descricao,
      fotoBase64: novaVisita.fotoBase64,
    };
    const payloadVisitante = {
      nome: novaVisita.visitante, empresa: novaVisita.empresa,
      documento: novaVisita.documento, contato: novaVisita.contato,
      faceDescriptor: faceDesc ? Array.from(faceDesc) : undefined,
    };

    if (isOnline) {
      try {
        const realId = await inserirVisita(novaVisita);
        if (realId) {
          setVisitas(prev => prev.map(v => v.id === tempId ? { ...v, id: realId } : v));
        } else {
          // Supabase retornou null — enfileira para retry
          enqueueOperation('insert_visita', payloadVisita, tempId);
        }
      } catch {
        enqueueOperation('insert_visita', payloadVisita, tempId);
      }
      // Salvar visitante (best-effort)
      salvarVisitante(
        novaVisita.visitante, novaVisita.empresa,
        novaVisita.documento, novaVisita.contato,
        faceDesc || undefined
      ).catch(() => enqueueOperation('save_visitante', payloadVisitante));
    } else {
      // Offline — enfileira tudo
      enqueueOperation('insert_visita', payloadVisita, tempId);
      enqueueOperation('save_visitante', payloadVisitante);
    }
  };

  const atualizarVisita = () => {
    if (!visitaEditando) return;
    setVisitas(visitas.map((v) => (v.id === visitaEditando.id ? visitaEditando : v)));
    setVisitaEditando(null);
    setModalVisitaAberto(false);

    const payloadVisita = {
      id: visitaEditando.id, data: visitaEditando.data, empresa: visitaEditando.empresa,
      visitante: visitaEditando.visitante, horarioEntrada: visitaEditando.horarioEntrada,
      documento: visitaEditando.documento, contato: visitaEditando.contato,
      responsavel: visitaEditando.responsavel, placaVeiculo: visitaEditando.placaVeiculo,
      notasFiscais: visitaEditando.notasFiscais, descricao: visitaEditando.descricao,
    };
    const payloadVisitante = {
      nome: visitaEditando.visitante, empresa: visitaEditando.empresa,
      documento: visitaEditando.documento, contato: visitaEditando.contato,
      faceDescriptor: visitaEditando.faceDescriptor ? Array.from(visitaEditando.faceDescriptor) : undefined,
    };

    if (isOnline) {
      atualizarVisitaDb(visitaEditando).catch(() => enqueueOperation('update_visita', payloadVisita));
      salvarVisitante(
        visitaEditando.visitante, visitaEditando.empresa,
        visitaEditando.documento, visitaEditando.contato,
        visitaEditando.faceDescriptor || undefined
      ).catch(() => enqueueOperation('save_visitante', payloadVisitante));
    } else {
      enqueueOperation('update_visita', payloadVisita);
      enqueueOperation('save_visitante', payloadVisitante);
    }
  };

  const excluirVisita = (id: string) => {
    setVisitas(visitas.filter((v) => v.id !== id));
    if (isOnline) {
      excluirVisitaDb(id).catch(() => enqueueOperation('delete_visita', { id }));
    } else {
      enqueueOperation('delete_visita', { id });
    }
  };

  const encerrarVisita = (id: string) => {
    const horarioSaida = horaSP();
    setVisitas(visitas.map((v) =>
      v.id === id ? { ...v, horarioSaida } : v
    ));
    if (isOnline) {
      encerrarVisitaDb(id, horarioSaida).catch(() => enqueueOperation('encerrar_visita', { id, horarioSaida }));
    } else {
      enqueueOperation('encerrar_visita', { id, horarioSaida });
    }
  };

  const resetFormVisita = () => {
    setFormVisita({
      data: hoje,
      empresa: '',
      visitante: '',
      horarioEntrada: '',
      horarioSaida: '',
      documento: '',
      contato: '',
      responsavel: '',
      placaVeiculo: '',
      notasFiscais: [{ numero: '', valor: 0 }],
      descricao: 'Visita',
    });
    setVisitaEditando(null);
  };

  const adicionarVeiculo = async () => {
    if (!formVeiculo.veiculo || !formVeiculo.motorista || !formVeiculo.destino) {
      alert('Preencha os campos obrigatórios: Motorista, Veículo e Destino.');
      return;
    }
    const kmSaidaNum = Number(formVeiculo.kmSaida) || 0;
    const kmEntradaNum = Number(formVeiculo.kmEntrada) || 0;
    if (kmEntradaNum > 0 && kmSaidaNum > 0 && kmEntradaNum < kmSaidaNum) {
      alert('KM de Entrada (retorno) não pode ser menor que o KM de Saída. Verifique os valores.');
      return;
    }
    const tempId = `temp-${Date.now()}`;
    const kmRodadosCalc = Math.max(0, kmEntradaNum - kmSaidaNum);
    const novoVeiculo: ControleVeiculo = {
      id: tempId,
      data: formVeiculo.data || hoje,
      motorista: formVeiculo.motorista || '',
      veiculo: formVeiculo.veiculo || '',
      horarioSaida: formVeiculo.horarioSaida || '',
      dataRetorno: formVeiculo.dataRetorno || '',
      horarioRetorno: formVeiculo.horarioRetorno || '',
      kmSaida: kmSaidaNum,
      kmEntrada: kmEntradaNum,
      kmRodados: kmRodadosCalc,
      destino: formVeiculo.destino || '',
      notasFiscais: formVeiculo.notasFiscais || [{ numero: '', valor: 0 }],
    };

    // Otimista: fecha o modal imediatamente
    setVeiculos(prev => [novoVeiculo, ...prev]);
    setModalVeiculoAberto(false);
    resetFormVeiculo();

    const payloadVeiculo = {
      data: novoVeiculo.data, motorista: novoVeiculo.motorista, veiculo: novoVeiculo.veiculo,
      horarioSaida: novoVeiculo.horarioSaida, dataRetorno: novoVeiculo.dataRetorno,
      horarioRetorno: novoVeiculo.horarioRetorno, kmRodados: novoVeiculo.kmRodados,
      kmSaida: novoVeiculo.kmSaida, kmEntrada: novoVeiculo.kmEntrada,
      destino: novoVeiculo.destino, notasFiscais: novoVeiculo.notasFiscais,
    };

    if (isOnline) {
      try {
        const realId = await inserirVeiculo(novoVeiculo);
        if (realId) {
          setVeiculos(prev => prev.map(v => v.id === tempId ? { ...v, id: realId } : v));
        } else {
          enqueueOperation('insert_veiculo', payloadVeiculo, tempId);
        }
      } catch {
        enqueueOperation('insert_veiculo', payloadVeiculo, tempId);
      }
    } else {
      enqueueOperation('insert_veiculo', payloadVeiculo, tempId);
    }
  };

  const atualizarVeiculo = () => {
    if (!veiculoEditando) return;
    const kmSaidaNum = Number(veiculoEditando.kmSaida) || 0;
    const kmEntradaNum = Number(veiculoEditando.kmEntrada) || 0;
    if (kmEntradaNum > 0 && kmSaidaNum > 0 && kmEntradaNum < kmSaidaNum) {
      alert('KM de Entrada (retorno) não pode ser menor que o KM de Saída. Verifique os valores.');
      return;
    }
    const veiculoCorrigido = { ...veiculoEditando, kmRodados: Math.max(0, kmEntradaNum - kmSaidaNum) };
    setVeiculos(veiculos.map((v) => (v.id === veiculoEditando.id ? veiculoCorrigido : v)));
    setVeiculoEditando(null);
    setModalVeiculoAberto(false);

    const payloadVeiculo = {
      id: veiculoCorrigido.id, data: veiculoCorrigido.data, motorista: veiculoCorrigido.motorista,
      veiculo: veiculoCorrigido.veiculo, horarioSaida: veiculoCorrigido.horarioSaida,
      dataRetorno: veiculoCorrigido.dataRetorno, horarioRetorno: veiculoCorrigido.horarioRetorno,
      kmRodados: veiculoCorrigido.kmRodados, kmSaida: veiculoCorrigido.kmSaida,
      kmEntrada: veiculoCorrigido.kmEntrada, destino: veiculoCorrigido.destino,
      notasFiscais: veiculoCorrigido.notasFiscais,
    };

    if (isOnline) {
      atualizarVeiculoDb(veiculoCorrigido).catch(() => enqueueOperation('update_veiculo', payloadVeiculo));
    } else {
      enqueueOperation('update_veiculo', payloadVeiculo);
    }
  };

  const excluirVeiculo = (id: string) => {
    setVeiculos(veiculos.filter((v) => v.id !== id));
    if (isOnline) {
      excluirVeiculoDb(id).catch(() => enqueueOperation('delete_veiculo', { id }));
    } else {
      enqueueOperation('delete_veiculo', { id });
    }
  };

  const abrirEdicaoVeiculo = (veiculo: ControleVeiculo) => {
    setVeiculoEditando(veiculo);
    setModalVeiculoAberto(true);
  };

  const abrirEdicaoVisita = (visita: Visita) => {
    setVisitaEditando(visita);
    setModalVisitaAberto(true);
  };

  const resetFormVeiculo = () => {
    setFormVeiculo({
      data: hoje,
      motorista: '',
      veiculo: '',
      horarioSaida: '',
      dataRetorno: '',
      horarioRetorno: '',
      kmRodados: 0,
      kmSaida: 0,
      kmEntrada: 0,
      destino: '',
      notasFiscais: [{ numero: '', valor: 0 }],
    });
    setVeiculoEditando(null);
  };

  // ── Helpers múltiplas NFs ─────────────────────────────────────────────────
  type NFItem = { numero: string; valor: number };

  const getNFsVisita = (): NFItem[] =>
    (visitaEditando ? visitaEditando.notasFiscais : formVisita.notasFiscais) || [{ numero: '', valor: 0 }];

  const setNFsVisita = (nfs: NFItem[]) => {
    if (visitaEditando) setVisitaEditando({ ...visitaEditando, notasFiscais: nfs });
    else setFormVisita({ ...formVisita, notasFiscais: nfs });
  };

  const adicionarNFVisita = () => setNFsVisita([...getNFsVisita(), { numero: '', valor: 0 }]);
  const removerNFVisita = (idx: number) => setNFsVisita(getNFsVisita().filter((_, i) => i !== idx));
  const atualizarNFVisita = (idx: number, field: keyof NFItem, value: string | number) => {
    const nfs = [...getNFsVisita()];
    nfs[idx] = { ...nfs[idx], [field]: value };
    setNFsVisita(nfs);
  };

  const getNFsVeiculo = (): NFItem[] =>
    (veiculoEditando ? veiculoEditando.notasFiscais : formVeiculo.notasFiscais) || [{ numero: '', valor: 0 }];

  const setNFsVeiculo = (nfs: NFItem[]) => {
    if (veiculoEditando) setVeiculoEditando({ ...veiculoEditando, notasFiscais: nfs });
    else setFormVeiculo({ ...formVeiculo, notasFiscais: nfs });
  };

  const adicionarNFVeiculo = () => setNFsVeiculo([...getNFsVeiculo(), { numero: '', valor: 0 }]);
  const removerNFVeiculo = (idx: number) => setNFsVeiculo(getNFsVeiculo().filter((_, i) => i !== idx));
  const atualizarNFVeiculo = (idx: number, field: keyof NFItem, value: string | number) => {
    const nfs = [...getNFsVeiculo()];
    nfs[idx] = { ...nfs[idx], [field]: value };
    setNFsVeiculo(nfs);
  };

  // ── Terceiros: Registrar Entrada ──────────────────────────────────────────
  const adicionarTerceiro = async () => {
    if (!formTerceiro.nome) { alert('Selecione um nome.'); return; }
    const agora = isoSP();
    const dataHoje = dataSP();
    const tempId = `temp-${Date.now()}`;
    const novo: RegistroTerceiro = { id: tempId, nome: formTerceiro.nome, data: dataHoje, horaEntrada: agora };
    setTerceiros(prev => [novo, ...prev]);
    setModalTerceiroAberto(false);
    setFormTerceiro({ nome: '' });

    const payloadTerceiro = { nome: formTerceiro.nome, data: dataHoje, horaEntrada: agora };

    if (isOnline) {
      try {
        const realId = await inserirTerceiro(payloadTerceiro);
        if (realId) {
          setTerceiros(prev => prev.map(t => t.id === tempId ? { ...t, id: realId } : t));
        } else {
          enqueueOperation('insert_terceiro', payloadTerceiro, tempId);
        }
      } catch {
        enqueueOperation('insert_terceiro', payloadTerceiro, tempId);
      }
    } else {
      enqueueOperation('insert_terceiro', payloadTerceiro, tempId);
    }
  };

  const encerrarTerceiro = async (reg: RegistroTerceiro) => {
    const agora = isoSP();
    // Calcula minutos diretamente pelas partes de hora da string ISO (já em SP)
    // para evitar problemas de conversão de timezone do new Date()
    const parseISOtoMinutes = (iso: string) => {
      const match = iso.match(/T(\d{2}):(\d{2}):(\d{2})/);
      if (!match) return 0;
      return parseInt(match[1]) * 60 + parseInt(match[2]);
    };
    const parseDatePart = (iso: string) => iso.split('T')[0];

    let mins: number;
    const dataEntrada = parseDatePart(reg.horaEntrada);
    const dataSaida = parseDatePart(agora);

    if (dataEntrada === dataSaida) {
      // Mesmo dia: diferença simples
      mins = parseISOtoMinutes(agora) - parseISOtoMinutes(reg.horaEntrada);
    } else {
      // Dias diferentes: usa Date mas com offset explícito para ambos
      // Como ambas strings estão em SP, adicionamos o offset de SP (-03:00)
      const entradaDate = new Date(reg.horaEntrada + '-03:00');
      const saidaDate = new Date(agora + '-03:00');
      mins = Math.round((saidaDate.getTime() - entradaDate.getTime()) / 60000);
    }
    if (mins < 0) mins = 0;

    setTerceiros(prev => prev.map(t => t.id === reg.id ? { ...t, horaSaida: agora, minutosTrabalhados: mins } : t));
    if (isOnline) {
      encerrarTerceiroDb(reg.id, agora, mins).catch(() => enqueueOperation('encerrar_terceiro', { id: reg.id, horaSaida: agora, minutosTrabalhados: mins }));
    } else {
      enqueueOperation('encerrar_terceiro', { id: reg.id, horaSaida: agora, minutosTrabalhados: mins });
    }
  };

  const excluirTerceiro = (id: string) => {
    setTerceiros(prev => prev.filter(t => t.id !== id));
    if (isOnline) {
      excluirTerceiroDb(id).catch(() => enqueueOperation('delete_terceiro', { id }));
    } else {
      enqueueOperation('delete_terceiro', { id });
    }
  };

  const resetFormRecebido = () => {
    setFormRecebido({
      data: dataSP(),
      horaRegistro: horaSP(),
      remetente: '',
      destinatario: '',
      descricao: '',
      fotoBase64: undefined,
    });
  };

  const handleFotoRecebidoCapture = (base64Image: string) => {
    setCameraRecebidoOpen(false);
    setFormRecebido(prev => ({ ...prev, fotoBase64: base64Image }));
  };

  const adicionarRecebido = async () => {
    if (!formRecebido.remetente || !formRecebido.destinatario) {
      alert('Preencha os campos obrigatórios: Remetente e Destinatário.');
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const novoRecebido: Recebido = {
      id: tempId,
      data: formRecebido.data || hoje,
      horaRegistro: formRecebido.horaRegistro || horaSP(),
      remetente: formRecebido.remetente || '',
      destinatario: formRecebido.destinatario || '',
      descricao: formRecebido.descricao || '',
      fotoBase64: formRecebido.fotoBase64,
    };

    setRecebidos(prev => [novoRecebido, ...prev]);
    setModalRecebidoAberto(false);
    resetFormRecebido();

    const payloadRecebido = {
      data: novoRecebido.data,
      horaRegistro: novoRecebido.horaRegistro,
      remetente: novoRecebido.remetente,
      destinatario: novoRecebido.destinatario,
      descricao: novoRecebido.descricao,
      fotoBase64: novoRecebido.fotoBase64,
    };

    if (isOnline) {
      try {
        const realId = await inserirRecebido(novoRecebido);
        if (realId) {
          setRecebidos(prev => prev.map(e => e.id === tempId ? { ...e, id: realId } : e));
        } else {
          enqueueOperation('insert_recebido', payloadRecebido, tempId);
        }
      } catch {
        enqueueOperation('insert_recebido', payloadRecebido, tempId);
      }
    } else {
      enqueueOperation('insert_recebido', payloadRecebido, tempId);
    }
  };

  const excluirRecebido = (id: string) => {
    setRecebidos(prev => prev.filter(e => e.id !== id));
    if (isOnline) {
      excluirRecebidoDb(id).catch(() => enqueueOperation('delete_recebido', { id }));
    } else {
      enqueueOperation('delete_recebido', { id });
    }
  };

  const exportarCSV = (tipo: 'visitas' | 'veiculos' | 'terceiros' | 'encomendas') => {
    if (tipo === 'visitas') {
      const headers = ['Data', 'Empresa', 'Visitante', 'Horario Entrada', 'Horario Saida', 'Documento', 'Contato', 'Responsavel', 'Placa Veiculo', 'Notas Fiscais', 'Valores NFE', 'Descricao'];
      const rows = visitasFiltradas.map((v) => [
        v.data, v.empresa, v.visitante, v.horarioEntrada, v.horarioSaida,
        v.documento, v.contato, v.responsavel, v.placaVeiculo,
        (v.notasFiscais || []).map(n => n.numero).join(' | '),
        (v.notasFiscais || []).map(n => n.valor.toFixed(2)).join(' | '),
        v.descricao
      ]);
      const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `controle_visitas_${hoje}.csv`;
      link.click();
    } else if (tipo === 'veiculos') {
      // Relatório analítico agrupado por veículo
      const allVeiculos = veiculosFiltrados.length > 0 ? veiculosFiltrados : veiculos;

      // Agrupa por veículo
      const grupos: Record<string, ControleVeiculo[]> = {};
      allVeiculos.forEach(v => {
        if (!grupos[v.veiculo]) grupos[v.veiculo] = [];
        grupos[v.veiculo].push(v);
      });

      const lines: string[] = [];
      lines.push(['RELATÓRIO ANALÍTICO DE FROTA - ' + hoje.split('-').reverse().join('/')].join(';'));
      lines.push('');

      const now = new Date();
      const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23, 59, 59, 999);

      let totalGeralDiario = 0, totalGeralSemanal = 0, totalGeralMensal = 0;

      Object.keys(grupos).sort().forEach(nomeVeiculo => {
        const regs = grupos[nomeVeiculo];
        lines.push(['=== ' + nomeVeiculo + ' ==='].join(';'));
        lines.push(['Data', 'Motorista', 'Horario Saida', 'Horario Retorno', 'KM Saida', 'KM Entrada', 'KM Rodados', 'Destino'].join(';'));

        let kmDiario = 0, kmSemanal = 0, kmMensal = 0;
        regs.sort((a, b) => a.data.localeCompare(b.data)).forEach(v => {
          const km = Math.max(0, v.kmRodados || 0);
          const dataObj = new Date(v.data + 'T12:00:00');
          if (v.data === hoje) kmDiario += km;
          if (dataObj >= startOfWeek && dataObj <= endOfWeek) kmSemanal += km;
          if (dataObj.getMonth() === now.getMonth() && dataObj.getFullYear() === now.getFullYear()) kmMensal += km;
          lines.push([
            v.data.split('-').reverse().join('/'), v.motorista, v.horarioSaida || '-', v.horarioRetorno || '-',
            (v.kmSaida || 0).toString(), (v.kmEntrada || 0).toString(), km.toString(), v.destino
          ].join(';'));
        });
        totalGeralDiario += kmDiario; totalGeralSemanal += kmSemanal; totalGeralMensal += kmMensal;
        lines.push(['', '', '', '', '', 'KM Diário (hoje):', kmDiario.toString() + ' km', ''].join(';'));
        lines.push(['', '', '', '', '', 'KM Semanal:', kmSemanal.toString() + ' km', ''].join(';'));
        lines.push(['', '', '', '', '', 'KM Mensal:', kmMensal.toString() + ' km', ''].join(';'));
        lines.push('');
      });

      lines.push(['TOTAIS GERAIS'].join(';'));
      lines.push(['Total KM Diário (hoje):', totalGeralDiario.toString() + ' km'].join(';'));
      lines.push(['Total KM Semanal:', totalGeralSemanal.toString() + ' km'].join(';'));
      lines.push(['Total KM Mensal:', totalGeralMensal.toString() + ' km'].join(';'));

      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `relatorio_frota_${hoje}.csv`;
      link.click();
    } else if (tipo === 'terceiros') {
      // Exportação analítica de terceiros
      const concluidos = terceirosFiltrados.filter(t => t.horaSaida && t.minutosTrabalhados);
      const headers = ['Nome', 'Data', 'Dia da Semana', 'Entrada', 'Saída', 'Horas no Dia', 'Acumulado Semanal', 'Acumulado Mensal'];
      const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const accSemana: Record<string, number> = {};
      const accMes: Record<string, number> = {};
      const rows = [...concluidos]
        .sort((a, b) => a.nome.localeCompare(b.nome) || a.data.localeCompare(b.data))
        .map(t => {
          const mins = t.minutosTrabalhados || 0;
          const dataObj = new Date(t.data + 'T12:00:00');
          const semAno = `${t.nome}-W${Math.ceil(dataObj.getDate() / 7)}`;
          const mesAno = `${t.nome}-M`;
          accSemana[semAno] = (accSemana[semAno] || 0) + mins;
          accMes[mesAno] = (accMes[mesAno] || 0) + mins;
          return [
            t.nome,
            t.data.split('-').reverse().join('/'),
            diasSemana[dataObj.getDay()],
            formatarHoraISO(t.horaEntrada),
            formatarHoraISO(t.horaSaida),
            formatarTempo(mins),
            formatarTempo(accSemana[semAno]),
            formatarTempo(accMes[mesAno]),
          ];
        });
      const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `controle_terceiros_${hoje}.csv`;
      link.click();
    } else if (tipo === 'encomendas') {
      const headers = ['Data', 'Hora Registro', 'Remetente', 'Destinatario', 'Descricao'];
      const rows = recebidosFiltrados.map((e) => [
        e.data.split('-').reverse().join('/'), e.horaRegistro, e.remetente, e.destinatario, e.descricao
      ]);
      const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `controle_recebidos_${hoje}.csv`;
      link.click();
    }
  };

  const getCorDescricao = (desc: string) => {
    switch (desc) {
      case 'Entrega': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Visita': return 'bg-green-100 text-green-800 border-green-200';
      case 'Visita técnica': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'Coleta': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'Trocar Caçamba': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'Boleto': return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      case 'Reunião': return 'bg-pink-100 text-pink-800 border-pink-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Card
          className={`border-l-4 border-l-emerald-500 shadow-sm hover:shadow-md transition-all ${isAdmin ? 'cursor-pointer hover:border-l-emerald-600 active:scale-[0.98]' : ''
            }`}
          onClick={() => isAdmin && abrirModalKPI('visitas_hoje')}
          title={isAdmin ? "Clique para ver o detalhamento de Visitas" : undefined}
        >
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
              <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" /> Visitas Hoje
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-gray-900">{totalVisitasHoje}</div>
            <p className="text-[11px] text-gray-500 mt-1">{hoje.split('-').reverse().join('/')}</p>
          </CardContent>
        </Card>

        <Card
          className={`border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-all ${isAdmin ? 'cursor-pointer hover:border-l-amber-600 active:scale-[0.98]' : ''
            }`}
          onClick={() => isAdmin && abrirModalKPI('em_andamento')}
          title={isAdmin ? "Clique para ver as Visitas em Andamento" : undefined}
        >
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" /> Em Andamento
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-gray-900">{visitasEmAndamento}</div>
            <p className="text-[11px] text-gray-500 mt-1">Visitas sem registro de saída</p>
          </CardContent>
        </Card>

        <Card
          className={`border-l-4 border-l-blue-500 shadow-sm hover:shadow-md transition-all ${isAdmin ? 'cursor-pointer hover:border-l-blue-600 active:scale-[0.98]' : ''
            }`}
          onClick={() => isAdmin && abrirModalKPI('entregas')}
          title={isAdmin ? "Clique para ver o detalhamento de Entregas" : undefined}
        >
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
              <FileText className="w-3.5 h-3.5 flex-shrink-0" /> Total de Entregas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-gray-900">{totalEntregas}</div>
            <p className="text-[11px] text-gray-500 mt-1">Registros no período</p>
          </CardContent>
        </Card>

        <Card
          className={`border-l-4 border-l-purple-500 shadow-sm hover:shadow-md transition-all ${isAdmin ? 'cursor-pointer hover:border-l-purple-600 active:scale-[0.98]' : ''
            }`}
          onClick={() => isAdmin && abrirModalKPI('tecnicas')}
          title={isAdmin ? "Clique para ver o detalhamento de Visitas Técnicas" : undefined}
        >
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
              <Users className="w-3.5 h-3.5 flex-shrink-0" /> Visitas Técnicas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-gray-900">{totalVisitasTecnicas}</div>
            <p className="text-[11px] text-gray-500 mt-1">Assistências registradas</p>
          </CardContent>
        </Card>

        <Card
          className={`border-l-4 border-l-rose-500 shadow-sm hover:shadow-md transition-all ${isAdmin ? 'cursor-pointer hover:border-l-rose-600 active:scale-[0.98]' : ''
            }`}
          onClick={() => isAdmin && setModalNFsAberto(true)}
          title={isAdmin ? "Clique para ver o detalhamento das NFs de Entrada" : undefined}
        >
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
              <CreditCard className="w-3.5 h-3.5 flex-shrink-0" /> NFs do Dia
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold text-gray-900 whitespace-nowrap">{formatarMoeda(totalNFsHoje)}</div>
            <p className="text-[11px] text-gray-500 mt-1">Total em NFs (visitas)</p>
          </CardContent>
        </Card>
      </div>

      {/* Resumo da Frota — logo abaixo dos KPIs de visitas */}
      <Card className="shadow-sm border-t-4 border-t-teal-500">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Car className="w-5 h-5 text-teal-600" />
            Resumo da Frota
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl bg-teal-50 border border-teal-100 p-4 text-center">
              <div className="text-2xl font-bold text-teal-700">{totalFrotaHoje}</div>
              <div className="text-xs font-medium text-teal-600 mt-1">Saídas hoje</div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 text-center">
              <div className="text-2xl font-bold text-amber-700">{frotaEmTransito}</div>
              <div className="text-xs font-medium text-amber-600 mt-1">Em trânsito</div>
            </div>
            <div
              className={`rounded-xl bg-blue-50 border border-blue-100 p-4 text-center ${isAdmin ? 'cursor-pointer hover:bg-blue-100 hover:border-blue-300 hover:shadow-md transition-all' : ''}`}
              onClick={() => { if (isAdmin) { setFiltroKmFrota('dia'); setVeiculoExpandido(null); setModalKmFrotaAberto(true); } }}
              title={isAdmin ? 'Clique para ver detalhes por veículo' : ''}
            >
              <div className="text-2xl font-bold text-blue-700">{totalKmRodados}</div>
              <div className="text-xs font-medium text-blue-600 mt-1">KM total rodados</div>
              {isAdmin && <div className="text-[10px] text-blue-400 mt-0.5">clique para detalhes</div>}
            </div>
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-gray-700">{totalRegistrosFrota}</div>
              <div className="text-xs font-medium text-gray-600 mt-1">Total de registros</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid lado a lado: Últimas Visitas + Últimos Registros Frota */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Últimas visitas */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <LogIn className="w-5 h-5 text-gray-600" />
              Últimas Visitas
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setPaginaAtiva('visitas')}>
              Ver todas
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto overflow-y-auto max-h-[250px] pr-1">
              <table className="w-full text-sm relative">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-gray-200 bg-white">
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Data</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Empresa</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Visitante</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Responsável</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {visitas.slice(0, 15).map((v) => (
                    <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-2 text-gray-700">{v.data.split('-').reverse().join('/')}</td>
                      <td className="py-3 px-2 font-medium text-gray-900">{v.empresa}</td>
                      <td className="py-3 px-2 text-gray-700">{v.visitante}</td>
                      <td className="py-3 px-2">
                        <Badge variant="outline" className="font-normal">{v.responsavel}</Badge>
                      </td>
                      <td className="py-3 px-2">
                        <Badge className={`${getCorDescricao(v.descricao)} font-medium`}>{v.descricao}</Badge>
                      </td>
                    </tr>
                  ))}
                  {visitas.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">Nenhuma visita registrada</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Últimos registros de Frota */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Car className="w-5 h-5 text-gray-600" />
              Últimos Registros — Frota
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setPaginaAtiva('veiculos')}>
              Ver todos
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto overflow-y-auto max-h-[250px] pr-1">
              <table className="w-full text-sm relative">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-gray-200 bg-white">
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Data</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Motorista</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Veículo</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">Destino</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 bg-white">KM</th>
                  </tr>
                </thead>
                <tbody>
                  {veiculos.slice(0, 15).map((v) => (
                    <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-2 text-gray-700 whitespace-nowrap">{v.data.split('-').reverse().join('/')}</td>
                      <td className="py-3 px-2">
                        <Badge variant="outline" className="font-normal">{v.motorista}</Badge>
                      </td>
                      <td className="py-3 px-2 font-medium text-gray-900">{v.veiculo}</td>
                      <td className="py-3 px-2 text-gray-700">{v.destino}</td>
                      <td className="py-3 px-2 text-gray-700 font-medium">{v.kmRodados > 0 ? `${v.kmRodados} km` : '-'}</td>
                    </tr>
                  ))}
                  {veiculos.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-sm">Nenhum registro de frota</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

      </div>{/* fim grid lado a lado */}
    </div>
  );

  const renderVisitas = () => (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filtroResponsavel} onValueChange={setFiltroResponsavel}>
              <SelectTrigger>
                <SelectValue placeholder="Responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os responsáveis</SelectItem>
                {RESPONSAVEIS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroDescricao} onValueChange={setFiltroDescricao}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {DESCRICOES.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={filtroData}
              onChange={(e) => setFiltroData(e.target.value)}
              placeholder="Data"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={() => { setBusca(''); setFiltroResponsavel('todos'); setFiltroDescricao('todos'); setFiltroData(''); }} title="Limpar filtros">
                <Filter className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => exportarCSV('visitas')} title="Exportar CSV">
                <Download className="w-4 h-4" />
              </Button>
              <Button onClick={() => { resetFormVisita(); setModalVisitaAberto(true); }} className="flex-1">
                <Plus className="w-4 h-4 mr-1" /> Nova
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="py-4">
          <CardTitle className="text-lg font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Users className="w-5 h-5 text-gray-600" />
              Registro de Visitas ({visitasFiltradas.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-350px)] w-full">
            <div className="min-w-[1200px] pb-4">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                  <tr className="bg-gray-50">
                    <th className="text-left py-3 pl-6 pr-3 font-semibold text-gray-600 bg-gray-50">Data</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Empresa</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Visitante</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Entrada</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Saída</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Documento</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Responsável</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Placa</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">NFe</th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Tipo</th>
                    <th className="text-right py-3 pl-3 pr-6 font-semibold text-gray-600 min-w-[180px] bg-gray-50">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visitasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-500">
                        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                        Nenhum registro encontrado
                      </td>
                    </tr>
                  )}
                  {visitasFiltradas.map((v) => {
                    const estaAberta = !!v.horarioEntrada && !v.horarioSaida;
                    return (
                      <tr
                        key={v.id}
                        onClick={() => setVisitaDetalhes(v)}
                        className={`border-b transition-colors cursor-pointer ${estaAberta
                          ? 'border-amber-100 bg-amber-50/40 hover:bg-amber-100'
                          : 'border-gray-100 hover:bg-blue-50/60'
                          }`}
                      >
                        <td className="py-3 pl-6 pr-3 text-gray-700 whitespace-nowrap">{v.data.split('-').reverse().join('/')}</td>
                        <td className="py-3 px-3 font-medium text-gray-900">{v.empresa}</td>
                        <td className="py-3 px-3 text-gray-700">{v.visitante}</td>
                        <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{v.horarioEntrada || '-'}</td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {v.horarioSaida ? (
                            <span className="text-gray-700">{v.horarioSaida}</span>
                          ) : v.horarioEntrada ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Em aberto
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">{v.documento || '-'}</td>
                        <td className="py-3 px-3">
                          <Badge variant="outline" className="font-normal text-xs">{v.responsavel}</Badge>
                        </td>
                        <td className="py-3 px-3 text-gray-500 text-xs">{v.placaVeiculo !== '-' ? v.placaVeiculo : '-'}</td>
                        <td className="py-3 px-3 text-gray-500 text-xs">
                          {v.notasFiscais && v.notasFiscais.some(n => n.numero)
                            ? v.notasFiscais.filter(n => n.numero).length > 1
                              ? <span title={v.notasFiscais.filter(n => n.numero).map(n => n.numero).join(', ')}>{v.notasFiscais[0].numero} <span className="text-blue-500 font-semibold">+{v.notasFiscais.filter(n => n.numero).length - 1}</span></span>
                              : v.notasFiscais[0].numero
                            : '-'}
                        </td>
                        <td className="py-3 px-3">
                          <Badge className={`${getCorDescricao(v.descricao)} text-xs font-medium`}>{v.descricao}</Badge>
                        </td>
                        <td className="py-3 pl-3 pr-6">
                          <div className="flex items-center justify-end gap-2">
                            {estaAberta ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); encerrarVisita(v.id); }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs font-semibold shadow-sm shadow-emerald-200 transition-all duration-150 cursor-pointer select-none"
                                title="Registra saída com o horário atual e encerra a visita"
                              >
                                <LogOut className="w-3.5 h-3.5" />
                                Encerrar visita
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Encerrada
                              </span>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={(e) => { e.stopPropagation(); abrirEdicaoVisita(v); }} title="Editar Visita">
                              <Edit3 className="w-3.5 h-3.5 text-gray-500" />
                            </Button>
                            {(perfil?.role === 'super_admin' || perfil?.role === 'admin') && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={(e) => { e.stopPropagation(); excluirVisita(v.id); }}>
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ScrollBar orientation="horizontal" className="h-1.5 bg-slate-100/10" />
            <ScrollBar orientation="vertical" className="w-1.5 bg-slate-100/10" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );

  const renderTerceiros = () => (
    <div className="space-y-4">
      {/* Header + Botão */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-orange-500" /> Terceiros — Controle de Prestadores
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{terceirosAtivos.length} prestador(es) no momento</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportarCSV('terceiros')} className="gap-1">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
          <Button onClick={() => setModalTerceiroAberto(true)} className="gap-1 bg-orange-500 hover:bg-orange-600">
            <Plus className="w-4 h-4" /> Registrar Entrada
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Buscar por nome..." value={buscaTerceiro} onChange={(e) => setBuscaTerceiro(e.target.value)} className="pl-9" />
            </div>
            <Input type="date" value={filtroDataTerceiro} onChange={(e) => setFiltroDataTerceiro(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-350px)] w-full">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                <tr className="bg-gray-50">
                  <th className="text-left py-3 pl-6 pr-4 font-semibold text-gray-600 bg-gray-50">Nome</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 bg-gray-50">Data</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 bg-gray-50">Entrada</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 bg-gray-50">Saída</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 bg-gray-50">Tempo</th>
                  <th className="text-left py-3 pl-4 pr-6 font-semibold text-gray-600 bg-gray-50">Ações</th>
                </tr>
              </thead>
              <tbody>
                {terceirosFiltrados.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-gray-400">Nenhum registro encontrado</td></tr>
                )}
                {terceirosFiltrados.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pl-6 pr-4 font-medium text-gray-900">{t.nome}</td>
                    <td className="py-3 px-4 text-gray-600">{t.data.split('-').reverse().join('/')}</td>
                    <td className="py-3 px-4 text-gray-700 whitespace-nowrap">{formatarHoraISO(t.horaEntrada)}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {t.horaSaida ? (
                        <span className="text-gray-700">{formatarHoraISO(t.horaSaida)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Em andamento
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-800">{formatarTempo(t.minutosTrabalhados || 0)}</td>
                    <td className="py-3 pl-4 pr-6">
                      <div className="flex items-center gap-2">
                        {!t.horaSaida && (
                          <Button size="sm" variant="outline" className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 gap-1" onClick={() => encerrarTerceiro(t)}>
                            <X className="w-3 h-3" /> Encerrar
                          </Button>
                        )}
                        {(perfil?.role === 'admin' || perfil?.role === 'super_admin') && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => excluirTerceiro(t.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ScrollBar orientation="vertical" className="w-1.5 bg-slate-100/10" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );

  const renderVeiculos = () => (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar veículo, destino..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9"
              />
            </div>
            <Input
              type="date"
              value={filtroData}
              onChange={(e) => setFiltroData(e.target.value)}
              placeholder="Data"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={() => { setBusca(''); setFiltroData(''); }} title="Limpar filtros">
                <Filter className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => exportarCSV('veiculos')} title="Exportar CSV">
                <Download className="w-4 h-4" />
              </Button>
            </div>
            <Button onClick={() => { resetFormVeiculo(); setModalVeiculoAberto(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Novo Registro
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Car className="w-5 h-5 text-gray-600" />
            Frota — Controle de Veículos ({veiculosFiltrados.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-350px)] w-full">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                <tr className="bg-gray-50">
                  <th className="text-left py-3 pl-6 pr-3 font-semibold text-gray-600 bg-gray-50">Data</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Motorista</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Veículo</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Saída</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Retorno</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">H. Retorno</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">KM</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600 bg-gray-50">Destino</th>
                  <th className="text-right py-3 pl-3 pr-6 font-semibold text-gray-600 bg-gray-50">Ações</th>
                </tr>
              </thead>
              <tbody>
                {veiculosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500">
                      <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      Nenhum registro encontrado
                    </td>
                  </tr>
                )}
                {veiculosFiltrados.map((v) => (
                  <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pl-6 pr-3 text-gray-700 whitespace-nowrap">{v.data.split('-').reverse().join('/')}</td>
                    <td className="py-3 px-3">
                      <Badge variant="outline" className="font-normal text-xs">{v.motorista}</Badge>
                    </td>
                    <td className="py-3 px-3 font-medium text-gray-900">{v.veiculo}</td>
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{v.horarioSaida || '-'}</td>
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{v.dataRetorno ? v.dataRetorno.split('-').reverse().join('/') : '-'}</td>
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{v.horarioRetorno || '-'}</td>
                    <td className="py-3 px-3 text-gray-700 font-medium">{Math.max(0, v.kmRodados) > 0 ? `${Math.max(0, v.kmRodados)} km` : '-'}</td>
                    <td className="py-3 px-3 text-gray-700">{v.destino}</td>
                    <td className="py-3 pl-3 pr-6">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEdicaoVeiculo(v)}>
                          <Edit3 className="w-3.5 h-3.5 text-gray-500" />
                        </Button>
                        {(perfil?.role === 'super_admin' || perfil?.role === 'admin') && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => excluirVeiculo(v.id)}>
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ScrollBar orientation="vertical" className="w-1.5 bg-slate-100/10" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );

  const renderRecebidos = () => (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Buscar por remetente, destinatário..."
                value={buscaRecebido}
                onChange={(e) => setBuscaRecebido(e.target.value)}
                className="pl-9"
              />
            </div>
            <Input
              type="date"
              value={filtroDataRecebido}
              onChange={(e) => setFiltroDataRecebido(e.target.value)}
              placeholder="Data"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={() => { setBuscaRecebido(''); setFiltroDataRecebido(''); }} title="Limpar filtros">
                <Filter className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => exportarCSV('encomendas')} title="Exportar CSV">
                <Download className="w-4 h-4" />
              </Button>
            </div>
            <Button onClick={() => { resetFormRecebido(); setModalRecebidoAberto(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Novo Recebido
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Package className="w-5 h-5 text-gray-600" />
              Recebidos ({recebidosFiltrados.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-3 font-semibold text-gray-600">Data</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600">Hora</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600">Remetente</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600">Destinatário</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-600">Descrição</th>
                  <th className="text-right py-3 px-3 font-semibold text-gray-600 w-24">Ações</th>
                </tr>
              </thead>
              <tbody>
                {recebidosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      Nenhum recebido encontrado
                    </td>
                  </tr>
                )}
                {recebidosFiltrados.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => setRecebidoDetalhes(e)}
                    className="border-b border-gray-100 hover:bg-blue-50/60 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{e.data.split('-').reverse().join('/')}</td>
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{e.horaRegistro}</td>
                    <td className="py-3 px-3 font-medium text-gray-900">{e.remetente}</td>
                    <td className="py-3 px-3">
                      <Badge variant="outline" className="font-normal text-xs">{e.destinatario}</Badge>
                    </td>
                    <td className="py-3 px-3 text-gray-500 text-xs truncate max-w-[200px]">{e.descricao || '-'}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center justify-end gap-2" onClick={(ev) => ev.stopPropagation()}>
                        {(perfil?.role === 'super_admin' || perfil?.role === 'admin') && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => excluirRecebido(e.id)}>
                            <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (authLoading) {
    return <div className="flex h-screen items-center justify-center bg-gray-50"><RefreshCw className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-gray-100 portaria-app-root">
      {/* Banner de status de conexão */}
      <OfflineBanner isOnline={isOnline} pendingCount={pendingCount} isSyncing={isSyncing} justSynced={justSynced} />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMenuAberto(!menuAberto)}
              >
                <Menu className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-wider text-gray-800 dark:text-zinc-200 uppercase">
                  Controle Portaria
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="hidden sm:flex items-center gap-1 bg-blue-50 text-blue-700 border-blue-200">
                <CalendarDays className="w-3 h-3" />
                {new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
              </Badge>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPaginaAtiva('configuracoes')}
                  className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white font-semibold text-sm hover:ring-2 hover:ring-blue-400 transition-all"
                  title={`${perfil?.nome || user.email} — Configurações`}
                >
                  {perfil?.foto_base64 ? (
                    <img src={perfil.foto_base64} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center">
                      {perfil?.nome ? perfil.nome.charAt(0).toUpperCase() : <UserCircle className="w-5 h-5 text-white" />}
                    </div>
                  )}
                </button>
                <Button variant="ghost" size="icon" onClick={signOut} title="Sair do Sistema">
                  <LogOut className="w-4 h-4 text-gray-600" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-6">
          {/* Sidebar Navigation */}
          <aside className={`${menuAberto ? 'block' : 'hidden'} lg:block w-64 flex-shrink-0`}>
            <nav className="space-y-1 sticky top-24">
              <button
                onClick={() => { setPaginaAtiva('dashboard'); setMenuAberto(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${paginaAtiva === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'text-gray-600 hover:bg-gray-200'
                  }`}
              >
                <BarChart3 className="w-5 h-5" />
                Dashboard
              </button>
              <button
                onClick={() => { setPaginaAtiva('visitas'); setMenuAberto(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${paginaAtiva === 'visitas'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'text-gray-600 hover:bg-gray-200'
                  }`}
              >
                <Users className="w-5 h-5" />
                Visitas
                <Badge className={`ml-auto ${paginaAtiva === 'visitas' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-800'}`}>{visitas.length}</Badge>
              </button>
              <button
                onClick={() => { setPaginaAtiva('terceiros'); setMenuAberto(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${paginaAtiva === 'terceiros'
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                  : 'text-gray-600 hover:bg-gray-200'
                  }`}
              >
                <Users className="w-5 h-5" />
                Terceiros
                {terceirosAtivos.length > 0 && (
                  <Badge className={`ml-auto ${paginaAtiva === 'terceiros' ? 'bg-white/20 text-white' : 'bg-orange-100 text-orange-700'}`}>{terceirosAtivos.length}</Badge>
                )}
              </button>
              <button
                onClick={() => { setPaginaAtiva('recebidos'); setMenuAberto(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${paginaAtiva === 'recebidos'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'text-gray-600 hover:bg-gray-200'
                  }`}
              >
                <Package className="w-5 h-5" />
                Recebidos
                <Badge className={`ml-auto ${paginaAtiva === 'recebidos' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-800'}`}>{recebidos.length}</Badge>
              </button>
              <button
                onClick={() => { setPaginaAtiva('veiculos'); setMenuAberto(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${paginaAtiva === 'veiculos'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'text-gray-600 hover:bg-gray-200'
                  }`}
              >
                <Car className="w-5 h-5" />
                Frota
                <Badge className={`ml-auto ${paginaAtiva === 'veiculos' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-800'}`}>{veiculos.length}</Badge>
              </button>

              {(perfil?.role === 'super_admin' || perfil?.role === 'admin') && (
                <button
                  onClick={() => { setPaginaAtiva('usuarios'); setMenuAberto(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${paginaAtiva === 'usuarios'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                    : 'text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  <Users className="w-5 h-5" />
                  Gerenciar Usuários
                </button>
              )}

              <button
                onClick={() => { setPaginaAtiva('configuracoes'); setMenuAberto(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${paginaAtiva === 'configuracoes'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'text-gray-600 hover:bg-gray-200'
                  }`}
              >
                <Settings className="w-5 h-5" />
                Configurações
              </button>

              <Separator className="my-4" />

              <div className="px-4 py-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Resumo</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      Entregas
                    </span>
                    <span className="font-semibold text-gray-900">{totalEntregas}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      Visitas
                    </span>
                    <span className="font-semibold text-gray-900">{totalVisitasGerais}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-purple-500" />
                      Técnicas
                    </span>
                    <span className="font-semibold text-gray-900">{totalVisitasTecnicas}</span>
                  </div>
                  <Separator className="my-1" />
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 mb-2">Frota</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-teal-500" />
                      Registros
                    </span>
                    <span className="font-semibold text-gray-900">{totalRegistrosFrota}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      Em trânsito
                    </span>
                    <span className="font-semibold text-gray-900">{frotaEmTransito}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-400" />
                      KM total
                    </span>
                    <span className="font-semibold text-gray-900">{totalKmRodados}</span>
                  </div>
                </div>
              </div>
            </nav>
          </aside>

          {/* Conteúdo Principal */}
          <main className="flex-1 min-w-0">
            {carregando ? (
              <div className="flex flex-col items-center justify-center h-full py-40 gap-4 text-gray-400">
                <RefreshCw className="w-10 h-10 animate-spin text-blue-400" />
                <p className="text-sm font-medium">Carregando dados do servidor...</p>
              </div>
            ) : (
              <>
                {paginaAtiva === 'dashboard' && renderDashboard()}
                {paginaAtiva === 'visitas' && renderVisitas()}
                {paginaAtiva === 'terceiros' && renderTerceiros()}
                {paginaAtiva === 'recebidos' && renderRecebidos()}
                {paginaAtiva === 'veiculos' && renderVeiculos()}
                {paginaAtiva === 'usuarios' && <GerenciarUsuarios />}
                {paginaAtiva === 'configuracoes' && <Configuracoes />}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Modal - Registrar Entrada Terceiro */}
      <Dialog open={modalTerceiroAberto} onOpenChange={(open) => { setModalTerceiroAberto(open); if (!open) setFormTerceiro({ nome: '' }); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-orange-500" />
              Registrar Entrada — Terceiro
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Prestador *</Label>
              <Select value={formTerceiro.nome} onValueChange={(val) => setFormTerceiro({ nome: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o prestador" />
                </SelectTrigger>
                <SelectContent>
                  {TERCEIROS.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              A hora de entrada será registrada automaticamente no momento do clique em Confirmar.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalTerceiroAberto(false)}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={adicionarTerceiro} className="bg-orange-500 hover:bg-orange-600">
              <Check className="w-4 h-4 mr-1" /> Confirmar Entrada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal - Nova Visita */}
      <Dialog open={modalVisitaAberto} onOpenChange={setModalVisitaAberto}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {visitaEditando ? <Edit3 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {visitaEditando ? 'Editar Visita' : 'Nova Visita'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            {/* Seção da Câmera / Identificação */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <Label className="text-sm font-semibold text-gray-700">Identificação Facial</Label>
                {!visitaEditando && !formVisita.fotoBase64 && !cameraOpen && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setIdentificacaoModo(true); setCameraOpen(true); }}
                    className="text-blue-600 border-blue-200 hover:bg-blue-50"
                  >
                    Buscar Visitante (Auto-preencher)
                  </Button>
                )}
              </div>

              {isExtractingFace ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-gray-500">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                  <p>Analisando rosto e buscando no banco de dados...</p>
                </div>
              ) : cameraOpen ? (
                <CameraCapture
                  onCapture={handleFotoCapture}
                  onCancel={() => setCameraOpen(false)}
                />
              ) : formVisita.fotoBase64 || (visitaEditando && visitaEditando.fotoBase64) ? (
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-lg overflow-hidden border">
                    <img src={visitaEditando ? visitaEditando.fotoBase64 : formVisita.fotoBase64} alt="Visitante" className="w-full h-full object-cover" />
                  </div>
                  {!visitaEditando && (
                    <Button type="button" variant="outline" onClick={() => { setFormVisita(prev => ({ ...prev, fotoBase64: undefined, faceDescriptor: undefined })); setCameraOpen(true); }}>
                      Tirar Nova Foto
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center p-6 border-2 border-dashed rounded-lg bg-gray-50 text-gray-400">
                  <UserCircle className="w-12 h-12 mb-2 opacity-50" />
                  <p className="text-sm mb-4">Nenhuma foto capturada</p>
                  <Button type="button" onClick={() => { setIdentificacaoModo(false); setCameraOpen(true); }}>
                    Abrir Câmera para Cadastro
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data *</Label>
                <Input
                  type="date"
                  value={visitaEditando ? visitaEditando.data : formVisita.data}
                  onChange={(e) => visitaEditando
                    ? setVisitaEditando({ ...visitaEditando, data: e.target.value })
                    : setFormVisita({ ...formVisita, data: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Empresa *</Label>
                <Input
                  placeholder="Nome da empresa"
                  value={visitaEditando ? visitaEditando.empresa : formVisita.empresa}
                  onChange={(e) => visitaEditando
                    ? setVisitaEditando({ ...visitaEditando, empresa: e.target.value })
                    : setFormVisita({ ...formVisita, empresa: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2 relative">
                <Label>Visitante *</Label>
                <Input
                  placeholder="Nome do visitante"
                  value={visitaEditando ? visitaEditando.visitante : formVisita.visitante}
                  onChange={(e) => handleInputChangeVisitante(e.target.value)}
                  onKeyDown={handleKeyDownVisitante}
                  onBlur={() => setTimeout(() => {
                    setSugestoesVisitantes([]);
                    setIndiceSugestaoAtiva(-1);
                  }, 200)}
                  autoComplete="off"
                />
                {sugestoesVisitantes.length > 0 && (
                  <ul className="absolute z-[100] w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto mt-1 py-1 text-sm text-gray-700">
                    {sugestoesVisitantes.map((sug, idx) => (
                      <li
                        key={idx}
                        onMouseDown={(e) => {
                          // Prevent input blur before click registers
                          e.preventDefault();
                        }}
                        onClick={() => selecionarSugestaoVisitante(sug)}
                        className={`cursor-pointer px-3 py-2 flex flex-col hover:bg-blue-50 transition-colors ${idx === indiceSugestaoAtiva ? 'bg-blue-50 text-blue-900 font-medium' : ''
                          }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-gray-900">{sug.nome}</span>
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            {idx === indiceSugestaoAtiva ? 'Espaço para preencher' : 'Clique ou Setas'}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          Empresa: {sug.empresa || '-'} | Doc: {sug.documento || '-'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <Label>Responsável *</Label>
                <Select
                  value={visitaEditando ? visitaEditando.responsavel : formVisita.responsavel}
                  onValueChange={(val) => visitaEditando
                    ? setVisitaEditando({ ...visitaEditando, responsavel: val })
                    : setFormVisita({ ...formVisita, responsavel: val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESPONSAVEIS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Horário Entrada</Label>
                <Input
                  type="time"
                  value={visitaEditando ? visitaEditando.horarioEntrada : formVisita.horarioEntrada}
                  onChange={(e) => visitaEditando
                    ? setVisitaEditando({ ...visitaEditando, horarioEntrada: e.target.value })
                    : setFormVisita({ ...formVisita, horarioEntrada: e.target.value })
                  }
                />
              </div>
            </div>
            {/* Horário de Saída removido — registrado automaticamente pelo botão "Encerrar Visita" */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Documento</Label>
              <Input
                placeholder="CPF/RG"
                value={visitaEditando ? visitaEditando.documento : formVisita.documento}
                onChange={(e) => visitaEditando
                  ? setVisitaEditando({ ...visitaEditando, documento: e.target.value })
                  : setFormVisita({ ...formVisita, documento: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Contato</Label>
              <Input
                placeholder="Telefone"
                value={visitaEditando ? visitaEditando.contato : formVisita.contato}
                onChange={(e) => visitaEditando
                  ? setVisitaEditando({ ...visitaEditando, contato: e.target.value })
                  : setFormVisita({ ...formVisita, contato: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Car className="w-3.5 h-3.5" /> Placa do Veículo</Label>
              <Input
                placeholder="ABC1D23"
                value={visitaEditando ? visitaEditando.placaVeiculo : formVisita.placaVeiculo}
                onChange={(e) => visitaEditando
                  ? setVisitaEditando({ ...visitaEditando, placaVeiculo: e.target.value })
                  : setFormVisita({ ...formVisita, placaVeiculo: e.target.value })
                }
              />
            </div>
            {/* ── Notas Fiscais (múltiplas) ── */}
            <div className="col-span-2 space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1 font-semibold"><FileText className="w-3.5 h-3.5" /> Notas Fiscais</Label>
                <Button type="button" variant="outline" size="sm" onClick={adicionarNFVisita} className="h-7 text-xs gap-1 border-blue-200 text-blue-600 hover:bg-blue-50">
                  <Plus className="w-3 h-3" /> Adicionar NF
                </Button>
              </div>
              {getNFsVisita().map((nf, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input
                    placeholder="Número NF-e"
                    value={nf.numero}
                    onChange={(e) => atualizarNFVisita(idx, 'numero', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    type="text"
                    placeholder="R$ 0,00"
                    value={formatarMoeda(nf.valor)}
                    onChange={(e) => atualizarNFVisita(idx, 'valor', extrairValorNumericoMoeda(e.target.value))}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 flex-shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={() => removerNFVisita(idx)}
                    disabled={getNFsVisita().length === 1}
                    title="Remover esta NF"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select
                value={visitaEditando ? visitaEditando.descricao : formVisita.descricao}
                onValueChange={(val) => visitaEditando
                  ? setVisitaEditando({ ...visitaEditando, descricao: val })
                  : setFormVisita({ ...formVisita, descricao: val })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {DESCRICOES.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setModalVisitaAberto(false); setVisitaEditando(null); }}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={visitaEditando ? atualizarVisita : adicionarVisita}>
              <Check className="w-4 h-4 mr-1" /> {visitaEditando ? 'Atualizar' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal - Novo Veículo */}
      <Dialog open={modalVeiculoAberto} onOpenChange={setModalVeiculoAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {veiculoEditando ? <Edit3 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {veiculoEditando ? 'Editar Controle de Veículo' : 'Novo Controle de Veículo'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>Data *</Label>
              <Input
                type="date"
                value={veiculoEditando ? veiculoEditando.data : formVeiculo.data}
                onChange={(e) => veiculoEditando
                  ? setVeiculoEditando({ ...veiculoEditando, data: e.target.value })
                  : setFormVeiculo({ ...formVeiculo, data: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Motorista *</Label>
              <Select
                value={veiculoEditando ? veiculoEditando.motorista : formVeiculo.motorista}
                onValueChange={(val) => veiculoEditando
                  ? setVeiculoEditando({ ...veiculoEditando, motorista: val })
                  : setFormVeiculo({ ...formVeiculo, motorista: val })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {MOTORISTAS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Veículo *</Label>
              <Select
                value={veiculoEditando ? veiculoEditando.veiculo : formVeiculo.veiculo}
                onValueChange={(val) => veiculoEditando
                  ? setVeiculoEditando({ ...veiculoEditando, veiculo: val })
                  : setFormVeiculo({ ...formVeiculo, veiculo: val })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o veículo" />
                </SelectTrigger>
                <SelectContent>
                  {VEICULOS.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Horário de Saída</Label>
              <Input
                type="time"
                value={veiculoEditando ? veiculoEditando.horarioSaida : formVeiculo.horarioSaida}
                onChange={(e) => veiculoEditando
                  ? setVeiculoEditando({ ...veiculoEditando, horarioSaida: e.target.value })
                  : setFormVeiculo({ ...formVeiculo, horarioSaida: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Data de Retorno</Label>
              <Input
                type="date"
                value={veiculoEditando ? veiculoEditando.dataRetorno : formVeiculo.dataRetorno}
                onChange={(e) => veiculoEditando
                  ? setVeiculoEditando({ ...veiculoEditando, dataRetorno: e.target.value })
                  : setFormVeiculo({ ...formVeiculo, dataRetorno: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Horário de Retorno</Label>
              <Input
                type="time"
                value={veiculoEditando ? veiculoEditando.horarioRetorno : formVeiculo.horarioRetorno}
                onChange={(e) => veiculoEditando
                  ? setVeiculoEditando({ ...veiculoEditando, horarioRetorno: e.target.value })
                  : setFormVeiculo({ ...formVeiculo, horarioRetorno: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>KM Saída</Label>
              <Input
                type="number"
                placeholder="0"
                value={veiculoEditando
                  ? (veiculoEditando.kmSaida === 0 ? '' : veiculoEditando.kmSaida)
                  : (formVeiculo.kmSaida === 0 ? '' : formVeiculo.kmSaida)}
                onChange={(e) => {
                  const val = Math.max(0, e.target.value === '' ? 0 : Number(e.target.value));
                  if (veiculoEditando) {
                    const kmRodados = Math.max(0, (veiculoEditando.kmEntrada || 0) - val);
                    setVeiculoEditando({ ...veiculoEditando, kmSaida: val, kmRodados });
                  } else {
                    const kmRodados = Math.max(0, (formVeiculo.kmEntrada || 0) - val);
                    setFormVeiculo({ ...formVeiculo, kmSaida: val, kmRodados });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>KM Entrada (Retorno)</Label>
              <Input
                type="number"
                placeholder="0"
                min={veiculoEditando ? (veiculoEditando.kmSaida || 0) : (formVeiculo.kmSaida || 0)}
                value={veiculoEditando
                  ? (veiculoEditando.kmEntrada === 0 ? '' : veiculoEditando.kmEntrada)
                  : (formVeiculo.kmEntrada === 0 ? '' : formVeiculo.kmEntrada)}
                className={(() => {
                  const kmSaida = veiculoEditando ? (veiculoEditando.kmSaida || 0) : (formVeiculo.kmSaida || 0);
                  const kmEntrada = veiculoEditando ? (veiculoEditando.kmEntrada || 0) : (formVeiculo.kmEntrada || 0);
                  return kmEntrada > 0 && kmSaida > 0 && kmEntrada < kmSaida ? 'border-red-500 focus-visible:ring-red-500' : '';
                })()}
                onChange={(e) => {
                  const val = Math.max(0, e.target.value === '' ? 0 : Number(e.target.value));
                  if (veiculoEditando) {
                    const kmRodados = Math.max(0, val - (veiculoEditando.kmSaida || 0));
                    setVeiculoEditando({ ...veiculoEditando, kmEntrada: val, kmRodados });
                  } else {
                    const kmRodados = Math.max(0, val - (formVeiculo.kmSaida || 0));
                    setFormVeiculo({ ...formVeiculo, kmEntrada: val, kmRodados });
                  }
                }}
              />
              {(() => {
                const kmSaida = veiculoEditando ? (veiculoEditando.kmSaida || 0) : (formVeiculo.kmSaida || 0);
                const kmEntrada = veiculoEditando ? (veiculoEditando.kmEntrada || 0) : (formVeiculo.kmEntrada || 0);
                if (kmEntrada > 0 && kmSaida > 0 && kmEntrada < kmSaida) {
                  return <p className="text-xs text-red-600 font-medium mt-1">⚠ KM de retorno deve ser maior que KM de saída ({kmSaida} km)</p>;
                }
                return null;
              })()}
            </div>
            <div className="space-y-2 flex items-center pt-8">
              <Label className="text-gray-500 font-medium text-sm">
                Distância Percorrida: <span className={`font-bold ml-1 ${(() => {
                  const kmRodados = veiculoEditando ? veiculoEditando.kmRodados : formVeiculo.kmRodados;
                  return (kmRodados || 0) > 0 ? 'text-green-700' : 'text-gray-800';
                })()}`}>{Math.max(0, veiculoEditando ? (veiculoEditando.kmRodados || 0) : (formVeiculo.kmRodados || 0))} km</span>
              </Label>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Destino *</Label>
              <Input
                placeholder="Cidade/Local"
                value={veiculoEditando ? veiculoEditando.destino : formVeiculo.destino}
                onChange={(e) => veiculoEditando
                  ? setVeiculoEditando({ ...veiculoEditando, destino: e.target.value })
                  : setFormVeiculo({ ...formVeiculo, destino: e.target.value })
                }
              />
            </div>
            {/* ── Notas Fiscais (múltiplas) ── */}
            <div className="col-span-2 space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1 font-semibold"><FileText className="w-3.5 h-3.5" /> Notas Fiscais</Label>
                <Button type="button" variant="outline" size="sm" onClick={adicionarNFVeiculo} className="h-7 text-xs gap-1 border-blue-200 text-blue-600 hover:bg-blue-50">
                  <Plus className="w-3 h-3" /> Adicionar NF
                </Button>
              </div>
              {getNFsVeiculo().map((nf, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input
                    placeholder="Número NF-e"
                    value={nf.numero}
                    onChange={(e) => atualizarNFVeiculo(idx, 'numero', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    type="text"
                    placeholder="R$ 0,00"
                    value={formatarMoeda(nf.valor)}
                    onChange={(e) => atualizarNFVeiculo(idx, 'valor', extrairValorNumericoMoeda(e.target.value))}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 flex-shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={() => removerNFVeiculo(idx)}
                    disabled={getNFsVeiculo().length === 1}
                    title="Remover esta NF"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setModalVeiculoAberto(false); setVeiculoEditando(null); }}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={veiculoEditando ? atualizarVeiculo : adicionarVeiculo}>
              <Check className="w-4 h-4 mr-1" /> {veiculoEditando ? 'Atualizar' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Detalhes da Visita */}
      <Dialog open={!!visitaDetalhes} onOpenChange={() => setVisitaDetalhes(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl border-b pb-4">
              <UserCircle className="w-6 h-6 text-blue-500" />
              Detalhes do Visitante
            </DialogTitle>
          </DialogHeader>

          {visitaDetalhes && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
              {/* Coluna 1: Foto e Nome */}
              <div className="flex flex-col items-center gap-4 border-r border-gray-100 pr-4">
                <div className="w-40 h-40 rounded-xl overflow-hidden border-2 border-gray-100 shadow-sm bg-gray-50 flex items-center justify-center">
                  {carregandoFoto ? (
                    <RefreshCw className="w-8 h-8 text-gray-300 animate-spin" />
                  ) : fotoDetalhe ? (
                    <img src={fotoDetalhe} alt="Visitante" className="w-full h-full object-cover" />
                  ) : (
                    <UserCircle className="w-20 h-20 text-gray-300" />
                  )}
                </div>
                <div className="text-center w-full">
                  <h3 className="font-bold text-lg text-gray-900 leading-tight">{visitaDetalhes.visitante}</h3>
                  <p className="text-sm text-gray-500 font-medium">{visitaDetalhes.empresa}</p>
                  <Badge variant="outline" className="mt-2 text-xs">{visitaDetalhes.documento || 'Sem doc'}</Badge>
                </div>
              </div>

              {/* Coluna 2 e 3: Dados da Visita */}
              <div className="md:col-span-2 space-y-4">
                <div className="grid grid-cols-2 gap-y-4 gap-x-2 bg-gray-50/50 p-4 rounded-lg border border-gray-100">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Data da Visita</p>
                    <p className="font-medium text-gray-900 flex items-center gap-1.5">
                      <CalendarDays className="w-4 h-4 text-gray-400" />
                      {visitaDetalhes.data.split('-').reverse().join('/')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Responsável</p>
                    <p className="font-medium text-gray-900 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-gray-400" />
                      {visitaDetalhes.responsavel}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Entrada</p>
                    <p className="font-medium text-emerald-600 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      {visitaDetalhes.horarioEntrada || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Saída</p>
                    <p className="font-medium text-rose-600 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      {visitaDetalhes.horarioSaida || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Contato</p>
                    <p className="font-medium text-gray-900 flex items-center gap-1.5">
                      <Phone className="w-4 h-4 text-gray-400" />
                      {visitaDetalhes.contato || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Motivo / Tipo</p>
                    <Badge className={`${getCorDescricao(visitaDetalhes.descricao)} text-xs font-medium`}>
                      {visitaDetalhes.descricao}
                    </Badge>
                  </div>
                </div>

                {/* Veículo (se houver) */}
                <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                  <h4 className="text-sm font-semibold text-blue-900 flex items-center gap-2 mb-3">
                    <Car className="w-4 h-4" /> Dados do Veículo e NF
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-blue-400 font-medium uppercase tracking-wider mb-1">Placa</p>
                      <p className="font-medium text-blue-900">{visitaDetalhes.placaVeiculo !== '-' ? visitaDetalhes.placaVeiculo : 'A pé / Sem veículo'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-blue-400 font-medium uppercase tracking-wider mb-2">Notas Fiscais</p>
                      {visitaDetalhes.notasFiscais && visitaDetalhes.notasFiscais.some(n => n.numero) ? (
                        <div className="space-y-1">
                          {visitaDetalhes.notasFiscais.filter(n => n.numero).map((nf, i) => (
                            <div key={i} className="flex items-center justify-between bg-white rounded px-2 py-1 border border-blue-100">
                              <span className="font-medium text-blue-900 text-sm">{nf.numero}</span>
                              <span className="text-blue-700 text-sm font-semibold">{formatarMoeda(nf.valor)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="font-medium text-blue-900">N/A</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 border-t pt-4">
            <Button onClick={() => setVisitaDetalhes(null)} className="w-full sm:w-auto">
              <Check className="w-4 h-4 mr-2" /> Fechar Detalhes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Detalhes de NFs de Entrada (apenas para Admin) */}
      <Dialog open={modalNFsAberto} onOpenChange={setModalNFsAberto}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl border-b pb-4">
              <CreditCard className="w-6 h-6 text-rose-500" />
              Detalhamento de NFs de Entrada
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* Filtros e Resumo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Período de Filtro:</span>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={filtroPeriodoNF === 'dia' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoNF('dia')}
                    className={filtroPeriodoNF === 'dia' ? 'bg-rose-600 hover:bg-rose-700 text-white font-medium border-rose-600' : 'text-gray-600'}
                  >
                    Hoje
                  </Button>
                  <Button
                    variant={filtroPeriodoNF === 'semana' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoNF('semana')}
                    className={filtroPeriodoNF === 'semana' ? 'bg-rose-600 hover:bg-rose-700 text-white font-medium border-rose-600' : 'text-gray-600'}
                  >
                    Esta Semana
                  </Button>
                  <Button
                    variant={filtroPeriodoNF === 'mes' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoNF('mes')}
                    className={filtroPeriodoNF === 'mes' ? 'bg-rose-600 hover:bg-rose-700 text-white font-medium border-rose-600' : 'text-gray-600'}
                  >
                    Este Mês
                  </Button>
                  <Button
                    variant={filtroPeriodoNF === 'todos' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoNF('todos')}
                    className={filtroPeriodoNF === 'todos' ? 'bg-rose-600 hover:bg-rose-700 text-white font-medium border-rose-600' : 'text-gray-600'}
                  >
                    Todas as NFs
                  </Button>
                </div>
              </div>

              {/* Totais */}
              <div className="flex gap-6 items-center">
                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Qtd Notas</div>
                  <div className="text-lg font-bold text-gray-900">{totalQtdNFsFiltradas}</div>
                </div>
                <div className="text-right border-l pl-6 border-gray-200">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Acumulado</div>
                  <div className="text-xl font-black text-rose-600">{formatarMoeda(totalValorNFsFiltradas)}</div>
                </div>
              </div>
            </div>

            {/* Listagem */}
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
              <div className="overflow-x-auto max-h-[40vh] overflow-y-auto pr-1">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Data</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">NF</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Fornecedor/Empresa</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Visitante</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Responsável</th>
                      <th className="text-right py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nfsFiltradas.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-gray-400 font-medium bg-white">
                          Nenhuma nota fiscal de entrada registrada no período.
                        </td>
                      </tr>
                    ) : (
                      nfsFiltradas.map((nf, idx) => (
                        <tr key={`${nf.id}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors bg-white">
                          <td className="py-3.5 px-4 text-gray-600 whitespace-nowrap">{nf.data.split('-').reverse().join('/')}</td>
                          <td className="py-3.5 px-4 font-bold text-blue-600">{nf.numero}</td>
                          <td className="py-3.5 px-4 font-semibold text-gray-900">{nf.empresa}</td>
                          <td className="py-3.5 px-4 text-gray-700">{nf.visitante}</td>
                          <td className="py-3.5 px-4">
                            <Badge variant="outline" className="font-normal text-xs">{nf.responsavel}</Badge>
                          </td>
                          <td className="py-3.5 px-4 text-right font-bold text-gray-900 whitespace-nowrap">{formatarMoeda(nf.valor)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4 border-t pt-4">
            <Button onClick={() => setModalNFsAberto(false)} variant="outline" className="w-full sm:w-auto bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-700">
              <Check className="w-4 h-4 mr-2" /> Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Detalhes de Visitas / Entregas de KPIs (apenas para Admin) */}
      <Dialog open={modalKPIAtivo !== null} onOpenChange={(open) => !open && setModalKPIAtivo(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl border-b pb-4">
              {modalKPIAtivo === 'visitas_hoje' && <CalendarDays className="w-6 h-6 text-emerald-500" />}
              {modalKPIAtivo === 'em_andamento' && <Clock className="w-6 h-6 text-amber-500" />}
              {modalKPIAtivo === 'entregas' && <FileText className="w-6 h-6 text-blue-500" />}
              {modalKPIAtivo === 'tecnicas' && <Users className="w-6 h-6 text-purple-500" />}

              {modalKPIAtivo === 'visitas_hoje' && "Detalhamento de Visitas"}
              {modalKPIAtivo === 'em_andamento' && "Detalhamento de Visitas em Aberto"}
              {modalKPIAtivo === 'entregas' && "Detalhamento de Entregas"}
              {modalKPIAtivo === 'tecnicas' && "Detalhamento de Visitas Técnicas"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* Filtros e Resumo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Período de Filtro:</span>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={filtroPeriodoKPI === 'dia' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoKPI('dia')}
                    className={filtroPeriodoKPI === 'dia' ? 'bg-primary text-white font-medium hover:bg-primary/95' : 'text-gray-600'}
                  >
                    Hoje
                  </Button>
                  <Button
                    variant={filtroPeriodoKPI === 'semana' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoKPI('semana')}
                    className={filtroPeriodoKPI === 'semana' ? 'bg-primary text-white font-medium hover:bg-primary/95' : 'text-gray-600'}
                  >
                    Esta Semana
                  </Button>
                  <Button
                    variant={filtroPeriodoKPI === 'mes' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoKPI('mes')}
                    className={filtroPeriodoKPI === 'mes' ? 'bg-primary text-white font-medium hover:bg-primary/95' : 'text-gray-600'}
                  >
                    Este Mês
                  </Button>
                  <Button
                    variant={filtroPeriodoKPI === 'todos' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroPeriodoKPI('todos')}
                    className={filtroPeriodoKPI === 'todos' ? 'bg-primary text-white font-medium hover:bg-primary/95' : 'text-gray-600'}
                  >
                    Todos os Registros
                  </Button>
                </div>
              </div>

              {/* Totais */}
              <div className="flex gap-6 items-center">
                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total de Registros</div>
                  <div className="text-xl font-bold text-gray-900">{totalQtdKPIFiltrados}</div>
                </div>
              </div>
            </div>

            {/* Listagem */}
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
              <div className="overflow-x-auto max-h-[40vh] overflow-y-auto pr-1">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Data</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Empresa</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Visitante</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Entrada</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Saída</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Responsável</th>
                      <th className="text-left py-3 px-4 font-semibold bg-gray-50 border-b border-gray-200">Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitasKPILimitadas.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-gray-400 font-medium bg-white">
                          Nenhum registro encontrado no período.
                        </td>
                      </tr>
                    ) : (
                      visitasKPILimitadas.map((v, idx) => (
                        <tr key={`${v.id}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors bg-white">
                          <td className="py-3.5 px-4 text-gray-600 whitespace-nowrap">{v.data.split('-').reverse().join('/')}</td>
                          <td className="py-3.5 px-4 font-semibold text-gray-900">{v.empresa}</td>
                          <td className="py-3.5 px-4 text-gray-700">{v.visitante}</td>
                          <td className="py-3.5 px-4 text-gray-600 whitespace-nowrap">{v.horarioEntrada || '-'}</td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {v.horarioSaida ? (
                              <span className="text-gray-600">{v.horarioSaida}</span>
                            ) : v.horarioEntrada ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Em aberto
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <Badge variant="outline" className="font-normal text-xs">{v.responsavel}</Badge>
                          </td>
                          <td className="py-3.5 px-4">
                            <Badge className={`${getCorDescricao(v.descricao)} text-xs font-medium`}>{v.descricao}</Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4 border-t pt-4">
            <Button onClick={() => setModalKPIAtivo(null)} variant="outline" className="w-full sm:w-auto bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-700">
              <Check className="w-4 h-4 mr-2" /> Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Detalhamento KM por Veículo */}
      <Dialog open={modalKmFrotaAberto} onOpenChange={(open) => { if (!open) { setModalKmFrotaAberto(false); setVeiculoExpandido(null); } }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl border-b pb-4">
              <Truck className="w-6 h-6 text-blue-500" />
              Detalhamento de KM por Veículo
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* Filtros de período */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Período:</span>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={filtroKmFrota === 'dia' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setFiltroKmFrota('dia'); setVeiculoExpandido(null); }}
                    className={filtroKmFrota === 'dia' ? 'bg-blue-600 text-white font-medium hover:bg-blue-700' : 'text-gray-600'}
                  >
                    Hoje
                  </Button>
                  <Button
                    variant={filtroKmFrota === 'semana' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setFiltroKmFrota('semana'); setVeiculoExpandido(null); }}
                    className={filtroKmFrota === 'semana' ? 'bg-blue-600 text-white font-medium hover:bg-blue-700' : 'text-gray-600'}
                  >
                    Esta Semana
                  </Button>
                  <Button
                    variant={filtroKmFrota === 'mes' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setFiltroKmFrota('mes'); setVeiculoExpandido(null); }}
                    className={filtroKmFrota === 'mes' ? 'bg-blue-600 text-white font-medium hover:bg-blue-700' : 'text-gray-600'}
                  >
                    Este Mês
                  </Button>
                </div>
              </div>
              <div className="flex gap-6 items-center">
                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">KM Total no Período</div>
                  <div className="text-xl font-bold text-blue-700">{totalKmFiltrado} km</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Veículos</div>
                  <div className="text-xl font-bold text-gray-900">{kmPorVeiculo.length}</div>
                </div>
              </div>
            </div>

            {/* Listagem de veículos */}
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
              <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
                {kmPorVeiculo.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 font-medium">
                    Nenhum registro de frota encontrado no período.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {kmPorVeiculo.map((grupo) => (
                      <div key={grupo.veiculo}>
                        {/* Linha do veículo */}
                        <div
                          className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-blue-50/60 transition-colors"
                          onClick={() => setVeiculoExpandido(veiculoExpandido === grupo.veiculo ? null : grupo.veiculo)}
                        >
                          <div className="flex items-center gap-3">
                            {veiculoExpandido === grupo.veiculo
                              ? <ChevronDown className="w-4 h-4 text-blue-500" />
                              : <ChevronRight className="w-4 h-4 text-gray-400" />
                            }
                            <Car className="w-5 h-5 text-teal-600" />
                            <div>
                              <div className="font-semibold text-gray-900">{grupo.veiculo}</div>
                              <div className="text-xs text-gray-500">
                                {grupo.motoristas.join(', ')} — {grupo.registros.length} viage{grupo.registros.length === 1 ? 'm' : 'ns'}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-blue-700">{grupo.kmTotal} km</div>
                          </div>
                        </div>

                        {/* Sub-tabela com detalhes (expandido) */}
                        {veiculoExpandido === grupo.veiculo && (
                          <div className="bg-gray-50/80 px-5 pb-4">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-gray-500 text-xs uppercase tracking-wider">
                                  <th className="text-left py-2 px-2 font-semibold">Data</th>
                                  <th className="text-left py-2 px-2 font-semibold">Motorista</th>
                                  <th className="text-left py-2 px-2 font-semibold">Saída</th>
                                  <th className="text-left py-2 px-2 font-semibold">Retorno</th>
                                  <th className="text-right py-2 px-2 font-semibold">KM Saída</th>
                                  <th className="text-right py-2 px-2 font-semibold">KM Entrada</th>
                                  <th className="text-right py-2 px-2 font-semibold">KM Rodados</th>
                                  <th className="text-left py-2 px-2 font-semibold">Destino</th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.registros
                                  .sort((a, b) => a.data.localeCompare(b.data))
                                  .map((r, idx) => (
                                    <tr key={`${r.id}-${idx}`} className="border-t border-gray-200/60 hover:bg-white transition-colors">
                                      <td className="py-2 px-2 text-gray-700 whitespace-nowrap">{r.data.split('-').reverse().join('/')}</td>
                                      <td className="py-2 px-2 font-medium text-gray-900">{r.motorista}</td>
                                      <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{r.horarioSaida || '-'}</td>
                                      <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
                                        {r.horarioRetorno || (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-0.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            Em trânsito
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-2 px-2 text-right text-gray-600">{(r.kmSaida || 0).toLocaleString()}</td>
                                      <td className="py-2 px-2 text-right text-gray-600">{r.kmEntrada > 0 ? r.kmEntrada.toLocaleString() : '-'}</td>
                                      <td className="py-2 px-2 text-right font-semibold text-blue-700">{Math.max(0, r.kmRodados) > 0 ? `${Math.max(0, r.kmRodados)} km` : '-'}</td>
                                      <td className="py-2 px-2 text-gray-700">{r.destino}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4 border-t pt-4">
            <Button onClick={() => { setModalKmFrotaAberto(false); setVeiculoExpandido(null); }} variant="outline" className="w-full sm:w-auto bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-700">
              <Check className="w-4 h-4 mr-2" /> Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal - Registrar Recebimento (Recebidos) */}
      <Dialog open={modalRecebidoAberto} onOpenChange={setModalRecebidoAberto}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Registrar Recebimento
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            {/* Foto do Recebido */}
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <Label className="text-sm font-semibold text-gray-700">Foto do Recebido</Label>
              </div>

              {cameraRecebidoOpen ? (
                <CameraCapture
                  onCapture={handleFotoRecebidoCapture}
                  onCancel={() => setCameraRecebidoOpen(false)}
                />
              ) : formRecebido.fotoBase64 ? (
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-lg overflow-hidden border">
                    <img src={formRecebido.fotoBase64} alt="Recebido" className="w-full h-full object-cover" />
                  </div>
                  <Button type="button" variant="outline" onClick={() => { setFormRecebido(prev => ({ ...prev, fotoBase64: undefined })); setCameraRecebidoOpen(true); }}>
                    Tirar Nova Foto
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center p-6 border-2 border-dashed rounded-lg bg-gray-50 text-gray-400">
                  <Package className="w-12 h-12 mb-2 opacity-50" />
                  <p className="text-sm mb-4">Nenhuma foto capturada</p>
                  <Button type="button" onClick={() => setCameraRecebidoOpen(true)}>
                    Abrir Câmera para Foto
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data (Preenchida Automaticamente)</Label>
                <Input
                  type="date"
                  value={formRecebido.data}
                  disabled
                  className="bg-gray-50"
                />
              </div>
              <div className="space-y-2">
                <Label>Hora de Registro (Preenchida Automaticamente)</Label>
                <Input
                  type="text"
                  value={formRecebido.horaRegistro}
                  disabled
                  className="bg-gray-50"
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Remetente *</Label>
                <Input
                  placeholder="Quem enviou"
                  value={formRecebido.remetente}
                  onChange={(e) => setFormRecebido({ ...formRecebido, remetente: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Destinatário (Setor/Responsável) *</Label>
                <Select
                  value={formRecebido.destinatario}
                  onValueChange={(val) => setFormRecebido({ ...formRecebido, destinatario: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o setor/responsável destinatário" />
                  </SelectTrigger>
                  <SelectContent>
                    {DESTINATARIOS.map((dest) => (
                      <SelectItem key={dest} value={dest}>{dest}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Descrição / Observações</Label>
                <Input
                  placeholder="Breve descrição do conteúdo ou observações"
                  value={formRecebido.descricao}
                  onChange={(e) => setFormRecebido({ ...formRecebido, descricao: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalRecebidoAberto(false)}>
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={adicionarRecebido} className="bg-blue-600 hover:bg-blue-700">
              <Check className="w-4 h-4 mr-1" /> Registrar Recebido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Detalhes do Recebido */}
      <Dialog open={!!recebidoDetalhes} onOpenChange={() => setRecebidoDetalhes(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl border-b pb-4">
              <Package className="w-6 h-6 text-blue-500" />
              Detalhes do Recebido
            </DialogTitle>
          </DialogHeader>

          {recebidoDetalhes && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
              {/* Coluna 1: Foto */}
              <div className="flex flex-col items-center gap-4 border-r border-gray-100 pr-4">
                <div className="w-40 h-40 rounded-xl overflow-hidden border-2 border-gray-100 shadow-sm bg-gray-50 flex items-center justify-center">
                  {carregandoFotoRecebido ? (
                    <RefreshCw className="w-8 h-8 text-gray-300 animate-spin" />
                  ) : fotoRecebidoDetalhe ? (
                    <img src={fotoRecebidoDetalhe} alt="Recebido" className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-20 h-20 text-gray-300" />
                  )}
                </div>
              </div>

              {/* Coluna 2 e 3: Dados do Recebido */}
              <div className="md:col-span-2 space-y-4">
                <div className="grid grid-cols-2 gap-y-4 gap-x-2 bg-gray-50/50 p-4 rounded-lg border border-gray-100">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Data de Registro</p>
                    <p className="font-medium text-gray-900 flex items-center gap-1.5">
                      <CalendarDays className="w-4 h-4 text-gray-400" />
                      {recebidoDetalhes.data.split('-').reverse().join('/')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Hora de Registro</p>
                    <p className="font-medium text-gray-900 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-gray-400" />
                      {recebidoDetalhes.horaRegistro}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Remetente</p>
                    <p className="font-medium text-gray-900">
                      {recebidoDetalhes.remetente}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Destinatário</p>
                    <Badge variant="outline" className="font-normal text-xs text-gray-900">
                      {recebidoDetalhes.destinatario}
                    </Badge>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Descrição / Observações</p>
                    <p className="text-sm text-gray-700 bg-white p-3 rounded border border-gray-100 min-h-[60px] whitespace-pre-wrap">
                      {recebidoDetalhes.descricao || 'Nenhuma descrição fornecida.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 border-t pt-4">
            <Button onClick={() => setRecebidoDetalhes(null)} className="w-full sm:w-auto">
              <Check className="w-4 h-4 mr-2" /> Fechar Detalhes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
