"""
Authentication backend for the **Login Authentication** playground target
(``/playground/login.html`` and the short ``/login`` alias).

Why this exists
---------------
The original login page validated credentials in the browser with
``if (u === "admin" && p === "password123")``. That is not testable beyond the
happy path and teaches nothing about cookies, sessions, redirects or error
states. This module moves validation to the server so the page behaves like a
real sign-in screen:

* Credentials are checked **server side** and never echoed back to the client.
* Successful sign-in creates a **session** stored in SQLite and hands the
  browser an ``HttpOnly`` cookie (``pps_session``). Playwright can therefore
  practise ``context.cookies()``, ``storageState``, ``page.reload()``
  persistence, and ``context.clear_cookies()``.
* "Remember me" switches the cookie from a *session* cookie (``expires = -1``)
  to a *persistent* 7-day cookie - a great assertion target.
* Failure modes are deliberate and easy to assert against:

  ============  ========================================================
  HTTP status   Meaning
  ============  ========================================================
  ``400``       Missing username / password (client-side validation error)
  ``401``       Wrong credentials (``attempts_remaining`` included)
  ``403``       Account exists but is locked out
  ``429``       Too many failed attempts -> temporary lockout (``Retry-After``)
  ============  ========================================================

.. warning::
   The demo accounts below are **intentionally** hard-coded and published on the
   page (and via ``GET /api/auth/users``) because this project is an offline
   practice sandbox. Never ship this pattern in a real application - use a
   password hash (argon2/bcrypt), a real user store and HTTPS-only cookies.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import database as db

# --- Configuration ---------------------------------------------------------

SESSION_COOKIE_NAME = "pps_session"
SESSION_TTL_SECONDS = 60 * 60              # 1 hour for a normal session cookie
REMEMBER_ME_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days when "Remember me" is ticked
MAX_FAILED_ATTEMPTS = 5                   # then a temporary lockout kicks in
LOCKOUT_WINDOW_SECONDS = 60               # lockout / rate-limit window

# --- Demo user store (practice sandbox only) -------------------------------

DEMO_USERS: Dict[str, Dict[str, Any]] = {
    "admin": {
        "password": "password123",
        "display_name": "Alex Admin",
        "role": "Administrator",
        "locked": False,
        "note": "Happy path account - signs in successfully.",
    },
    "standard_user": {
        "password": "secret_sauce",
        "display_name": "Sam Standard",
        "role": "Standard User",
        "locked": False,
        "note": "Second happy path account with a read-only role.",
    },
    "locked_out_user": {
        "password": "locked123",
        "display_name": "Larry Locked",
        "role": "Standard User",
        "locked": True,
        "note": "Credentials are valid but the account is locked (HTTP 403).",
    },
}

# username -> list of failure timestamps (in-memory, reset when the server restarts)
_failed_attempts: Dict[str, List[datetime]] = {}

router = APIRouter(prefix="/api/auth", tags=["auth"])


# --- Request models --------------------------------------------------------

class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""
    remember: bool = False


# --- Helpers ---------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _failure(
    status_code: int,
    error: str,
    message: str,
    attempts_remaining: Optional[int] = None,
    headers: Optional[Dict[str, str]] = None,
) -> JSONResponse:
    """Builds a consistent JSON error body so tests can assert on `error`."""
    body: Dict[str, Any] = {"success": False, "error": error, "message": message}
    if attempts_remaining is not None:
        body["attempts_remaining"] = attempts_remaining
    response_headers = {"Cache-Control": "no-store"}
    if headers:
        response_headers.update(headers)
    return JSONResponse(status_code=status_code, content=body, headers=response_headers)


def _recent_failures(username: str) -> List[datetime]:
    """Failures for `username` inside the lockout window (older ones are dropped)."""
    cutoff = _now() - timedelta(seconds=LOCKOUT_WINDOW_SECONDS)
    attempts = [t for t in _failed_attempts.get(username, []) if t > cutoff]
    if attempts:
        _failed_attempts[username] = attempts
    else:
        _failed_attempts.pop(username, None)
    return attempts


def _record_failure(username: str) -> None:
    _failed_attempts.setdefault(username, []).append(_now())


def _seconds_until_unlock(username: str) -> int:
    attempts = _recent_failures(username)
    if not attempts:
        return 0
    unlock_at = min(attempts) + timedelta(seconds=LOCKOUT_WINDOW_SECONDS)
    return max(0, int((unlock_at - _now()).total_seconds()))


def _user_payload(username: str) -> Dict[str, Any]:
    user = DEMO_USERS[username]
    return {
        "username": username,
        "display_name": user["display_name"],
        "role": user["role"],
    }


def _session_payload(session: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "cookie_name": SESSION_COOKIE_NAME,
        "expires_at": session["expires_at"],
        "remember": bool(session["is_remembered"]),
        "ttl_seconds": REMEMBER_ME_TTL_SECONDS if session["is_remembered"] else SESSION_TTL_SECONDS,
    }


# --- Endpoints -------------------------------------------------------------

@router.post("/login")
async def login(payload: LoginRequest, response: Response):
    """Validates credentials and creates a session cookie on success."""
    username = (payload.username or "").strip()
    password = payload.password or ""
    username_key = username.lower()

    # 1. Field level validation (mirrors the messages shown in the UI)
    if not username and not password:
        return _failure(400, "validation_error", "Username and password are required.")
    if not username:
        return _failure(400, "validation_error", "Username is required.")
    if not password:
        return _failure(400, "validation_error", "Password is required.")

    # 2. Rate limiting - block while the account is temporarily locked
    if len(_recent_failures(username_key)) >= MAX_FAILED_ATTEMPTS:
        retry_after = _seconds_until_unlock(username_key)
        return _failure(
            429,
            "too_many_attempts",
            f"Too many failed attempts. This account is locked for {retry_after} more seconds.",
            attempts_remaining=0,
            headers={"Retry-After": str(retry_after)},
        )

    # 3. Credential check (server side only)
    user = DEMO_USERS.get(username_key)
    if user is None or password != user["password"]:
        _record_failure(username_key)
        remaining = max(0, MAX_FAILED_ATTEMPTS - len(_recent_failures(username_key)))
        if remaining == 0:
            return _failure(
                429,
                "too_many_attempts",
                f"Too many failed attempts. This account is locked for {LOCKOUT_WINDOW_SECONDS} seconds.",
                attempts_remaining=0,
                headers={"Retry-After": str(LOCKOUT_WINDOW_SECONDS)},
            )
        return _failure(
            401,
            "invalid_credentials",
            "Invalid username or password. Please try again.",
            attempts_remaining=remaining,
        )

    # 4. Locked-out accounts are rejected even with the correct password
    if user["locked"]:
        return _failure(
            403,
            "account_locked",
            "This account has been locked out. Please contact an administrator.",
        )

    # 5. Success - create the session and set the cookie
    ttl = REMEMBER_ME_TTL_SECONDS if payload.remember else SESSION_TTL_SECONDS
    token = secrets.token_urlsafe(32)
    session = db.create_session(
        token=token,
        username=username_key,
        display_name=user["display_name"],
        role=user["role"],
        ttl_seconds=ttl,
        is_remembered=bool(payload.remember),
    )
    _failed_attempts.pop(username_key, None)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=ttl if payload.remember else None,  # session cookie vs persistent cookie
        httponly=True,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"

    return {
        "success": True,
        "message": f"Welcome back, {user['display_name']}! Your session has been created.",
        "user": _user_payload(username_key),
        "session": _session_payload(session),
    }


@router.get("/me")
async def current_user(request: Request):
    """Returns the signed-in user, or 401 when there is no valid session.

    The page calls this on load, so a Playwright test can assert that the session
    survives a ``page.reload()`` (and dies after ``context.clear_cookies()``).
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return _failure(401, "not_authenticated", "No active session was found.")
    session = db.get_session(token)
    if not session:
        return _failure(401, "session_expired", "Your session has expired. Please sign in again.")
    return {
        "authenticated": True,
        "user": {
            "username": session["username"],
            "display_name": session["display_name"],
            "role": session["role"],
        },
        "session": _session_payload(session),
    }


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Invalidates the server-side session and clears the cookie."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    db.delete_session(token)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"success": True, "message": "You have been signed out."}


@router.get("/users")
async def demo_users():
    """Lists the practice credentials (sandbox convenience, not a real API)."""
    return [
        {
            "username": username,
            "password": user["password"],
            "display_name": user["display_name"],
            "role": user["role"],
            "locked": user["locked"],
            "note": user["note"],
        }
        for username, user in DEMO_USERS.items()
    ]


@router.delete("/attempts/{username}")
async def reset_failed_attempts(username: str):
    """Clears the lockout counter - handy to reset state between test runs."""
    _failed_attempts.pop(username.strip().lower(), None)
    return {"success": True, "message": f"Failed attempts cleared for '{username}'."}
