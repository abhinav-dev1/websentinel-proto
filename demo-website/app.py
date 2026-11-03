"""
Student Portal — demo website for WebSentinel.
FastAPI app: Student Portal frontend, marks, login, admin, CSV download.
Fake data only. No real secrets or student data.
"""
import io
import os
import urllib.parse

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from websentinel_middleware import WebSentinelMiddleware

app = FastAPI(title="Student Portal")
app.add_middleware(WebSentinelMiddleware)

# ── Fake student data ────────────────────────────────────────────────────────
STUDENTS = [
    {"id": "S001", "name": "Alice Smith",    "grade": "A", "gpa": 3.9, "status": "Enrolled", "major": "Computer Science"},
    {"id": "S002", "name": "Bob Johnson",    "grade": "B", "gpa": 3.1, "status": "Enrolled", "major": "Information Security"},
    {"id": "S003", "name": "Carol Williams", "grade": "A", "gpa": 3.7, "status": "Enrolled", "major": "Network Engineering"},
]

# ── Shared Theme CSS ─────────────────────────────────────────────────────────
CSS = """
:root {
  --bg: #0b0f19;
  --card-bg: #111827;
  --card-border: #1f2937;
  --text: #f3f4f6;
  --text-muted: #9ca3af;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --danger: #ef4444;
  --danger-bg: rgba(239, 68, 68, 0.12);
  --success: #10b981;
  --success-bg: rgba(16, 185, 129, 0.12);
  --warning: #f59e0b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: var(--bg);
  color: var(--text);
  line-height: 1.5;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
header {
  background: #0f172a;
  border-bottom: 1px solid var(--card-border);
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
  font-weight: 700;
  color: #fff;
  text-decoration: none;
}
.badge-live {
  background: #064e3b;
  color: #34d399;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid #059669;
}
nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
nav a {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.9rem;
  padding: 6px 12px;
  border-radius: 6px;
  transition: all 0.15s ease;
}
nav a:hover, nav a.active {
  background: var(--card-border);
  color: #fff;
}
main {
  flex: 1;
  max-width: 900px;
  width: 100%;
  margin: 32px auto;
  padding: 0 16px;
}
.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  margin-bottom: 24px;
}
.card h1 { font-size: 1.6rem; margin-bottom: 8px; font-weight: 700; }
.card p { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 20px; }
.banner {
  padding: 14px 18px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 0.92rem;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.banner-error { background: var(--danger-bg); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; }
.banner-success { background: var(--success-bg); border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7; }
.banner-info { background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #93c5fd; }
.form-group { margin-bottom: 18px; }
label { display: block; font-size: 0.85rem; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
input[type="text"], input[type="password"] {
  width: 100%;
  padding: 10px 14px;
  background: #0b0f19;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  color: #fff;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.15s;
}
input[type="text"]:focus, input[type="password"]:focus {
  border-color: var(--primary);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
  text-decoration: none;
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { background: #dc2626; }
.btn-outline {
  background: transparent;
  border: 1px solid var(--card-border);
  color: var(--text-muted);
}
.btn-outline:hover { background: var(--card-border); color: #fff; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-top: 20px;
}
.feature-card {
  background: #0d1322;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.feature-card h3 { font-size: 1.1rem; margin-bottom: 6px; }
.feature-card p { font-size: 0.88rem; color: var(--text-muted); margin-bottom: 16px; }
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
}
th, td {
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--card-border);
  font-size: 0.92rem;
}
th {
  color: var(--text-muted);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.badge-grade {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.82rem;
}
.badge-grade-a { background: #064e3b; color: #34d399; }
.badge-grade-b { background: #1e3a8a; color: #60a5fa; }
.console-box {
  background: #050811;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85rem;
  color: #38bdf8;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin-top: 14px;
  display: none;
}
footer {
  text-align: center;
  padding: 20px;
  font-size: 0.8rem;
  color: var(--text-muted);
  border-top: 1px solid var(--card-border);
  margin-top: auto;
}
"""

def layout(title: str, content: str, active_tab: str = "") -> str:
    tabs = [
        ("/", "🏠 Home"),
        ("/marks", "📋 Marks"),
        ("/login", "🔐 Login"),
        ("/admin", "🛡️ Admin"),
        ("/download/report.csv?mb=55", "💾 55MB Report"),
    ]
    nav_links = "".join(
        f'<a href="{path}" class="{"active" if active_tab == path else ""}">{label}</a>'
        for path, label in tabs
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} — Student Portal</title>
  <style>{CSS}</style>
