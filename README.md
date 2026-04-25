# mywally-api

Backend for **myWally** - TouchNGo hackathon entry.
Family-as-circuit-breaker for vulnerable users: when a high-risk transaction
is detected, halt it and escalate to a guardian via push and (if needed) a
Twilio voice call with DTMF approval.

## Stack

- NestJS 11 + TypeScript
- PostgreSQL 16 (Prisma 6 ORM)
- Redis 7 (BullMQ for held-transaction timers)
- Twilio Programmable Voice (TwiML served from this app)
- Expo Server SDK (push to guardian app)
- Docker / Docker Compose

## Run (dev)

```bash
# 1. Boot Postgres + Redis
docker compose up -d postgres redis

# 2. Apply migrations
npx prisma migrate dev

# 3. Start dev server
npm run start:dev

# Health check
curl http://localhost:3000/health
```

Or the full dockerized stack (app + db + cache):

```bash
docker compose up --build
```

### Ports

| Service  | Host port | Note |
|----------|-----------|------|
| Postgres | 5433      | Homebrew `postgresql@18` already on 5432 |
| Redis    | 6380      | avoid clashes with system redis |
| API      | 3000      | - |

## Architecture (in flight)

```
TNG -POST /webhooks/tng/transaction-> HELD -> score -> notify guardian
                                                              |
              push answer (in-app)        ------------------+
              voice answer (Twilio /webhooks/twilio/voice/*)+
              timeout (BullMQ delayed job)------------------+
                                  |
                          RELEASE / BLOCK / ABORT
                                  |
                       callback to TNG to settle
```

State machine on `Transaction.state`:
`RECEIVED -> SCORED -> HELD -> NOTIFIED -> CALLING? -> RELEASED | BLOCKED | ABORTED`

Every transition appends a row to `TransactionEvent` with a hash chain
(`hash = sha256(prevHash || type || payload || ts)`) for audit defensibility.

## Module layout (planned)

```
src/
  prisma/         PrismaService (global)
  health/         liveness probe
  auth/           JWT guard, seeded users for hackathon
  families/       parent <-> guardians graph
  risk/           rule engine (table-driven, hot-reloadable)
  transactions/   FSM, idempotent state transitions
  interventions/  orchestrator: push first, voice escalation, timeouts
  voice/          Twilio webhook controllers, TwiML builders
  webhooks/       TNG inbound (HMAC-verified)
  simulator/      /sim/merchant fake-TNG demo page
```

## Demo flow (target)

1. Open `http://localhost:3000/sim/merchant` (fake TNG checkout).
2. Click "Send RM 1,500 to Maybank ****1234" -> halts.
3. Guardian phone rings. Enter PIN. Hear amount + recipient.
4. Press **1** approve / **9** reject + freeze / **5** conference parent.
5. TNG webview unblocks accordingly.

## Env

Copy `.env.example` -> `.env`. For Twilio-less demos, leave
`DEMO_FAKE_VOICE=true` - calls are logged instead of dialed.

## Node version

Pinned to **Node 22 LTS** via `.nvmrc` (Prisma engines don't yet support
Node 25). With `fnm` installed and `--use-on-cd`, `cd` into this dir auto-switches.
