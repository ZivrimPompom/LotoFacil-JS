export type Category = 'quentissimas' | 'quentes' | 'mornas' | 'frias' | 'geladas';

export interface DezenaFreq {
  dezena: number;
  frequencia: number;
}

export interface AnalysisResult {
  quentissimas: DezenaFreq[];
  quentes: DezenaFreq[];
  mornas: DezenaFreq[];
  frias: DezenaFreq[];
  geladas: DezenaFreq[];
}

export interface Game {
  balls: number[];
  evens: number;
  odds: number;
  isNew: boolean;
}

export interface ParityStats {
  segment: string;
  total: number;
  evens: number;
  odds: number;
  evensPercent: number;
  oddsPercent: number;
}
