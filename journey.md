# myWally - TouchNGo Hackathon Journey

**Project**: myWally - family-as-circuit-breaker for at-risk transactions
**Context**: TouchNGo Hackathon entry. Backend by Zaf, frontend + deck by team.
**Repo**: ~/projects/apps/mywally-api
**Start date**: 2026-04-25

myWally is a feature inside TNG: when an elderly or vulnerable user attempts a risky payment, TNG halts it and asks a guardian (adult child) to approve via push or voice call. Goal is to reduce scam losses for elderly Malaysians (RM 1.2B+ lost in 2023 per PDRM).

---

## Day 0-1 (2026-04-25 → 2026-04-26): Kickoff sprint - backend MVP end-to-end

A single overnight session that took the project from "no code" to "working demo with real phone calls, real risk engine, real LLM-powered chatbot, and a self-service simulator for the team to play with."

### Concept locked

Family-as-circuit-breaker. Parent uses TNG. Risky payment detected → TNG calls myWally → myWally calls the guardian on the phone → guardian enters PIN → presses 1 to approve / 9 to reject / 5 to conference in the parent → myWally tells TNG to release or block.

**Key principle decided:** elder always overrides. Guardian is co-pilot, never captain. Without this, the product is one design decision away from being the *tool* of elder financial abuse rather than the defense.

### Demo magic moment designed

Live on stage: tap "Send RM 1,500" in fake TNG checkout → judge's phone rings → enter PIN `1234` → Polly voice describes the transaction → press 9 → screen shows BLOCKED in real-time. Engineered the whole stack backwards from this 90-second flow.

### Stack chosen

