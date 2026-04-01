# FAM Web MVP

这是一个可直接运行的网页原型，支持：

1. 指定专家、指标、方案；
2. 自动生成输入表；
3. 输入专家权重、指标排序、方案排序、可选比值；
4. 点击按钮后自动求解；
5. 自动输出方案排序、指标权重、局部权重。

## 运行方法

```bash
cd /mnt/data/fam_web_mvp
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

然后在浏览器打开：

```text
http://127.0.0.1:8000
```

## 当前实现说明

- 后端：FastAPI
- 求解：SciPy `milp`
- 前端：原生 HTML/CSS/JS
- 模型：采用严格排序版 FAM 原型，能够直接跑通输入—输出流程

## 后续可继续扩展

- 并列层级 / tie 逻辑
- 参数可调（alpha, beta, epsilon）
- 结果图表
- Excel 导入导出
- 接入你现有的 FAM 仓库前端
