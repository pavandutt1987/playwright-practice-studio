import os
import sys
import uuid
import json
import asyncio
import subprocess
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import auth
from . import database as db
from . import templates
from . import runner

app = FastAPI(title="Playwright Practice Studio API")

# Enable CORS for local cross-origin development if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
PLAYGROUND_DIR = os.path.join(STATIC_DIR, "playground")

# Mount static folders
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/playground", StaticFiles(directory=PLAYGROUND_DIR), name="playground")

# Authentication API for the Login Authentication playground target
app.include_router(auth.router)

# Request Models
class SnippetCreate(BaseModel):
    title: str
    tags: Optional[str] = ""
    language: str
    code: str

class SnippetUpdate(BaseModel):
    title: str
    tags: Optional[str] = ""
    language: str
    code: str

class StopRequest(BaseModel):
    execution_id: str

# --- Page Routes ---

@app.get("/")
async def get_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    return FileResponse(index_file)

@app.get("/login")
async def get_login_page():
    """Short alias so the login target is reachable at /login as well as
    /playground/login.html."""
    return FileResponse(os.path.join(PLAYGROUND_DIR, "login.html"))

# --- Status / Health Check ---

@app.get("/api/status")
async def get_status():
    # 1. Check Python Playwright
    python_playwright = False
    try:
        import playwright
        python_playwright = True
    except ImportError:
        pass

    # 2. Check Node & TSX
    node_installed = False
    tsx_installed = False
    try:
        node_res = subprocess.run(["node", "--version"], capture_output=True, text=True)
        node_installed = node_res.returncode == 0
    except Exception:
        pass

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tsx_cmd = os.path.join(project_root, "node_modules", ".bin", "tsx.cmd")
    tsx_installed = os.path.exists(tsx_cmd) or shutil_which("tsx")

    # 3. Check Chromium browser
    chromium_installed = True # default true if playwright installed

    return {
        "python_playwright": python_playwright,
        "node": node_installed,
        "tsx": tsx_installed,
        "chromium": chromium_installed
    }

def shutil_which(cmd: str) -> bool:
    import shutil
    return shutil.which(cmd) is not None

# --- Challenge Templates ---

@app.get("/api/templates")
async def list_templates():
    return templates.get_template_list()

@app.get("/api/templates/{template_id}")
async def get_template(template_id: str, lang: str = "python"):
    code = templates.get_template_code(template_id, lang)
    return {"template_id": template_id, "language": lang, "code": code}

# --- Code Execution WebSocket ---

@app.websocket("/ws/run")
async def websocket_run_code(websocket: WebSocket):
    await websocket.accept()
    execution_id = str(uuid.uuid4())[:8]

    try:
        data = await websocket.receive_text()
        payload = json.loads(data)

        language = payload.get("language", "python")
        code = payload.get("code", "")
        headed = bool(payload.get("headed", False))

        await websocket.send_json({"execution_id": execution_id})

        full_output = []
        final_status = "failed"
        final_duration = 0

        async for item in runner.execute_code_stream(execution_id, language, code, headed=headed):
            await websocket.send_json(item)
            if item.get("type") in ["log", "error"]:
                full_output.append(item.get("text", ""))
            elif item.get("type") == "done":
                final_status = item.get("status", "failed")
                final_duration = item.get("duration_ms", 0)
                if "full_output" in item:
                    full_output = [item["full_output"]]

        # Save run to SQLite database
        db.record_run(
            language=language,
            code=code,
            headed=headed,
            status=final_status,
            output="".join(full_output),
            duration_ms=final_duration
        )

    except WebSocketDisconnect:
        await runner.stop_execution(execution_id)
    except Exception as e:
        import traceback
        traceback.print_exc()
        await websocket.send_json({
            "type": "error",
            "text": f"Execution failed with internal server error: {str(e)}"
        })
        await websocket.send_json({
            "type": "done",
            "status": "failed",
            "duration_ms": 0
        })

@app.post("/api/stop")
async def stop_code_execution(req: StopRequest):
    stopped = await runner.stop_execution(req.execution_id)
    return {"stopped": stopped}

# --- History Endpoints ---

@app.get("/api/history")
async def get_history(language: Optional[str] = None, search: Optional[str] = None):
    return db.get_recent_runs(language=language, search=search)

@app.delete("/api/history")
async def clear_history():
    db.clear_run_history()
    return {"cleared": True}

# --- Snippet Library Endpoints ---

@app.get("/api/snippets")
async def get_snippets(language: Optional[str] = None, search: Optional[str] = None, favorites_only: bool = False):
    return db.get_all_snippets(language=language, search=search, favorites_only=favorites_only)

@app.post("/api/snippets")
async def create_new_snippet(snippet: SnippetCreate):
    created = db.create_snippet(
        title=snippet.title,
        tags=snippet.tags or "",
        language=snippet.language,
        code=snippet.code
    )
    return created

@app.put("/api/snippets/{snippet_id}")
async def update_existing_snippet(snippet_id: int, snippet: SnippetUpdate):
    updated = db.update_snippet(
        snippet_id=snippet_id,
        title=snippet.title,
        tags=snippet.tags or "",
        language=snippet.language,
        code=snippet.code
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return updated

@app.put("/api/snippets/{snippet_id}/favorite")
async def toggle_favorite(snippet_id: int):
    updated = db.toggle_favorite_snippet(snippet_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return updated

@app.delete("/api/snippets/{snippet_id}")
async def delete_existing_snippet(snippet_id: int):
    deleted = db.delete_snippet(snippet_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Snippet not found")
    return {"deleted": True}

# --- Mock APIs for Playground Targets ---

@app.get("/api/products/more")
async def mock_more_products(id: int = 105):
    # Simulate network latency for AJAX practice
    await asyncio.sleep(1.0)
    return [
        {"id": id, "name": "4K Ultra HD Webcam", "category": "Accessories", "price": "$89.99", "status": "In Stock"},
        {"id": id + 1, "name": "USB-C Dual Display Dock", "category": "Electronics", "price": "$159.00", "status": "In Stock"},
        {"id": id + 2, "name": "Studio Condenser Microphone", "category": "Audio", "price": "$119.50", "status": "In Stock"}
    ]

@app.get("/api/user-profile")
async def mock_user_profile():
    # Default mock user profile (interceptable via Playwright page.route)
    return {
        "name": "Alex Mercer",
        "role": "Principal Automation Engineer",
        "department": "Quality & Platform",
        "status": "Active VIP"
    }
