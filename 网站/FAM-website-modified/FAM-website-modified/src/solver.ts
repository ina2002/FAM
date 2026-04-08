import solver from 'javascript-lp-solver';
import { FAMData, FAMModelConfig, FAMResult, RankingResultItem } from './types';

const DEFAULT_CONFIG: FAMModelConfig = {
  alpha: 1,
  beta: 0.3,
  eta: 0.001,
  epsilon: 1e-4,
  phiTie: 0.03,
  phiSep: 0.05,
  lambda: 1,
  bigM: 1000,
  barM: 1,
  minLevels: 0,
};

type LPModel = {
  optimize: string;
  opType: 'max' | 'min';
  constraints: Record<string, any>;
  variables: Record<string, Record<string, number>>;
  binaries: Record<string, 1>;
};

function normalizeExpertWeights(rawWeights: number[]): number[] {
  const total = rawWeights.reduce((a, b) => a + b, 0);
  if (total > 0) {
    return rawWeights.map((w) => w / total);
  }
  return new Array(rawWeights.length).fill(1 / Math.max(rawWeights.length, 1));
}

function addVariable(model: LPModel, varName: string, objectiveCoeff = 0): void {
  if (!model.variables[varName]) {
    model.variables[varName] = {};
  }
  if (objectiveCoeff !== 0) {
    model.variables[varName].obj = objectiveCoeff;
  }
}

function addNonNegative(model: LPModel, varName: string): void {
  const cName = `nonneg_${varName}`;
  model.constraints[cName] = { min: 0 };
  model.variables[varName][cName] = 1;
}

function getDefaultedConfig(input?: Partial<FAMModelConfig>): FAMModelConfig {
  const config = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  if (config.phiTie < 0) {
    throw new Error('phiTie must be nonnegative.');
  }
  if (config.phiSep <= config.phiTie) {
    throw new Error('phiSep must be strictly larger than phiTie.');
  }
  if (config.alpha <= 0 || config.beta <= 0) {
    throw new Error('alpha and beta must be positive.');
  }
  if (config.eta < 0 || config.lambda <= 0 || config.bigM <= 0 || config.barM <= 0) {
    throw new Error('eta, lambda, bigM and barM must be valid positive parameters.');
  }
  if (config.minLevels < 0) {
    throw new Error('minLevels must be nonnegative.');
  }
  return config;
}

