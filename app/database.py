import sqlite3
import json
import os
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

DB_FILE = os.path.join(os.path.dirname(__file__), "history.db")

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        # Runs history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                language TEXT NOT NULL,
                code TEXT NOT NULL,
                headed INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                output TEXT,
                duration_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Snippets table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS snippets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                tags TEXT,
                language TEXT NOT NULL,
                code TEXT NOT NULL,
                is_favorite INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Login sessions table (powers the Login Authentication playground target)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL,
                is_remembered INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        """)
        conn.commit()
        purge_expired_sessions()

# --- Run History operations ---

def record_run(language: str, code: str, headed: bool, status: str, output: str, duration_ms: int) -> int:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO runs (language, code, headed, status, output, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (language, code, 1 if headed else 0, status, output, duration_ms, datetime.utcnow().isoformat())
        )
        conn.commit()
        return cursor.lastrowid

def get_recent_runs(language: Optional[str] = None, search: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT id, language, code, headed, status, output, duration_ms, created_at FROM runs WHERE 1=1"
        params = []

        if language and language.lower() != "all":
            query += " AND lower(language) = ?"
            params.append(language.lower())

        if search:
            query += " AND (code LIKE ? OR output LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])

        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def clear_run_history():
    with get_db() as conn:
        conn.cursor().execute("DELETE FROM runs")
        conn.commit()

# --- Snippets operations ---

def create_snippet(title: str, tags: str, language: str, code: str) -> Dict[str, Any]:
    with get_db() as conn:
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()
        cursor.execute(
            """
            INSERT INTO snippets (title, tags, language, code, is_favorite, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            """,
            (title, tags, language, code, now, now)
        )
        conn.commit()
        snippet_id = cursor.lastrowid
        return get_snippet_by_id(snippet_id)

def get_snippet_by_id(snippet_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM snippets WHERE id = ?", (snippet_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_all_snippets(language: Optional[str] = None, search: Optional[str] = None, favorites_only: bool = False) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM snippets WHERE 1=1"
        params = []

        if language and language.lower() != "all":
            query += " AND lower(language) = ?"
            params.append(language.lower())

        if favorites_only:
            query += " AND is_favorite = 1"

        if search:
            query += " AND (title LIKE ? OR tags LIKE ? OR code LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])

        query += " ORDER BY is_favorite DESC, updated_at DESC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def update_snippet(snippet_id: int, title: str, tags: str, language: str, code: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()
        cursor.execute(
            """
            UPDATE snippets
            SET title = ?, tags = ?, language = ?, code = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, tags, language, code, now, snippet_id)
        )
        conn.commit()
        return get_snippet_by_id(snippet_id)

def toggle_favorite_snippet(snippet_id: int) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE snippets SET is_favorite = (1 - is_favorite) WHERE id = ?", (snippet_id,))
        conn.commit()
        return get_snippet_by_id(snippet_id)

def delete_snippet(snippet_id: int) -> bool:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
        conn.commit()
        return cursor.rowcount > 0

# --- Login session operations (Login Authentication playground target) ---

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str) -> datetime:
    """Parses an ISO-8601 timestamp, tolerating naive values written by older rows."""
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def create_session(token: str, username: str, display_name: str, role: str,
                   ttl_seconds: int, is_remembered: bool = False) -> Dict[str, Any]:
    now = _utcnow()
    expires_at = now + timedelta(seconds=ttl_seconds)
    with get_db() as conn:
        conn.cursor().execute(
            """
            INSERT OR REPLACE INTO sessions
                (token, username, display_name, role, is_remembered, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (token, username, display_name, role, 1 if is_remembered else 0,
             now.isoformat(), expires_at.isoformat())
        )
        conn.commit()
    return {
        "token": token,
        "username": username,
        "display_name": display_name,
        "role": role,
        "is_remembered": is_remembered,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat()
    }


def get_session(token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Returns the session for `token`, or None when missing/expired."""
    if not token:
        return None
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM sessions WHERE token = ?", (token,))
        row = cursor.fetchone()
    if not row:
        return None

    session = dict(row)
    if _parse_iso(session["expires_at"]) <= _utcnow():
        delete_session(token)
        return None
    session["is_remembered"] = bool(session["is_remembered"])
    return session


def delete_session(token: Optional[str]) -> bool:
    if not token:
        return False
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return cursor.rowcount > 0


def purge_expired_sessions() -> int:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE expires_at <= ?", (_utcnow().isoformat(),))
        conn.commit()
        return cursor.rowcount


# Initialize on module import
init_db()
