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
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
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
    const processedData: number[][] = [];
    
    // Sort rows by the first column assumed to be contest number (descending)
    // Results from Caixa website often start with headers or empty rows
    rawData.forEach(row => {
      // Find all cells that can be numbers
      const cells = row.map(cell => {
        if (cell === null || cell === undefined) return null;
        if (typeof cell === 'number') return cell;
        if (typeof cell === 'string') {
          // Remove dots from thousands and replace comma with dot contextually
          const sanitized = cell.replace(/\./g, '').replace(',', '.').trim();
          const parsed = parseInt(sanitized);
          return isNaN(parsed) ? null : parsed;
        }
        return null;
      });

      const filtered = cells.filter((n): n is number => n !== null);
      
      // Look for exactly 15 balls. 
      // In some formats, balls are in columns 2 to 16 if column 1 is contest
      // In others, they might be mixed. We prioritize finding any sequence of 15 balls 1-25.
      if (filtered.length >= 15) {
        // Find 15 numbers between 1-25. 
        // We often have Contest, Date, Ball1, Ball2...
        // Let's filter everything between 1 and 25 and see if we have at least 15.
        const balls = filtered.filter(n => n >= 1 && n <= 25);
        
        if (balls.length >= 15) {
          // Take the last 15 if there are more (ignoring possible small numbers like contest sequence)
          // Actually, balls are usually grouped.
          // Let's look for the first occurrence of 15 valid balls.
          for (let i = 0; i <= filtered.length - 15; i++) {
            const slice = filtered.slice(i, i + 15);
            if (slice.every(n => n >= 1 && n <= 25)) {
              processedData.push([...slice].sort((a, b) => a - b));
              break;
            }
          }
        }
      }
    });

    // Remove headers if any survived or duplicates
    const unique = Array.from(new Set(processedData.map(j => j.join(','))))
      .map(s => s.split(',').map(Number));
      
    // Sort by assumed contest order (reverse historical is usually what we want for tail analysis)
    return unique.reverse();
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

    return counts;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      
      const processedData = processRawData(rawData);

      if (processedData.length > 0) {
        setData(processedData);
        // Auto-run analysis
        const result = analyzeFrequenciy(processedData, contestsToAnalyze);
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
          history: processedData
        });
        setGeneratedGames(games);
      } else {
        alert("Não foi possível encontrar dados válidos da Lotofácil neste arquivo.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSyncCaixa = async () => {
    setIsSyncing(true);
    setFileName('Sincronizando...');
    try {
      const response = await fetch('/api/sync-caixa');
      const contentType = response.headers.get('content-type');
      
      if (!response.ok) {
        let errorMessage = "Falha ao sincronizar.";
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          if (errorData.timeout) {
            errorMessage = "A sincronização demorou muito. O site da Caixa está instável. Tente novamente ou use a opção 'Local'.";
          } else {
            errorMessage = errorData.error || errorData.details || errorMessage;
          }
        } else {
          errorMessage = await response.text();
          // Truncate if it's a long HTML string
          if (errorMessage.length > 100) errorMessage = "Erro no servidor da Caixa (URL não encontrada ou bloqueada).";
        }
        throw new Error(errorMessage);
      }

      if (!contentType || !contentType.includes('application/json')) {
        throw new Error("Resposta inesperada do servidor (não é JSON).");
      }

      const { data: rawData, fileName: remoteFileName } = await response.json();
      
      const processedData = processRawData(rawData);

      if (processedData.length > 0) {
        setData(processedData);
        setFileName(remoteFileName);
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
      alert("Erro ao sincronizar: " + (err.message || "Tente novamente mais tarde."));
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

  const loadMockData = () => {
    // Generate some random history for demo purposes
    const mockHistory: number[][] = [];
    for (let i = 0; i < 3000; i++) {
      const game: number[] = [];
      while (game.length < 15) {
        const n = Math.floor(Math.random() * 25) + 1;
        if (!game.includes(n)) game.push(n);
      }
      mockHistory.push(game.sort((a, b) => a - b));
    }
    setData(mockHistory);
    setFileName('Demo_Lotofacil_Data.xlsx');
    
    const result = analyzeFrequenciy(mockHistory, contestsToAnalyze);
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
      history: mockHistory
    });
    setGeneratedGames(games);
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
      <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 shrink-0">
        <div className="flex flex-col w-full xl:w-auto">
          <div className="flex justify-between items-center w-full xl:w-auto">
            <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase italic gradient-text flex items-center gap-2">
              <TrendingUp className="w-6 h-6 md:w-8 md:h-8 text-green-500" />
              LotoSmart AI
            </h1>
            <div className="flex xl:hidden gap-2 shrink-0">
              <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept=".xlsx, .xls"
              />
              <button 
                  onClick={resetParams}
                  className="bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 font-bold p-2 md:px-3 md:py-2 rounded-lg transition-all uppercase text-[8px] md:text-[10px]"
                  title="Resetar"
                >
                  Reset
              </button>
            </div>
          </div>
          <p className="text-[10px] md:text-xs text-slate-500 font-mono tracking-widest hidden sm:block">ANALISADOR ESTATÍSTICO DE ALTA PERFORMANCE</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full xl:w-auto">
          {/* Main Action Buttons */}
          <div className="flex gap-2 w-full xl:w-auto items-center justify-start sm:justify-end overflow-x-auto pb-1 xl:pb-0 custom-scrollbar">
            <button 
                onClick={loadMockData}
                className="bg-green-500 hover:bg-green-400 text-black font-bold px-4 py-2 md:px-5 md:py-3 rounded-lg transition-all glow-green uppercase text-[10px] md:text-sm flex items-center gap-1.5 shrink-0"
              >
                <Play className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Gerar Jogos</span>
                <span className="sm:hidden">Gerar</span>
            </button>
            <button 
              onClick={handleGenerate}
              disabled={!analysis || totalSelected !== gameSize}
              className="bg-green-500 hover:bg-green-400 text-black font-bold px-4 py-2 md:px-5 md:py-3 rounded-lg transition-all glow-green uppercase text-[10px] md:text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:grayscale shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Gerar com IA</span>
              <span className="sm:hidden">com IA</span>
            </button>
            <button 
              onClick={handleSyncCaixa}
              disabled={isSyncing}
              className={cn(
                "bg-green-500 hover:bg-green-400 text-black font-bold px-4 py-2 md:px-5 md:py-3 rounded-lg transition-all glow-green uppercase text-[10px] md:text-sm flex items-center gap-1.5 shrink-0",
                isSyncing && "animate-pulse opacity-70 cursor-wait"
              )}
            >
              <Download className={cn("w-3.5 h-3.5 md:w-4 md:h-4", isSyncing && "animate-bounce")} />
              {isSyncing ? "Sinc..." : "CEF"}
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold px-4 py-2 md:px-5 md:py-3 rounded-lg transition-all uppercase text-[10px] md:text-sm flex items-center gap-1.5 shrink-0"
              title="Carregar Arquivo"
            >
              <Upload className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Local</span>
              <span className="sm:hidden">LOC</span>
            </button>
          </div>

          {/* Stats and Reset */}
          <div className="flex gap-2 w-full xl:w-auto items-center justify-start sm:justify-end">
            <div className="glass px-2 md:px-3 py-1.5 rounded-lg text-right min-w-[70px] sm:min-w-[80px] md:min-w-[130px] flex-1 sm:flex-none flex flex-col justify-center">
              <span className="block text-[7px] md:text-[8px] uppercase text-slate-500 font-bold tracking-wider leading-tight text-center md:text-right">Último</span>
              <span className="block text-xs md:text-base font-mono text-white leading-tight text-center md:text-right">{data.length || '----'}</span>
            </div>
            <div className="glass px-2 md:px-3 py-1.5 rounded-lg text-right min-w-[70px] sm:min-w-[80px] md:min-w-[130px] flex-1 sm:flex-none flex flex-col justify-center">
              <span className="block text-[7px] md:text-[8px] uppercase text-slate-500 font-bold tracking-wider leading-tight text-center md:text-right">Base</span>
              <span className="block text-xs md:text-base font-mono text-white leading-tight text-center md:text-right">{data.length || '---'}</span>
            </div>
            
            <div className="hidden xl:flex gap-2 shrink-0">
              <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept=".xlsx, .xls"
              />
              <button 
                  onClick={resetParams}
                  className="bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 font-bold p-2 md:px-3 md:py-2 rounded-lg transition-all uppercase text-[8px] md:text-[10px]"
                  title="Resetar"
                >
                  Reset
              </button>
            </div>
          </div>
        </div>
      </header>

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
                    value={numGames} 
                    onChange={(e) => setNumGames(Number(e.target.value))}
                    className="text-base md:text-xl font-mono text-white bg-transparent w-full focus:outline-none"
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
                          value={item.val} 
                          onChange={(e) => updateCounts(item.key, Number(e.target.value))}
                          className="w-full bg-transparent text-center font-mono text-xs md:text-sm focus:outline-none"
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
                    value={minEvens} 
                    onChange={(e) => setMinEvens(Number(e.target.value))}
                    className="text-base md:text-xl font-mono text-white bg-transparent w-full focus:outline-none"
                    min="0"
                    max={gameSize}
                  />
                </div>
                <div className="glass p-2 md:p-3 rounded-lg">
                  <label className="text-[9px] md:text-[10px] block text-slate-500 uppercase font-bold mb-1">Pares Máx.</label>
                  <input 
                    type="number" 
                    value={maxEvens} 
                    onChange={(e) => setMaxEvens(Number(e.target.value))}
                    className="text-base md:text-xl font-mono text-white bg-transparent w-full focus:outline-none"
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
                    <span className="text-[10px] font-mono text-slate-400">{stat.evens}P | {stat.odds}Í ({stat.total} total)</span>
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
                       <span className="text-[10px] font-mono text-white">{expectedParity.evens}P | {expectedParity.odds}Í</span>
                    </div>
                    <p className="text-[9px] text-slate-500 italic">Baseado na sua distribuição de dezenas selecionada.</p>
                 </div>
                 <button className="w-full py-3 bg-white/5 border border-white/10 rounded-xl font-bold uppercase text-[10px] tracking-widest hover:bg-white/10 flex items-center justify-center gap-2">
                    <FileSpreadsheet className="w-3 h-3" /> Exportar Dados (.xlsx)
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
                    <div className="text-[10px] font-mono text-slate-500 md:rotate-180 flex items-center md:block shrink-0" style={{ writingMode: 'vertical-rl' }}>
                      JOGO {(idx + 1).toString().padStart(2, '0')}
                    </div>
                    <div className="flex flex-wrap justify-center md:justify-start gap-1.5 flex-grow">
                      {game.balls.map(num => (
                        <Ball key={num} number={num} className="w-7 h-7 text-xs md:w-8 md:h-8 md:text-sm" />
                      ))}
                    </div>
                    <div className="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-2 shrink-0 border-t md:border-t-0 border-white/5 pt-2 md:pt-0">
                      <div className="text-[10px] text-slate-500 font-bold">{game.evens}P | {game.odds}Í</div>
                      <div className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold">INÉDITO</div>
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
