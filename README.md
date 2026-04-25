# myWally — backend

> **Family-as-circuit-breaker for at-risk transactions.**
> Built for the TouchNGo hackathon. Backend for the myWally guardian-approval flow.

When an elderly TNG user attempts a risky payment (large amount, new recipient, crypto destination, or over-budget), TNG halts the transaction and calls myWally. myWally calls a designated guardian (an adult child) on the phone. Guardian enters a PIN, then presses **1** (approve), **9** (reject), or **5** (conference call to parent). Decision settles back to TNG within seconds.

**Live demo:** `https://wally-api.mywally-app.com`
**Repo:** `Xavier-IV/mywally-api` (private)

---

## Why this matters

PDRM reported **RM 1.2 billion+ lost to scams in 2023**, with the elderly disproportionately targeted. Banks can't see the family graph; they only see accounts. TNG can — Ant Group's ecosystem already has the social and payment graph in one place.

myWally is the first product we know of that uses **the family relationship itself as the safety net**, not just transaction patterns.

---

## Demo

```
TNG simulator (/sim/merchant)
        │
        ▼ "Send RM 1500 to Maybank ****1234"
   POST /transactions
        │
        ▼ riskScore=60 → HOLD
   InterventionsService
        │
        ▼ Twilio.calls.create(to=guardian)
   Guardian's phone rings
        │
        ▼ PIN 1234, then DTMF 1/9/5
   Tx state updates LIVE in /sim/merchant
```

Try it yourself at `/sim` — pick a tester family, click **Use this**, push the **Send RM 1,500** button. The phone number on the family record will ring.

---

## Endpoints worth poking at

| URL | What |
|---|---|
| `/sim` | Tester index — JWT mint buttons, family list, last transaction state |
| `/sim/merchant` | TNG-style checkout demo. The moneyshot |
| `/sim/chat` | Chatbot with mic button (BM voice notes via Alibaba ASR) |
| `/sim/budget?familyId=…` | Edit family budget, auto-approve limit, reset transactions |
| `/sim/asr-test` | Standalone ASR test page |
| `/docs` | Full Swagger / OpenAPI |
| `/health` | Liveness probe |

All `/sim/*` pages are excluded from the public API contract — they exist for testers and judges to understand and trigger flows without writing code.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | NestJS 11 + TypeScript, Node 22 LTS |
| Database | PostgreSQL 16 + Prisma 6 |
| Voice | Twilio Programmable Voice + TwiML |
| ASR | Alibaba DashScope `qwen3-asr-flash` (BM-strong, async-job pattern) |
| LLM | Pluggable: `LLM_PROVIDER=alibaba\|bedrock\|moonshot\|anthropic` |
| Container | Docker + Compose |
| Hosting | Alibaba ECS Singapore (`ecs.t6-c1m2.large`) |
| TLS / DNS | Cloudflare proxied subdomain (Flexible mode) |
| Repo | GitHub private + deploy-key on prod |

LLM choice is a one-line env swap. We default to **Alibaba Qwen** for hackathon (Ant Group / TNG ecosystem alignment) but Bedrock Claude is wired and tested.

---

## Risk engine

Rule-based and deterministic — explainable to judges, regulators, and elderly users. ML is V2.

| Signal | +Score |
|---|---|
| First-time recipient | +30 |
| Amount ≥ RM 500 | +15 |
| Amount ≥ RM 1,000 | +30 |
| Crypto destination (Binance/Luno/Tokenize/Bitcoin) | +40 |
| Untrusted handle keyword | +20 |
| Period spending + tx > budget cap | +30 |

**Decision:** `score ≥ 40` → HOLD (call guardian). Else → PASS.
**Override:** `amount ≤ dailyAutoApproveLimit` → PASS regardless (except crypto).

Server-side enforced. The LLM never decides risk — it only describes it.

---

## State machine

