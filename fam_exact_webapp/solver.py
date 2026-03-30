from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix


@dataclass
class ParsedRatio:
    expert: str
    attr: str
    alt1: str
    alt2: str
    ratio: float


class ModelInputError(ValueError):
    pass


IMPLEMENTATION_NOTES = [
    "原模型中的严格不等式 \\(<\\) 在 MILP 中无法直接处理，程序中统一以带容差参数 \\(\\varepsilon\\) 的非严格不等式进行替代。",
    "程序中显式加入了 \\(w_i = \\sum_j \\sum_k w_{ijk}\\)、\\(w_{ij} = \\sum_k w_{ijk}\\) 以及 \\(v_j = \\sum_i w_{ij}\\)，以确保专家层、属性层与局部权重变量之间具有明确的聚合关系。",
    "求解过程采用两阶段（词典序）优化策略：第一阶段最大化方案排序区分度 \\(Z\\)；第二阶段在保持 \\(Z\\) 不低于第一阶段最优值减去给定容差的前提下，进一步最大化专家层最小差距 \\(\\Delta^E\\) 与属性层最小差距 \\(\\Delta_i^A\\)。",
]


def _parse_ratio_text(ratio_text: str, experts: List[str], attrs: List[str], alts: List[str]) -> Tuple[List[ParsedRatio], List[str]]:
    ratios: List[ParsedRatio] = []
    warnings: List[str] = []
    if not ratio_text or not ratio_text.strip():
        return ratios, warnings

    valid_e = set(experts)
    valid_a = set(attrs)
    valid_k = set(alts)
    for lineno, raw in enumerate(ratio_text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 5:
            warnings.append(f"第 {lineno} 行比值信息格式无效，已忽略。")
            continue
        e, a, k1, k2, ratio_raw = parts
        try:
            ratio = float(ratio_raw)
        except ValueError:
            warnings.append(f"第 {lineno} 行比值不是数值，已忽略。")
            continue
        if e not in valid_e or a not in valid_a or k1 not in valid_k or k2 not in valid_k:
            warnings.append(f"第 {lineno} 行引用了不存在的专家/属性/方案，已忽略。")
            continue
        if k1 == k2:
            warnings.append(f"第 {lineno} 行的两个方案相同，已忽略。")
            continue
        if ratio <= 0:
            warnings.append(f"第 {lineno} 行比值必须为正，已忽略。")
            continue
        ratios.append(ParsedRatio(e, a, k1, k2, ratio))
    return ratios, warnings



def _validate_and_normalize(payload: Dict[str, Any]) -> Dict[str, Any]:
    experts = [str(x).strip() for x in payload.get("experts", []) if str(x).strip()]
    attrs = [str(x).strip() for x in payload.get("attrs", []) if str(x).strip()]
    alts = [str(x).strip() for x in payload.get("alts", []) if str(x).strip()]

    if len(experts) < 1:
        raise ModelInputError("至少需要 1 位专家。")
    if len(attrs) < 1:
        raise ModelInputError("至少需要 1 个属性。")
    if len(alts) < 2:
        raise ModelInputError("至少需要 2 个方案。")

    if len(set(experts)) != len(experts):
        raise ModelInputError("专家名称存在重复。")
    if len(set(attrs)) != len(attrs):
        raise ModelInputError("属性名称存在重复。")
    if len(set(alts)) != len(alts):
        raise ModelInputError("方案名称存在重复。")

    expert_ranks = payload.get("expertRanks", {})
    attr_ranks = payload.get("attrRanks", {})
    alt_ranks = payload.get("altRanks", {})

    normalized_expert_ranks: Dict[str, int] = {}
    normalized_attr_ranks: Dict[str, Dict[str, int]] = {}
    normalized_alt_ranks: Dict[str, Dict[str, Dict[str, int]]] = {}

    for e in experts:
        if e not in expert_ranks:
            raise ModelInputError(f"缺少专家 {e} 的排序信息。")
        try:
            normalized_expert_ranks[e] = int(expert_ranks[e])
        except Exception as exc:
            raise ModelInputError(f"专家 {e} 的排序不是整数。") from exc

    for e in experts:
        if e not in attr_ranks:
            raise ModelInputError(f"缺少专家 {e} 的属性排序信息。")
        normalized_attr_ranks[e] = {}
        for a in attrs:
            if a not in attr_ranks[e]:
                raise ModelInputError(f"缺少专家 {e} 对属性 {a} 的排序。")
            try:
                normalized_attr_ranks[e][a] = int(attr_ranks[e][a])
            except Exception as exc:
                raise ModelInputError(f"专家 {e} 对属性 {a} 的排序不是整数。") from exc

    for e in experts:
        if e not in alt_ranks:
            raise ModelInputError(f"缺少专家 {e} 的方案排序信息。")
        normalized_alt_ranks[e] = {}
        for a in attrs:
            if a not in alt_ranks[e]:
                raise ModelInputError(f"缺少专家 {e} 在属性 {a} 下的方案排序。")
            normalized_alt_ranks[e][a] = {}
            for k in alts:
                if k not in alt_ranks[e][a]:
                    raise ModelInputError(f"缺少专家 {e} 在属性 {a} 下对方案 {k} 的排序。")
                try:
                    normalized_alt_ranks[e][a][k] = int(alt_ranks[e][a][k])
                except Exception as exc:
                    raise ModelInputError(f"专家 {e} 在属性 {a} 下对方案 {k} 的排序不是整数。") from exc

    epsilon = float(payload.get("epsilon", 1e-4))
    if epsilon <= 0:
        raise ModelInputError("epsilon 必须为正。")

    alpha = float(payload.get("alpha", 1.0))
    beta = float(payload.get("beta", 1.0))
    z_fix_tolerance = float(payload.get("zFixTolerance", 1e-5))
    if alpha < 0:
        raise ModelInputError("alpha 不能为负。")
    if beta < 0:
        raise ModelInputError("beta 不能为负。")
    if z_fix_tolerance < 0:
        raise ModelInputError("zFixTolerance 不能为负。")

    lambdas = payload.get("lambdas")
    if lambdas is None or lambdas == "":
        normalized_lambdas = [1.0] * (len(alts) - 1)
    else:
        if not isinstance(lambdas, list):
            raise ModelInputError("lambdas 必须是数组。")
        if len(lambdas) != len(alts) - 1:
            raise ModelInputError(f"lambdas 的长度必须等于 |K|-1 = {len(alts)-1}。")
        normalized_lambdas = []
        for idx, x in enumerate(lambdas, start=1):
            value = float(x)
            if value <= 0:
                raise ModelInputError(f"lambda_{idx} 必须为正。")
            normalized_lambdas.append(value)

    ratio_text = str(payload.get("ratioText", ""))
    ratios, parse_warnings = _parse_ratio_text(ratio_text, experts, attrs, alts)

    return {
        "experts": experts,
        "attrs": attrs,
        "alts": alts,
        "expertRanks": normalized_expert_ranks,
        "attrRanks": normalized_attr_ranks,
        "altRanks": normalized_alt_ranks,
        "epsilon": epsilon,
        "alpha": alpha,
        "beta": beta,
        "zFixTolerance": z_fix_tolerance,
        "lambdas": normalized_lambdas,
        "ratios": ratios,
        "parseWarnings": parse_warnings,
    }



def _collect_direct_conflict_warnings(data: Dict[str, Any]) -> List[str]:
    warnings = list(data["parseWarnings"])
    alt_ranks = data["altRanks"]
    for item in data["ratios"]:
        r1 = alt_ranks[item.expert][item.attr][item.alt1]
        r2 = alt_ranks[item.expert][item.attr][item.alt2]
        if r1 < r2 and item.ratio < 1:
            warnings.append(
                f"比值 {item.expert}/{item.attr}/{item.alt1}:{item.alt2}={item.ratio:g} 与排序方向可能冲突：{item.alt1} 排名优于 {item.alt2}，但比值小于 1。"
            )
        if r1 > r2 and item.ratio > 1:
            warnings.append(
                f"比值 {item.expert}/{item.attr}/{item.alt1}:{item.alt2}={item.ratio:g} 与排序方向可能冲突：{item.alt1} 排名劣于 {item.alt2}，但比值大于 1。"
            )
    return warnings


class _Indexer:
    def __init__(self, experts: List[str], attrs: List[str], alts: List[str]) -> None:
        self.experts = experts
        self.attrs = attrs
        self.alts = alts
        self.offset = 0
        self.wijk: Dict[Tuple[str, str, str], int] = {}
        self.wi: Dict[str, int] = {}
        self.wij: Dict[Tuple[str, str], int] = {}
        self.vj: Dict[str, int] = {}
        self.sw: Dict[str, int] = {}
        self.t: Dict[int, int] = {}
        self.x: Dict[Tuple[str, int], int] = {}
        self.Z: int | None = None
        self.deltaE: int | None = None
        self.deltaA: Dict[str, int] = {}
        self._build()

    def _build(self) -> None:
        for e in self.experts:
            for a in self.attrs:
                for k in self.alts:
                    self.wijk[(e, a, k)] = self.offset
                    self.offset += 1
        for e in self.experts:
            self.wi[e] = self.offset
            self.offset += 1
        for e in self.experts:
            for a in self.attrs:
                self.wij[(e, a)] = self.offset
                self.offset += 1
        for a in self.attrs:
            self.vj[a] = self.offset
            self.offset += 1
        for k in self.alts:
            self.sw[k] = self.offset
            self.offset += 1
        for r in range(1, len(self.alts) + 1):
            self.t[r] = self.offset
            self.offset += 1
        for k in self.alts:
            for r in range(1, len(self.alts) + 1):
                self.x[(k, r)] = self.offset
                self.offset += 1
        self.Z = self.offset
        self.offset += 1
        self.deltaE = self.offset
        self.offset += 1
        for e in self.experts:
            self.deltaA[e] = self.offset
            self.offset += 1

    @property
    def nvars(self) -> int:
        return self.offset


class _ConstraintBuilder:
    def __init__(self, nvars: int) -> None:
        self.nvars = nvars
        self.rows: List[Dict[int, float]] = []
        self.lbs: List[float] = []
        self.ubs: List[float] = []

    def add_eq(self, coeffs: Dict[int, float], rhs: float) -> None:
        self.rows.append(coeffs)
        self.lbs.append(rhs)
        self.ubs.append(rhs)

    def add_ub(self, coeffs: Dict[int, float], rhs: float) -> None:
        self.rows.append(coeffs)
        self.lbs.append(-1e30)
        self.ubs.append(rhs)

    def build(self) -> LinearConstraint:
        matrix = lil_matrix((len(self.rows), self.nvars))
        for row_idx, coeffs in enumerate(self.rows):
            for col_idx, value in coeffs.items():
                matrix[row_idx, col_idx] = value
        return LinearConstraint(matrix.tocsr(), self.lbs, self.ubs)



def _build_common_constraints(
    data: Dict[str, Any],
    index: _Indexer,
    *,
    use_gap_variables: bool,
    z_floor: float | None = None,
) -> _ConstraintBuilder:
    experts = data["experts"]
    attrs = data["attrs"]
    alts = data["alts"]
    epsilon = data["epsilon"]
    lambdas = data["lambdas"]
    M = 1.0

    builder = _ConstraintBuilder(index.nvars)

    # Definition constraints: w_i, w_ij, v_j, sw_k are derived from w_ijk.
    for e in experts:
        coeffs = {index.wi[e]: 1.0}
        for a in attrs:
            for k in alts:
                var = index.wijk[(e, a, k)]
                coeffs[var] = coeffs.get(var, 0.0) - 1.0
        builder.add_eq(coeffs, 0.0)

    for e in experts:
        for a in attrs:
            coeffs = {index.wij[(e, a)]: 1.0}
            for k in alts:
                var = index.wijk[(e, a, k)]
                coeffs[var] = coeffs.get(var, 0.0) - 1.0
            builder.add_eq(coeffs, 0.0)

    for a in attrs:
        coeffs = {index.vj[a]: 1.0}
        for e in experts:
            coeffs[index.wij[(e, a)]] = coeffs.get(index.wij[(e, a)], 0.0) - 1.0
        builder.add_eq(coeffs, 0.0)

    for k in alts:
        coeffs = {index.sw[k]: 1.0}
        for e in experts:
            for a in attrs:
                var = index.wijk[(e, a, k)]
                coeffs[var] = coeffs.get(var, 0.0) - 1.0
        builder.add_eq(coeffs, 0.0)

    # Normalization.
    builder.add_eq({index.wijk[key]: 1.0 for key in index.wijk}, 1.0)

    # Assignment constraints.
    for k in alts:
        builder.add_eq({index.x[(k, r)]: 1.0 for r in range(1, len(alts) + 1)}, 1.0)
    for r in range(1, len(alts) + 1):
        builder.add_eq({index.x[(k, r)]: 1.0 for k in alts}, 1.0)

    # Linking sw_k and ordered positions t_r.
    for k in alts:
        for r in range(1, len(alts) + 1):
            builder.add_ub({index.sw[k]: 1.0, index.t[r]: -1.0, index.x[(k, r)]: M}, M)
            builder.add_ub({index.t[r]: 1.0, index.sw[k]: -1.0, index.x[(k, r)]: M}, M)

    # Ordered scores are non-increasing.
    for r in range(1, len(alts)):
        builder.add_ub({index.t[r + 1]: 1.0, index.t[r]: -1.0}, 0.0)

    # Max-min gap constraints.
    for r, lam in enumerate(lambdas, start=1):
        builder.add_ub({index.Z: 1.0, index.t[r]: -lam, index.t[r + 1]: lam}, 0.0)

    if z_floor is not None:
        builder.add_ub({index.Z: -1.0}, -float(z_floor))

    # Ranking consistency constraints using epsilon to replace strict inequalities.
    expert_ranks = data["expertRanks"]
    expert_pairs: List[Tuple[str, str]] = []
    for e1 in experts:
        for e2 in experts:
            if e1 != e2 and expert_ranks[e1] < expert_ranks[e2]:
                expert_pairs.append((e1, e2))
                builder.add_ub({index.wi[e2]: 1.0, index.wi[e1]: -1.0}, -epsilon)
                if use_gap_variables:
                    builder.add_ub({index.wi[e2]: 1.0, index.wi[e1]: -1.0, index.deltaE: 1.0}, 0.0)
    if use_gap_variables and not expert_pairs:
        builder.add_eq({index.deltaE: 1.0}, 0.0)

    attr_ranks = data["attrRanks"]
    for e in experts:
        attr_pairs: List[Tuple[str, str]] = []
        for a1 in attrs:
            for a2 in attrs:
                if a1 != a2 and attr_ranks[e][a1] < attr_ranks[e][a2]:
                    attr_pairs.append((a1, a2))
                    builder.add_ub({index.wij[(e, a2)]: 1.0, index.wij[(e, a1)]: -1.0}, -epsilon)
                    if use_gap_variables:
                        builder.add_ub({index.wij[(e, a2)]: 1.0, index.wij[(e, a1)]: -1.0, index.deltaA[e]: 1.0}, 0.0)
        if use_gap_variables and not attr_pairs:
            builder.add_eq({index.deltaA[e]: 1.0}, 0.0)

    alt_ranks = data["altRanks"]
    for e in experts:
        for a in attrs:
            for k1 in alts:
                for k2 in alts:
                    if k1 != k2 and alt_ranks[e][a][k1] < alt_ranks[e][a][k2]:
                        builder.add_ub({index.wijk[(e, a, k2)]: 1.0, index.wijk[(e, a, k1)]: -1.0}, -epsilon)

    # Ratio equalities.
    for item in data["ratios"]:
        builder.add_eq(
            {
                index.wijk[(item.expert, item.attr, item.alt1)]: 1.0,
                index.wijk[(item.expert, item.attr, item.alt2)]: -item.ratio,
            },
            0.0,
        )

    return builder



def _build_bounds(index: _Indexer) -> Bounds:
    lower_bounds = [0.0] * index.nvars
    upper_bounds = [1.0] * index.nvars
    return Bounds(lower_bounds, upper_bounds)



def _build_integrality(index: _Indexer) -> List[int]:
    integrality = [0] * index.nvars
    for k in index.alts:
        for r in range(1, len(index.alts) + 1):
            integrality[index.x[(k, r)]] = 1
    return integrality



def _run_milp(objective: List[float], builder: _ConstraintBuilder, index: _Indexer):
    return milp(
        c=objective,
        constraints=builder.build(),
        bounds=_build_bounds(index),
        integrality=_build_integrality(index),
        options={"disp": False},
    )



def _extract_solution(index: _Indexer, data: Dict[str, Any], xvals) -> Dict[str, Any]:
    experts = data["experts"]
    attrs = data["attrs"]
    alts = data["alts"]

    local_weights: Dict[str, Dict[str, Dict[str, float]]] = {
        e: {a: {k: float(xvals[index.wijk[(e, a, k)]]) for k in alts} for a in attrs} for e in experts
    }
    expert_weights: Dict[str, float] = {e: float(xvals[index.wi[e]]) for e in experts}
    expert_attr_weights: Dict[str, Dict[str, float]] = {
        e: {a: float(xvals[index.wij[(e, a)]]) for a in attrs} for e in experts
    }
    global_attr_weights: Dict[str, float] = {a: float(xvals[index.vj[a]]) for a in attrs}
    alternative_scores: Dict[str, float] = {k: float(xvals[index.sw[k]]) for k in alts}
    ordered_t: List[float] = [float(xvals[index.t[r]]) for r in range(1, len(alts) + 1)]

    ranking: List[Dict[str, Any]] = []
    for k in alts:
        assigned_rank = max(range(1, len(alts) + 1), key=lambda r: float(xvals[index.x[(k, r)]]))
        ranking.append({"alt": k, "rank": assigned_rank, "score": alternative_scores[k]})
    ranking.sort(key=lambda item: item["rank"])

    expert_output = sorted(
        [{"name": e, "weight": expert_weights[e]} for e in experts],
        key=lambda item: (-item["weight"], item["name"]),
    )
    alternative_output = [
        {"name": item["alt"], "rank": item["rank"], "score": item["score"]} for item in ranking
    ]

    return {
        "expert_weights": expert_weights,
        "expert_attr_weights": expert_attr_weights,
        "global_attr_weights": global_attr_weights,
        "local_weights": local_weights,
        "alternative_scores": alternative_scores,
        "ordered_t": ordered_t,
        "ranking": ranking,
        "expert_output": expert_output,
        "alternative_output": alternative_output,
    }



def _failure_payload(
    *,
    data: Dict[str, Any],
    warnings: List[str],
    status: int,
    message: str,
    index: _Indexer,
    builder: _ConstraintBuilder,
    stage: str,
) -> Dict[str, Any]:
    return {
        "success": False,
        "status": int(status),
        "message": message,
        "stage": stage,
        "warnings": warnings,
        "model_info": {
            "n_experts": len(data["experts"]),
            "n_attrs": len(data["attrs"]),
            "n_alts": len(data["alts"]),
            "n_ratios": len(data["ratios"]),
            "epsilon": data["epsilon"],
            "lambdas": data["lambdas"],
            "alpha": data["alpha"],
            "beta": data["beta"],
            "zFixTolerance": data["zFixTolerance"],
            "n_variables": index.nvars,
            "n_constraints": len(builder.rows),
        },
        "implementation_notes": IMPLEMENTATION_NOTES,
    }



def solve_fam(payload: Dict[str, Any]) -> Dict[str, Any]:
    data = _validate_and_normalize(payload)
    warnings = _collect_direct_conflict_warnings(data)

    index = _Indexer(data["experts"], data["attrs"], data["alts"])

    # Stage 1: maximize Z.
    builder_stage1 = _build_common_constraints(data, index, use_gap_variables=False, z_floor=None)
    objective_stage1 = [0.0] * index.nvars
    objective_stage1[index.Z] = -1.0  # maximize Z

    result_stage1 = _run_milp(objective_stage1, builder_stage1, index)
    if not result_stage1.success:
        return _failure_payload(
            data=data,
            warnings=warnings,
            status=int(result_stage1.status),
            message=result_stage1.message,
            index=index,
            builder=builder_stage1,
            stage="stage1",
        )

    z_star = float(result_stage1.x[index.Z])

    # Stage 2: maximize alpha * DeltaE + beta * sum DeltaA_i, while keeping Z close to Z*.
    z_floor = max(0.0, z_star - data["zFixTolerance"])
    builder_stage2 = _build_common_constraints(data, index, use_gap_variables=True, z_floor=z_floor)
    objective_stage2 = [0.0] * index.nvars
    objective_stage2[index.deltaE] = -float(data["alpha"])
    for e in data["experts"]:
        objective_stage2[index.deltaA[e]] = -float(data["beta"])

    result_stage2 = _run_milp(objective_stage2, builder_stage2, index)

    # If stage 2 fails, gracefully fall back to stage-1 solution.
    if not result_stage2.success:
        solution = _extract_solution(index, data, result_stage1.x)
        warnings = list(warnings) + [
            f"第二阶段未成功求解，已回退为第一阶段最优解：{result_stage2.message}"
        ]
        return {
            "success": True,
            "status": int(result_stage1.status),
            "message": "第一阶段成功，第二阶段未成功，已返回第一阶段解。",
            "stage": "stage1_fallback",
            "objective_value": float(-result_stage1.fun),
            "first_stage_Z": z_star,
            "Z": z_star,
            "second_stage_objective": None,
            "deltaE": None,
            "deltaA": None,
            **solution,
            "warnings": warnings,
            "model_info": {
                "n_experts": len(data["experts"]),
                "n_attrs": len(data["attrs"]),
                "n_alts": len(data["alts"]),
                "n_ratios": len(data["ratios"]),
                "epsilon": data["epsilon"],
                "lambdas": data["lambdas"],
                "alpha": data["alpha"],
                "beta": data["beta"],
                "zFixTolerance": data["zFixTolerance"],
                "n_variables": index.nvars,
                "n_constraints": len(builder_stage2.rows),
                "n_constraints_stage1": len(builder_stage1.rows),
                "n_constraints_stage2": len(builder_stage2.rows),
                "z_floor_in_stage2": z_floor,
            },
            "implementation_notes": IMPLEMENTATION_NOTES,
        }

    solution = _extract_solution(index, data, result_stage2.x)
    delta_a = {e: float(result_stage2.x[index.deltaA[e]]) for e in data["experts"]}
    second_obj = float(-result_stage2.fun)

    return {
        "success": True,
        "status": int(result_stage2.status),
        "message": result_stage2.message,
        "stage": "stage2",
        "objective_value": second_obj,
        "first_stage_Z": z_star,
        "Z": float(result_stage2.x[index.Z]),
        "second_stage_objective": second_obj,
        "deltaE": float(result_stage2.x[index.deltaE]),
        "deltaA": delta_a,
        **solution,
        "warnings": warnings,
        "model_info": {
            "n_experts": len(data["experts"]),
            "n_attrs": len(data["attrs"]),
            "n_alts": len(data["alts"]),
            "n_ratios": len(data["ratios"]),
            "epsilon": data["epsilon"],
            "lambdas": data["lambdas"],
            "alpha": data["alpha"],
            "beta": data["beta"],
            "zFixTolerance": data["zFixTolerance"],
            "n_variables": index.nvars,
            "n_constraints": len(builder_stage2.rows),
            "n_constraints_stage1": len(builder_stage1.rows),
            "n_constraints_stage2": len(builder_stage2.rows),
            "z_floor_in_stage2": z_floor,
        },
        "implementation_notes": IMPLEMENTATION_NOTES,
    }
