from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="FAM Web - Exact MILP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class Expert(BaseModel):
    id: str
    name: str
    weight: float = Field(ge=0)


class Criterion(BaseModel):
    id: str
    name: str


class Alternative(BaseModel):
    id: str
    name: str


class CriterionRanking(BaseModel):
    expert_id: str
    criterion_id: str
    rank: Optional[float] = None


class AlternativeRanking(BaseModel):
    expert_id: str
    criterion_id: str
    alternative_id: str
    rank: Optional[float] = None


class RatioInput(BaseModel):
    expert_id: str
    criterion_id: str
    alt_k_id: str
    alt_k_prime_id: str
    ratio: float = Field(gt=0)


class SolveParams(BaseModel):
    alpha: float = Field(default=10.0, gt=0)
    beta: float = Field(default=1.0, gt=0)
    eta: float = Field(default=0.01, ge=0)
    epsilon: float = Field(default=1e-4, gt=0)
    phi: float = Field(default=1e-3, gt=0)
    big_m: float = Field(default=1.0, gt=0)
    lambda_default: float = Field(default=1.0, gt=0)
    lambda_list: List[float] = Field(default_factory=list)
    min_separations: int = Field(default=1, ge=0)
    enable_layer_guard: bool = True

    @model_validator(mode="after")
    def validate_lambdas(self) -> "SolveParams":
        if any(val <= 0 for val in self.lambda_list):
            raise ValueError("lambda_list 中所有值都必须大于 0。")
        return self


