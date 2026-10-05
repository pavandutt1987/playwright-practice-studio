# 🎭 Playwright Practice Studio (Multi-Language IDE)

A complete local browser-based practice & automation platform for **Python**, **TypeScript**, and **JavaScript** Playwright test engineers.

---

## 🌐 Deploying it on the web

The Studio executes the code you type, so it needs two things a static host can't give it:
a long-lived process and a WebSocket. A `Dockerfile`, `docker-compose.yml` and
`start_web.sh` are included and work on Render, Railway, Fly.io, Google Cloud Run,
Hugging Face Spaces or any VPS.

```bash
docker compose up --build      # then open http://localhost:8000/login
```

**Read [DEPLOYMENT.md](DEPLOYMENT.md) first** — it explains the security implications of
publishing a code runner, how to gate it, and the per-host steps.

---

## 🚀 Quick Start (Windows)

### Step 1: 1-Click Setup (First time only)
Double-click `setup.bat` or run:
```powershell
pip install -r requirements.txt
npm install
python -m playwright install chromium
```

### Step 2: 1-Click Launch
Double-click `start.bat` or run:
```powershell
python -m uvicorn app.server:app --host 127.0.0.1 --port 8000
```
This automatically launches the studio at **http://localhost:8000**.

---

## 🌟 Key Features

1. **Multi-Language Runner**:
   - 🐍 **Python**: Powered by `async_playwright` and native async event loop.
   - 🔷 **TypeScript**: Powered by `tsx` on the fly (zero manual compilation required).
   - 🟨 **JavaScript**: Powered by native Node.js.

2. **Full VS Code Dark Monaco Editor**:
   - Syntax highlighting, auto-completion, bracket matching, code formatting.
   - Hotkey `Ctrl + Enter` to run scripts instantly.
   - Hotkey `Ctrl + S` to save snippets into your personal knowledge base.

3. **👁️ Headed vs. ⚡ Headless Toggle**:
   - Run in **Headed** mode to watch the browser launch on your desktop in real-time.
   - Run in **Headless** mode for lightning-fast headless verification.

4. **Real-Time Terminal Output & Process Management**:
   - Live stdout / stderr streaming with milliseconds counter.
   - **Stop Button**: Terminate hung loops or long waits cleanly at any moment.

5. **🗂️ History & Saved Snippets Library**:
   - Automatic execution history tracking with status badges (`SUCCESS` / `FAILED`).
   - Save custom snippets with tags, search by title/keyword, star favorites, and 1-click restore.

6. **🎯 Built-in Offline Playground Targets (`/playground`)**:
   - `1. Login Authentication` (`/playground/login.html`, short alias `/login`) – Server-validated credentials, session cookies, "remember me", lockout & rate-limit states, sign-out. See [Login target](#-login-authentication-target).
   - `2. Dynamic Tables & AJAX` (`/playground/dynamic-tables.html`) – Table filtering, dynamic row count, awaiting asynchronous network responses.
   - `3. Frames & Shadow DOM` (`/playground/iframes-shadowdom.html`) – Frame locators and open Shadow DOM piercing.
   - `4. Alerts & Popups` (`/playground/alerts-popups.html`) – JS dialogs (`dialog.accept()`) and multi-tab context capturing.
   - `5. File Upload Automation` (`/playground/file-upload.html`) – Input files and drag & drop file upload.
   - `6. Network & API Mocking` (`/playground/network-mocking.html`) – Intercepting and mocking routes with `page.route()`.

---

## 🔐 Login Authentication Target

The login target is a **real form backed by a real API** (no hard-coded `if` in the
browser). It is reachable at two URLs:

| URL | Purpose |
|---|---|
| `/login` | Short alias for automation practice |
| `/playground/login.html` | Same page, linked from the Studio drawer |

### What is implemented

- **Server-side credential validation** (`app/auth.py`) – the password is never checked in the browser.
- **Cookie sessions** – a successful sign-in returns an `HttpOnly; SameSite=lax` cookie named `pps_session` and stores the session in SQLite (`app/database.py`).
- **Remember me** – checked issues a *persistent* 7-day cookie (`Max-Age`), unchecked issues a *session* cookie (`expires = -1` in Playwright).
- **Session restore** – reloading the page calls `GET /api/auth/me`, so tests can assert that a session survives `page.reload()` and dies after `context.clear_cookies()`.
- **Sign out** – invalidates the session server-side *and* clears the cookie.
- **Failure states that are worth asserting on** – inline empty-field validation, wrong credentials, locked account, and a temporary lockout after 5 failed attempts per minute.

### Practice accounts

| Username | Password | Result |
|---|---|---|
| `admin` | `password123` | Signs in as *Alex Admin* (Administrator) |
| `standard_user` | `secret_sauce` | Signs in as *Sam Standard* (read-only role) |
| `locked_out_user` | `locked123` | HTTP `403` – account locked |
| any other value | any | HTTP `401` – invalid credentials |

### API reference

| Method & path | Success | Failure modes |
|---|---|---|
| `POST /api/auth/login` | `200` + session cookie + user/session payload | `400` validation, `401` invalid credentials, `403` locked, `429` too many attempts (+`Retry-After`) |
| `GET /api/auth/me` | `200` with the signed-in user | `401` no/expired session |
| `POST /api/auth/logout` | `200` and the cookie is cleared | – |
| `GET /api/auth/users` | `200` list of practice accounts | – |
| `DELETE /api/auth/attempts/{username}` | `200` clears the lockout counter (handy between test runs) | – |

### Playwright hooks

`data-testid`: `username-input`, `password-input`, `remember-checkbox`, `toggle-password`,
`login-button`, `status-message` (`data-state` = `validation` / `invalid-credentials` /
`account-locked` / `network-error` / `signed-out`), `username-error`, `password-error`,
`attempts-counter`, `welcome-banner`, `session-username`, `session-role`, `session-expires`,
`logout-button`.

### Running the tests

```bash
# 1. Server-side API tests (no browser needed, works in-process)
python tests/test_login_api.py
python -m pytest tests/test_login_api.py -v

# 2. Python Playwright browser tests (studio must be running)
python tests/test_login_page.py
HEADED=1 python tests/test_login_page.py

# 3. TypeScript Playwright tests (boots the server automatically)
npx playwright test
npx playwright test --headed
```

---

## ⌨️ Shortcuts & Cheatsheet

| Shortcut | Action |
|---|---|
| `Ctrl + Enter` | Run code in current language |
| `Ctrl + S` | Open "Save Snippet" modal |
| `✨ Format` | Auto-format code in Monaco editor |
| `☰ Drawer` | Slide open/close History and Target Sandbox |
