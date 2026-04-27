import { Category, DezenaFreq, AnalysisResult, Game, ParityStats } from '../types';

/**
 * Funções utilitárias para análise da Lotofácil
 */

export const analyzeFrequenciy = (data: number[][], contests: number): AnalysisResult => {
  const recentData = data.slice(-contests).flat();
  const counter: Record<number, number> = {};
  
  // Inicializa todos de 1 a 25
  for (let i = 1; i <= 25; i++) counter[i] = 0;
  
  // Conta frequências
  recentData.forEach(num => {
    if (num >= 1 && num <= 25) {
      counter[num] = (counter[num] || 0) + 1;
    }
  });

  const freqs: DezenaFreq[] = Object.entries(counter).map(([dez, freq]) => ({
    dezena: parseInt(dez),
    frequencia: freq
  }));

  // Agrupar por frequências únicas (ordenado do maior para menor)
  const freqGroups: Record<number, number[]> = {};
  freqs.forEach(f => {
    if (!freqGroups[f.frequencia]) freqGroups[f.frequencia] = [];
    freqGroups[f.frequencia].push(f.dezena);
  });

  const sortedUniqueFreqs = Object.keys(freqGroups)
    .map(Number)
    .sort((a, b) => b - a);

  const result: AnalysisResult = {
    quentissimas: [],
    quentes: [],
    mornas: [],
    frias: [],
    geladas: []
  };

  if (sortedUniqueFreqs.length >= 5) {
    const size = sortedUniqueFreqs.length / 5;
    const idx1 = Math.max(1, Math.floor(size * 1));
    const idx2 = Math.max(2, Math.floor(size * 2));
    const idx3 = Math.max(3, Math.floor(size * 3));
    const idx4 = Math.max(4, Math.floor(size * 4));

    const mapToCat = (indices: number[], cat: keyof AnalysisResult) => {
      indices.forEach(freq => {
        freqGroups[freq].forEach(dez => {
          result[cat].push({ dezena: dez, frequencia: freq });
        });
      });
    };

    mapToCat(sortedUniqueFreqs.slice(0, idx1), 'quentissimas');
    mapToCat(sortedUniqueFreqs.slice(idx1, idx2), 'quentes');
    mapToCat(sortedUniqueFreqs.slice(idx2, idx3), 'mornas');
    mapToCat(sortedUniqueFreqs.slice(idx3, idx4), 'frias');
    mapToCat(sortedUniqueFreqs.slice(idx4), 'geladas');
  } else {
    // Fallback simplificado se houver poucos níveis de frequência
    freqs.forEach(f => result.mornas.push(f));
  }

  // Ordena dezenas dentro de cada categoria
  (Object.keys(result) as (keyof AnalysisResult)[]).forEach(key => {
    result[key].sort((a, b) => a.dezena - b.dezena);
  });

  return result;
};

export const calculateParityStats = (result: AnalysisResult): ParityStats[] => {
  const categories: { name: string; data: DezenaFreq[] }[] = [
    { name: 'Quentíssimas', data: result.quentissimas },
    { name: 'Quentes', data: result.quentes },
    { name: 'Mornas', data: result.mornas },
    { name: 'Frias', data: result.frias },
    { name: 'Geladas', data: result.geladas }
  ];

  const stats = categories.map(cat => {
    const total = cat.data.length;
    const evens = cat.data.filter(d => d.dezena % 2 === 0).length;
    const odds = total - evens;
    return {
      segment: cat.name,
      total,
      evens,
      odds,
      evensPercent: total > 0 ? (evens / total) * 100 : 0,
      oddsPercent: total > 0 ? (odds / total) * 100 : 0
    };
  });

  const totalAll = stats.reduce((acc, s) => acc + s.total, 0);
  const totalEvens = stats.reduce((acc, s) => acc + s.evens, 0);
  const totalOdds = stats.reduce((acc, s) => acc + s.odds, 0);

  stats.push({
    segment: 'TOTAL',
    total: totalAll,
    evens: totalEvens,
    odds: totalOdds,
    evensPercent: totalAll > 0 ? (totalEvens / totalAll) * 100 : 0,
    oddsPercent: totalAll > 0 ? (totalOdds / totalAll) * 100 : 0
  });

  return stats;
};

export const generateGames = (
  analysis: AnalysisResult,
  config: {
    n_jogos: number;
    qt: number;
    q: number;
    m: number;
    f: number;
    g: number;
    minEvens: number;
    maxEvens: number;
    history: number[][];
  }
): Game[] => {
  const { n_jogos, qt, q, m, f, g, minEvens, maxEvens, history } = config;
  const games: Game[] = [];
  const historySet = new Set(history.map(row => [...row].sort((a, b) => a - b).join(',')));
  
  let attempts = 0;
  const maxAttempts = 20000;

  const sample = (arr: DezenaFreq[], n: number) => {
    if (n === 0) return [];
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, n).map(d => d.dezena);
  };

  while (games.length < n_jogos && attempts < maxAttempts) {
    attempts++;
    const currentBalls: number[] = [
      ...sample(analysis.quentissimas, qt),
      ...sample(analysis.quentes, q),
      ...sample(analysis.mornas, m),
      ...sample(analysis.frias, f),
      ...sample(analysis.geladas, g)
    ];

    const totalRequested = qt + q + m + f + g;
    if (currentBalls.length !== totalRequested) continue;
    
    // Check duplicates in game (should not happen if sampling from separate categories, but logic needs to be safe)
    const uniqueBalls = Array.from(new Set(currentBalls)).sort((a, b) => a - b);
    if (uniqueBalls.length !== totalRequested) continue;

    const evens = uniqueBalls.filter(n => n % 2 === 0).length;
    if (evens < minEvens || evens > maxEvens) continue;

    const gameStr = uniqueBalls.join(',');
    if (!games.some(g => g.balls.join(',') === gameStr)) {
      games.push({
        balls: uniqueBalls,
        evens,
        odds: totalRequested - evens,
        isNew: !historySet.has(gameStr)
      });
    }
  }

  return games;
};
