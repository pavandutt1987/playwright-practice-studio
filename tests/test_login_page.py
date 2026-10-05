"""
Browser tests for the Login Authentication target - the Playwright half of the
story. They drive the real page (``/login``) against the real FastAPI auth API,
so they exercise the DOM, the cookie, and the redirect-free view switching.

Run it (the studio server must be running):

    python -m playwright install chromium     # once
    python tests/test_login_page.py           # headless
    HEADED=1 python tests/test_login_page.py  # watch the browser

Set ``BASE_URL`` to point at a different host, e.g.
``BASE_URL=http://localhost:8000 python tests/test_login_page.py``.
"""

import os
import sys
import traceback

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from playwright.sync_api import sync_playwright, expect  # noqa: E402

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
HEADED = os.environ.get("HEADED") == "1"
LOGIN_URL = f"{BASE_URL}/login"

CREDENTIALS = {"username": "admin", "password": "password123"}


def sign_in(page, username=CREDENTIALS["username"], password=CREDENTIALS["password"],
            remember=False):
    page.get_by_label("Username").fill(username)
    page.get_by_label("Password").fill(password)
    if remember:
        page.get_by_test_id("remember-checkbox").check()
    page.get_by_role("button", name="Sign In").click()


# --- tests -----------------------------------------------------------------

def test_successful_login_shows_welcome_banner(page):
    page.goto(LOGIN_URL)
    sign_in(page)

    expect(page.get_by_test_id("welcome-banner")).to_be_visible()
    expect(page.get_by_test_id("welcome-banner")).to_contain_text("Alex Admin")
    expect(page.get_by_test_id("session-username")).to_have_text("admin")
    expect(page.get_by_test_id("session-role")).to_have_text("Administrator")
    expect(page).to_have_url(LOGIN_URL)


def test_invalid_credentials_show_error_and_attempt_counter(page):
    page.goto(LOGIN_URL)
    sign_in(page, password="wrong-password")

    status = page.get_by_test_id("status-message")
    expect(status).to_be_visible()
    expect(status).to_contain_text("Invalid username or password")
    expect(status).to_have_attribute("data-state", "invalid-credentials")
    expect(page.get_by_test_id("attempts-counter")).to_contain_text("4 of 5 attempts remaining")
    expect(page.get_by_label("Password")).to_have_value("wrong-password")


def test_empty_fields_are_validated_client_side(page):
    page.goto(LOGIN_URL)
    page.get_by_role("button", name="Sign In").click()

    expect(page.get_by_test_id("username-error")).to_have_text("Username is required.")
    expect(page.get_by_test_id("password-error")).to_have_text("Password is required.")
    expect(page.get_by_label("Username")).to_have_attribute("aria-invalid", "true")
    # No request was made, so the form is still on screen.
    expect(page.get_by_test_id("login-view")).to_be_visible()


def test_session_survives_a_page_reload(page):
    page.goto(LOGIN_URL)
    sign_in(page, remember=True)
    expect(page.get_by_test_id("welcome-banner")).to_be_visible()

    page.reload()
    expect(page.get_by_test_id("welcome-banner")).to_be_visible()
    expect(page.get_by_test_id("session-username")).to_have_text("admin")

    cookie = next(c for c in page.context.cookies() if c["name"] == "pps_session")
    assert cookie["httpOnly"] is True, "session cookie must be HttpOnly"
    assert cookie["expires"] != -1, "Remember me should issue a persistent cookie"


def test_plain_session_uses_a_session_cookie(page):
    page.goto(LOGIN_URL)
    sign_in(page, remember=False)
    expect(page.get_by_test_id("welcome-banner")).to_be_visible()

    cookie = next(c for c in page.context.cookies() if c["name"] == "pps_session")
    assert cookie["expires"] == -1, "without Remember me the cookie must be a session cookie"


def test_logout_returns_to_the_login_form(page):
    page.goto(LOGIN_URL)
    sign_in(page)
    expect(page.get_by_test_id("welcome-banner")).to_be_visible()

    page.get_by_test_id("logout-button").click()
    expect(page.get_by_test_id("login-view")).to_be_visible()
    expect(page.get_by_test_id("status-message")).to_contain_text("signed out")

    page.reload()
    expect(page.get_by_test_id("login-view")).to_be_visible()


def test_locked_account_reports_lockout(page):
    page.goto(LOGIN_URL)
    sign_in(page, username="locked_out_user", password="locked123")

    status = page.get_by_test_id("status-message")
    expect(status).to_have_attribute("data-state", "account-locked")
    expect(status).to_contain_text("locked out")


def test_password_visibility_toggle(page):
    page.goto(LOGIN_URL)
    password = page.get_by_label("Password")
    expect(password).to_have_attribute("type", "password")

    page.get_by_test_id("toggle-password").click()
    expect(password).to_have_attribute("type", "text")

    page.get_by_test_id("toggle-password").click()
    expect(password).to_have_attribute("type", "password")


def test_loading_state_disables_the_button(page):
    page.goto(LOGIN_URL)
    sign_in(page)
    # Asserted right after the click, before the response lands.
    button = page.get_by_test_id("login-button")
    expect(page.get_by_test_id("welcome-banner")).to_be_visible()
    expect(button).to_be_enabled()  # re-enabled once the request completed


# --- runner ----------------------------------------------------------------

def main() -> int:
    tests = [(name, func) for name, func in sorted(globals().items())
             if name.startswith("test_") and callable(func)]
    failures = []

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(headless=not HEADED)
        except Exception as exc:  # noqa: BLE001
            print(f"Could not launch Chromium: {exc}\n")
            print("Install the browser first:  python -m playwright install chromium")
            return 2

        print(f"Running {len(tests)} login page tests against {BASE_URL}\n" + "-" * 60)
        for name, func in tests:
            context = browser.new_context()
            page = context.new_page()
            try:
                func(page)
                print(f"  PASS  {name}")
            except Exception as exc:  # noqa: BLE001
                failures.append(name)
                print(f"  FAIL  {name}: {type(exc).__name__}: {str(exc).splitlines()[0]}")
                traceback.print_exc(limit=2)
            finally:
                context.close()
        browser.close()

    print("-" * 60)
    print(f"{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
