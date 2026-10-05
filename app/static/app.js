let editor = null;
let currentExecutionId = null;
let executionTimerInterval = null;
let templatesCache = [];
let activeWs = null;

// Initialize Monaco Editor
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
    editor = monaco.editor.create(document.getElementById('monacoEditor'), {
        value: '# Loading Playwright template...',
        language: 'python',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "'Fira Code', Consolas, monospace",
        tabSize: 4,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        bracketPairColorization: { enabled: true },
        formatOnPaste: true
    });

    // Hotkeys inside Monaco
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        runCode();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        openSaveModal();
    });

    initApp();
});

// App Initialization
async function initApp() {
    setupEventListeners();
    await checkEnvironmentStatus();
    await loadTemplates();
    await loadSnippets();
    await loadHistory();
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Language select change
    document.getElementById('languageSelect').addEventListener('change', (e) => {
        const lang = e.target.value;
        updateEditorLanguage(lang);
        const templateId = document.getElementById('templateSelect').value || 'basic_nav';
        loadTemplateCode(templateId, lang);
    });

    // Template select change
    document.getElementById('templateSelect').addEventListener('change', (e) => {
        const templateId = e.target.value;
        const lang = document.getElementById('languageSelect').value;
        loadTemplateCode(templateId, lang);
    });

    // Headed mode toggle
    document.getElementById('headedToggle').addEventListener('change', (e) => {
        const label = document.getElementById('headedLabel');
        if (e.target.checked) {
            label.innerText = '👁️ Headed Browser';
            label.style.color = '#38bdf8';
        } else {
            label.innerText = '⚡ Headless';
            label.style.color = '';
        }
    });

    // Run & Stop buttons
    document.getElementById('runBtn').addEventListener('click', runCode);
    document.getElementById('stopBtn').addEventListener('click', stopCode);

    // Editor Actions
    document.getElementById('formatCodeBtn').addEventListener('click', () => {
        if (editor) editor.getAction('editor.action.formatDocument').run();
    });

    document.getElementById('copyCodeBtn').addEventListener('click', () => {
        if (editor) {
            navigator.clipboard.writeText(editor.getValue());
            showToast('Code copied to clipboard!');
        }
    });

    document.getElementById('resetTemplateBtn').addEventListener('click', () => {
        const templateId = document.getElementById('templateSelect').value;
        const lang = document.getElementById('languageSelect').value;
        if (confirm('Reset editor to original template code?')) {
            loadTemplateCode(templateId, lang);
        }
    });

    // Terminal Actions
    document.getElementById('clearConsoleBtn').addEventListener('click', () => {
        const terminal = document.getElementById('terminalOutput');
        terminal.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">Console cleared.</div>';
    });

    document.getElementById('copyLogsBtn').addEventListener('click', () => {
        const terminal = document.getElementById('terminalOutput');
        navigator.clipboard.writeText(terminal.innerText);
        showToast('Console logs copied!');
    });

    // Drawer Toggle
    const drawer = document.getElementById('drawer');
    document.getElementById('toggleDrawerBtn').addEventListener('click', () => {
        drawer.classList.toggle('open');
    });

    document.getElementById('closeDrawerBtn').addEventListener('click', () => {
        drawer.classList.remove('open');
    });

    // Drawer Tabs
    document.querySelectorAll('.drawer-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.drawer-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const tabId = tab.getAttribute('data-tab');
            if (tabId === 'snippets') document.getElementById('tabSnippets').classList.add('active');
            if (tabId === 'playground') document.getElementById('tabPlayground').classList.add('active');
        });
    });

    // Sub Tabs: Saved Snippets vs History
    document.getElementById('viewSnippetsBtn').addEventListener('click', () => {
        document.getElementById('viewSnippetsBtn').classList.add('active');
        document.getElementById('viewHistoryBtn').classList.remove('active');
        document.getElementById('snippetsList').style.display = 'flex';
        document.getElementById('historyList').style.display = 'none';
    });

    document.getElementById('viewHistoryBtn').addEventListener('click', () => {
        document.getElementById('viewHistoryBtn').classList.add('active');
        document.getElementById('viewSnippetsBtn').classList.remove('active');
        document.getElementById('historyList').style.display = 'flex';
        document.getElementById('snippetsList').style.display = 'none';
        loadHistory();
    });

    // Snippet Filter & Search
    document.getElementById('snippetSearchInput').addEventListener('input', () => {
        loadSnippets();
        loadHistory();
    });
    document.getElementById('snippetLangFilter').addEventListener('change', () => {
        loadSnippets();
        loadHistory();
    });

    // Save Snippet Modal
    document.getElementById('saveSnippetBtn').addEventListener('click', openSaveModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeSaveModal);
    document.getElementById('cancelSaveBtn').addEventListener('click', closeSaveModal);
    document.getElementById('confirmSaveBtn').addEventListener('click', handleSaveSnippet);
}

