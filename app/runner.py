import asyncio
import os
import sys
import time
import uuid
import subprocess
import shutil
import tempfile
from typing import Dict, Optional, Tuple, AsyncGenerator, Any

# Directory to hold temporary execution files (outside workspace to avoid watcher reloads)
WORKSPACE_DIR = os.path.join(tempfile.gettempdir(), "playwright_practice_studio_runs")
os.makedirs(WORKSPACE_DIR, exist_ok=True)

ACTIVE_PROCESSES: Dict[str, asyncio.subprocess.Process] = {}

def get_project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def get_node_bin_path() -> Tuple[str, str]:
    """Finds node and tsx binaries on the local Windows system."""
    project_root = get_project_root()
    local_tsx_cmd = os.path.join(project_root, "node_modules", ".bin", "tsx.cmd")
    local_tsx = os.path.join(project_root, "node_modules", ".bin", "tsx")

    tsx_cmd = "npx tsx"
    if os.path.exists(local_tsx_cmd):
        tsx_cmd = f'"{local_tsx_cmd}"'
    elif os.path.exists(local_tsx):
        tsx_cmd = f'"{local_tsx}"'

    return "node", tsx_cmd

async def execute_code_stream(
    execution_id: str,
    language: str,
    code: str,
    headed: bool = False,
    timeout_sec: int = 60
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Executes Python, JavaScript, or TypeScript code asynchronously,
    streaming output line-by-line and handling process termination cleanly.
    """
    lang = language.lower()
    start_time = time.time()
    project_root = get_project_root()

    ext = ".py" if lang == "python" else (".ts" if lang in ["typescript", "ts"] else ".js")
    file_name = f"run_{execution_id}{ext}"
    file_path = os.path.join(WORKSPACE_DIR, file_name)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(code)

        env = os.environ.copy()
        env["HEADED"] = "1" if headed else "0"
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        env["NODE_PATH"] = os.path.join(project_root, "node_modules")

        # Determine command
        if lang == "python":
            python_exe = sys.executable
            cmd = [python_exe, file_path]
            is_shell = False
        elif lang in ["typescript", "ts"]:
            _, tsx_path = get_node_bin_path()
            cmd = f'{tsx_path} "{file_path}"'
            is_shell = True
        else: # javascript
            cmd = ["node", file_path]
            is_shell = False

        yield {
            "type": "log",
            "text": f"🚀 Starting {language.upper()} Playwright run in {'👁️ HEADED' if headed else '⚡ HEADLESS'} mode...\n",
            "time": 0
        }

        # Spawn child process
        if is_shell:
            process = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=project_root
            )
        else:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=project_root
            )

        ACTIVE_PROCESSES[execution_id] = process
        accumulated_output = []
        output_queue = asyncio.Queue()

        async def pump(stream, is_stderr: bool):
            try:
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    decoded = line.decode("utf-8", errors="replace")
                    await output_queue.put({
                        "type": "error" if is_stderr else "log",
                        "text": decoded,
                        "time": round((time.time() - start_time) * 1000)
                    })
            except Exception:
                pass
            finally:
                await output_queue.put(None)

        task_out = asyncio.create_task(pump(process.stdout, False))
        task_err = asyncio.create_task(pump(process.stderr, True))

        streams_finished = 0
        while streams_finished < 2:
            item = await output_queue.get()
            if item is None:
                streams_finished += 1
            else:
                accumulated_output.append(item["text"])
                yield item

        await asyncio.gather(task_out, task_err, return_exceptions=True)
        await asyncio.wait_for(process.wait(), timeout=5.0)

        duration_ms = int((time.time() - start_time) * 1000)
        status = "success" if process.returncode == 0 else "failed"

        yield {
            "type": "done",
            "status": status,
            "exit_code": process.returncode,
            "duration_ms": duration_ms,
            "full_output": "".join(accumulated_output)
        }

    except asyncio.CancelledError:
        await stop_execution(execution_id)
        duration_ms = int((time.time() - start_time) * 1000)
        yield {
            "type": "done",
            "status": "stopped",
            "exit_code": -1,
            "duration_ms": duration_ms,
            "full_output": "\n🛑 Execution manually aborted by user."
        }
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        yield {
            "type": "done",
            "status": "failed",
            "exit_code": 1,
            "duration_ms": duration_ms,
            "full_output": f"\n💥 Execution Error: {str(e)}"
        }
    finally:
        ACTIVE_PROCESSES.pop(execution_id, None)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass

async def stop_execution(execution_id: str) -> bool:
    """Terminates an active child process."""
    process = ACTIVE_PROCESSES.get(execution_id)
    if not process:
        return False
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True)
        else:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                process.kill()
        return True
    except Exception:
        return False
