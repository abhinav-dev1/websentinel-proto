# Student Portal — WebSentinel Demo Website

A tiny FastAPI site used to demonstrate WebSentinel threat detection.

## Quick start

```bash
cd demo-website
pip install -r requirements.txt
WEBSENTINEL_URL=http://localhost:8000 uvicorn app:app --port 8080
python attack_demo.py --type all --host http://localhost:8080
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `WEBSENTINEL_URL` | `http://localhost:8000` | WebSentinel backend URL |
| `WEBSENTINEL_API_KEY` | *(empty)* | Must match backend `WEBSENTINEL_API_KEY` if set |
| `WEBSENTINEL_SITE_IP` | `192.168.1.50` | IP shown in topology for this site |

## Routes

| Route | Method | Description |
|---|---|---|
| `/` | GET | Home page with navigation links |
| `/marks` | GET | View fake student marks table |
| `/login` | GET | Login form |
| `/login` | POST | Authenticate (admin / portal@123); returns 401 on failure |
| `/admin` | GET | Always returns 403 (triggers path probe detection) |
| `/download/{filename}` | GET | Stream a large CSV file (`?mb=1–100`, default 55 MB) |
| `/health` | GET | Health check |

## Attack detection demo

| Attack | How | WebSentinel reaction |
|---|---|---|
| Brute force | `python attack_demo.py --type brute` | Brute Force alert after 5 failed logins |
| Web scan | `python attack_demo.py --type scan` | Port Scan alert after 10 distinct 403/404 paths |
| Data exfil | `python attack_demo.py --type exfil` | Data Exfil alert on the 55 MB download |
| All three | `python attack_demo.py --type all` | Full demo sequence with pauses between attacks |

