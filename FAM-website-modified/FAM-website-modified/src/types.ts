export interface Expert {
  id: string;
  name: string;
  weight?: number; // e_i
}

export interface Attribute {
  id: string;
  name: string;
}

export interface Alternative {
  id: string;
  name: string;
}

export interface AttributeRanking {
  expertId: string;
  attributeId: string;
  rank?: number; // p_ij
}

export interface AlternativeRanking {
  expertId: string;
  attributeId: string;
  alternativeId: string;
  rank?: number; // p_ijk
}

export interface RatioInput {
  expertId: string;
  attributeId: string;
  altKId: string;
  altKPrimeId: string;
  ratio: number; // t_ijkk'
}

export interface FAMModelConfig {
  alpha: number;
  beta: number;
  eta: number;
  epsilon: number;
  phiTie: number;
  phiSep: number;
  lambda: number;
  bigM: number;
  barM: number;
  minLevels: number;
}

export interface FAMData {
  experts: Expert[];
  attributes: Attribute[];
  alternatives: Alternative[];
  attributeRankings: AttributeRanking[];
  alternativeRankings: AlternativeRanking[];
  ratios: RatioInput[];
  config?: Partial<FAMModelConfig>;
}

export interface RankingResultItem {
  altId: string;
  weight: number;
  rank: number;     // competition rank: 1,2,2,4
  level: number;    // dense level index: 1,2,2,3
  position: number; // sorted position: 1..|K|
  isTie?: boolean;
}

export interface FAMResult {
  expertWeights: Record<string, number>; // e_i
  attributeWeights: Record<string, number>; // c_j
  alternativeWeights: Record<string, number>; // a_k
  localWeights: Record<string, Record<string, Record<string, number>>>; // w_ijk
  ranking: RankingResultItem[];
  sortedWeights: number[]; // \tilde a_r
  levelIndicators: number[]; // y_r
  dA: number; // d^A
  dC: Record<string, number>; // d_i^C
  objectiveValue: number;
  Z: number; // backward compatibility with old UI, equal to objectiveValue
  config: FAMModelConfig;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  name: string;
  data: FAMData;
  result: FAMResult;
}
