import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  BarChart3, 
  Upload, 
  Settings2, 
  TrendingUp, 
  Dices, 
  FileSpreadsheet, 
  ChevronRight,
  Info,
  Layers,
  Database,
  Terminal,
  Download,
  Sparkles,
  Play,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { Ball } from './components/Ball';
import { cn } from './lib/utils';
import { analyzeFrequenciy, calculateParityStats, generateGames } from './services/analysisService';
import { AnalysisResult, Game, ParityStats } from './types';

export default function App() {
  const [data, setData] = useState<number[][]>([]);
  const [contestsToAnalyze, setContestsToAnalyze] = useState(10);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [parityStats, setParityStats] = useState<ParityStats[]>([]);
  const [generatedGames, setGeneratedGames] = useState<Game[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<{
    message: string;
    isSyncError: boolean;
    details?: string;
    manual_url?: string;
  } | null>(null);
  
  // Game Generation Config
  const [numGames, setNumGames] = useState(10);
  const [gameSize, setGameSize] = useState(15);
  const [qtCount, setQtCount] = useState(3);
  const [qCount, setQCount] = useState(3);
  const [mCount, setMCount] = useState(3);
  const [fCount, setFCount] = useState(3);
  const [gCount, setGCount] = useState(3);
  const [minEvens, setMinEvens] = useState(6);
  const [maxEvens, setMaxEvens] = useState(9);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data.length > 0 && !generatedGames.length) {
       runAnalysis();
    }
  }, [data, generatedGames.length]);

  const processRawData = (rawData: any[][]) => {
    const processed: number[][] = [];
    
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return [];

    console.log(`Iniciando processamento de ${rawData.length} linhas...`);

    // O usuário solicitou:
    // 1. Ler apenas das colunas C até Q (bolas sorteadas) -> Índices 2 a 16
    // 2. Contar as linhas para determinar o número concurso (implícito na ordem)
    // 3. Linhas de numeração mais alta (índice maior no array) são as mais recentes

    rawData.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length < 17) return;

      const balls: number[] = [];
      // Colunas C (index 2) até Q (index 16) - total de 15 colunas
      for (let i = 2; i <= 16; i++) {
        const cell = row[i];
        if (cell === null || cell === undefined || String(cell).trim() === '') continue;
        
        let val = NaN;
        if (typeof cell === 'number') {
          val = Math.floor(cell);
        } else {
          // Extrai apenas os dígitos da célula (ex: "01" -> 1, " 05 " -> 5)
          const str = String(cell).trim();
          if (str) {
            // Tenta converter removendo zeros à esquerda
            const sanitized = str.replace(/^0+/, '');
            val = parseInt(sanitized || str, 10); // Usa str original se sanitized for vazio (caso do "0")
            
            // Se falhar, extrai qualquer número de dentro da string
            if (isNaN(val)) {
              const digits = str.replace(/[^0-9]/g, '');
              if (digits) val = parseInt(digits, 10);
            }
          }
        }
        
        if (!isNaN(val) && val >= 1 && val <= 25) {
          balls.push(val);
        }
      }

      // Validação: a Lotofácil sempre tem 15 dezenas nas colunas C-Q
      if (balls.length === 15) {
        // Ordenamos as dezenas para garantir consistência estatística
        const sortedBalls = [...balls].sort((a, b) => a - b);
        processed.push(sortedBalls);
      } else if (rowIndex > 0 && balls.length > 0) {
         // Log de depuração mais detalhado para ajudar o usuário
         console.debug(`Linha ${rowIndex + 1} (Conc: ${row[0]}) ignorada: ${balls.length} dezenas em C-Q.`);
      }
    });

    if (processed.length === 0) {
      console.warn("Nenhum resultado válido encontrado nas colunas C-Q. Verifique se o arquivo tem 15 dezenas entre as colunas C e Q.");
      return [];
    }
    
    console.log(`Sucesso: ${processed.length} registros extraídos.`);
    return processed; 
  };

  useEffect(() => {
    // Proportional parity limits
    const ratio = gameSize / 15;
    setMinEvens(Math.floor(6 * ratio));
    setMaxEvens(Math.ceil(9 * ratio));

    // Re-suggest distribution for the new game size
    if (analysis) {
       suggestDistribution(analysis);
    }
  }, [gameSize]);

  const updateCounts = (key: string, newVal: number) => {
    const keys = ['qt', 'q', 'm', 'f', 'g'] as const;
    const currentValues = { qt: qtCount, q: qCount, m: mCount, f: fCount, g: gCount };
    const maxLimits = {
      qt: analysis?.quentissimas.length ?? 25,
      q: analysis?.quentes.length ?? 25,
      m: analysis?.mornas.length ?? 25,
      f: analysis?.frias.length ?? 25,
      g: analysis?.geladas.length ?? 25,
    };

    const setters: Record<string, React.Dispatch<React.SetStateAction<number>>> = {
      qt: setQtCount,
      q: setQCount,
      m: setMCount,
      f: setFCount,
      g: setGCount,
    };

    const idx = keys.indexOf(key as any);
    const oldVal = currentValues[key as keyof typeof currentValues];
    const diff = oldVal - newVal;

    if (diff > 0) {
      // User reduced the value. Add to the right.
      setters[key](newVal);
      let remainingToAdd = diff;
      for (let i = idx + 1; i < keys.length && remainingToAdd > 0; i++) {
        const nextKey = keys[i];
        const nextVal = currentValues[nextKey];
        const nextMax = maxLimits[nextKey];
        
        const canConsume = nextMax - nextVal;
        const addAmt = Math.min(remainingToAdd, canConsume);
        
        setters[nextKey](nextVal + addAmt);
        remainingToAdd -= addAmt;
      }
    } else if (diff < 0) {
      // User increased the value. Subtract from the right to balance.
      const incAmt = Math.abs(diff);
      const allowedNewVal = Math.min(newVal, maxLimits[key as keyof typeof maxLimits]);
      const actualInc = allowedNewVal - oldVal;
      
      setters[key](allowedNewVal);
      
      let remainingToSub = actualInc;
      for (let i = idx + 1; i < keys.length && remainingToSub > 0; i++) {
        const nextKey = keys[i];
        const nextVal = currentValues[nextKey];
        
        const canSub = nextVal;
        const subAmt = Math.min(remainingToSub, canSub);
        
        setters[nextKey](nextVal - subAmt);
        remainingToSub -= subAmt;
      }
    }
  };

  const suggestDistribution = (result: AnalysisResult) => {
    let remaining = gameSize;
    const counts = { qt: 0, q: 0, m: 0, f: 0, g: 0 };
    
    counts.qt = Math.min(remaining, result.quentissimas.length);
    remaining -= counts.qt;
    
    counts.q = Math.min(remaining, result.quentes.length);
    remaining -= counts.q;
    
    counts.m = Math.min(remaining, result.mornas.length);
    remaining -= counts.m;
    
    counts.f = Math.min(remaining, result.frias.length);
    remaining -= counts.f;
    
    counts.g = Math.min(remaining, result.geladas.length);
    remaining -= counts.g;

    setQtCount(counts.qt);
    setQCount(counts.q);
    setMCount(counts.m);
    setFCount(counts.f);
    setGCount(counts.g);

    // Cativar a paridade sugerida com base na distribuição
    const cats = [
      { data: result.quentissimas, count: counts.qt },
      { data: result.quentes, count: counts.q },
      { data: result.mornas, count: counts.m },
      { data: result.frias, count: counts.f },
      { data: result.geladas, count: counts.g },
    ];

    let avgEvens = 0;
    cats.forEach(cat => {
      if (cat.data.length === 0) return;
      const evensInCat = cat.data.filter(d => d.dezena % 2 === 0).length;
      const evenRatio = evensInCat / cat.data.length;
      avgEvens += evenRatio * cat.count;
    });

    const suggestedEvens = Math.round(avgEvens);
    setMinEvens(suggestedEvens);
    setMaxEvens(suggestedEvens);

    return counts;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSyncError(null);
    setFileName(file.name);
    setIsSyncing(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      let finalData: ArrayBuffer | string = arrayBuffer;

      // Handle ZIP file
      if (file.name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);
        const files = Object.keys(zip.files).filter(f => !zip.files[f].dir);
        
        // Find the most likely result file (htm, html, xlsx, xls)
        const resultFileKey = files.find(f => 
          f.toLowerCase().endsWith('.htm') || 
          f.toLowerCase().endsWith('.html') || 
          f.toLowerCase().endsWith('.xlsx') || 
          f.toLowerCase().endsWith('.xls')
        );

        if (resultFileKey) {
          const zipFile = zip.files[resultFileKey];
          finalData = await zipFile.async('arraybuffer');
        } else {
          throw new Error("Nenhum arquivo de resultados (HTM ou XLSX) encontrado dentro do ZIP.");
        }
      }

      const wb = XLSX.read(finalData, { type: 'array', cellStyles: true, cellDates: true, cellNF: true });
      
      let bestSheetData: number[][] = [];
      let bestSheetName = '';
      
      // Scan all sheets to find the one with the most records
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
        if (rows.length > 0) {
          const processed = processRawData(rows);
          if (processed.length > bestSheetData.length) {
            bestSheetData = processed;
            bestSheetName = sn;
          }
        }
      }

      if (bestSheetData.length > 0) {
        setData(bestSheetData);
        setFileName(file.name);
        setSyncError(null);
        
        // Auto-run analysis
        const res = analyzeFrequenciy(bestSheetData, contestsToAnalyze);
        setAnalysis(res);
        setParityStats(calculateParityStats(res));
        const dist = suggestDistribution(res);

        const games = generateGames(res, {
          n_jogos: numGames,
          qt: dist.qt,
          q: dist.q,
          m: dist.m,
          f: dist.f,
          g: dist.g,
          minEvens,
          maxEvens,
          history: bestSheetData
        });
        setGeneratedGames(games);
        console.log(`Sucesso: Carregadas ${bestSheetData.length} linhas da aba "${bestSheetName}"`);
      } else {
        throw new Error("Arquivo carregado, mas não detectamos resultados válidos da Lotofácil (15 dezenas entre 1 e 25) em nenhuma das abas.");
      }
    } catch (err: any) {
      console.error("Erro ao ler arquivo:", err);
      setSyncError({
        message: `Erro no arquivo: ${err.message || 'Formato incompatível'}`,
        isSyncError: false
      });
    } finally {
      setIsSyncing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSyncCaixa = async () => {
    setIsSyncing(true);
    setSyncError(null);
    setFileName('Sincronizando...');
    try {
      const response = await fetch('/api/sync-caixa');
      const contentType = response.headers.get('content-type');
      
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error("O servidor retornou um formato inesperado. Tente novamente em instantes.");
      }

      const result = await response.json();
      
      if (result.error) {
        setSyncError({
          message: result.error,
          details: result.details,
          manual_url: result.manual_url,
          isSyncError: true
        });
        setFileName('Falha na sincronização');
        return;
      }

      const { data, fileName } = result;

      const processedData = processRawData(data);

      if (processedData.length > 0) {
        setData(processedData);
        setFileName(fileName);
        const result = analyzeFrequenciy(processedData, contestsToAnalyze);
        setAnalysis(result);
        setParityStats(calculateParityStats(result));
        const dist = suggestDistribution(result);
        
        // Auto-generate games
        const games = generateGames(result, {
          n_jogos: numGames,
          qt: dist.qt,
          q: dist.q,
          m: dist.m,
          f: dist.f,
          g: dist.g,
          minEvens,
          maxEvens,
          history: processedData
        });
        setGeneratedGames(games);
      } else {
        throw new Error("Dados sincronizados, mas nenhum resultado válido encontrado.");
      }
    } catch (err: any) {
      console.error(err);
      let errorMsg = err.message || "A conexão automática com a Caixa falhou (bloqueio de acesso ou site instável).";
      setSyncError({
        message: errorMsg,
        isSyncError: true
      });
      setFileName('Falha na sincronização');
    } finally {
      setIsSyncing(false);
    }
  };

  const runAnalysis = () => {
    if (data.length === 0) return;
    const result = analyzeFrequenciy(data, contestsToAnalyze);
    setAnalysis(result);
    setParityStats(calculateParityStats(result));
    const dist = suggestDistribution(result);

    const games = generateGames(result, {
      n_jogos: numGames,
      qt: dist.qt,
      q: dist.q,
      m: dist.m,
      f: dist.f,
      g: dist.g,
      minEvens,
      maxEvens,
      history: data
    });
    setGeneratedGames(games);
  };

  const handleGenerate = () => {
    if (!analysis) return;
    setGeneratedGames([]); // Flash effect
    setTimeout(() => {
      const games = generateGames(analysis, {
        n_jogos: numGames,
        qt: qtCount,
        q: qCount,
        m: mCount,
        f: fCount,
        g: gCount,
        minEvens,
        maxEvens,
        history: data
      });
      setGeneratedGames(games);
    }, 50);
  };

  const resetParams = () => {
    setContestsToAnalyze(10);
    setNumGames(10);
    setGameSize(15);
    setQtCount(3);
    setQCount(3);
    setMCount(3);
    setFCount(3);
    setGCount(3);
    setMinEvens(6);
    setMaxEvens(9);
    setGeneratedGames([]);
    if (data.length > 0) {
      runAnalysis();
    }
  };

  const handleExport = () => {
    if (generatedGames.length === 0) {
      setSyncError({ message: "Nenhum jogo gerado para exportar. Gere jogos primeiro.", isSyncError: false });
      return;
    }

    // Sheet 1: Generated Games
    const gamesData = generatedGames.map((game, idx) => {
      const row: any = { 
        'Sequência': idx + 1,
      };
      
      // Traditional Lottery Layout: B1, B2, ... B15
      game.balls.sort((a, b) => a - b).forEach((num, bIdx) => {
        row[`Bola ${String(bIdx + 1).padStart(2, '0')}`] = num.toString().padStart(2, '0');
      });
      
      row['Total Pares'] = game.evens;
      row['Total Ímpares'] = game.odds;
      row['Distribuição (PAR/ÍMPAR)'] = `${game.evens}PAR/${game.odds}ÍMPAR`;
      row['Status Inédito'] = game.isNew ? 'SIM' : 'NÃO';
      
      return row;
    });

    try {
      const wsGames = XLSX.utils.json_to_sheet(gamesData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsGames, "Jogos Gerados");

      // Sheet 2: Analysis Details
      if (analysis) {
        const freqData = [
          ...analysis.quentissimas.map(d => ({ Dezena: d.dezena, Freq: d.frequencia, Categoria: 'Quentíssima' })),
          ...analysis.quentes.map(d => ({ Dezena: d.dezena, Freq: d.frequencia, Categoria: 'Quente' })),
          ...analysis.mornas.map(d => ({ Dezena: d.dezena, Freq: d.frequencia, Categoria: 'Morna' })),
          ...analysis.frias.map(d => ({ Dezena: d.dezena, Freq: d.frequencia, Categoria: 'Fria' })),
          ...analysis.geladas.map(d => ({ Dezena: d.dezena, Freq: d.frequencia, Categoria: 'Gelada' })),
        ].sort((a, b) => b.Freq - a.Freq);

        const wsAnalysis = XLSX.utils.json_to_sheet(freqData);
        XLSX.utils.book_append_sheet(wb, wsAnalysis, "Análise de Dezenas");
      }

      // Export file
      const dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      XLSX.writeFile(wb, `LotoSmart_IA_Jogos_${dateStr}.xlsx`);
    } catch (err) {
      console.error("Erro na exportação:", err);
      setSyncError({ message: "Houve um erro ao gerar o arquivo Excel. Verifique se o navegador tem permissão para downloads.", isSyncError: false });
    }
  };

  const totalSelected = qtCount + qCount + mCount + fCount + gCount;

  const expectedParity = useMemo(() => {
    if (!analysis) return { evens: 0, odds: 0 };
    
    const cats = [
      { data: analysis.quentissimas, count: qtCount },
      { data: analysis.quentes, count: qCount },
      { data: analysis.mornas, count: mCount },
      { data: analysis.frias, count: fCount },
      { data: analysis.geladas, count: gCount },
    ];

    let avgEvens = 0;
    cats.forEach(cat => {
      if (cat.data.length === 0) return;
      const evensInCat = cat.data.filter(d => d.dezena % 2 === 0).length;
      const evenRatio = evensInCat / cat.data.length;
      avgEvens += evenRatio * cat.count;
    });

    return {
      evens: Math.round(avgEvens),
      odds: totalSelected - Math.round(avgEvens)
    };
  }, [analysis, qtCount, qCount, mCount, fCount, gCount, totalSelected]);

  return (
     <div className="min-h-screen lg:h-screen flex flex-col p-4 md:p-6 gap-4 md:gap-6 font-sans overflow-x-hidden">
      {/* Top Header */}
      <header className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 shrink-0 transition-all">
        <div className="flex flex-col items-center lg:items-start justify-center">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase italic gradient-text flex items-center gap-2 leading-none">
              <TrendingUp className="w-6 h-6 md:w-8 md:h-8 text-green-500" />
              LotoSmart IA
            </h1>
            <input 
              type="file" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".xlsx, .xls, .zip, .htm, .html"
            />
          </div>
          <p className="text-[9px] md:text-xs text-slate-500 font-mono tracking-widest uppercase mt-2 leading-none text-center lg:text-left">
            ANALISADOR ESTATÍSTICO DE ALTA PERFORMANCE
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full lg:w-auto items-center justify-center lg:justify-end overflow-x-auto pb-1 lg:pb-0 custom-scrollbar">
          <button 
              onClick={handleGenerate}
              disabled={!analysis || totalSelected !== gameSize}
              className="bg-green-500 hover:bg-green-400 text-black font-bold px-3 py-2 md:px-4 md:py-2.5 rounded-lg transition-all glow-green uppercase text-[9px] md:text-xs flex items-center gap-2 disabled:opacity-50 disabled:grayscale shrink-0 text-left"
            >
              <Play className="w-4 h-4 md:w-5 md:h-5" />
              <div className="flex flex-col leading-tight">
                <span className="hidden sm:inline">Gerar</span>
                <span className="hidden sm:inline font-black">Jogos</span>
                <span className="sm:hidden">Gerar</span>
              </div>
          </button>
          <button 
            onClick={handleGenerate}
            disabled={!analysis || totalSelected !== gameSize}
            className="bg-green-500 hover:bg-green-400 text-black font-bold px-3 py-2 md:px-4 md:py-2.5 rounded-lg transition-all glow-green uppercase text-[9px] md:text-xs flex items-center gap-2 disabled:opacity-50 disabled:grayscale shrink-0 text-left"
          >
            <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
            <div className="flex flex-col leading-tight">
              <span className="hidden sm:inline">Gerar</span>
              <span className="hidden sm:inline font-black">com IA</span>
              <span className="sm:hidden text-[7px]">com IA</span>
            </div>
          </button>
          <button 
            onClick={handleSyncCaixa}
            disabled={isSyncing}
            className={cn(
              "bg-green-500 hover:bg-green-400 text-black font-bold px-3 py-2 md:px-4 md:py-2.5 rounded-lg transition-all glow-green uppercase text-[9px] md:text-xs flex items-center gap-2 shrink-0 text-left",
              isSyncing && "animate-pulse opacity-70 cursor-wait"
            )}
          >
            <Download className={cn("w-4 h-4 md:w-5 md:h-5", isSyncing && "animate-bounce")} />
            <div className="flex flex-col leading-tight">
              {isSyncing ? (
                 <span className="font-black">Sinc...</span>
              ) : (
                <>
                  <span className="hidden sm:inline">Sincronizar</span>
                  <span className="hidden sm:inline font-black">CEF</span>
                  <span className="sm:hidden">CEF</span>
                </>
              )}
            </div>
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold px-3 py-2 md:px-4 md:py-2.5 rounded-lg transition-all uppercase text-[9px] md:text-xs flex items-center gap-2 shrink-0 text-left"
            title="Carregar Arquivo"
          >
            <Upload className="w-4 h-4 md:w-5 md:h-5" />
            <div className="flex flex-col leading-tight">
              <span className="hidden sm:inline">Carregar</span>
              <span className="hidden sm:inline font-black">Local</span>
              <span className="sm:hidden">LOC</span>
            </div>
          </button>
          
          {/* Stats */}
          <div className="glass px-2 md:px-3 py-1.5 rounded-lg text-right flex flex-col justify-center min-w-fit shrink-0">
            <span className="block text-[7px] md:text-[8px] uppercase text-slate-500 font-bold tracking-wider leading-tight text-center sm:text-right">Último</span>
            <span className="block text-xs md:text-base font-mono text-white leading-tight text-center sm:text-right px-2">{data.length || '----'}</span>
          </div>
          <div className="glass px-2 md:px-3 py-1.5 rounded-lg text-right flex flex-col justify-center min-w-fit shrink-0">
            <span className="block text-[7px] md:text-[8px] uppercase text-slate-500 font-bold tracking-wider leading-tight text-center sm:text-right">Base</span>
            <span className="block text-xs md:text-base font-mono text-white leading-tight text-center sm:text-right px-2">{data.length || '---'}</span>
          </div>
          
          {/* Reset */}
          <button 
              onClick={resetParams}
              className="bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 font-bold p-2 md:px-4 md:py-3 rounded-lg transition-all uppercase text-[8px] md:text-[10px] shrink-0"
              title="Resetar"
            >
              Reset
          </button>
        </div>
      </header>
      {/* Sync Error Alert */}
      <AnimatePresence>
        {syncError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden"
          >
            <div className={cn(
              "p-4 rounded-2xl flex items-center justify-between gap-4 border",
              syncError.isSyncError ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-yellow-500/10 border-yellow-500/20 text-yellow-500"
            )}>
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  syncError.isSyncError ? "bg-red-500/20" : "bg-yellow-500/20"
                )}>
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="flex-grow">
                  <p className="text-sm font-bold uppercase tracking-tight leading-none mb-1">
                    {syncError.isSyncError ? "Problema de Sincronização Automática" : "Aviso no Processamento"}
                  </p>
                  <p className="text-xs leading-tight mb-1 opacity-90">
                    {syncError.message}
                  </p>
                  {syncError.details && (
                    <p className="text-[10px] leading-tight mb-3 text-white/70 italic">
                      {syncError.details}
                    </p>
                  )}
                  
                  {syncError.isSyncError && (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        <a 
                          href={syncError.manual_url || "https://loterias.caixa.gov.br/Paginas/Lotofacil.aspx"} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[10px] bg-green-600 text-black px-3 py-2 rounded-xl font-bold uppercase hover:bg-green-500 transition-colors flex items-center gap-1.5 shadow-lg shadow-green-500/20"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> CAIXA (SITE OFICIAL)
                        </a>
                      </div>
                      <div className="text-[10px] text-white/60 bg-black/40 p-3 rounded-xl border border-white/10">
                        <p className="font-bold text-white mb-1 uppercase tracking-wider">Como atualizar manualmente:</p>
                        <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                          <li>No site da Caixa, clique em <span className="text-green-400 font-bold italic">"Download de Resultados"</span>.</li>
                          <li>Isso baixará um arquivo <span className="font-bold uppercase text-white">ZIP ou HTM</span>.</li>
                          <li>Após baixar, clique no botão <button onClick={() => fileInputRef.current?.click()} className="text-yellow-400 font-bold underline cursor-pointer hover:text-yellow-300 transition-colors uppercase">'LOCAL'</button> aqui ou no topo e selecione o arquivo.</li>
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button 
                onClick={() => setSyncError(null)}
                className="hover:bg-black/20 p-2 rounded-lg transition-colors"
                aria-label="Dispensar erro"
              >
                <ChevronRight className="w-5 h-5 rotate-90" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col lg:flex-row gap-6 flex-grow overflow-hidden h-full">
        {/* Left Panel: Parameters */}
        <aside className="w-full lg:w-[400px] lg:shrink-0 flex flex-col gap-6 lg:overflow-y-auto custom-scrollbar lg:h-full pr-0 lg:pr-1">
          <section className="glass rounded-2xl p-4 md:p-6 flex flex-col gap-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-green-400 border-b border-white/10 pb-2 flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Parâmetros de Entrada
            </h2>
            
            <div className="space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-xs text-slate-400 uppercase font-bold italic">Amostragem (Concursos)</label>
                  <span className="text-sm font-mono text-green-400">{contestsToAnalyze < data.length ? contestsToAnalyze : data.length} / {data.length}</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max={Math.max(1000, data.length)} 
                  value={contestsToAnalyze}
                  onChange={(e) => setContestsToAnalyze(Number(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-green-500"
                />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-2 gap-3 md:gap-4">
                <div className="glass p-2 md:p-3 rounded-lg">
                  <label className="text-[9px] md:text-[10px] block text-slate-500 uppercase font-bold mb-1 flex items-center gap-2">
                    <Dices className="w-3 h-3" /> Tamanho
                  </label>
                  <select 
                    value={gameSize}
                    onChange={(e) => setGameSize(Number(e.target.value))}
                    className="w-full bg-transparent font-mono text-white text-base md:text-xl focus:outline-none appearance-none"
                  >
                    {[15, 16, 17, 18, 19, 20].map(size => (
                      <option key={size} value={size} className="bg-slate-900">{size}</option>
                    ))}
                  </select>
                </div>

                <div className="glass p-2 md:p-3 rounded-lg">
                  <label className="text-[9px] md:text-[10px] block text-slate-500 uppercase font-bold mb-1 flex items-center gap-2">
                    <Layers className="w-3 h-3" /> Nº Jogos
                  </label>
                  <input 
                    type="number" 
                    value={numGames || ''} 
                    onChange={(e) => setNumGames(e.target.value === '' ? 0 : Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    className="text-base md:text-xl font-mono text-white bg-transparent w-full focus:outline-none"
                    placeholder="0"
                    min="1"
                    max="50"
                  />
                </div>
              </div>

                <div className="space-y-4">
                  <label className="text-xs text-slate-400 uppercase font-bold italic flex items-center gap-2">
                    <Dices className="w-3 h-3" /> Distribuição de Dezenas (Soma: {totalSelected}/{gameSize})
                  </label>
                  <div className="grid grid-cols-5 xl:grid-cols-5 gap-1">
                    {[
                      { label: 'QT', val: qtCount, key: 'qt', color: 'bg-red-500/20 border-red-500/50', max: analysis?.quentissimas.length ?? 25 },
                      { label: 'Q', val: qCount, key: 'q', color: 'bg-orange-500/20 border-orange-500/50', max: analysis?.quentes.length ?? 25 },
                      { label: 'M', val: mCount, key: 'm', color: 'bg-yellow-500/20 border-yellow-500/50', max: analysis?.mornas.length ?? 25 },
                      { label: 'F', val: fCount, key: 'f', color: 'bg-blue-500/20 border-blue-500/50', max: analysis?.frias.length ?? 25 },
                      { label: 'G', val: gCount, key: 'g', color: 'bg-cyan-500/20 border-cyan-500/50', max: analysis?.geladas.length ?? 25 },
                    ].map((item) => (
                      <div key={item.label} className={`${item.color} border px-1 py-1.5 md:p-2 rounded text-center`}>
                        <div className="text-[9px] md:text-[10px] opacity-70 font-bold">{item.label}</div>
                        <input 
                          type="number" 
                          value={item.val || ''} 
                          onChange={(e) => updateCounts(item.key, e.target.value === '' ? 0 : Number(e.target.value))}
                          onFocus={(e) => e.target.select()}
                          className="w-full bg-transparent text-center font-mono text-xs md:text-sm focus:outline-none"
                          placeholder="0"
                          min="0"
                          max={item.max}
                        />
                        <div className="text-[7px] md:text-[8px] opacity-40 mt-0.5">max {item.max}</div>
                      </div>
                    ))}
                  </div>
                  {totalSelected !== gameSize && (
                    <p className="text-[10px] text-red-400 italic">A soma das dezenas deve ser {gameSize}.</p>
                  )}
                </div>

              <div className="grid grid-cols-2 gap-3 md:gap-4">
                <div className="glass p-2 md:p-3 rounded-lg">
                  <label className="text-[9px] md:text-[10px] block text-slate-500 uppercase font-bold mb-1">Pares Mín.</label>
                  <input 
                    type="number" 
                    value={minEvens || ''} 
                    onChange={(e) => setMinEvens(e.target.value === '' ? 0 : Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    className="text-base md:text-xl font-mono text-white bg-transparent w-full focus:outline-none"
                    placeholder="0"
                    min="0"
                    max={gameSize}
                  />
                </div>
                <div className="glass p-2 md:p-3 rounded-lg">
                  <label className="text-[9px] md:text-[10px] block text-slate-500 uppercase font-bold mb-1">Pares Máx.</label>
                  <input 
                    type="number" 
                    value={maxEvens || ''} 
                    onChange={(e) => setMaxEvens(e.target.value === '' ? 0 : Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    className="text-base md:text-xl font-mono text-white bg-transparent w-full focus:outline-none"
                    placeholder="0"
                    min="0"
                    max={gameSize}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="glass rounded-2xl p-6 flex flex-col gap-3 flex-grow">
            <h2 className="text-sm font-bold uppercase tracking-widest text-green-400 border-b border-white/10 pb-2 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Status de Equilíbrio
            </h2>
            <div className="space-y-4 mt-2 h-full flex flex-col">
              {parityStats.slice(0, -1).map((stat) => (
                <div key={stat.segment} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs">{stat.segment}</span>
                    <span className="text-[10px] font-mono text-slate-400">{stat.evens} PAR | {stat.odds} ÍMPAR ({stat.total} total)</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden flex">
                    <div 
                      className="bg-green-500 h-full transition-all duration-500" 
                      style={{ width: `${stat.evensPercent}%` }}
                    />
                    <div 
                      className="bg-slate-700 h-full transition-all duration-500" 
                      style={{ width: `${stat.oddsPercent}%` }}
                    />
                  </div>
                </div>
              ))}

              <div className="mt-auto pt-4 border-t border-white/5 flex flex-col gap-2">
                 <div className="p-3 bg-green-500/5 rounded-xl border border-green-500/10 mb-2">
                    <div className="flex justify-between items-center mb-1">
                       <span className="text-[10px] text-green-400 font-bold uppercase italic">Sugestão de Paridade</span>
                       <span className="text-[10px] font-mono text-white">{expectedParity.evens} PAR | {expectedParity.odds} ÍMPAR</span>
                    </div>
                    <p className="text-[9px] text-slate-500 italic">Baseado na sua distribuição de dezenas selecionada.</p>
                 </div>
                 <button 
                   onClick={handleExport}
                   className="w-full py-3 bg-white/5 border border-white/10 rounded-xl font-bold uppercase text-[10px] tracking-widest hover:bg-white/10 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                 >
                    <FileSpreadsheet className="w-3 h-3" /> Baixar Jogos (.xlsx)
                 </button>
              </div>
            </div>
          </section>
        </aside>

        {/* Right Content: Frequency & Games */}
        <main className="flex-1 min-w-0 flex flex-col gap-6 lg:overflow-y-auto custom-scrollbar pb-10 lg:pb-0 lg:pr-2">
          <section className="glass rounded-2xl p-4 md:p-6 shrink-0">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-6">
              <h2 className="text-sm font-bold uppercase tracking-widest text-white flex items-center gap-2">
                <Layers className="w-4 h-4" /> Segmentação de Dezenas
              </h2>
              <span className="text-[10px] text-slate-500">Base: Últimos {contestsToAnalyze} Concursos</span>
            </div>
            
            <AnimatePresence mode="wait">
              {analysis ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6 xl:gap-4"
                >
                  {(['quentissimas', 'quentes', 'mornas', 'frias', 'geladas'] as const).map((cat) => (
                    <div key={cat} className="flex flex-col gap-3">
                       <span className={cn(
                         "text-[9px] md:text-[10px] uppercase font-black tracking-widest",
                         cat === 'quentissimas' ? 'text-red-500' :
                         cat === 'quentes' ? 'text-orange-500' :
                         cat === 'mornas' ? 'text-yellow-500' :
                         cat === 'frias' ? 'text-blue-500' : 'text-cyan-500'
                       )}>
                         {cat === 'quentissimas' ? 'Quentíssimas 🔥🔥' :
                          cat === 'quentes' ? 'Quentes 🔥' :
                          cat === 'mornas' ? 'Mornas 🌡️' :
                          cat === 'frias' ? 'Frias ❄️' : 'Geladas 🧊'}
                       </span>
                       <div className="flex flex-wrap gap-1.5 md:gap-2">
                          {analysis[cat].map(d => (
                            <Ball key={d.dezena} number={d.dezena} category={cat} className="w-7 h-7 text-xs md:w-8 md:h-8 md:text-sm" />
                          ))}
                          {analysis[cat].length === 0 && <span className="text-[10px] italic text-slate-500">Vazio</span>}
                       </div>
                    </div>
                  ))}
                </motion.div>
              ) : (
                <div className="h-24 flex items-center justify-center border border-dashed border-white/10 rounded-xl">
                  <p className="text-slate-500 text-xs italic">Aguardando carregamento de dados...</p>
                </div>
              )}
            </AnimatePresence>
          </section>

          <section className="glass rounded-2xl p-6 flex flex-col flex-grow overflow-hidden min-h-[400px]">
            <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-green-400 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Jogos Gerados com IA
              </h2>
              <span className="font-mono text-xs">{generatedGames.length} / {numGames} COMPLETOS</span>
            </div>
            
            <div className="flex-grow overflow-y-auto pr-2 custom-scrollbar space-y-4">
              <AnimatePresence>
                {generatedGames.map((game, idx) => (
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex flex-col md:flex-row items-center gap-4 bg-white/5 p-4 rounded-xl border border-white/5 hover:border-green-500/30 transition-colors group"
                  >
                    <div className="text-[10px] font-mono text-slate-500 md:rotate-180 flex items-center justify-center md:block shrink-0 md:[writing-mode:vertical-rl] whitespace-nowrap bg-white/5 px-3 py-1 rounded-full md:rounded-none md:bg-transparent">
                      JOGO {(idx + 1).toString().padStart(2, '0')}
                    </div>
                    <div className="flex flex-wrap justify-center md:justify-start gap-1.5 flex-grow">
                      {game.balls.map(num => (
                        <Ball 
                          key={num} 
                          number={num} 
                          highlighted={!game.isNew} 
                          className="w-7 h-7 text-xs md:w-8 md:h-8 md:text-sm" 
                        />
                      ))}
                    </div>
                    <div className="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-2 shrink-0 border-t md:border-t-0 border-white/5 pt-2 md:pt-0">
                      <div className="text-[10px] text-slate-500 font-bold">{game.evens} PAR | {game.odds} ÍMPAR</div>
                      {game.isNew ? (
                        <div className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold">INÉDITO</div>
                      ) : (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-bold animate-pulse">
                          <AlertTriangle className="w-3 h-3" /> JÁ SORTEADO
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {generatedGames.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                   <div className="p-4 bg-white/5 rounded-full">
                     <TrendingUp className="w-12 h-12 opacity-20" />
                   </div>
                   <p className="text-xs uppercase tracking-widest opacity-50">Pronto para gerar resultados inéditos</p>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Bottom Status Bar */}
      <footer className="flex flex-col md:flex-row justify-between items-center border-t border-white/5 pt-4 gap-4 md:gap-0 mt-auto md:mt-0">
        <div className="flex gap-3 md:gap-6 text-[8px] md:text-[10px] font-mono text-slate-500 flex-wrap justify-center sm:justify-start">
          <span className="flex items-center gap-1">
            <div className={`w-1 md:w-1.5 h-1 md:h-1.5 ${data.length > 0 ? 'bg-green-500' : 'bg-red-500'} rounded-full animate-pulse`}></div> 
            ENGINE {data.length > 0 ? 'ON' : 'IDLE'}
          </span>
          <span className="flex items-center gap-1"><Terminal className="w-2.5 h-2.5 md:w-3 md:h-3" /> LAT: 12ms</span>
          <span className="flex items-center gap-1"><Database className="w-2.5 h-2.5 md:w-3 md:h-3" /> SESSION: AUTH</span>
          {fileName && <span className="text-green-500/70 truncate max-w-[100px] md:max-w-none">FILES: {fileName}</span>}
        </div>
        <div className="text-[8px] md:text-[10px] text-slate-600 font-mono tracking-tighter italic uppercase text-center md:text-right">
          © 2026 LOTOSMART AI v2.4 | EXTREME STATS
        </div>
      </footer>
    </div>
  );
}
