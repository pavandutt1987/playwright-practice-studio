# 🎭 Playwright Practice Studio - Complete Execution & User Guide

This guide walks you through setting up, launching, and using the **Playwright Practice Studio** on your local Windows machine.

---

## 📋 Prerequisites

Before running the application, make sure you have:
1. **Python 3.8+** (Verified with Python 3.14 on your system)
2. **Node.js 18+** (Verified with Node v24 on your system)

---

## ⚡ Quick Start Guide (3 Simple Steps)

### Step 1: Initial Setup (One-time only)
Double-click `setup.bat` or run the following commands in your PowerShell/Terminal:

```powershell
# 1. Install Python packages (FastAPI, Uvicorn, Playwright)
python -m pip install -r requirements.txt

# 2. Install Node.js & TypeScript dependencies
npm install

# 3. Download the Playwright Chromium browser binary
python -m playwright install chromium
```

---

### Step 2: Start the Web Studio
Double-click `start.bat` or run:

```powershell
python -m uvicorn app.server:app --host 127.0.0.1 --port 8000
```

- Your default web browser will automatically open to **`http://localhost:8000`**.
- The studio will connect to the backend server and display green health badges for Python, Node, and Chromium.

---

### Step 3: Write & Execute Playwright Tests

1. **Select Language**: Choose **Python 🐍**, **TypeScript 🔷**, or **JavaScript 🟨** from the top dropdown.
2. **Select Template**: Pick any template from the dropdown:
   - **`0. Blank / Empty Scratchpad`** (Clean slate to write custom scripts from scratch)
   - **`1. Synchronous Python (sync_playwright)`** (Standard Python sync syntax)
   - **`2. Basic Navigation & Smart Locators`** (Async syntax)
   - **`3. Dynamic Tables & AJAX`**
   - **`4. Frames & Shadow DOM`**
   - **`5. Alerts & Multiple Tabs`**
   - **`6. Network & API Mocking`**
   - **`7. Page Object Model (POM)`**
3. **Choose Execution Mode**:
   - ⚡ **Headless Mode** (Default): Fast, runs silently in the background.
   - 👁️ **Headed Mode**: Toggle the switch to **Headed** to watch the real Chromium browser window pop up on your desktop and execute your actions in real time!
4. **Run**: Click the **▶️ Run** button or press **`Ctrl + Enter`**.
5. **View Live Console**: Watch real-time logs, execution duration, and success/failure badges on the right pane.
6. **Stop**: If a test gets stuck in a loop, click the **`⏹️ Stop`** button to immediately kill the process.

---

## 🎯 Built-in Offline Playground Targets

You can test your locators against the built-in offline test sandbox pages by opening the left drawer (**☰ History & Targets**) or directly visiting:

| Challenge Target | URL | Key Concepts Tested |
|---|---|---|
| 🔑 **Login Authentication** | `http://localhost:8000/playground/login.html` (or `/login`) | Real sign-in API: role locators (`getByRole`, `getByLabel`), HttpOnly session cookie, `remember me` persistent cookies, locked account (`403`), rate limit (`429`), sign-out, session restore after reload |
| 📊 **Dynamic Tables & AJAX** | `http://localhost:8000/playground/dynamic-tables.html` | Live search filter, count rows, trigger AJAX load & `waitForResponse()` |
| 👥 **Frames & Shadow DOM** | `http://localhost:8000/playground/iframes-shadowdom.html` | `frameLocator()`, open Shadow Root Web Component piercing |
| 🚨 **Alerts & Multiple Tabs** | `http://localhost:8000/playground/alerts-popups.html` | `page.on('dialog')`, `dialog.accept()`, `context.waitForEvent('page')` |
| 📁 **File Upload Automation** | `http://localhost:8000/playground/file-upload.html` | `setInputFiles()`, drag & drop upload simulation |
| 🌐 **Network & API Mocking** | `http://localhost:8000/playground/network-mocking.html` | `page.route()`, intercepting endpoints and returning mock JSON payloads |

---

## 🔐 Login Authentication Target (Deep Dive)

The login page is a **real sign-in screen**, not a JavaScript mock. `app/auth.py` validates
credentials on the server, creates a session in SQLite, and returns an `HttpOnly` cookie
(`pps_session`). The page adds client-side validation, a loading state, inline field errors,
a password visibility toggle, a lockout countdown, and a signed-in dashboard view.

### Practice accounts

| Username | Password | Result |
|---|---|---|
| `admin` | `password123` | Signs in as *Alex Admin* (Administrator) |
| `standard_user` | `secret_sauce` | Signs in as *Sam Standard* (read-only role) |
| `locked_out_user` | `locked123` | `403` – account is locked out |
| any other value | any | `401` – invalid credentials |