export function solveFAM(data: FAMData): FAMResult | null {
  const { experts, attributes, alternatives, attributeRankings, alternativeRankings, ratios } = data;
  const config = getDefaultedConfig(data.config);

  const nExperts = experts.length;
  const nAttrs = attributes.length;
  const nAlts = alternatives.length;

  if (nExperts === 0 || nAttrs === 0 || nAlts === 0) {
    throw new Error('Experts, attributes and alternatives must all be non-empty.');
  }

  const model: LPModel = {
    optimize: 'obj',
    opType: 'max',
    constraints: {},
    variables: {},
    binaries: {},
  };

  const getWijk = (i: number, j: number, k: number) => `w_${i}_${j}_${k}`;
  const getUij = (i: number, j: number) => `u_${i}_${j}`;
  const getAk = (k: number) => `a_${k}`;
  const getTR = (r: number) => `t_${r}`;
  const getXkr = (k: number, r: number) => `x_${k}_${r}`;
  const getYr = (r: number) => `y_${r}`;
  const getDCi = (i: number) => `dC_${i}`;
  const dAName = 'dA';

  const assignedWeights = normalizeExpertWeights(experts.map((e) => e.weight ?? 0));

  // Core local weight variables w_ijk >= 0
  for (let i = 0; i < nExperts; i++) {
    for (let j = 0; j < nAttrs; j++) {
      for (let k = 0; k < nAlts; k++) {
        const varName = getWijk(i, j, k);
        addVariable(model, varName);
        addNonNegative(model, varName);
      }
    }
  }

  // Aggregated alternative weights a_k
  for (let k = 0; k < nAlts; k++) {
    const varName = getAk(k);
    addVariable(model, varName);
    addNonNegative(model, varName);
    const cName = `def_a_${k}`;
    model.constraints[cName] = { equal: 0 };
    model.variables[varName][cName] = 1;
    for (let i = 0; i < nExperts; i++) {
      for (let j = 0; j < nAttrs; j++) {
        model.variables[getWijk(i, j, k)][cName] = -1;
      }
    }
  }

  // Aggregated local criterion weights u_ij
  for (let i = 0; i < nExperts; i++) {
    for (let j = 0; j < nAttrs; j++) {
      const varName = getUij(i, j);
      addVariable(model, varName);
      addNonNegative(model, varName);
      const cName = `def_u_${i}_${j}`;
      model.constraints[cName] = { equal: 0 };
      model.variables[varName][cName] = 1;
      for (let k = 0; k < nAlts; k++) {
        model.variables[getWijk(i, j, k)][cName] = -1;
      }
    }
  }

  // Fixed expert weights: sum_j sum_k w_ijk = e_i
  for (let i = 0; i < nExperts; i++) {
    const cName = `fix_expert_weight_${i}`;
    model.constraints[cName] = { equal: assignedWeights[i] };
    for (let j = 0; j < nAttrs; j++) {
      for (let k = 0; k < nAlts; k++) {
        model.variables[getWijk(i, j, k)][cName] = 1;
      }
    }
  }

  // d^A variable
  addVariable(model, dAName, config.alpha);
  addNonNegative(model, dAName);

  // d_i^C variables
  for (let i = 0; i < nExperts; i++) {
    const dC = getDCi(i);
    addVariable(model, dC, config.beta);
    addNonNegative(model, dC);
  }

  // Attribute ranking consistency and d_i^C support
  for (let i = 0; i < nExperts; i++) {
    const expertId = experts[i].id;
    const rankings = attributeRankings
      .filter((r) => r.expertId === expertId && r.rank !== undefined)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

    let hasAttrPair = false;

    for (let idx = 0; idx < rankings.length - 1; idx++) {
      const r1 = rankings[idx];
      const r2 = rankings[idx + 1];
      if (r1.rank === r2.rank) continue;

      const j1 = attributes.findIndex((a) => a.id === r1.attributeId);
      const j2 = attributes.findIndex((a) => a.id === r2.attributeId);
      if (j1 < 0 || j2 < 0) continue;

      hasAttrPair = true;

      const rankName = `rank_attr_${i}_${j1}_${j2}`;
      model.constraints[rankName] = { min: config.epsilon };
      model.variables[getUij(i, j1)][rankName] = 1;
      model.variables[getUij(i, j2)][rankName] = -1;

      const dCName = `gap_attr_${i}_${j1}_${j2}`;
      model.constraints[dCName] = { min: 0 };
      model.variables[getUij(i, j1)][dCName] = 1;
      model.variables[getUij(i, j2)][dCName] = -1;
      model.variables[getDCi(i)][dCName] = -1;
    }

    if (!hasAttrPair) {
      const zeroName = `fix_dC_zero_${i}`;
      model.constraints[zeroName] = { equal: 0 };
      model.variables[getDCi(i)][zeroName] = 1;
    }
  }

  // Alternative ranking consistency
  for (let i = 0; i < nExperts; i++) {
    for (let j = 0; j < nAttrs; j++) {
      const expertId = experts[i].id;
      const attrId = attributes[j].id;
      const rankings = alternativeRankings
        .filter((r) => r.expertId === expertId && r.attributeId === attrId && r.rank !== undefined)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

      for (let idx = 0; idx < rankings.length - 1; idx++) {
        const r1 = rankings[idx];
        const r2 = rankings[idx + 1];
        if (r1.rank === r2.rank) continue;

        const k1 = alternatives.findIndex((a) => a.id === r1.alternativeId);
        const k2 = alternatives.findIndex((a) => a.id === r2.alternativeId);
        if (k1 < 0 || k2 < 0) continue;

        const cName = `rank_alt_${i}_${j}_${k1}_${k2}`;
        model.constraints[cName] = { min: config.epsilon };
        model.variables[getWijk(i, j, k1)][cName] = 1;
        model.variables[getWijk(i, j, k2)][cName] = -1;
      }
    }
  }

  // Ratio constraints w_ijk = t * w_ijk'
  for (const ratio of ratios) {
    const i = experts.findIndex((e) => e.id === ratio.expertId);
    const j = attributes.findIndex((a) => a.id === ratio.attributeId);
    const k = alternatives.findIndex((a) => a.id === ratio.altKId);
    const kp = alternatives.findIndex((a) => a.id === ratio.altKPrimeId);
    if (i < 0 || j < 0 || k < 0 || kp < 0) continue;

    const cName = `ratio_${i}_${j}_${k}_${kp}`;
    model.constraints[cName] = { equal: 0 };
    model.variables[getWijk(i, j, k)][cName] = 1;
    model.variables[getWijk(i, j, kp)][cName] = -ratio.ratio;
  }

  // Position weights t_r and assignment variables x_kr
  for (let r = 0; r < nAlts; r++) {
    const tVar = getTR(r);
    addVariable(model, tVar);
    addNonNegative(model, tVar);

    const sumK = `sum_k_x_${r}`;
    model.constraints[sumK] = { equal: 1 };

    for (let k = 0; k < nAlts; k++) {
      const xVar = getXkr(k, r);
      model.binaries[xVar] = 1;
      addVariable(model, xVar);
      model.variables[xVar][sumK] = 1;
    }

    if (r < nAlts - 1) {
      const yVar = getYr(r);
      model.binaries[yVar] = 1;
      addVariable(model, yVar, config.eta);

      // t_r >= t_{r+1}
      const orderName = `t_order_${r}`;
      model.constraints[orderName] = { min: 0 };
      model.variables[getTR(r)][orderName] = 1;
      model.variables[getTR(r + 1)][orderName] = -1;

      // t_r - t_{r+1} >= phiSep * y_r
      const sepName = `level_gap_${r}`;
      model.constraints[sepName] = { min: 0 };
      model.variables[getTR(r)][sepName] = 1;
      model.variables[getTR(r + 1)][sepName] = -1;
      model.variables[yVar][sepName] = -config.phiSep;

      // t_r - t_{r+1} <= phiTie + M * y_r
      const tieName = `level_bound_${r}`;
      model.constraints[tieName] = { max: config.phiTie };
      model.variables[getTR(r)][tieName] = 1;
      model.variables[getTR(r + 1)][tieName] = -1;
      model.variables[yVar][tieName] = -config.bigM;

      // dA <= lambda * (t_r - t_{r+1}) + M(1-y_r)
      // dA - lambda*t_r + lambda*t_{r+1} + M*y_r <= M
      const dANameLocal = `dA_support_${r}`;
      model.constraints[dANameLocal] = { max: config.bigM };
      model.variables[dAName][dANameLocal] = 1;
      model.variables[getTR(r)][dANameLocal] = -config.lambda;
      model.variables[getTR(r + 1)][dANameLocal] = config.lambda;
      model.variables[yVar][dANameLocal] = config.bigM;
    }
  }

  // Each alternative occupies exactly one rank position, and link a_k with t_r.
  for (let k = 0; k < nAlts; k++) {
    const sumR = `sum_r_x_${k}`;
    model.constraints[sumR] = { equal: 1 };

    for (let r = 0; r < nAlts; r++) {
      const xVar = getXkr(k, r);
      model.variables[xVar][sumR] = 1;

      const link1 = `link1_${k}_${r}`;
      model.constraints[link1] = { max: config.bigM };
      model.variables[getAk(k)][link1] = 1;
      model.variables[getTR(r)][link1] = -1;
      model.variables[xVar][link1] = config.bigM;

      const link2 = `link2_${k}_${r}`;
      model.constraints[link2] = { max: config.bigM };
      model.variables[getTR(r)][link2] = 1;
      model.variables[getAk(k)][link2] = -1;
      model.variables[xVar][link2] = config.bigM;
    }
  }

  // dA <= barM * sum_r y_r
  const protection = 'level_protection';
  model.constraints[protection] = { max: 0 };
  model.variables[dAName][protection] = 1;
  for (let r = 0; r < nAlts - 1; r++) {
    model.variables[getYr(r)][protection] = -config.barM;
  }

  // sum_r y_r >= minLevels
  const minLevelsName = 'min_levels';
  model.constraints[minLevelsName] = { min: config.minLevels };
  for (let r = 0; r < nAlts - 1; r++) {
    model.variables[getYr(r)][minLevelsName] = 1;
  }

  const result: any = solver.Solve(model);
  if (!result || !result.feasible) {
    console.warn('FAM Solver: no feasible solution found', result);
    return null;
  }

  const expertWeights: Record<string, number> = {};
  const attributeWeights: Record<string, number> = {};
  const alternativeWeights: Record<string, number> = {};
  const localWeights: Record<string, Record<string, Record<string, number>>> = {};
  const dC: Record<string, number> = {};

  experts.forEach((expert, i) => {
    expertWeights[expert.id] = assignedWeights[i];
    dC[expert.id] = result[getDCi(i)] || 0;
    localWeights[expert.id] = {};

    attributes.forEach((attr, j) => {
      localWeights[expert.id][attr.id] = {};
      alternatives.forEach((alt, k) => {
        localWeights[expert.id][attr.id][alt.id] = result[getWijk(i, j, k)] || 0;
      });
    });
  });

  attributes.forEach((attr, j) => {
    let sum = 0;
    experts.forEach((expert, i) => {
      sum += result[getUij(i, j)] || 0;
    });
    attributeWeights[attr.id] = sum;
  });

  alternatives.forEach((alt, k) => {
    alternativeWeights[alt.id] = result[getAk(k)] || 0;
  });

  const sortedWeights = Array.from({ length: nAlts }, (_, r) => result[getTR(r)] || 0);
  const levelIndicators = Array.from({ length: Math.max(nAlts - 1, 0) }, (_, r) => {
    const raw = result[getYr(r)] || 0;
    return raw >= 0.5 ? 1 : 0;
  });

  const orderedAltIndices: number[] = [];
  for (let r = 0; r < nAlts; r++) {
    let bestK = 0;
    let bestVal = -Infinity;
    for (let k = 0; k < nAlts; k++) {
      const value = result[getXkr(k, r)] || 0;
      if (value > bestVal) {
        bestVal = value;
        bestK = k;
      }
    }
    orderedAltIndices.push(bestK);
  }

  const ranking: RankingResultItem[] = orderedAltIndices.map((k, r) => ({
    altId: alternatives[k].id,
    weight: alternativeWeights[alternatives[k].id],
    rank: r + 1,
    level: 1,
    position: r + 1,
    isTie: false,
  }));

  let currentRank = 1;
  let currentLevel = 1;
  let groupStart = 0;

  for (let r = 0; r < ranking.length; r++) {
    if (r === 0) {
      ranking[r].rank = 1;
      ranking[r].level = 1;
      continue;
    }

    const sameLevel = levelIndicators[r - 1] === 0;
    if (sameLevel) {
      ranking[r].rank = currentRank;
      ranking[r].level = currentLevel;
    } else {
      if (r - groupStart > 1) {
        for (let idx = groupStart; idx < r; idx++) {
          ranking[idx].isTie = true;
        }
      }
      currentRank = r + 1;
      currentLevel += 1;
      groupStart = r;
      ranking[r].rank = currentRank;
      ranking[r].level = currentLevel;
    }
  }

  if (ranking.length - groupStart > 1) {
    for (let idx = groupStart; idx < ranking.length; idx++) {
      ranking[idx].isTie = true;
    }
  }

  const objectiveValue = result.result || 0;

  return {
    expertWeights,
    attributeWeights,
    alternativeWeights,
    localWeights,
    ranking,
    sortedWeights,
    levelIndicators,
    dA: result[dAName] || 0,
    dC,
    objectiveValue,
    Z: objectiveValue,
    config,
  };
}
