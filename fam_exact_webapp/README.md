# FAM 两阶段应用

这个版本已经按新版建模逻辑改为**两阶段 MILP**：

1. **第一阶段**：最大化方案区分度 `Z`。
2. **第二阶段**：在保持 `Z >= Z* - zFixTolerance` 的前提下，最大化专家差距 `Δ^E` 与属性差距 `Δ_i^A`。

## 主要更新

- 显式加入聚合约束：
  - `w_i = Σ_j Σ_k w_ijk`
  - `w_ij = Σ_k w_ijk`
  - `v_j = Σ_i w_ij`
- 输出新增：
  - 全局属性权重 `v_j`
  - 专家差距 `Δ^E`
  - 各专家属性差距 `Δ_i^A`
- 前端新增参数：
  - `alpha`：专家差距目标权重
  - `beta`：属性差距目标权重
  - `zFixTolerance`：第二阶段对第一阶段最优 `Z*` 的固定容差

## 运行

```bash
pip install -r requirements.txt
python app.py
```

打开：

```text
http://127.0.0.1:8000
```

## 输入 JSON 关键字段

- `experts`, `attrs`, `alts`
- `expertRanks`, `attrRanks`, `altRanks`
- `ratioText`
- `epsilon`
- `alpha`
- `beta`
- `zFixTolerance`
- `lambdas`

## 说明

- 严格不等式会自动用 `epsilon` 替换为 MILP 可处理的非严格不等式。
- 当前实现使用 `scipy.optimize.milp`（HiGHS）求解。
- 若第二阶段失败，通常意味着在保持 `Z` 接近 `Z*` 的前提下，新增差距约束与原有排序/比值信息发生冲突。