</head>
<body>
  <header>
    <a href="/" class="brand">
      <span>🎓 Apex Portal</span>
      <span class="badge-live">WebSentinel Protected</span>
    </a>
    <nav>{nav_links}</nav>
  </header>
  <main>
    {content}
  </main>
  <footer>
    Demo Student Portal &bull; Protected by WebSentinel Network Threat Visualizer &bull; Fake Demo Data Only
  </footer>
</body>
</html>"""


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def home():
    content = """
    <div class="card">
      <h1>🎓 Student & Faculty Portal</h1>
      <p>Official demo academic portal connected live to the WebSentinel Network Threat Visualizer.</p>
      
      <div class="banner banner-info">
        <span>ℹ️</span>
        <div>
          <strong>IDS Integration Active:</strong> All HTTP traffic on this portal is securely monitored by WebSentinel Middleware.
          Normal browsing streams green telemetry. Failed logins and path scanning trigger real-time threat alerts on the 3D dashboard.
        </div>
      </div>

      <div class="grid">
        <div class="feature-card">
          <div>
            <h3>📋 Student Marks</h3>
            <p>Access the public academic performance and GPA register for enrolled students.</p>
          </div>
          <a href="/marks" class="btn btn-outline">View Marks &rarr;</a>
        </div>

        <div class="feature-card">
          <div>
            <h3>🔐 Account Login</h3>
            <p>Sign in with administrative credentials or test authentication protection against brute-force attacks.</p>
          </div>
          <a href="/login" class="btn btn-primary">Go to Login &rarr;</a>
        </div>

        <div class="feature-card">
          <div>
            <h3>🛡️ Admin Console</h3>
            <p>Restricted faculty dean console. Unauthorized visits return HTTP 403 and report path probing.</p>
          </div>
          <a href="/admin" class="btn btn-outline">Access Admin &rarr;</a>
        </div>

        <div class="feature-card">
          <div>
            <h3>💾 Academic Report</h3>
            <p>Simulate large academic transcript archive download (55 MB data transfer event).</p>
          </div>
          <a href="/download/report.csv?mb=55" class="btn btn-outline">Download CSV (55 MB) &rarr;</a>
        </div>
      </div>
    </div>
    """
    return HTMLResponse(layout("Dashboard", content, "/"))


@app.get("/marks", response_class=HTMLResponse)
async def marks():
    rows = "".join(
        f"""<tr>
          <td><strong>{s['id']}</strong></td>
          <td>{s['name']}</td>
          <td>{s['major']}</td>
          <td><span class="badge-grade {'badge-grade-a' if s['grade'] == 'A' else 'badge-grade-b'}">{s['grade']}</span></td>
          <td><strong>{s['gpa']}</strong></td>
          <td style="color:#34d399">{s['status']}</td>
        </tr>"""
        for s in STUDENTS
    )
    content = f"""
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:12px;">
        <div>
          <h1>📋 Student Marks & Records</h1>
          <p>Spring Semester 2026 Academic Performance Directory</p>
        </div>
        <a href="/download/report.csv?mb=55" class="btn btn-outline" style="font-size:0.85rem">📥 Export All (CSV)</a>
      </div>

      <table>
        <thead>
          <tr>
            <th>Student ID</th>
            <th>Full Name</th>
            <th>Major</th>
            <th>Grade</th>
            <th>GPA</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows}
        </tbody>
      </table>
    </div>
    """
    return HTMLResponse(layout("Student Marks", content, "/marks"))


@app.get("/login", response_class=HTMLResponse)
async def login_form():
    content = """
    <div class="card" style="max-width: 540px; margin: 0 auto;">
      <h1>🔐 Portal Login</h1>
      <p>Enter your institutional credentials to access your student records.</p>

      <div class="banner banner-info" style="margin-bottom: 20px;">
        <span>💡</span>
        <div style="font-size: 0.88rem;">
          <strong>Valid Demo Account:</strong> Username: <code style="color:#67e8f9">admin</code> &bull; Password: <code style="color:#67e8f9">portal@123</code><br>
          <em>Entering wrong passwords triggers auth_failure events monitored by WebSentinel.</em>
        </div>
      </div>

      <form method="POST" action="/login" id="loginForm">
        <div class="form-group">
          <label for="username">Username / Student ID</label>
          <input type="text" id="username" name="username" placeholder="e.g. admin or S001" required value="admin">
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" placeholder="••••••••••••" required>
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 22px;">
          <button type="submit" class="btn btn-primary" style="flex:1;">Sign In &rarr;</button>
          <button type="button" class="btn btn-outline" onclick="fillValid()">Fill Valid</button>
          <button type="button" class="btn btn-outline" onclick="fillWrong()">Fill Wrong</button>
        </div>
      </form>

      <!-- In-Browser Attack Simulator Section -->
      <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--card-border);">
        <h3 style="font-size: 1.05rem; margin-bottom: 8px; color: #cbd5e1;">⚡ In-Browser Attack Simulator</h3>
        <p style="font-size: 0.85rem; margin-bottom: 14px;">Trigger real-time attacks straight from this browser to see WebSentinel react live:</p>
        
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="btn btn-danger" onclick="runBruteForce()" id="btnBrute" style="justify-content: flex-start;">
            🔴 Launch Brute Force Attack (6 rapid failed logins)
          </button>
          <button type="button" class="btn btn-outline" onclick="runPathScan()" id="btnScan" style="justify-content: flex-start;">
            🔍 Launch Web Path Scan (12 distinct probe requests)
          </button>
        </div>

        <div id="consoleLog" class="console-box"></div>
      </div>
    </div>

    <script>
      function fillValid() {
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'portal@123';
      }
      function fillWrong() {
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'wrong_password_' + Math.floor(Math.random() * 900 + 100);
      }

      function logMsg(msg) {
        const box = document.getElementById('consoleLog');
        box.style.display = 'block';
        box.textContent += msg + '\\n';
        box.scrollTop = box.scrollHeight;
      }

      async function runBruteForce() {
        const btn = document.getElementById('btnBrute');
        btn.disabled = true;
        btn.textContent = '⏳ Running Brute Force Attack...';
        const box = document.getElementById('consoleLog');
        box.style.display = 'block';
        box.textContent = '=== Starting Brute Force Simulation (6 attempts) ===\\n';

        const wrongPasswords = ['123456', 'admin123', 'toor', 'password', 'student2026', 'letmein'];
        for (let i = 0; i < wrongPasswords.length; i++) {
          const pw = wrongPasswords[i];
          const form = new URLSearchParams();
          form.append('username', 'admin');
          form.append('password', pw);

          try {
            const res = await fetch('/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: form.toString()
            });
            logMsg(`[${i+1}/6] POST /login pw=${pw} -> HTTP ${res.status} (Denied)`);
          } catch(e) {
            logMsg(`[${i+1}/6] Error: ${e}`);
          }
          await new Promise(r => setTimeout(r, 300));
        }
        logMsg('>>> Brute Force complete! Check WebSentinel dashboard for red alert.');
        btn.disabled = false;
        btn.textContent = '🔴 Launch Brute Force Attack (6 rapid failed logins)';
      }

      async function runPathScan() {
        const btn = document.getElementById('btnScan');
        btn.disabled = true;
        btn.textContent = '⏳ Probing paths...';
        const box = document.getElementById('consoleLog');
        box.style.display = 'block';
        box.textContent = '=== Starting Web Path Scan (12 distinct endpoints) ===\\n';

        const paths = [
          '/.env', '/admin', '/wp-login.php', '/phpmyadmin',
          '/.git/config', '/backup.zip', '/config.php',
          '/server-status', '/api/keys', '/db.sql', '/old', '/test'
        ];
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          try {
            const res = await fetch(p);
            logMsg(`[${i+1}/12] GET ${p} -> HTTP ${res.status}`);
          } catch(e) {
            logMsg(`[${i+1}/12] GET ${p} -> network error`);
          }
          await new Promise(r => setTimeout(r, 200));
        }
        logMsg('>>> Path scan complete! Check WebSentinel dashboard for Port/Path Scan alert.');
        btn.disabled = false;
        btn.textContent = '🔍 Launch Web Path Scan (12 distinct probe requests)';
      }
    </script>
    """
    return HTMLResponse(layout("Login", content, "/login"))


@app.post("/login", response_class=HTMLResponse)
async def login(request: Request):
    # Parse form safely without requiring python-multipart C-extensions
    username = ""
    password = ""
    try:
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type:
            data = await request.json()
            username = data.get("username", "")
            password = data.get("password", "")
        else:
            body = await request.body()
            parsed = urllib.parse.parse_qs(body.decode("utf-8", errors="ignore"))
            username = parsed.get("username", [""])[0]
            password = parsed.get("password", [""])[0]
    except Exception:
        pass

    if username == "admin" and password == "portal@123":
        content = """
        <div class="card" style="max-width: 540px; margin: 0 auto; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
          <h1 style="color: #34d399;">Welcome, Administrator!</h1>
          <p>Authenticated successfully as <strong>admin</strong>. Session token active.</p>

          <div class="banner banner-success" style="text-align:left; margin-top:20px;">
            <span>🛡️</span>
            <div>
              <strong>WebSentinel Security Telemetry:</strong> Normal connection event logged. No threat detected.
            </div>
          </div>

          <div style="display:flex; justify-content:center; gap:12px; margin-top:24px;">
            <a href="/marks" class="btn btn-primary">View Student Marks</a>
            <a href="/admin" class="btn btn-outline">Restricted Admin Panel</a>
            <a href="/login" class="btn btn-outline">Sign Out</a>
          </div>
        </div>
        """
        return HTMLResponse(layout("Welcome", content, "/login"), status_code=200)

    # Failed login -> returns 401 as required by WebSentinel middleware
    content = f"""
    <div class="card" style="max-width: 540px; margin: 0 auto;">
      <h1>🔐 Portal Login</h1>
      <p>Enter your institutional credentials to access your student records.</p>

      <div class="banner banner-error">
        <span>❌</span>
        <div>
          <strong>Invalid credentials!</strong> Access denied for username <code>{username or 'unknown'}</code>.<br>
          <span style="font-size:0.82rem; color:#f87171;">Security Incident: This failed attempt has been reported to WebSentinel IDS.</span>
        </div>
      </div>

      <form method="POST" action="/login">
        <div class="form-group">
          <label for="username">Username / Student ID</label>
          <input type="text" id="username" name="username" value="{username}" required>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" placeholder="Try again..." required autofocus>
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 22px;">
          <button type="submit" class="btn btn-primary" style="flex:1;">Retry Sign In &rarr;</button>
          <a href="/login" class="btn btn-outline">Reset</a>
        </div>
      </form>
    </div>
    """
    return HTMLResponse(layout("Login Failed", content, "/login"), status_code=401)


@app.get("/admin", response_class=HTMLResponse)
async def admin():
    content = """
    <div class="card" style="max-width: 540px; margin: 0 auto; text-align: center;">
      <div style="font-size: 3rem; margin-bottom: 12px;">🚫</div>
      <h1 style="color: #f87171;">403 Forbidden</h1>
      <p>Access denied. Administrative dean privileges required.</p>

      <div class="banner banner-error" style="text-align:left; margin-top:20px;">
        <span>⚠️</span>
        <div>
          <strong>WebSentinel Path Probe Detected:</strong> Visiting <code>/admin</code> without clearance produces an HTTP 403 event, flagged as a suspicious path probe.
        </div>
      </div>

      <div style="margin-top: 24px;">
        <a href="/" class="btn btn-outline">&larr; Return to Home</a>
      </div>
    </div>
    """
    return HTMLResponse(layout("403 Forbidden", content, "/admin"), status_code=403)


@app.get("/download/{filename}")
async def download(filename: str, request: Request, mb: int = 55):
    mb = min(max(mb, 1), 100)  # clamp 1–100
    header = "id,name,grade,gpa,major,notes\n"
    row = "S001,Alice Smith,A,3.9,Computer Science,Official institutional transcript record for demo\n"
    target_bytes = mb * 1024 * 1024
    reps = max(1, (target_bytes - len(header)) // len(row))

    def generate():
        yield header
        chunk = row * 500
        full_chunks, remainder = divmod(reps, 500)
        for _ in range(full_chunks):
            yield chunk
        if remainder:
            yield row * remainder

    content_length = len(header) + reps * len(row)
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(content_length),
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