class SolveRequest(BaseModel):
    experts: List[Expert]
    criteria: List[Criterion]
    alternatives: List[Alternative]
    criterion_rankings: List[CriterionRanking] = Field(default_factory=list)
    alternative_rankings: List[AlternativeRanking] = Field(default_factory=list)
    ratios: List[RatioInput] = Field(default_factory=list)
    params: SolveParams = SolveParams()


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    html = (TEMPLATES_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(content=html)


@app.post("/solve")
def solve(payload: SolveRequest) -> Dict:
    try:
        return solve_fam_exact(payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"求解失败：{exc}") from exc


class VarMap:
    def __init__(self, I: int, J: int, K: int):
        self.I, self.J, self.K = I, J, K
        offset = 0
        self.w0 = offset
        offset += I * J * K
        self.u0 = offset
        offset += I * J
        self.c0 = offset
        offset += J
        self.a0 = offset
        offset += K
        self.dA = offset
        offset += 1
        self.dC0 = offset
        offset += I
        self.at0 = offset
        offset += K
        self.x0 = offset
        offset += K * K
        self.y0 = offset
        offset += max(K - 1, 0)
        self.n = offset

    def w(self, i: int, j: int, k: int) -> int:
        return self.w0 + (i * self.J + j) * self.K + k

    def u(self, i: int, j: int) -> int:
        return self.u0 + i * self.J + j

    def c(self, j: int) -> int:
        return self.c0 + j

    def a(self, k: int) -> int:
        return self.a0 + k

    def d_c(self, i: int) -> int:
        return self.dC0 + i

    def at(self, r: int) -> int:
        return self.at0 + r

    def x(self, k: int, r: int) -> int:
        return self.x0 + k * self.K + r

    def y(self, r: int) -> int:
        return self.y0 + r


def solve_fam_exact(payload: SolveRequest) -> Dict:
    experts = payload.experts
    criteria = payload.criteria
    alternatives = payload.alternatives
    params = payload.params

    if not experts or not criteria or not alternatives:
        raise HTTPException(status_code=400, detail="专家、指标、方案都不能为空。")

    I, J, K = len(experts), len(criteria), len(alternatives)
    if len({e.id for e in experts}) != I or len({c.id for c in criteria}) != J or len({a.id for a in alternatives}) != K:
        raise HTTPException(status_code=400, detail="专家、指标、方案的 ID 必须唯一。")

    total_weight = sum(e.weight for e in experts)
    if total_weight <= 0:
        raise HTTPException(status_code=400, detail="专家权重之和必须大于 0。")
    if abs(total_weight - 1.0) > 1e-8:
        raise HTTPException(status_code=400, detail="该版本按你的原模型实现，要求专家权重之和严格等于 1。")

    if params.min_separations > max(K - 1, 0):
        raise HTTPException(status_code=400, detail=f"min_separations 不能超过 |K|-1={max(K-1, 0)}。")

    expert_idx = {e.id: i for i, e in enumerate(experts)}
    criterion_idx = {c.id: j for j, c in enumerate(criteria)}
    alt_idx = {a.id: k for k, a in enumerate(alternatives)}

    lambda_list = list(params.lambda_list)
    while len(lambda_list) < max(K - 1, 0):
        lambda_list.append(params.lambda_default)
    lambda_list = lambda_list[: max(K - 1, 0)]

    var = VarMap(I, J, K)
    n_vars = var.n

    c_obj = np.zeros(n_vars)
    c_obj[var.dA] = -params.alpha
    for i in range(I):
        c_obj[var.d_c(i)] = -params.beta
    for r in range(K - 1):
        c_obj[var.y(r)] = -params.eta

    lb = np.zeros(n_vars)
    ub = np.full(n_vars, np.inf)

    for j in range(J):
        ub[var.c(j)] = 1.0
    for k in range(K):
        ub[var.a(k)] = 1.0
        ub[var.at(k)] = 1.0
    ub[var.dA] = 1.0
    for i, exp in enumerate(experts):
        ub[var.d_c(i)] = exp.weight if J > 1 else 0.0
        for j in range(J):
            ub[var.u(i, j)] = exp.weight
            for k in range(K):
                ub[var.w(i, j, k)] = exp.weight

    integrality = np.zeros(n_vars, dtype=int)
    for k in range(K):
        for r in range(K):
            idx = var.x(k, r)
            integrality[idx] = 1
            ub[idx] = 1.0
    for r in range(K - 1):
        idx = var.y(r)
        integrality[idx] = 1
        ub[idx] = 1.0

    rows: List[Dict[int, float]] = []
    lbs: List[float] = []
    ubs: List[float] = []

    def add_row(coeffs: Dict[int, float], lower: float, upper: float) -> None:
        rows.append(coeffs)
        lbs.append(lower)
        ubs.append(upper)

    for k in range(K):
        coeffs = {var.a(k): 1.0}
        for i in range(I):
            for j in range(J):
                coeffs[var.w(i, j, k)] = coeffs.get(var.w(i, j, k), 0.0) - 1.0
        add_row(coeffs, 0.0, 0.0)

    for i in range(I):
        for j in range(J):
            coeffs = {var.u(i, j): 1.0}
            for k in range(K):
                coeffs[var.w(i, j, k)] = coeffs.get(var.w(i, j, k), 0.0) - 1.0
            add_row(coeffs, 0.0, 0.0)

    for j in range(J):
        coeffs = {var.c(j): 1.0}
        for i in range(I):
            coeffs[var.u(i, j)] = coeffs.get(var.u(i, j), 0.0) - 1.0
        add_row(coeffs, 0.0, 0.0)

    for i, exp in enumerate(experts):
        coeffs: Dict[int, float] = {}
        for j in range(J):
            for k in range(K):
                coeffs[var.w(i, j, k)] = coeffs.get(var.w(i, j, k), 0.0) + 1.0
        add_row(coeffs, exp.weight, exp.weight)

    for k in range(K):
        add_row({var.x(k, r): 1.0 for r in range(K)}, 1.0, 1.0)
    for r in range(K):
        add_row({var.x(k, r): 1.0 for k in range(K)}, 1.0, 1.0)

    M = params.big_m
    for k in range(K):
        for r in range(K):
            add_row({var.a(k): 1.0, var.at(r): -1.0, var.x(k, r): M}, -np.inf, M)
            add_row({var.at(r): 1.0, var.a(k): -1.0, var.x(k, r): M}, -np.inf, M)

    for r in range(K - 1):
        lam = lambda_list[r]
        add_row({var.at(r): 1.0, var.at(r + 1): -1.0}, 0.0, np.inf)
        add_row({var.at(r): 1.0, var.at(r + 1): -1.0, var.y(r): -params.phi}, 0.0, np.inf)
        add_row({var.at(r): 1.0, var.at(r + 1): -1.0, var.y(r): -M}, -np.inf, 0.0)
        add_row({var.dA: 1.0, var.at(r): -lam, var.at(r + 1): lam, var.y(r): M}, -np.inf, M)

    if params.enable_layer_guard and K > 1:
        coeffs = {var.dA: 1.0}
        for r in range(K - 1):
            coeffs[var.y(r)] = -M
        add_row(coeffs, -np.inf, 0.0)

    if params.min_separations > 0 and K > 1:
        add_row({var.y(r): 1.0 for r in range(K - 1)}, params.min_separations, np.inf)

    criterion_rank_map: Dict[tuple[int, int], float] = {}
    for item in payload.criterion_rankings:
        if item.rank is None:
            continue
        if item.expert_id not in expert_idx or item.criterion_id not in criterion_idx:
            continue
        criterion_rank_map[(expert_idx[item.expert_id], criterion_idx[item.criterion_id])] = float(item.rank)

    for i in range(I):
        available = [(j, criterion_rank_map[(i, j)]) for j in range(J) if (i, j) in criterion_rank_map]
        for j1, r1 in available:
            for j2, r2 in available:
                if r1 < r2:
                    add_row({var.u(i, j1): 1.0, var.u(i, j2): -1.0}, params.epsilon, np.inf)
                    add_row({var.u(i, j1): 1.0, var.u(i, j2): -1.0, var.d_c(i): -1.0}, 0.0, np.inf)

    alt_rank_map: Dict[tuple[int, int, int], float] = {}
    for item in payload.alternative_rankings:
        if item.rank is None:
            continue
        if item.expert_id not in expert_idx or item.criterion_id not in criterion_idx or item.alternative_id not in alt_idx:
            continue
        alt_rank_map[(expert_idx[item.expert_id], criterion_idx[item.criterion_id], alt_idx[item.alternative_id])] = float(item.rank)

    for i in range(I):
        for j in range(J):
            available = [(k, alt_rank_map[(i, j, k)]) for k in range(K) if (i, j, k) in alt_rank_map]
            for k1, r1 in available:
                for k2, r2 in available:
                    if r1 < r2:
                        add_row({var.w(i, j, k1): 1.0, var.w(i, j, k2): -1.0}, params.epsilon, np.inf)

    for ratio in payload.ratios:
        if (
            ratio.expert_id not in expert_idx
            or ratio.criterion_id not in criterion_idx
            or ratio.alt_k_id not in alt_idx
            or ratio.alt_k_prime_id not in alt_idx
        ):
            continue
        i = expert_idx[ratio.expert_id]
        j = criterion_idx[ratio.criterion_id]
        k = alt_idx[ratio.alt_k_id]
        kp = alt_idx[ratio.alt_k_prime_id]
        add_row({var.w(i, j, k): 1.0, var.w(i, j, kp): -float(ratio.ratio)}, 0.0, 0.0)

    A = lil_matrix((len(rows), n_vars), dtype=float)
    for r, coeffs in enumerate(rows):
        for idx, val in coeffs.items():
            A[r, idx] = val

    constraints = LinearConstraint(A.tocsr(), np.array(lbs, dtype=float), np.array(ubs, dtype=float))
    bounds = Bounds(lb, ub)

    result = milp(c=c_obj, constraints=constraints, integrality=integrality, bounds=bounds)
    if not result.success or result.x is None:
        detail = result.message if hasattr(result, "message") else "模型无可行解。"
        raise HTTPException(status_code=400, detail=f"模型未成功求解：{detail}")

    x = result.x
    sorted_positions = [round(float(x[var.at(r)]), 6) for r in range(K)]
    y_values = [int(round(float(x[var.y(r)]))) for r in range(K - 1)]

    layer_by_position: List[int] = []
    current_layer = 1
    for r in range(K):
        layer_by_position.append(current_layer)
        if r < K - 1 and y_values[r] == 1:
            current_layer += 1

    alternative_scores = []
    for k, alt in enumerate(alternatives):
        score = float(x[var.a(k)])
        position = None
        for r in range(K):
            if x[var.x(k, r)] > 0.5:
                position = r + 1
                break
        layer = layer_by_position[position - 1] if position is not None else None
        alternative_scores.append(
            {
                "id": alt.id,
                "name": alt.name,
                "score": round(score, 6),
                "rank": position,
                "layer": layer,
            }
        )
    alternative_scores.sort(key=lambda item: (item["rank"] if item["rank"] is not None else 10**9, -item["score"]))

    criterion_weights = []
    for j, crit in enumerate(criteria):
        criterion_weights.append({"id": crit.id, "name": crit.name, "weight": round(float(x[var.c(j)]), 6)})
    criterion_weights.sort(key=lambda item: -item["weight"])

    local_weights = []
    for i, exp in enumerate(experts):
        row = {
            "expert": exp.name,
            "expert_weight": round(exp.weight, 6),
            "criterion_gap": round(float(x[var.d_c(i)]), 6),
            "criterion_weights": [],
        }
        for j, crit in enumerate(criteria):
            row["criterion_weights"].append({"criterion": crit.name, "value": round(float(x[var.u(i, j)]), 6)})
        local_weights.append(row)

    warning_notes: List[str] = []
    if K > 1 and sum(y_values) == 0:
        warning_notes.append("当前解将所有相邻位置都判为同层；可尝试提高 eta、降低 phi，或提高 min_separations")
    if params.enable_layer_guard:
        warning_notes.append("已启用 d^A ≤ M·Σy_r 的防空转约束，用于避免 d^A 在全部同层时被无意义放松")

    return {
        "status": "ok",
        "message": "求解成功",
        "objective": round(float(-result.fun), 6),
        "global_gap": round(float(x[var.dA]), 6),
        "criterion_weights": criterion_weights,
        "alternative_scores": alternative_scores,
        "local_weights": local_weights,
        "sorted_position_scores": sorted_positions,
        "y_values": y_values,
        "warning_notes": warning_notes,
        "solver_message": result.message,
        "model_note": "当前版本按完整排序-分层模型求解，并增加了防止无意义同层的可调参数：eta、min_separations 和 layer_guard。",
        "params_used": {
            "alpha": params.alpha,
            "beta": params.beta,
            "eta": params.eta,
            "epsilon": params.epsilon,
            "phi": params.phi,
            "big_m": params.big_m,
            "lambda_default": params.lambda_default,
            "lambda_list": lambda_list,
            "min_separations": params.min_separations,
            "enable_layer_guard": params.enable_layer_guard,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