```
RECEIVED → SCORED → HELD → CALLING → RELEASED | BLOCKED | ABORTED
```

Every transition appends one row to `TransactionEvent` with a SHA-256 hash chain:

```
hash = sha256(prevHash || type || payload || ts)
```

Tampering with one row breaks every row after it. Designed for dispute defensibility.

---

## Run locally

Requires Docker, Node 22 (use `fnm` + `.nvmrc`), and your own `.env` (copy from `.env.example`).

```bash
# Postgres only, run app from npm
docker compose up -d postgres
npx prisma migrate dev
npm run start:dev

# OR full dockerized stack
docker compose up --build
```

Health check: `curl http://localhost:3000/health`

For a Twilio-less demo, set `DEMO_FAKE_VOICE=true` — calls are logged instead of dialed.

---

## Module layout

```
src/
  prisma/         PrismaService (global)
  health/         liveness probe
  auth/           JWT auth, role-aware token mint
  families/       parent ↔ guardians graph
  guardianships/  permissions + soft delete
  budgets/        per-family budget, auto-approve, warning thresholds
  risk/           rule engine
  transactions/   FSM, hash-chained events
  interventions/  push-then-voice orchestrator
  voice/          Twilio TwiML controllers
  twilio/         leaf service (extracted to break a dep cycle)
  webhooks/       TNG inbound, signature-verified
  asr/            Alibaba qwen3-asr-flash integration
  chat/           tool-calling agent (LLM-agnostic)
  simulator/      /sim/* pages and helpers
```

---

## Hackathon tradeoffs (transparency)

We deliberately deferred the following for demo speed. Each has a clear path back to production-grade:

| Component | Hackathon choice | Production target |
|---|---|---|
| Postgres | Self-hosted on the API box | ApsaraDB RDS (HA, backups, PITR) |
| Redis / queues | Removed; sync orchestration | BullMQ for push→voice escalation, retries, dedupe |
| CI/CD | `git pull && docker compose up` on the box | GitHub Actions → ACR → SAE/ACK |
| TLS to origin | Cloudflare Flexible (CF↔origin HTTP) | Origin Certificate, Full-strict |
| CORS | Wide open | Allowlist on production FE domain |
| Twilio signature validation | Off | On with rotating webhook secret |
| Rate limiting | None | Nest throttler + Cloudflare rate rules |
| Observability | `docker compose logs` | SLS + CloudMonitor + structured JSON |
| PIN | Hardcoded `1234` | bcrypt-hashed, per-guardian |

None of these are architectural blockers — they're all "swap one config / one module" changes.

---

## Deploy (current shape)

One Alibaba ECS box runs everything. Manual deploy:

```bash
# from your laptop, after pushing
ssh root@<ecs-ip> 'cd ~/mywally-api && git pull && docker compose up -d --build'
```

Cloudflare A record → ECS public IP, Proxied, Flexible SSL. Twilio voice webhook points at `https://wally-api.mywally-app.com/voice/answer`.

---

## Strategic angle (for judges)

| Concern | Banks | myWally |
|---|---|---|
| See family graph | ❌ | ✅ first-class |
| Phone-bridge live decision | SMS OTP | DTMF over PSTN |
| Speak Bahasa Melayu | fixed IVR | Alibaba ASR + LLM |
| Elder always overrides guardian | partial | schema-enforced |
| Settle dispute | ledger entry | hash-chained event log |
| Strategic fit with TNG / Ant Group | competitor | ecosystem alignment |

**Why only TNG can ship this:** family graph + payment graph + voice infra in one place. Banks don't have all three.

---

## Engineering journey

`journey.md` in this repo is the unfiltered build log — every decision, gotcha, and tradeoff captured with timestamps from Day 0 through deployment. Day-by-day, including what we tried and rejected (e.g. why we skipped TTS and AWS Polly).

---

## License & contact

Private hackathon repo. For collaboration: contact via the team.
