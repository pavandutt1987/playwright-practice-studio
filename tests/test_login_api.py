"""
HTTP-level tests for the Login Authentication target (``app/auth.py``).

These assert the *server* side of the login page: validation, cookie sessions,
lockout, rate limiting and logout. They run in-process with FastAPI's TestClient,
so no browser (and no running server) is required:

    python tests/test_login_api.py          # plain script, prints a summary
    python -m pytest tests/test_login_api.py -v   # if pytest is installed

For the browser side see ``tests/test_login_page.py`` (Playwright).
"""

import os
import sys
from datetime import datetime, timedelta, timezone

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi.testclient import TestClient  # noqa: E402

from app import auth, database as db  # noqa: E402
from app.server import app  # noqa: E402

COOKIE = auth.SESSION_COOKIE_NAME


def _client() -> TestClient:
    """Fresh client + cleared lockout state, so tests are order independent."""
    client = TestClient(app)
    for username in list(auth._failed_attempts):
        auth._failed_attempts.pop(username, None)
    return client


def _login(client, username="admin", password="password123", remember=False):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "remember": remember},
    )


# --- tests -----------------------------------------------------------------

def test_login_page_is_served_with_playwright_hooks():
    client = _client()
    for path in ("/login", "/playground/login.html"):
        response = client.get(path)
        assert response.status_code == 200, path
        body = response.text
        for test_id in ("username-input", "password-input", "login-button",
                        "status-message", "welcome-banner", "logout-button"):
            assert f'data-testid="{test_id}"' in body, f"{test_id} missing from {path}"


def test_login_rejects_empty_fields():
    client = _client()
    response = _login(client, username="", password="")
    assert response.status_code == 400
    assert response.json()["error"] == "validation_error"

    response = _login(client, username="admin", password="")
    assert response.status_code == 400
    assert response.json()["message"] == "Password is required."


def test_login_success_sets_session_cookie_and_me_returns_user():
    client = _client()
    response = _login(client)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["user"] == {"username": "admin", "display_name": "Alex Admin",
                           "role": "Administrator"}
    assert COOKIE in response.cookies
    # Plain session cookie: no Max-Age/Expires, so the browser drops it on close.
    assert response.cookies[COOKIE] != ""
    assert body["session"]["remember"] is False

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["display_name"] == "Alex Admin"


def test_remember_me_issues_persistent_cookie():
    client = _client()
    response = _login(client, remember=True)
    assert response.status_code == 200
    assert response.json()["session"]["remember"] is True
    assert response.json()["session"]["ttl_seconds"] == auth.REMEMBER_ME_TTL_SECONDS

    set_cookie = response.headers["set-cookie"]
    assert "Max-Age=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie.replace("samesite=lax", "SameSite=lax")


def test_me_without_session_is_401():
    client = _client()
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["error"] == "not_authenticated"


def test_wrong_password_reports_attempts_remaining():
    client = _client()
    response = _login(client, password="wrong-password")
    assert response.status_code == 401
    body = response.json()
    assert body["error"] == "invalid_credentials"
    assert body["attempts_remaining"] == auth.MAX_FAILED_ATTEMPTS - 1
    assert body["message"] == "Invalid username or password. Please try again."


def test_five_failures_trigger_lockout_then_reset_clears_it():
    client = _client()
    for attempt in range(1, auth.MAX_FAILED_ATTEMPTS):
        response = _login(client, password="nope")
        assert response.status_code == 401, f"attempt {attempt}"
        assert response.json()["attempts_remaining"] == auth.MAX_FAILED_ATTEMPTS - attempt

    fifth = _login(client, password="nope")
    assert fifth.status_code == 429
    assert fifth.json()["error"] == "too_many_attempts"
    assert int(fifth.headers["Retry-After"]) > 0

    # Correct credentials are refused while the account is locked...
    assert _login(client).status_code == 429

    # ...until the practice helper resets the counter.
    reset = client.delete("/api/auth/attempts/admin")
    assert reset.status_code == 200
    assert _login(client).status_code == 200


def test_locked_account_is_403_even_with_correct_password():
    client = _client()
    response = _login(client, username="locked_out_user", password="locked123")
    assert response.status_code == 403
    assert response.json()["error"] == "account_locked"


def test_logout_invalidates_the_session():
    client = _client()
    assert _login(client).status_code == 200
    token = client.cookies.get(COOKIE)
    assert db.get_session(token) is not None

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert db.get_session(token) is None  # server side session is gone, not just the cookie


def test_demo_users_endpoint_lists_practice_accounts():
    client = _client()
    users = client.get("/api/auth/users").json()
    usernames = {user["username"] for user in users}
    assert {"admin", "standard_user", "locked_out_user"} <= usernames


def test_expired_sessions_are_rejected_and_purged():
    token = "expired-token-for-test"
    db.create_session(token=token, username="admin", display_name="Alex Admin",
                      role="Administrator", ttl_seconds=-1)
    assert db.get_session(token) is None
    assert db.purge_expired_sessions() == 0  # get_session already deleted the row


def test_session_expiry_is_stored_in_the_future():
    session = db.create_session(token="ttl-check", username="admin",
                                display_name="Alex Admin", role="Administrator",
                                ttl_seconds=60, is_remembered=False)
    expires = datetime.fromisoformat(session["expires_at"])
    assert expires > datetime.now(timezone.utc) + timedelta(seconds=30)
    db.delete_session("ttl-check")


if __name__ == "__main__":
    tests = [(name, func) for name, func in sorted(globals().items())
             if name.startswith("test_") and callable(func)]
    failures = []
    print(f"Running {len(tests)} login API tests\n" + "-" * 52)
    for name, func in tests:
        try:
            func()
            print(f"  PASS  {name}")
        except Exception as exc:  # noqa: BLE001 - report every failure, keep going
            failures.append((name, exc))
            print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")
    print("-" * 52)
    print(f"{len(tests) - len(failures)}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