// Update Monaco language mode and badges
function updateEditorLanguage(lang) {
    const badge = document.getElementById('editorLanguageBadge');
    const filename = document.getElementById('editorFilename');

    let monacoLang = 'python';
    let fileExt = 'test_script.py';

    if (lang === 'typescript') {
        monacoLang = 'typescript';
        fileExt = 'test_script.ts';
        badge.innerText = 'TYPESCRIPT';
        badge.style.background = '#3178c6';
    } else if (lang === 'javascript') {
        monacoLang = 'javascript';
        fileExt = 'test_script.js';
        badge.innerText = 'JAVASCRIPT';
        badge.style.background = '#f7df1e';
        badge.style.color = '#000';
    } else {
        badge.innerText = 'PYTHON';
        badge.style.background = '#58a6ff';
        badge.style.color = '#fff';
    }

    filename.innerText = fileExt;
    if (editor) {
        monaco.editor.setModelLanguage(editor.getModel(), monacoLang);
    }
}

// Load Challenge Templates
async function loadTemplates() {
    try {
        const res = await fetch('/api/templates');
        templatesCache = await res.json();
        const select = document.getElementById('templateSelect');
        select.innerHTML = '';

        templatesCache.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.innerText = t.title;
            select.appendChild(opt);
        });

        // Load default template (Blank Scratchpad)
        const currentLang = document.getElementById('languageSelect').value;
        const defaultTemplateId = templatesCache[0]?.id || 'blank';
        select.value = defaultTemplateId;
        loadTemplateCode(defaultTemplateId, currentLang);
    } catch (err) {
        console.error('Failed to load templates:', err);
    }
}

async function loadTemplateCode(templateId, language) {
    try {
        const res = await fetch(`/api/templates/${templateId}?lang=${language}`);
        const data = await res.json();
        if (editor) {
            // An empty template deliberately clears the editor.
            editor.setValue(data.code || '');
        }
    } catch (err) {
        console.error('Failed to fetch template code:', err);
    }
}