- NestJS 11 + TypeScript
- PostgreSQL 16 + Prisma 6 ORM
- Redis 7 + BullMQ (for held-transaction timers, not yet used)
- Twilio Programmable Voice (TwiML served from app)
- Anthropic SDK + OpenAI SDK (latter used to talk to Moonshot's OpenAI-compatible API)
- Cloudflare Tunnel (quick tunnel for Twilio webhook reach)
- Docker / Docker Compose for the whole stack

### Things that broke and the root causes (worth keeping)

- **Node 25 + Prisma engines**: silent "(not available)" P1010 errors. Prisma's native engine can't parse env vars under Node 25's runtime. Fix: pinned Node 22 LTS via fnm + .nvmrc. Lesson: bleeding-edge Node bites Prisma every time.
- **Prisma 7 → 6**: v7 dropped `url` from schema, requires driver adapters. Too much surgery for a hackathon. Downgraded to v6, kept the classic `url = env("DATABASE_URL")` pattern.
- **Homebrew postgresql@18 on 5432**: shadowing the Docker container, intercepting all local connections. Fix: docker maps 5433:5432, redis 6380:6379, no service contention.
- **3-cycle module dep**: TransactionsModule ↔ InterventionsModule ↔ VoiceModule. forwardRef wasn't enough across 3 nodes. Fix: extracted TwilioService into its own leaf module so Voice and Interventions both import it independently.
- **Twilio +60 number**: requires Malaysia Local Individual Regulatory Bundle (MyKad + utility bill, 3-10 day approval). Bailed → US number ($1.15/mo, instant). Then geo permission for Malaysia was off by default → enabled it under Voice → Geo Permissions → Low Risk.
- **Twilio trial preamble + verified-only outbound**: gone after $20 upgrade. Stage demo will use the upgraded account.
- **Moonshot kimi-k2-0905-preview**: 404 model not found despite enterprise tier. Switched to moonshot-v1-32k (boring choice, works, supports tools).
- **Cloudflare quick tunnel ephemerality**: URL changes every restart. For demo day will switch to a named tunnel with fixed subdomain. Not done yet.

### What got built (in order)

1. **NestJS scaffold** with Prisma, BullMQ, Twilio, JWT, class-validator, dockerized.
2. **State machine**: Transaction states `RECEIVED → SCORED → HELD → CALLING → RELEASED | BLOCKED | ABORTED`. Hash-chained TransactionEvent rows for audit defensibility (`hash = sha256(prevHash || type || payload || ts)`).
3. **Risk engine**: 5-7 rule heuristics. First-time recipient + amount > 500 = halt. Crypto destination = +40 score. Score >= 40 = HOLD.
4. **Twilio voice flow**: `/voice/answer` → gather PIN → `/voice/pin` → describe transaction → gather decision → `/voice/decision` → 1/9/5 captured. Polly.Joanna voice. Verified working with real phone calls.
5. **TNG simulator**: `/sim/merchant` HTML page with three buttons (safe, halt, scammy). Each fires the same path TNG would: webhook → ingest → score → if held, fire voice call. Polling on the UI shows live state.
6. **Self-service onboarding**: `/sim` testers index. Anyone can register their family with their own phone, get a familyId in localStorage, run scenarios. Each tester gets their own family. JWT mint button per row (parent or guardian) for the FE to grab tokens.
7. **REST resource refactor**: moved everything from `/sim/*` rpc-style to proper REST. `POST /families`, `GET /transactions/:id`, `POST /transactions/:id/unblock`, `POST /auth/tokens`, `GET /me`, `GET /me/dashboard`. Webhooks stay rpc (TNG and Twilio don't speak REST). HTML demo pages stay under `/sim` and are excluded from Swagger.
8. **Permissions surface**: Guardianship gets `canViewBalance` / `canViewTransactions` / `canReceiveAlerts` flags. `PATCH /guardianships/:id` for permission edits, `DELETE` for revoke (soft delete, status=REVOKED, sunsetAt stamped, audit preserved). BFF endpoint `GET /me/members/:guardianshipId` for the member-detail screen.
9. **Budget surface**: Family gets `budgetAmount`, `budgetPeriod` (DAILY/WEEKLY/MONTHLY), `warningThresholdPercent`. Resource at `/families/:id/budget`, BFF at `/me/budget`. PUT is parent-only (guardian can read, can't change rules).
10. **Chatbot architecture**: `LlmProvider` interface, two implementations (Anthropic, Moonshot), tool registry with role + permission gating, agentic multi-turn loop (LLM picks tool → backend executes → result fed back to LLM → final narration). `MAX_TOOL_HOPS = 4`. Stateless API — FE keeps history, sends last 20 turns each call.
11. **Tools shipped**: `add_family_member`, `list_family_members`, `set_budget`, `get_balance`, `get_spending_summary`. Each wraps existing services so logic isn't duplicated. Each declares its required role + guardian permissions; registry enforces server-side before execution (never trusts the LLM).
12. **Sim chatbot UI** at `/sim/chat`: pick a tester, see their tool list (filtered by role), chat freely, see assistant text + structured action cards + UI hints (toast, refresh, navigate). Whitespace-pre-wrap fixes line-break formatting.
13. **Integration prompt**: copy-pasteable briefing at the bottom of `/sim/chat` for the FE colleague to feed Cursor/Claude Code. Has the live base URL filled in, all 13 endpoints documented, the chat response contract, rich-card rendering convention, and edge-case handling. One click to copy.
14. **Swagger docs** at `/docs` covering everything. Tags: auth, me, families, guardianships, budgets, transactions, webhooks, voice, chat, health. HTML pages excluded.

### Decisions worth keeping

- **REST + BFF** as a layered pattern. Resource endpoints (`/families`, `/transactions`) are canonical. BFF endpoints (`/me/dashboard`, `/me/budget`, `/me/members/:id`) are screen-shaped, can denormalize, suffix with screen name. Never duplicate a resource list.
- **LLM provider abstraction first, model choice second.** ChatService talks to a generic `LlmProvider`. Today it's Moonshot (because Zaf had no Claude credits). Tomorrow it's AWS Bedrock (because of credits). Swap is a one-class change. The judge defense for "why this LLM" becomes "we picked it for this milestone, the architecture lets us swap providers in a day."
- **Server-side permission re-check** even though tools are filtered before being shown to the LLM. Never trust the LLM to enforce auth.
- **Soft delete for guardianships**, not hard delete. Audit trail must survive any "remove access" action.
- **Single message → multiple actions + UI hints** as the chatbot response shape. Lets FE render rich cards inline (e.g. spending progress card from `get_spending_summary` tool data) and honor toast/navigate/refresh hints declaratively.

### Cost so far

- Twilio: ~$20 upgrade + $1.15/mo number + ~$0.02 in test calls
- Moonshot: free credits, ~$0 used
- Anthropic: $0 (no credits, didn't use)
- Domain / hosting: $0 (Cloudflare quick tunnel is free)
- AWS: $0 yet, will use existing credits next session

**Total so far: ~$22 USD**

### Key learning

The product surface is built — the harder calls were architectural, not coding. Specifically:
1. The "elder always overrides" principle has to be in the schema and enforced at the API, not bolted on later.
2. Provider abstraction for LLM is non-negotiable. Vendor lock-in on the chatbot is a death trap if the judge asks about cost or data residency.
3. Hash-chained audit events take 10 lines and become a slide bullet ("every decision provable, every override traceable") that judges weight heavily.
4. BFF + REST in parallel beats picking one. FE wants screen-shaped endpoints. Backend needs canonical resources. Both, suffixed clearly, no duplication.

### Next

- **AWS migration**: replace Moonshot with Bedrock (Claude Sonnet via AWS in ap-southeast-1 / Singapore region). Adds data residency story for judges. Add Amazon Transcribe for voice input (ASR). Add Amazon Polly for TTS (same engine as Twilio, brand consistency).
- **Conference call (press 5)**: real Twilio `<Dial><Conference>` to bridge guardian + parent live on the call. Stage moneyshot.
- **Push-first, voice-second**: Expo Push to guardian app first (60s window), only call if no in-app response. Reduces false-positive call cost dramatically. Judges will pick at this if it's missing.
- **Outbound TNG callback**: when decision is made, POST back to TNG callback URL (mocked). Closes the architecture loop.
- **Named Cloudflare tunnel**: fixed subdomain so demo-day slides don't go stale.
- **Avatar placeholders + notifications stub**: small but FE colleague will hit these.

---

## Day 1 (2026-04-26 evening): AWS regional research before migration

Before pulling the trigger on Bedrock, researched whether the new AWS Malaysia region (`ap-southeast-5`, live since 2024) could be the home for our AI stack. The answer changed the plan.

### What I checked

- AWS Bedrock model availability per region (official docs)
- Amazon Transcribe regional support
- Amazon Polly regional support

### What I found

**`ap-southeast-5` (Malaysia):**
- Bedrock Claude: NOT in-region. Only via "Global cross-region inference" — routes to anywhere in the world. Defeats data residency.
- Amazon Transcribe: NOT available
- Amazon Polly: Available (standard + neural)

**`ap-southeast-1` (Singapore):**
- Bedrock Claude 3.5 Sonnet: Direct in-region access — data stays in SG ✅
- Newer Claude (Sonnet 4.5/4.6, Opus 4.7, Haiku 4.5): only via global cross-region inference even from SG
- Transcribe: Available ✅
- Polly: Available ✅

### Decision

Stick with **Singapore (`ap-southeast-1`) + Claude 3.5 Sonnet**. This gives the most defensible data residency story we can honestly make:
- All AI processing in Singapore (~50ms latency to MY users)
- Claude 3.5 Sonnet is in-region (no cross-region routing)
- Transcribe + Polly both in-region
- For PDPA/BNM, "data processed in SG, data residency achievable in SG" is honest

We cannot honestly claim "data stays in Malaysia" with this stack. Bedrock + Transcribe both miss MY region. The only fully MY-resident option for AI would be self-hosting Llama on EC2 in `ap-southeast-5` — out of hackathon scope.

### Updated judge defense

> "Bedrock + Transcribe + Polly all run in Singapore. We use Claude 3.5 Sonnet which is in-region direct (no cross-region routing). For Malaysian users, in-region latency is ~50ms. Production roadmap includes evaluating ap-southeast-5 once Bedrock launches there, and self-hosted Llama on EC2 in MY for fully on-shore processing if BNM compliance demands it."

### Key learning

Don't assume new regions get full service parity. Bedrock + Transcribe rollouts lag the region launch by 12-24 months. Always check the regional services page before promising data residency.

### Next

- Set up IAM user with Bedrock + Transcribe + Polly access
- Request Claude 3.5 Sonnet model access in `ap-southeast-1` Bedrock console
- Create S3 bucket for Transcribe job inputs (MY ASR uploads)
- Wire BedrockProvider into the existing LlmProvider abstraction
- Add Transcribe service for `POST /me/chat/messages/voice`
- Add Polly service for optional `GET /me/chat/messages/:id/audio` (TTS)

---

## Day 1 (2026-04-26 late evening): Multi-provider AI stack

A second push focused on getting cloud LLMs working and discovering a strategic angle for the pitch.

### Bedrock came up easier than expected

- AWS Bedrock console retired the manual "Model access" page. Serverless models now auto-enable on first invocation.
- Hackathon AWS account (federated SSO via PermissionSet `finhack_IsbUsersPS`) had Bedrock pre-enabled.
- Singapore region playground served **Claude Sonnet 4.5** (newer than the 3.5 we asked for) at ~1.3s latency.
- Used Bedrock's new long-term API key (`AWS_BEARER_TOKEN_BEDROCK`) instead of IAM access keys. Much simpler — single env var, SDK auto-detects. Skipped IAM user creation entirely.
- Built `BedrockProvider` using the Bedrock Converse API which is provider-agnostic (works for Claude, Llama, Mistral) and supports tool use natively. Wrote turn → Converse message format conversion.
- Model ID: `global.anthropic.claude-sonnet-4-5-20250929-v1:0` (global cross-region inference profile - newer Claude not in-region direct in SG).

### Strategic angle discovered: Ant Group owns TNG

While discussing Alibaba as an alternative, surfaced the fact that **Ant Group (Alibaba ecosystem) is a strategic shareholder in TNG Digital** since 2017. This makes Alibaba Cloud + Qwen the most strategically aligned choice for a TNG hackathon submission.

Pitch slide bullet now writes itself:
> "LLM provider abstraction supports AWS Bedrock (Claude), Alibaba Cloud DashScope (Qwen), Anthropic direct, and Moonshot. Single env-var swap. Aligned with TNG's existing Ant Group infrastructure."

### Built AlibabaProvider

- DashScope is OpenAI-compatible — used existing `openai` SDK with `baseURL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`.
- Same shape as MoonshotProvider, wired into the same factory.
- Hackathon Alibaba account (`finhackuser26@...`) had Model Studio (rebranded DashScope) pre-activated in Singapore region.
- Models seen in console: Qwen3.6-Plus, Qwen3.6-Max-Preview, Qwen3.6-Open-Source, Qwen3.5-Plus, plus the multimodal Wan2.7 image-to-video (out of scope).

### Provider abstraction now has four implementations

```
AnthropicProvider, BedrockProvider, AlibabaProvider, MoonshotProvider
       ↓             ↓                ↓                  ↓
       LLM_PROVIDER env var picks one. ChatService doesn't care.
```

Factory order of preference (when no explicit pick): bedrock → alibaba → anthropic → moonshot.

### Latency tradeoffs discovered

- `qwen3.6-max-preview` (biggest Qwen): **5+ seconds** end-to-end with multi-turn loop. Too slow for chat UX.
- `qwen-turbo-latest`: **~1-2 seconds**. Acceptable. Slight quality dip on ambiguous inputs and BM intent handling, but fine for the demo's canned queries.
- Bedrock Sonnet 4.5: ~2-3s end-to-end with multi-turn. Solid baseline.

Settled on `qwen-turbo-latest` for active demo. Bedrock kept as parallel-configured fallback.

### Things that broke and the root causes

- **HTML response in chat**: "Network error: Unexpected token '<', '<!DOCTYPE'..." on the FE. Root cause: dev server crashed mid-request, Cloudflare tunnel served its own 1033 error HTML page, browser tried to JSON.parse it. Fix: restart dev server, watch logs for the actual stack trace.
- **Duplicate `LLM_PROVIDER` lines** in `.env`: dotenv last-value-wins meant `bedrock` was overridden by `moonshot` further down the file. Fix: cleaned up.
- **Initial wrong default Moonshot model** `kimi-k2-0905-preview` 404'd despite enterprise tier — switched to `moonshot-v1-32k` as boring-and-stable choice.

### Decisions worth keeping

- **Bedrock API key over IAM access keys** for hackathon. Single env var, no IAM user dance, no policies to attach. Production would still want fine-grained IAM for least-privilege but this is faster for demo.
- **Singapore region for the entire AI stack**, not Malaysia. Bedrock + Transcribe both miss `ap-southeast-5`. Cannot honestly claim "data stays in Malaysia" with this stack.
- **Multi-provider abstraction is non-negotiable.** It paid for itself in this session alone (we swapped providers three times in an hour: Anthropic-shape via Moonshot → Bedrock → Alibaba → Bedrock-via-Alibaba comparison). Without the abstraction we'd have rewritten ChatService each time.
- **For demo, default to fastest reliable provider, mention strategic alignment on slide.** Don't sacrifice latency for ecosystem alignment when the abstraction lets you have both.

### Cost so far (cumulative)

- Twilio: ~$22 (upgrade + number + test calls)
- Moonshot: $0 (free credits)
- Anthropic: $0 (no use)
- AWS Bedrock: $0 (hackathon credits)
- Alibaba DashScope: $0 (hackathon credits)
- Cloudflare: $0
- Hosting/domain: $0

**Total: ~$22 USD** for the entire backend so far.

### Key learning

The **strategic-fit slide bullet is worth more than the technical "best" answer**. Judges from TNG won't be impressed by raw model benchmarks; they'll be impressed by "this team understands our ecosystem." Building the abstraction means we don't have to pick — we have *all* the answers ready.

Also: cloud provider AI quickstart pages are misleading. Alibaba's "qwen-max-latest" and AWS's "model access" page are both rough edges that cost time. Always test with the actual provider playground first before integrating.

### Next

- **Conference call (press 5)**: real Twilio `<Dial><Conference>` to bridge guardian + parent live on the call. Stage moneyshot. ~30 min.
- **Push-first, voice-second**: Expo Push to guardian app first (60s window), only call if no in-app response.
- **Outbound TNG callback**: when decision is made, POST back to TNG callback URL (mocked).
- **Named Cloudflare tunnel**: fixed subdomain so demo-day slides don't go stale.
- **Voice ASR/TTS via AWS**: deferred — needs IAM access keys which the hackathon SSO account may not allow. Bedrock API key only covers Bedrock.

---

## Day 1 (2026-04-26 night): Voice features — what worked, what didn't

A focused investigation: can we add voice to the chatbot using the providers we already have credits for? Outcome: ASR yes, TTS no. Below is the full picture so we don't re-investigate.

### The user demand

myWally targets **elderly Malaysian users**. Voice is the natural interface — many won't type. Need both directions:
- **Voice in (ASR)**: user speaks BM or Manglish, system understands
- **Voice out (TTS)**: system speaks back in BM, elderly user listens

### Provider comparison for ASR + TTS

| Provider | ASR | TTS | BM ASR | BM TTS | Same key as our LLM? | Verdict |
|---|---|---|---|---|---|---|
| **AWS Transcribe + Polly** | Transcribe | Polly | ✅ Native `ms-MY` (Oct 2024) | ❌ No `ms-MY`, no `id-ID` either (verified in docs) | ❌ Polly/Transcribe need IAM, Bedrock API key insufficient | ASR-only AWS only works if we get IAM creds, TTS unusable for BM |
| **Alibaba qwen3-* models** | qwen3-asr-flash | qwen3-tts-flash | ✅ Works (transcribes BM as Indonesian — same root) | ❌ Anime/manga voice for BM, unusable | ✅ Same DashScope key as LLM | ASR yes, TTS no |
| **Google Cloud TTS** | Speech-to-Text | TTS | ✅ Native `ms-MY` | ✅ **Best in industry** for `ms-MY` | ❌ Different vendor | Best for BM TTS, but we don't have credits or wired |
| **Browser Web Speech / SpeechSynthesis** | SpeechRecognition | SpeechSynthesis | ⚠️ Some browsers support `ms-MY` | ⚠️ Device-dependent | n/a (client-side) | Cheap fallback, varies by user device |

### Why we picked Alibaba ASR + skipped TTS for now

- **ASR via Alibaba**: works, BM-recognizable, single-vendor story holds (LLM + ASR on the same key, billing, audit).
- **TTS via Alibaba**: tested CosyVoice voices `Cherry`, `Ethan`, `Chelsie`, `Serena`, `Dylan`, `Jada`, `Sunny` with three test phrases (BM, EN, code-switched). All sounded "anime/manga" — wrong language model used as fallback for unsupported BM. **No-go**.
- **AWS Polly for BM**: docs page in 2026 doesn't list `ms-MY` or even `id-ID` (Indonesian was previously listed; appears removed). So even with IAM creds, no TTS. **Confirmed dead end**.
- **Google TTS** would solve TTS but adds a third cloud and we don't have credits. **Roadmap, not demo**.

**Decision**: ship ASR via Alibaba for the demo. Voice is one-way (in) only. Output stays text + rich cards. Mention Google TTS as the production TTS roadmap on the architecture slide.

### The Alibaba ASR integration story (for future-me)

`qwen3-asr-flash` is a **dedicated ASR task**, not a multimodal LLM. It does NOT accept the `{audio, text}` content blocks shape that Qwen-Audio expects.

The model is accessed via **async job pattern**:

```
1. POST /api/v1/services/audio/asr/transcription
   header: X-DashScope-Async: enable
   body: { model: 'qwen3-asr-flash', input: { file_urls: ['<public-https-url>'] } }
   returns: { output: { task_id, task_status: 'PENDING' } }

2. Poll GET /api/v1/tasks/<task_id> every 1s until task_status === 'SUCCEEDED'
   returns: { output: { results: [{ transcription_url }] } }

3. GET <transcription_url> (a temp signed S3-style URL with the JSON transcript)
   returns: { transcripts: [{ text: '...' }] }
```

**Critical gotcha**: `file_urls` MUST be public HTTPS URLs that DashScope can fetch. `data:` URIs don't work. We solve this by:

1. Browser uploads base64 audio to backend.
2. Backend stores in an in-memory `Map<uuid, {bytes, mime, expiresAt}>` (5-minute TTL).
3. Backend exposes the audio at `GET /audio/:id` (no auth) served via the Cloudflare tunnel.
4. Backend sends the tunnel URL to DashScope.
5. DashScope fetches the audio over HTTPS, transcribes.
6. Backend purges the in-memory entry after job completes.

Methods we tried before landing on the async-job approach (recorded so we don't repeat):

| Attempt | Endpoint | Result |
|---|---|---|
| 1 | OpenAI-compatible `/audio/transcriptions` (Whisper-style multipart upload) | 404 — endpoint doesn't exist on this DashScope account |
| 2 | Native `multimodal-generation/generation` with `{audio, text}` content | 400 "dedicated task `asr` does not support this input" |
| 3 | Native `multimodal-generation/generation` with audio-only content + data URL | 400 invalid input |
| 4 | Native `audio/asr/transcription` with `data:` URI | 400 "url error" — needs HTTPS, not data URI |
| 5 | Native `audio/asr/transcription` with public tunnel URL + async polling | ✅ **Works** |

**Quality test**: said "cubaan satu dua tiga" in Bahasa Melayu, got back `cobaan satu dua tiga` (Indonesian spelling, same root). Recognizable enough for our chat tools (intent extraction is downstream LLM's job, not the transcript's job to be perfect).

### Code shape

```
src/asr/
  asr.module.ts       @Global, exports AsrService
  asr.service.ts      transcribe(bytes, mime) → { transcript, raw, error }
                      manages in-memory temp store + 5min TTL
  asr.controller.ts   GET /audio/:id (public, serves audio bytes)

src/chat/chat.controller.ts
  POST /me/chat/messages/voice  (auth required)
    body: { audio: base64, mime: 'audio/webm', history: [...] }
    returns: { transcript, reply, actions, ui, llm }   ← transcript prepended to chat shape

src/simulator/simulator.controller.ts
  GET  /sim/chat            ← mic button next to text input
  POST /sim/asr-test        ← demo-only; calls AsrService.transcribe
  GET  /sim/asr-test        ← standalone test page
```

### Frontend pattern (sim/chat)

Mic button uses MediaRecorder. WebKit-compatible MIME selection:
```
if ('audio/webm;codecs=opus' supported) → 'audio/webm;codecs=opus'
elif 'audio/mp4' supported               → 'audio/mp4'
else                                     → browser default
```

UX:
1. Tap mic → `getUserMedia({audio:true})` → record (button red, pulsing)
2. Tap again → `mediaRecorder.stop()` → `onstop` builds Blob, calls `sendVoiceBlob`
3. `sendVoiceBlob` immediately appends a `🎙 (voice note...)` placeholder bubble
4. POSTs base64 audio to `/me/chat/messages/voice`
5. On response: replaces placeholder text with actual transcript, then appends assistant reply

### Things that broke and the root causes

- **`pollTimer is not defined`**: copy-paste from the merchant page where it polls transaction state. Chat page has no polling — variable was undefined. Fix: removed the line.
- **Anime-voice TTS**: `qwen3-tts-flash` falls back to a neural voice trained on a different language when BM text is fed in. Likely Mandarin/Cantonese voice profile picked. No way to force language without a BM-specific voice in the catalog. Confirmed by trying every voice in the menu.
- **`data:` URIs rejected by DashScope ASR**: their fetcher only accepts HTTPS URLs. Easy diagnostic: error message "url error, please check url".

### Updated cost note

- AWS Bedrock: minimal (Sonnet 4.5 calls during chat testing)
- Alibaba: free tier well within hackathon credits. ASR async jobs ~$0.001 each.
- Twilio: ~$22 from earlier
- Google Cloud, Azure: $0 (not used)

**Total: still ~$22 USD.**

### Decisions worth keeping

- **Voice is one-way (in only) for the demo.** TTS deferred to roadmap. Mention Google TTS for production BM voice.
- **AsrService is `@Global`** so any controller (chat, simulator, future voice-call recording) can use it without explicit imports.
- **Audio temp store is in-memory with TTL.** No disk I/O, no S3, no persistence. Suitable for hackathon — would swap to S3 with signed URLs in production.
- **Tunnel is required for ASR.** Local-only dev still works (LLM chat) but voice notes need cloudflared up so DashScope can fetch the audio. Document this clearly in README before handoff.

### Next (revised)

1. **Conference call (press 5)** — Twilio `<Dial><Conference>` between guardian leg + outbound to parent. ~30 min. Demo magic moment.
2. **Push-first then voice escalation** — Expo Push primary, Twilio call only after 60s no-response. Production credibility.
3. **Outbound TNG callback** — POST decision back to mocked TNG endpoint when state is RELEASED/BLOCKED.
4. **Named Cloudflare tunnel** — fixed subdomain (e.g. mywally-api.zafranudin.dev) so the tunnel URL doesn't drift between sessions / demo-day slides don't go stale.
5. **Browser SpeechSynthesis as 5-min TTS bandaid** — auto-speak assistant replies in chat. Works on most devices, BM voice quality varies but acceptable.
6. **Avatar placeholders + notifications stub** — small but FE colleague will hit these.

### Compact memo

If/when the conversation is compacted, the key things to know are:

- **4 LLM providers wired** (Bedrock primary, Alibaba secondary, Anthropic+Moonshot configured but inactive). All behind `LlmProvider` interface, swap with `LLM_PROVIDER` env var. Active default: bedrock.
- **Tools shipped**: add_family_member, list_family_members, set_budget, get_balance, get_spending_summary. Multi-turn loop max 4 hops.
- **Voice IN works** via Alibaba qwen3-asr-flash, async job pattern, public tunnel URL trick. `POST /me/chat/messages/voice` is the entry point.
- **Voice OUT skipped** — Alibaba TTS sounds anime, AWS Polly has no BM, Google TTS would work but unwired.
- **Demo flow remains**: TNG simulator at `/sim/merchant` → halt RM 1500 → guardian phone rings → PIN 1234 → press 1/9/5 → state updates live.
- **Sim has 4 pages**: `/sim` (testers), `/sim/merchant` (checkout), `/sim/chat` (chatbot with mic), `/sim/asr-test` (standalone ASR test).
- **Repo**: `Xavier-IV/mywally-api` private. SSH push works.
- **Hackathon AWS account is federated SSO** — Bedrock works via long-term API key, but Transcribe/Polly/IAM access keys likely blocked by SCP. Don't waste time trying.
- **Cloudflared tunnel is ephemeral** — URL changes each restart. Need to switch to named tunnel before demo day.
- **Phone number**: Twilio US `+16204558161`, paid (upgraded), Malaysia outbound enabled. Verified caller IDs not needed since upgrade.