Five failed attempts within a minute trigger a temporary lockout: the API answers `429`
with a `Retry-After` header and the UI disables the button while it counts down.

### Auth API

| Endpoint | What it does |
|---|---|
| `POST /api/auth/login` | `{ username, password, remember }` → `200` + cookie, or `400`/`401`/`403`/`429` |
| `GET /api/auth/me` | Returns the signed-in user (`401` when there is no/expired session) |
| `POST /api/auth/logout` | Invalidates the session server-side and clears the cookie |
| `GET /api/auth/users` | Lists the practice accounts above |
| `DELETE /api/auth/attempts/{username}` | Clears the failed-attempt counter (reset your lockout) |

### Assertion ideas

```python
# Python - session survives a reload because it lives in a cookie
page.goto("http://localhost:8000/login")
page.get_by_label("Username").fill("admin")
page.get_by_label("Password").fill("password123")
page.get_by_test_id("remember-checkbox").check()
page.get_by_role("button", name="Sign In").click()
expect(page.get_by_test_id("welcome-banner")).to_be_visible()

page.reload()
expect(page.get_by_test_id("session-username")).to_have_text("admin")

# negative paths
sign_in(page, "admin", "wrong")          # -> data-state="invalid-credentials"
sign_in(page, "locked_out_user", "locked123")  # -> data-state="account-locked"
```

```typescript
// TypeScript - screenshot/trace friendly negative assertion
await page.goto('/login');
await page.getByLabel('Username').fill('admin');
await page.getByLabel('Password').fill('nope');
await page.getByTestId('login-button').click();
await expect(page.getByTestId('status-message')).toHaveAttribute('data-state', 'invalid-credentials');
```

### Running the login test suites

```bash
python tests/test_login_api.py          # 12 API tests, no browser required
python tests/test_login_page.py         # Playwright (Python) browser suite
npx playwright test                     # Playwright (TypeScript) suite in tests/e2e
```

---

## 🗂️ History & Saved Snippet Management

Click the **☰ History & Targets** button in the top left:
- **⭐ Saved Snippets**: Save customized code solutions with custom tags (e.g. `interview-q1`, `storageState`, `POM`). Click any saved card to instantly restore it into the editor.
- **🕒 Execution History**: Automatically logs every run with status (`SUCCESS` / `FAILED`), execution time, and code snapshots.
- **Search & Filter**: Filter history and snippets by language (`Python`, `TypeScript`, `JavaScript`) or keyword search.

---

## ⌨️ Keyboard Shortcuts

- **`Ctrl + Enter`**: Run active code in current language.
- **`Ctrl + S`**: Open the "Save Practice Snippet" modal.
- **`✨ Format`**: Format code inside Monaco editor.

---

## 📂 Project Structure

```
playwright-practice-studio/
│
├── app/
│   ├── server.py              # FastAPI server (WebSocket streaming, REST APIs)
│   ├── auth.py                # Login target: credential checks, sessions, lockout
│   ├── runner.py              # Multi-language process executor (Python, TSX, Node)
│   ├── database.py            # SQLite database manager for history, snippets & sessions
│   ├── templates.py           # Multi-language Playwright templates & solutions
│   └── static/
│       ├── index.html         # Web IDE (Monaco Editor, Output, Drawer)
│       ├── style.css          # VS Code dark theme styling
│       ├── app.js             # Monaco initialization, WebSockets, history
│       └── playground/        # Built-in offline practice sandbox pages
│           ├── login.html     # Login Authentication target (real API backed)
│           ├── dynamic-tables.html
│           ├── iframes-shadowdom.html
│           ├── frame-content.html
│           ├── alerts-popups.html
│           ├── file-upload.html
│           └── network-mocking.html
│
├── tests/
│   ├── test_login_api.py      # Login API tests (runs without a browser)
│   ├── test_login_page.py     # Playwright (Python) browser tests
│   └── e2e/login.spec.ts      # Playwright (TypeScript) browser tests
├── playwright.config.ts       # Playwright Test config (auto-starts the studio)
├── requirements.txt           # Python dependencies (FastAPI, Uvicorn, Playwright)
├── package.json               # Node.js & TypeScript dependencies (@playwright/test, tsx)
├── setup.bat                  # 1-Click setup batch file
├── start.bat                  # 1-Click launch batch file
├── README.md                  # Overview documentation
└── EXECUTION_STEPS.md         # Detailed execution guide
```