// --- Code Execution & Real-Time Output ---
function runCode() {
    if (!editor) return;
    const code = editor.getValue().trim();
    if (!code) {
        alert('Please enter some code to execute.');
        return;
    }

    const language = document.getElementById('languageSelect').value;
    const headed = document.getElementById('headedToggle').checked;

    const runBtn = document.getElementById('runBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusBadge = document.getElementById('executionStatusBadge');
    const timerBadge = document.getElementById('timerBadge');
    const terminal = document.getElementById('terminalOutput');

    // UI state updates
    runBtn.style.display = 'none';
    stopBtn.style.display = 'inline-flex';
    statusBadge.className = 'status-pill running';
    statusBadge.innerText = 'RUNNING';
    terminal.innerHTML = '';

    const startTime = Date.now();
    timerBadge.innerText = '0.0s';
    clearInterval(executionTimerInterval);
    executionTimerInterval = setInterval(() => {
        timerBadge.innerText = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    }, 100);

    // Open WebSocket connection for streaming
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/run`;
    activeWs = new WebSocket(wsUrl);

    activeWs.onopen = () => {
        activeWs.send(JSON.stringify({
            language: language,
            code: code,
            headed: headed
        }));
    };

    activeWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.execution_id) {
            currentExecutionId = msg.execution_id;
        }

        if (msg.type === 'log' || msg.type === 'error') {
            const line = document.createElement('div');
            line.className = msg.type === 'error' ? 'terminal-error-line' : 'terminal-log-line';
            line.textContent = msg.text;
            terminal.appendChild(line);
            terminal.scrollTop = terminal.scrollHeight;
        } else if (msg.type === 'done') {
            handleExecutionDone(msg.status, msg.duration_ms);
        }
    };

    activeWs.onerror = (err) => {
        console.error('WebSocket error:', err);
        appendTerminalLine('❌ Connection to runner error', true);
        handleExecutionDone('failed', 0);
    };

    activeWs.onclose = () => {
        activeWs = null;
    };
}

function handleExecutionDone(status, durationMs) {
    clearInterval(executionTimerInterval);
    document.getElementById('runBtn').style.display = 'inline-flex';
    document.getElementById('stopBtn').style.display = 'none';

    const statusBadge = document.getElementById('executionStatusBadge');
    statusBadge.className = `status-pill ${status}`;
    statusBadge.innerText = status.toUpperCase();

    const timerBadge = document.getElementById('timerBadge');
    if (durationMs) timerBadge.innerText = (durationMs / 1000).toFixed(1) + 's';

    currentExecutionId = null;
    loadHistory(); // refresh history list
}

async function stopCode() {
    if (!currentExecutionId) {
        if (activeWs) activeWs.close();
        handleExecutionDone('stopped', 0);
        return;
    }

    try {
        await fetch('/api/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ execution_id: currentExecutionId })
        });
        appendTerminalLine('🛑 Stopping execution...', true);
    } catch (e) {
        console.error(e);
    }
}

function appendTerminalLine(text, isError = false) {
    const terminal = document.getElementById('terminalOutput');
    const line = document.createElement('div');
    line.className = isError ? 'terminal-error-line' : 'terminal-log-line';
    line.textContent = text;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

// --- Snippet Management ---
function openSaveModal() {
    document.getElementById('saveModal').style.display = 'flex';
    document.getElementById('snippetTitle').value = '';
    document.getElementById('snippetTags').value = '';
    document.getElementById('snippetTitle').focus();
}

function closeSaveModal() {
    document.getElementById('saveModal').style.display = 'none';
}

async function handleSaveSnippet() {
    const title = document.getElementById('snippetTitle').value.trim();
    const tags = document.getElementById('snippetTags').value.trim();
    const language = document.getElementById('languageSelect').value;
    const code = editor ? editor.getValue() : '';

    if (!title) {
        alert('Please provide a snippet title.');
        return;
    }

    try {
        const res = await fetch('/api/snippets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, tags, language, code })
        });
        if (res.ok) {
            closeSaveModal();
            showToast('Snippet saved successfully! ⭐');
            loadSnippets();
        }
    } catch (err) {
        alert('Failed to save snippet.');
    }
}

async function loadSnippets() {
    const search = document.getElementById('snippetSearchInput').value.trim();
    const lang = document.getElementById('snippetLangFilter').value;

    try {
        const url = `/api/snippets?language=${lang}&search=${encodeURIComponent(search)}`;
        const res = await fetch(url);
        const snippets = await res.json();
        renderSnippets(snippets);
    } catch (e) {
        console.error(e);
    }
}

function renderSnippets(snippets) {
    const container = document.getElementById('snippetsList');
    container.innerHTML = '';

    if (!snippets || snippets.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">No saved snippets found. Click "Save Snippet" to save your code!</div>';
        return;
    }

    snippets.forEach(s => {
        const card = document.createElement('div');
        card.className = 'item-card';

        const tagsHtml = s.tags ? s.tags.split(',').map(t => `<span class="item-tag">${t.trim()}</span>`).join(' ') : '';

        card.innerHTML = `
            <div class="item-card-header">
                <div class="item-card-title">${s.is_favorite ? '⭐ ' : ''}${escapeHtml(s.title)}</div>
                <div class="item-card-actions">
                    <button class="action-btn fav-btn" title="Favorite">${s.is_favorite ? '★' : '☆'}</button>
                    <button class="action-btn del-btn" title="Delete">🗑️</button>
                </div>
            </div>
            <div>${tagsHtml}</div>
            <div class="item-meta">
                <span>${s.language.toUpperCase()}</span>
                <span>${new Date(s.updated_at).toLocaleDateString()}</span>
            </div>
        `;

        // Click to load
        card.addEventListener('click', (e) => {
            if (e.target.closest('.fav-btn') || e.target.closest('.del-btn')) return;
            document.getElementById('languageSelect').value = s.language.toLowerCase();
            updateEditorLanguage(s.language.toLowerCase());
            editor.setValue(s.code);
            showToast(`Loaded "${s.title}" into editor!`);
        });

        // Favorite action
        card.querySelector('.fav-btn').addEventListener('click', async () => {
            await fetch(`/api/snippets/${s.id}/favorite`, { method: 'PUT' });
            loadSnippets();
        });

        // Delete action
        card.querySelector('.del-btn').addEventListener('click', async () => {
            if (confirm(`Delete snippet "${s.title}"?`)) {
                await fetch(`/api/snippets/${s.id}`, { method: 'DELETE' });
                loadSnippets();
            }
        });

        container.appendChild(card);
    });
}

// --- History List ---
async function loadHistory() {
    const search = document.getElementById('snippetSearchInput').value.trim();
    const lang = document.getElementById('snippetLangFilter').value;

    try {
        const url = `/api/history?language=${lang}&search=${encodeURIComponent(search)}`;
        const res = await fetch(url);
        const runs = await res.json();
        renderHistory(runs);
    } catch (e) {
        console.error(e);
    }
}

function renderHistory(runs) {
    const container = document.getElementById('historyList');
    container.innerHTML = '';

    if (!runs || runs.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px;">No execution history yet.</div>';
        return;
    }

    runs.forEach(r => {
        const card = document.createElement('div');
        card.className = 'item-card';

        const statusIcon = r.status === 'success' ? '✅' : '❌';
        card.innerHTML = `
            <div class="item-card-header">
                <div class="item-card-title">${statusIcon} ${r.language.toUpperCase()} Run</div>
                <span class="status-pill ${r.status}">${r.status}</span>
            </div>
            <div class="item-meta">
                <span>⏱️ ${(r.duration_ms / 1000).toFixed(1)}s</span>
                <span>${new Date(r.created_at).toLocaleTimeString()}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            document.getElementById('languageSelect').value = r.language.toLowerCase();
            updateEditorLanguage(r.language.toLowerCase());
            editor.setValue(r.code);
            showToast(`Restored run from ${new Date(r.created_at).toLocaleTimeString()} into editor!`);
        });

        container.appendChild(card);
    });
}

// Check environment status
async function checkEnvironmentStatus() {
    try {
        const res = await fetch('/api/status');
        const status = await res.json();

        const py = document.getElementById('pythonStatus');
        const node = document.getElementById('nodeStatus');
        const browser = document.getElementById('browserStatus');

        if (status.python_playwright) {
            py.innerHTML = '<span class="status-dot green"></span> Python Playwright OK';
        }
        if (status.node && status.tsx) {
            node.innerHTML = '<span class="status-dot green"></span> Node.js & TSX OK';
        }
        if (status.chromium) {
            browser.innerHTML = '<span class="status-dot green"></span> Chromium Installed';
        }
    } catch (e) {
        console.error('Status check error:', e);
    }
}

// Helpers
function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 40px; right: 20px; background: #238636; color: #fff;
        padding: 10px 18px; border-radius: 6px; font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 9999; animation: fadeIn 0.2s;
    `;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 2500);
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}
