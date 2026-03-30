from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from solver import ModelInputError, solve_fam

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES = Jinja2Templates(directory=str(BASE_DIR / "templates"))
SAMPLE_PATH = BASE_DIR / "sample_input.json"

app = FastAPI(title="FAM Exact MILP Web App")

# 静态资源目录
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return TEMPLATES.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
        },
    )


@app.get("/api/sample")
async def sample() -> Dict[str, Any]:
    if not SAMPLE_PATH.exists():
        raise HTTPException(status_code=404, detail="sample_input.json 不存在。")
    with SAMPLE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


@app.post("/api/solve")
async def api_solve(payload: Dict[str, Any]):
    try:
        result = solve_fam(payload)
        status_code = 200 if result.get("success") else 422
        return JSONResponse(result, status_code=status_code)
    except ModelInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"求解时发生未预期错误：{exc}") from exc


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
    print("Server running at http://192.168.1.8:8000")