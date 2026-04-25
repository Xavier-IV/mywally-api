import { Body, Controller, Get, Header, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AsrService } from '../asr/asr.service';
import { PrismaService } from '../prisma/prisma.service';

interface AsrTestBody {
  audio: string; // base64 (no data: prefix)
  mime: string; // e.g. "audio/webm"
}

@ApiExcludeController()
@Controller('sim')
export class SimulatorController {
  private readonly logger = new Logger(SimulatorController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly asr: AsrService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('families/:id/reset-transactions')
  async resetTransactions(@Param('id') familyId: string) {
    const f = await this.prisma.family.findUnique({ where: { id: familyId } });
    if (!f) throw new NotFoundException(`Family ${familyId} not found`);
    const events = await this.prisma.transactionEvent.deleteMany({
      where: { transaction: { familyId } },
    });
    const decisions = await this.prisma.decisionLog.deleteMany({
      where: { transaction: { familyId } },
    });
    const txs = await this.prisma.transaction.deleteMany({ where: { familyId } });
    return { familyId, deleted: { transactions: txs.count, events: events.count, decisions: decisions.count } };
  }

  @Get('families/:id/spending')
  async familySpending(@Param('id') familyId: string) {
    const f = await this.prisma.family.findUnique({ where: { id: familyId } });
    if (!f) throw new NotFoundException(`Family ${familyId} not found`);
    const start = startOfBudgetPeriodSim(new Date(), f.budgetPeriod);
    const agg = await this.prisma.transaction.aggregate({
      where: { familyId, state: 'RELEASED', createdAt: { gte: start } },
      _sum: { amount: true },
    });
    const spent = Number((agg._sum.amount ?? 0).toString());
    const budget = Number(f.budgetAmount.toString());
    return {
      familyId,
      period: f.budgetPeriod,
      periodStart: start.toISOString(),
      spent,
      budget,
      remaining: Math.max(0, budget - spent),
      dailyAutoApproveLimit: Number(f.dailyAutoApproveLimit.toString()),
    };
  }

  @Post('asr-test')
  async asrTest(@Body() body: AsrTestBody) {
    const audioBytes = Buffer.from(body.audio, 'base64');
    return this.asr.transcribe(audioBytes, body.mime);
  }

  @Get('asr-test')
  @Header('Content-Type', 'text/html; charset=utf-8')
  asrTestPage() {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>myWally - ASR test</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 540px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { margin: 0; font-size: 22px; }
  .sub { color: #666; margin: 4px 0 24px; font-size: 14px; }
  nav { margin-bottom: 16px; font-size: 13px; }
  nav a { color: #2563eb; text-decoration: none; margin-right: 14px; }
  .panel { border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 14px; background: #fff; }
  button { padding: 12px 18px; border: 0; border-radius: 999px; background: #111827; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  button.recording { background: #dc2626; animation: pulse 1.2s ease-in-out infinite; }
  button:disabled { opacity: 0.5; cursor: wait; }
  @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  .duration { font-family: ui-monospace, Monaco, monospace; font-size: 28px; color: #111827; margin: 16px 0; }
  .transcript { font-size: 18px; line-height: 1.45; padding: 14px; background: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0; min-height: 60px; white-space: pre-wrap; }
  .transcript:empty::before { content: 'Transcript will appear here...'; color: #6b7280; font-size: 14px; font-style: italic; }
  .meta { font-size: 12px; color: #6b7280; margin-top: 6px; }
  pre { background: #f9fafb; border: 1px solid #e5e7eb; padding: 10px; border-radius: 6px; font-size: 11px; overflow-x: auto; max-height: 240px; overflow-y: auto; }
  .audios { margin-top: 12px; }
  audio { width: 100%; }
  .phrases { background: #fffbeb; border: 1px solid #fcd34d; padding: 10px 12px; border-radius: 8px; font-size: 13px; color: #78350f; }
  .phrases ul { margin: 4px 0 0 18px; padding: 0; }
  .phrases li { margin: 2px 0; }
</style>
</head><body>
<h1>ASR test (Bahasa Melayu)</h1>
<p class="sub">Records audio in your browser → uploads to backend → calls Alibaba qwen3-asr-flash → shows transcript.</p>
<nav>
  <a href="/sim">Testers</a>
  <a href="/sim/merchant">Checkout</a>
  <a href="/sim/chat">Chatbot</a>
  <a href="/sim/asr-test" style="color:#111827; font-weight:600">ASR test</a>
</nav>

<div class="phrases">
  <strong>Try saying:</strong>
  <ul>
    <li>"Berapa duit saya hari ini?"</li>
    <li>"Tolong tambah anak saya, Adam, nombor 0123456789"</li>
    <li>"Macam mana check my balance?" (code-switched)</li>
    <li>"Hello, what's my spending today?" (English sanity check)</li>
  </ul>
</div>

<div class="panel" style="text-align:center; margin-top:14px">
  <button id="rec-btn">🎙 Tap to record</button>
  <div class="duration" id="duration">0.0s</div>
  <div class="meta" id="meta"></div>
  <div class="audios" id="audios"></div>
</div>

<div class="panel">
  <strong>Transcript</strong>
  <div class="transcript" id="transcript"></div>
  <details style="margin-top:10px"><summary style="cursor:pointer; color:#666; font-size:12px">raw response</summary>
  <pre id="raw"></pre>
  </details>
</div>

<script>
let mediaRecorder = null;
let chunks = [];
let startedAt = 0;
let timerId = null;
let recording = false;

const btn = document.getElementById('rec-btn');
const dur = document.getElementById('duration');
const meta = document.getElementById('meta');
const audios = document.getElementById('audios');
const transcript = document.getElementById('transcript');
const raw = document.getElementById('raw');

function fmtDuration(ms) { return (ms / 1000).toFixed(1) + 's'; }

async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    alert('Your browser does not support MediaRecorder. Try Chrome or Safari.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      audios.innerHTML = '<audio controls src="' + audioUrl + '"></audio>';
      meta.textContent = mediaRecorder.mimeType + ' · ' + (blob.size / 1024).toFixed(1) + ' KB · ' + fmtDuration(Date.now() - startedAt);
      await uploadAndTranscribe(blob);
    };
    mediaRecorder.start();
    recording = true;
    startedAt = Date.now();
    btn.textContent = '⏹ Stop';
    btn.classList.add('recording');
    timerId = setInterval(() => { dur.textContent = fmtDuration(Date.now() - startedAt); }, 100);
  } catch (e) {
    alert('Microphone access denied: ' + e.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  clearInterval(timerId);
  recording = false;
  btn.textContent = '🎙 Tap to record';
  btn.classList.remove('recording');
}

async function uploadAndTranscribe(blob) {
  transcript.textContent = '';
  raw.textContent = 'Transcribing...';
  btn.disabled = true;
  try {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const res = await fetch('/sim/asr-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, mime: blob.type }),
    });
    const json = await res.json();
    if (json.transcript) {
      transcript.textContent = json.transcript;
    } else {
      transcript.textContent = '(no transcript) ' + (json.error || '');
    }
    raw.textContent = JSON.stringify(json.raw ?? json, null, 2);
  } catch (e) {
    transcript.textContent = 'Network error: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener('click', () => {
  if (recording) stopRecording();
  else startRecording();
});
</script>
</body></html>`;
  }

  @Get('chat')
  @Header('Content-Type', 'text/html; charset=utf-8')
  chatPage() {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>myWally - chatbot demo</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 720px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { margin: 0; font-size: 22px; }
  .sub { color: #666; margin: 4px 0 16px; font-size: 13px; }
  nav { margin-bottom: 16px; font-size: 13px; }
  nav a { color: #2563eb; text-decoration: none; margin-right: 14px; }
  nav a.active { color: #111827; font-weight: 600; }
  .panel { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; margin-bottom: 14px; background: #fff; }
  .panel h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  select, input { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; box-sizing: border-box; }
  select { width: 100%; }
  .row { display: flex; gap: 8px; align-items: center; }
  button { padding: 8px 14px; border: 0; border-radius: 8px; background: #111827; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: wait; }
  .tools { display: flex; flex-wrap: wrap; gap: 6px; }
  .tool-chip { font-size: 11px; padding: 4px 8px; background: #ede9fe; color: #5b21b6; border-radius: 999px; }
  .chat { height: 400px; overflow-y: auto; padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 12px; }
  .msg { margin: 8px 0; max-width: 80%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .msg.user { background: #2563eb; color: #fff; margin-left: auto; border-bottom-right-radius: 4px; }
  .msg.assistant { background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }
  .action-card { margin-top: 6px; padding: 8px 12px; border-radius: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; font-size: 12px; }
  .action-card.error { background: #fef2f2; border-color: #fecaca; }
  .action-card pre { margin: 4px 0 0; font-size: 11px; color: #065f46; white-space: pre-wrap; }
  .action-card.error pre { color: #991b1b; }
  .composer { display: flex; gap: 8px; }
  .composer input { flex: 1; }
  .empty { text-align: center; color: #6b7280; padding: 40px 20px; font-size: 13px; }
  .meta { font-size: 11px; color: #9ca3af; margin-top: 4px; }
  .toast-stack { position: fixed; top: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 100; }
  .toast { padding: 10px 14px; background: #111827; color: #fff; border-radius: 8px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: slide 0.2s; }
  .toast.success { background: #059669; }
  .toast.error { background: #dc2626; }
  @keyframes slide { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head><body>
<h1>myWally chatbot</h1>
<p class="sub">LLM-powered, role-aware. Pick a tester to act as, then chat. Tools shown are filtered by role/permissions.</p>
<nav>
  <a href="/sim">Testers</a>
  <a href="/sim/merchant">My checkout</a>
  <a href="/sim/chat" class="active">Chatbot</a>
  <a href="/docs" target="_blank">API docs</a>
</nav>

<div class="panel">
  <h3>Acting as</h3>
  <div class="row" style="gap:8px">
    <select id="user-select"><option value="">Loading...</option></select>
    <button id="reload-tools">↻</button>
  </div>
  <div id="user-meta" class="meta"></div>
  <div id="tools-list" class="tools" style="margin-top:10px"></div>
</div>

<div class="chat" id="chat">
  <div class="empty">Send a message to start. Try things like "what's my balance" or "add my daughter Aishah, +60123456789".</div>
</div>

<form class="composer" id="composer">
  <input id="text" placeholder="Type a message or tap mic..." autocomplete="off" />
  <button type="button" id="mic" title="Hold mic to speak (Bahasa Melayu / English)">🎙</button>
  <button type="submit" id="send">Send</button>
</form>
<div id="rec-status" style="font-size:12px; color:#dc2626; margin-top:6px; min-height:18px"></div>

<details class="panel" style="margin-top:24px">
  <summary style="cursor:pointer; font-weight:600; font-size:13px">📋 Integration prompt for your FE colleague (Next.js)</summary>
  <p style="font-size:12px; color:#6b7280; margin:12px 0 8px">Copy and paste this into Claude Code, Cursor, or any AI coding assistant working on the Next.js frontend. The base URL is filled in from this server.</p>
  <div class="row" style="gap:8px; margin-bottom:8px">
    <button id="copy-prompt" type="button">Copy prompt to clipboard</button>
    <span id="copy-status" style="font-size:12px; color:#059669"></span>
  </div>
  <textarea id="integration-prompt" readonly style="width:100%; height:380px; font-family:ui-monospace,Monaco,monospace; font-size:11px; padding:12px; border:1px solid #d1d5db; border-radius:8px; box-sizing:border-box; resize:vertical"></textarea>
</details>

<div class="toast-stack" id="toasts"></div>

<script>
let token = null;
let history = [];
let users = [];

function $(id) { return document.getElementById(id); }

function renderToast(t) {
  const el = document.createElement('div');
  el.className = 'toast ' + (t.level || 'success');
  el.textContent = t.message || t.kind;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function renderUiHints(ui) {
  for (const hint of ui || []) {
    if (hint.kind === 'toast') renderToast(hint);
  }
}

function appendMessage(role, text, actions) {
  const empty = $('chat').querySelector('.empty');
  if (empty) empty.remove();
  const wrap = document.createElement('div');
  wrap.style.cssText = role === 'user' ? 'text-align:right' : 'text-align:left';
  const bubble = document.createElement('div');
  bubble.className = 'msg ' + role;
  bubble.style.display = 'inline-block';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  if (actions && actions.length) {
    for (const a of actions) {
      const card = document.createElement('div');
      card.className = 'action-card' + (a.status === 'success' ? '' : ' error');
      card.innerHTML = '<strong>' + a.type + '</strong> · ' + a.status +
        (a.data ? '<pre>' + JSON.stringify(a.data, null, 2) + '</pre>' : '') +
        (a.error ? '<pre>' + a.error + '</pre>' : '');
      wrap.appendChild(card);
    }
  }
  $('chat').appendChild(wrap);
  $('chat').scrollTop = $('chat').scrollHeight;
}

async function loadUsers() {
  const res = await fetch('/families');
  const families = await res.json();
  users = [];
  for (const f of families) {
    users.push({ id: f.parent.id, label: f.parent.fullName + ' (parent of family ' + f.familyId.slice(0,8) + ')' });
    if (f.guardian) users.push({ id: f.guardian.id, label: f.guardian.fullName + ' · ' + f.guardian.relationshipLabel + ' (guardian)' });
  }
  $('user-select').innerHTML = users.map(u => '<option value="' + u.id + '">' + u.label + '</option>').join('');
  if (users.length) selectUser(users[0].id);
}

async function mintToken(userId) {
  const res = await fetch('/auth/tokens', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const json = await res.json();
  return json.token;
}

async function loadTools() {
  if (!token) return;
  const res = await fetch('/me/chat/tools', { headers: { Authorization: 'Bearer ' + token } });
  const json = await res.json();
  $('tools-list').innerHTML = json.tools.map(t =>
    '<span class="tool-chip" title="' + t.description.replace(/"/g, '&quot;') + '">' + t.name + '</span>'
  ).join('');
}

async function selectUser(userId) {
  token = await mintToken(userId);
  const meRes = await fetch('/me', { headers: { Authorization: 'Bearer ' + token } });
  const me = await meRes.json();
  $('user-meta').textContent = me.role + ' · ' + me.fullName + ' (' + me.phone + ')';
  history = [];
  $('chat').innerHTML = '<div class="empty">Send a message to start.</div>';
  await loadTools();
}

async function sendMessage(text) {
  appendMessage('user', text);
  history.push({ role: 'user', content: text });
  $('text').value = '';
  $('send').disabled = true;
  try {
    const res = await fetch('/me/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ text, history: history.slice(0, -1) }),
    });
    const json = await res.json();
    if (json.statusCode && json.statusCode !== 200) {
      appendMessage('assistant', 'Error: ' + (json.message || 'request failed'), []);
      return;
    }
    appendMessage('assistant', json.reply.text, json.actions);
    history.push({ role: 'assistant', content: json.reply.text });
    renderUiHints(json.ui);
    if (json.actions && json.actions.length) {
      // refresh the tool list in case permissions changed
      await loadTools();
    }
  } catch (e) {
    appendMessage('assistant', 'Network error: ' + e.message, []);
  } finally {
    $('send').disabled = false;
    $('text').focus();
  }
}

$('user-select').addEventListener('change', (e) => selectUser(e.target.value));
$('reload-tools').addEventListener('click', loadTools);
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('text').value.trim();
  if (t) sendMessage(t);
});

// ===== Voice (mic) =====
let mediaRecorder = null;
let chunks = [];
let micRecording = false;

async function startMic() {
  if (!token) { alert('Pick a user first'); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    alert('Browser does not support microphone recording.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      await sendVoiceBlob(blob);
    };
    mediaRecorder.start();
    micRecording = true;
    $('mic').classList.add('recording');
    $('mic').textContent = '⏹';
    $('rec-status').textContent = 'Recording... tap mic again to stop';
  } catch (e) {
    alert('Mic access denied: ' + e.message);
  }
}

function stopMic() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  micRecording = false;
  $('mic').classList.remove('recording');
  $('mic').textContent = '🎙';
  $('rec-status').textContent = 'Transcribing... (Alibaba qwen3-asr-flash)';
}

async function sendVoiceBlob(blob) {
  $('send').disabled = true;
  $('mic').disabled = true;
  appendMessage('user', '🎙 (voice note...)', null);
  try {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const res = await fetch('/me/chat/messages/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ audio: base64, mime: blob.type, history: history.slice() }),
    });
    const json = await res.json();
    $('rec-status').textContent = '';
    // Replace the placeholder voice-note bubble with the actual transcript
    const chatEl = $('chat');
    const lastWrap = chatEl.lastElementChild;
    if (lastWrap && lastWrap.querySelector('.msg.user')) {
      lastWrap.querySelector('.msg.user').textContent = json.transcript ? '🎙 ' + json.transcript : '🎙 (could not transcribe)';
    }
    if (json.transcript) {
      history.push({ role: 'user', content: json.transcript });
    }
    if (json.reply && json.reply.text) {
      appendMessage('assistant', json.reply.text, json.actions);
      history.push({ role: 'assistant', content: json.reply.text });
      renderUiHints(json.ui);
    }
    if (json.asrError) {
      $('rec-status').textContent = 'ASR error: ' + json.asrError;
    }
  } catch (e) {
    $('rec-status').textContent = 'Network error: ' + e.message;
  } finally {
    $('send').disabled = false;
    $('mic').disabled = false;
  }
}

$('mic').addEventListener('click', () => {
  if (micRecording) stopMic();
  else startMic();
});

// Build the integration prompt with the live base URL
const PROMPT = \`You are integrating the myWally chatbot API into a Next.js 15+ App Router app (TypeScript, server components where possible).

# API base URL
\${window.location.origin}

# Auth (hackathon dev-mode)
POST /auth/tokens
Body: { "userId": "<uuid>" }
Returns: { "token": "<jwt>", "tokenType": "Bearer", "user": { "id", "role", "fullName", "phone" } }

The token is a JWT. Use it as: Authorization: Bearer <token>
Roles: PARENT | GUARDIAN. Tools the chatbot exposes are filtered by role + per-guardianship permissions.

# Endpoints to integrate

GET /me                                Bearer    user profile
GET /me/dashboard                      Bearer    BFF for the home screen (greeting, balance, members[])
GET /me/budget                         Bearer    family budget (amount, period, warningThresholdPercent)
PUT /me/budget                         Bearer    update budget (parent only)
GET /me/members/:guardianshipId        Bearer    BFF for the member-detail screen
GET /me/chat/tools                     Bearer    list tools the LLM can call for this user
POST /me/chat/messages                 Bearer    SEND A CHATBOT MESSAGE
GET /families                          public    list of demo families (use to pick a userId for /auth/tokens)
GET /families/:id                      public    single family
PATCH /guardianships/:id               Bearer    update a member (relationshipLabel, permissions)
DELETE /guardianships/:id              Bearer    revoke a member (soft delete)
POST /transactions                     public    submit a payment for risk evaluation (TNG-shaped)
GET /transactions/:id                  public    poll transaction state

# Chat message contract (the heart of the integration)

POST /me/chat/messages
Headers: Authorization: Bearer <token>
Body:
{
  "text": "Add my daughter Aishah, +60123456789",
  "history": [
    { "role": "user", "content": "previous message" },
    { "role": "assistant", "content": "previous reply" }
  ]
}

Response (always 200 unless auth fails):
{
  "reply": { "role": "assistant", "text": "Got it. I've added Aishah." },
  "actions": [
    {
      "type": "ADD_FAMILY_MEMBER",
      "tool": "add_family_member",
      "status": "success" | "error" | "denied",
      "data": { /* tool-specific payload */ },
      "error": "..."  // only if status != success
    }
  ],
  "ui": [
    { "kind": "toast", "level": "success", "message": "Added Aishah as Daughter" },
    { "kind": "refresh", "resource": "/me/dashboard" },
    { "kind": "navigate", "to": "/somewhere" }
  ],
  "llm": { "provider": "bedrock" | "alibaba" | "anthropic" | "moonshot", "configured": true }
}

The server is STATELESS for chat. The frontend keeps history and sends the last ~20 messages on each request.

The chat uses an **agentic multi-turn loop** server-side: when the user message triggers a tool, the backend executes the tool, sends the result back to the LLM, and the LLM produces a final narrated reply. This means a single POST may take 2-6 seconds depending on provider/model. Show a typing indicator. Don't time out under 30s.

LLM provider is configurable server-side (one of: bedrock, alibaba, anthropic, moonshot). The frontend doesn't care which one is active — same response shape across all four. Read response.llm.provider if you want to display "Powered by ..." somewhere.

# What to build

1. /lib/api.ts - typed fetch wrapper that injects Bearer header and parses errors.
2. /lib/types.ts - TypeScript types for ChatResponse, ChatAction, UiHint, MeDashboard, Budget, Member.
3. /hooks/useChat.ts - React hook that manages history, optimistically appends user message, calls /me/chat/messages, appends assistant reply + handles ui hints.
4. /components/Chatbot.tsx - presentational component:
   - Message list (user right, assistant left)
   - For each assistant message, if it has actions render an inline card showing tool name + status + key fields from data
   - Composer with input + send button
   - Disable send while in flight
5. UI hint handling (in the hook):
   - kind=toast → call sonner.toast[level || 'info'](message)
   - kind=refresh → queryClient.invalidateQueries({ queryKey: [resource] })
   - kind=navigate → router.push(to)
6. Auth: store the token in a httpOnly cookie via a /api/auth/login route handler that proxies to POST /auth/tokens. Don't store JWT in localStorage in production.

# Stack assumptions
- Next.js 15+ App Router, TypeScript strict
- TanStack Query v5 for fetch state
- shadcn/ui (button, input, card, scroll-area)
- sonner for toasts
- zod for response validation

# Edge cases to handle
- llm.configured === false → show "Chatbot offline, please contact admin" banner. The reply.text in this case explains which tools the user could otherwise use, so you can render it as a text bubble unchanged.
- actions with status='denied' → render with red treatment, message "You don't have permission for this"
- actions with status='error' → show error message from action.error
- 401 from any endpoint → redirect to login (token expired)
- Assistant text contains real \\n newlines for lists. Render with whitespace-pre-wrap (Tailwind) on the bubble container so line breaks display correctly.

# Rich card rendering

Some tools return structured data the FE should render as rich cards INSIDE the chat thread, not just as raw JSON.
Pattern: read action.tool, switch on tool name, render a custom component using action.data.

Tools currently shipped (read GET /me/chat/tools to see what your role is allowed):
- get_spending_summary  → render a "Today's Progress" card (or weekly/monthly based on data.period). Show: spent, budget, remaining, a progress bar at percentUsed (color shifts at warningThresholdPercent), and the period label.
- list_family_members   → render a list of avatar rows with name + relationshipLabel, tap-through to /members/:guardianshipId.
- add_family_member     → render a confirmation card with the new member's name, phone, and "View" CTA linking to their detail page.
- set_budget            → render a small "Budget updated" card showing the new amount + period.
- get_balance           → render a balance pill or hero card.

Server returns BOTH a narrated text reply AND the structured action. The FE composition is typically:
  1. Assistant text bubble
  2. Inline rich card from action.data
  3. (Optional) The next assistant text bubble if the LLM continues with a follow-up

Render order: text bubble first, then for each action in actions[], render the card matching action.tool. If unknown tool, fall back to a generic "Tool ran: <name>" pill.

# Style
The mobile screens are warm/orange/purple, friendly elderly-first design. Big tap targets, generous whitespace, large readable type. Keep the chatbot bubble UI simple and accessible.

Generate the files now. Include any UI utilities you need. Use server-side data fetching where it makes sense (initial dashboard load) and client components for the chat itself.
\`;

$('integration-prompt').value = PROMPT;
$('copy-prompt').addEventListener('click', async () => {
  await navigator.clipboard.writeText(PROMPT);
  $('copy-status').textContent = 'Copied!';
  setTimeout(() => $('copy-status').textContent = '', 2000);
});

loadUsers();
</script>
</body></html>`;
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  indexPage() {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>myWally - testers</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { margin: 0; font-size: 22px; }
  .sub { color: #666; margin: 4px 0 24px; font-size: 14px; }
  nav { margin-bottom: 16px; font-size: 13px; }
  nav a { color: #2563eb; text-decoration: none; margin-right: 14px; }
  nav a.active { color: #111827; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 10px; background: #fff; }
  .row .col { flex: 1; min-width: 0; }
  .row h3 { margin: 0 0 2px; font-size: 15px; }
  .row p { margin: 0; color: #6b7280; font-size: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f3f4f6; color: #374151; font-size: 11px; }
  .pill.live { background: #ecfdf5; color: #065f46; }
  .pill.held { background: #fef3c7; color: #92400e; }
  .pill.blocked { background: #fee2e2; color: #991b1b; }
  button, a.btn { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #111827; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }
  button.primary, a.btn.primary { background: #111827; color: #fff; border-color: #111827; }
  .actions { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
  .empty { text-align: center; padding: 40px 20px; color: #6b7280; border: 1px dashed #e5e7eb; border-radius: 12px; }
  .empty a { color: #2563eb; text-decoration: none; font-weight: 600; }
</style>
</head><body>
<h1>myWally testers</h1>
<p class="sub">Everyone who's onboarded a family in this demo environment.</p>
<nav>
  <a href="/sim" class="active">Testers</a>
  <a href="/sim/merchant">My checkout</a>
  <a href="/sim/chat">Chatbot</a>
  <a href="/docs" target="_blank">API docs</a>
</nav>

<div id="list">Loading...</div>

<script>
function stateBadge(s) {
  if (!s) return '';
  if (['RELEASED'].includes(s)) return '<span class="pill live">' + s + '</span>';
  if (['HELD','CALLING','NOTIFIED','SCORED','RECEIVED'].includes(s)) return '<span class="pill held">' + s + '</span>';
  if (['BLOCKED','ABORTED'].includes(s)) return '<span class="pill blocked">' + s + '</span>';
  return '<span class="pill">' + s + '</span>';
}
function fmt(d) { return new Date(d).toLocaleString(); }

async function load() {
  const res = await fetch('/families');
  const families = await res.json();
  if (!families.length) {
    document.getElementById('list').innerHTML =
      '<div class="empty">No testers yet. <a href="/sim/merchant">Be the first.</a></div>';
    return;
  }
  document.getElementById('list').innerHTML = families.map(f => {
    const tx = f.latestTransaction;
    const isBlocked = tx && (tx.state === 'BLOCKED' || tx.state === 'ABORTED');
    const guardianLabel = f.guardian ? f.guardian.fullName + ' · ' + (f.guardian.relationshipLabel || 'Guardian') + ' (' + f.guardian.phone + ')' : 'none';
    return \`
    <div class="row">
      <div class="col">
        <h3>\${f.parent.fullName} <span style="color:#9ca3af; font-weight:400">·</span> RM \${f.balance}</h3>
        <p>guardian: \${guardianLabel}</p>
        <p>onboarded \${fmt(f.createdAt)} \${tx ? '· last txn ' + stateBadge(tx.state) + ' ' + fmt(tx.createdAt) : ''}</p>
      </div>
      <div class="actions">
        <button class="jwt-btn" data-uid="\${f.parent.id}" data-name="\${f.parent.fullName} (parent)">JWT (parent)</button>
        \${f.guardian ? '<button class="jwt-btn" data-uid="' + f.guardian.id + '" data-name="' + f.guardian.fullName + ' (guardian)">JWT (guardian)</button>' : ''}
        \${isBlocked ? '<button class="unblock-btn" data-tx="' + tx.id + '">Unblock</button>' : ''}
        <a class="btn" href="/sim/budget?familyId=\${encodeURIComponent(f.familyId)}">Budget</a>
        <a class="btn primary" href="/sim/merchant?familyId=\${encodeURIComponent(f.familyId)}">Use this</a>
      </div>
    </div>
    \`;
  }).join('');

  document.querySelectorAll('.unblock-btn').forEach(b => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = '...';
      await fetch('/transactions/' + b.dataset.tx + '/unblock', { method: 'POST' });
      load();
    });
  });

  document.querySelectorAll('.jwt-btn').forEach(b => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      const orig = b.textContent;
      b.textContent = '...';
      try {
        const res = await fetch('/auth/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: b.dataset.uid }),
        });
        const json = await res.json();
        showJwtModal(b.dataset.name, json);
      } finally {
        b.disabled = false;
        b.textContent = orig;
      }
    });
  });
}

function showJwtModal(label, json) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:50';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff; padding:20px; border-radius:12px; max-width:580px; width:90%; max-height:80vh; overflow:auto';
  box.innerHTML =
    '<h3 style="margin:0 0 8px">JWT for ' + label + '</h3>' +
    '<p style="font-size:13px; color:#6b7280; margin:0 0 12px">Use as <code>Authorization: Bearer &lt;token&gt;</code> against /me, /me/dashboard, etc.</p>' +
    '<textarea readonly style="width:100%; height:120px; font-family:ui-monospace,Monaco,monospace; font-size:11px; padding:8px; border:1px solid #d1d5db; border-radius:6px">' + json.token + '</textarea>' +
    '<div style="display:flex; gap:8px; margin-top:12px">' +
    '<button id="m-copy">Copy token</button>' +
    '<button id="m-curl">Copy curl + run</button>' +
    '<button id="m-close" style="margin-left:auto">Close</button>' +
    '</div>' +
    '<pre id="m-resp" style="margin-top:12px; display:none; background:#f9fafb; padding:12px; border-radius:8px; font-size:11px; overflow:auto"></pre>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  box.querySelector('#m-close').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  box.querySelector('#m-copy').onclick = () => {
    navigator.clipboard.writeText(json.token);
    box.querySelector('#m-copy').textContent = 'Copied!';
  };
  box.querySelector('#m-curl').onclick = async () => {
    const cmd = "curl " + window.location.origin + "/me/dashboard -H 'Authorization: Bearer " + json.token + "'";
    navigator.clipboard.writeText(cmd);
    box.querySelector('#m-curl').textContent = 'Copied! Loading...';
    const pre = box.querySelector('#m-resp');
    pre.style.display = 'block';
    pre.textContent = 'Loading...';
    const r = await fetch('/me/dashboard', { headers: { Authorization: 'Bearer ' + json.token } });
    pre.textContent = JSON.stringify(await r.json(), null, 2);
  };
}

load();
setInterval(load, 5000);
</script>
</body></html>`;
  }

  @Get('merchant')
  @Header('Content-Type', 'text/html; charset=utf-8')
  merchantPage() {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TNG Simulator - myWally demo</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 540px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { margin: 0; font-size: 22px; }
  .sub { color: #666; margin: 4px 0 24px; font-size: 14px; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 14px; background: #fff; }
  .card h3 { margin: 0 0 4px; font-size: 16px; }
  .card p { margin: 0 0 14px; color: #555; font-size: 14px; line-height: 1.4; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
  .badge.safe { background: #ecfdf5; color: #065f46; }
  .badge.warn { background: #fef3c7; color: #92400e; }
  .badge.danger { background: #fee2e2; color: #991b1b; }
  button { width: 100%; padding: 12px 16px; border: 0; border-radius: 8px; background: #111827; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #000; }
  button:disabled { opacity: 0.5; cursor: wait; }
  button.secondary { background: #fff; color: #111827; border: 1px solid #d1d5db; }
  #mic { background: #fff; color: #111827; border: 1px solid #d1d5db; padding: 0 14px; }
  #mic.recording { background: #dc2626; color: #fff; border-color: #dc2626; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  pre { background: #f9fafb; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
  .hint { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .me { font-size: 13px; color: #374151; margin-bottom: 14px; }
  .me strong { color: #111827; }
</style>
</head><body>
<h1>myWally x TNG</h1>
<p class="sub">A safety net for at-risk transactions. Built for the TouchNGo hackathon.</p>
<nav style="margin-bottom:16px; font-size:13px">
  <a href="/sim" style="color:#2563eb; text-decoration:none; margin-right:14px">Testers</a>
  <a href="/sim/merchant" style="color:#111827; text-decoration:none; font-weight:600; margin-right:14px">My checkout</a>
  <a href="/sim/chat" style="color:#2563eb; text-decoration:none; margin-right:14px">Chatbot</a>
  <a href="/docs" target="_blank" style="color:#2563eb; text-decoration:none">API docs</a>
</nav>

<section id="onboard" class="card" style="display:none">
  <h3>1. Onboard your family</h3>
  <p>Create a family with you as the guardian. The phone you enter will receive the actual call when you submit a risky transaction.</p>
  <label>Parent's name (will be spoken in the call)</label>
  <input id="parentName" placeholder="Encik Rahmat" />
  <label>Your name (guardian)</label>
  <input id="guardianName" placeholder="Nur Radhiah" />
  <label>Your phone (E.164)</label>
  <input id="guardianPhone" placeholder="+60138155761" />
  <p class="hint">Format: country code with +, no spaces. e.g. +60138155761</p>
  <label>Relationship</label>
  <input id="relationshipLabel" placeholder="Daughter" />
  <button id="btn-onboard" style="margin-top:16px">Create family and continue</button>
</section>

<section id="merchant" style="display:none">
  <p class="me">Logged in as <strong id="parentLabel">-</strong>. Guardian: <strong id="guardianLabel">-</strong>. <a href="#" id="reset" style="color:#6b7280; font-size:12px">switch family</a></p>

  <div class="card">
    <span class="badge safe">Safe</span>
    <h3>Pay Aunty Kak Tini RM 30 - kuih</h3>
    <p>Repeat recipient. Small amount. Should auto-pass without bothering anyone.</p>
    <button data-scenario="safe">Send RM 30</button>
  </div>

  <div class="card">
    <span class="badge warn">Halt</span>
    <h3>Transfer RM 1500 to Maybank ****1234</h3>
    <p>First-time recipient, large amount. myWally will halt and call your guardian.</p>
    <button data-scenario="halt">Send RM 1,500</button>
  </div>

  <div class="card">
    <span class="badge danger">Scammy</span>
    <h3>Top up RM 800 to "Binance Wallet"</h3>
    <p>First-time + crypto destination. High score. Halts immediately.</p>
    <button data-scenario="crypto">Send RM 800</button>
  </div>

  <div id="status" style="display:none">
    <h3 style="margin:24px 0 8px">Live transaction status</h3>
    <div class="card" id="status-card">
      <p><strong>State:</strong> <span id="state">-</span></p>
      <p><strong>Risk score:</strong> <span id="score">-</span> &middot; <span id="reasons">-</span></p>
      <p id="msg" style="font-size:14px; color:#374151"></p>
      <button id="btn-unblock" class="secondary" style="display:none; margin-top:8px">Override &amp; unblock</button>
    </div>
  </div>
  <details style="margin-top:16px"><summary style="cursor:pointer; color:#666; font-size:12px">raw JSON</summary>
  <pre id="out">Awaiting transaction...</pre>
  </details>
</section>

<script>
const TERMINAL = ['RELEASED', 'BLOCKED', 'ABORTED'];
let pollTimer = null;
let currentTxId = null;
const STORAGE_KEY = 'mywally_family_v1';

function $(id) { return document.getElementById(id); }
function showOnboard() { $('onboard').style.display = 'block'; $('merchant').style.display = 'none'; }
function showMerchant(family) {
  $('parentLabel').textContent = family.parent.fullName;
  $('guardianLabel').textContent = family.guardian.fullName + ' (' + family.guardian.phone + ')';
  $('onboard').style.display = 'none';
  $('merchant').style.display = 'block';
}

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('familyId');
  if (fromUrl) {
    const res = await fetch('/families/' + fromUrl);
    const json = await res.json();
    if (!json.error && json.guardian) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ familyId: fromUrl }));
      history.replaceState({}, '', '/sim/merchant');
      return showMerchant(json);
    }
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return showOnboard();
  try {
    const { familyId } = JSON.parse(stored);
    const res = await fetch('/families/' + familyId);
    const json = await res.json();
    if (json.error || !json.guardian) {
      localStorage.removeItem(STORAGE_KEY);
      return showOnboard();
    }
    showMerchant(json);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    showOnboard();
  }
}

async function onboard() {
  const btn = $('btn-onboard');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  try {
    const res = await fetch('/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentName: $('parentName').value.trim() || 'Mama',
        guardianName: $('guardianName').value.trim() || 'Adam',
        guardianPhone: $('guardianPhone').value.trim(),
        relationshipLabel: $('relationshipLabel').value.trim() || undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.familyId) {
      alert((json.message && JSON.stringify(json.message)) || 'Failed: ' + JSON.stringify(json));
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ familyId: json.familyId }));
    showMerchant({ familyId: json.familyId, parent: json.parent, guardian: json.guardian });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create family and continue';
  }
}

const SCENARIOS = {
  safe:   { amount: 30,   recipientName: 'Aunty Kak Tini',         recipientHandle: 'TNG ewallet user 60123456789', merchantCategory: 'food',     isFirstTimeRecipient: false },
  halt:   { amount: 1500, recipientName: 'Unknown Maybank Account', recipientHandle: 'MAYBANK ****1234',             merchantCategory: 'transfer', isFirstTimeRecipient: true },
  crypto: { amount: 800,  recipientName: 'Binance Wallet',          recipientHandle: 'binance crypto exchange',      merchantCategory: 'crypto',   isFirstTimeRecipient: true },
};

function badge(state) {
  const colors = {
    RECEIVED: '#6b7280', SCORED: '#6b7280',
    HELD: '#d97706', CALLING: '#d97706', NOTIFIED: '#d97706',
    RELEASED: '#059669', BLOCKED: '#dc2626', ABORTED: '#dc2626',
  };
  return '<span style="color:' + (colors[state] || '#000') + '; font-weight:600">' + state + '</span>';
}

function render(json) {
  currentTxId = json.transactionId || currentTxId;
  $('status').style.display = 'block';
  $('state').innerHTML = badge(json.state);
  $('score').textContent = json.riskScore ?? '-';
  $('reasons').textContent = (json.riskReasons || []).join(', ') || 'no flags';
  let msg = '';
  let canUnblock = false;
  if (['HELD','CALLING','NOTIFIED'].includes(json.state)) {
    msg = '⏳ Calling your guardian. Pick up the phone, enter PIN 1234, then press 1, 9, or 5.';
  } else if (json.state === 'RELEASED') {
    msg = '✅ Approved. Transaction goes through.';
  } else if (json.state === 'BLOCKED') {
    msg = '🛑 Rejected by guardian. Account frozen 24h.';
    canUnblock = true;
  } else if (json.state === 'ABORTED') {
    msg = '⚠️ No response from guardian. Defaulted to reject.';
    canUnblock = true;
  }
  $('msg').textContent = msg;
  $('btn-unblock').style.display = canUnblock ? 'inline-block' : 'none';
  $('out').textContent = JSON.stringify(json, null, 2);
}

async function poll(txId) {
  try {
    const res = await fetch('/transactions/' + txId);
    const json = await res.json();
    render(json);
    if (TERMINAL.includes(json.state)) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch {}
}

async function unblockCurrent() {
  if (!currentTxId) return;
  const btn = $('btn-unblock');
  btn.disabled = true;
  btn.textContent = 'Unblocking...';
  try {
    await fetch('/transactions/' + currentTxId + '/unblock', { method: 'POST' });
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => poll(currentTxId), 1000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Override & unblock';
  }
}

async function send(scenario, btn) {
  btn.disabled = true;
  if (pollTimer) clearInterval(pollTimer);
  $('out').textContent = 'Submitting transaction...';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) { showOnboard(); btn.disabled = false; return; }
  const { familyId } = JSON.parse(stored);
  try {
    const payload = { externalRef: 'sim-' + Date.now(), familyId, currency: 'MYR', ...SCENARIOS[scenario] };
    const res = await fetch('/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    render(json);
    if (json.transactionId && !TERMINAL.includes(json.state)) {
      pollTimer = setInterval(() => poll(json.transactionId), 1000);
    }
  } catch (e) {
    $('out').textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

$('btn-onboard').addEventListener('click', onboard);
$('reset').addEventListener('click', (e) => { e.preventDefault(); localStorage.removeItem(STORAGE_KEY); showOnboard(); });
$('btn-unblock').addEventListener('click', unblockCurrent);
document.querySelectorAll('button[data-scenario]').forEach(b => {
  b.addEventListener('click', () => send(b.dataset.scenario, b));
});

bootstrap();
</script>
</body></html>`;
  }

  @Get('budget')
  @Header('Content-Type', 'text/html; charset=utf-8')
  budgetPage() {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>myWally - family budget (sim)</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 540px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { margin: 0; font-size: 22px; }
  .sub { color: #666; margin: 4px 0 24px; font-size: 14px; }
  nav { margin-bottom: 16px; font-size: 13px; }
  nav a { color: #2563eb; text-decoration: none; margin-right: 14px; }
  nav a.active { color: #111827; font-weight: 600; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 14px; background: #fff; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
  input, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
  .hint { font-size: 12px; color: #6b7280; margin-top: 4px; }
  button { width: 100%; padding: 12px 16px; border: 0; border-radius: 8px; background: #111827; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 12px; }
  button.secondary { background: #fff; color: #111827; border: 1px solid #d1d5db; }
  button.danger { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  button:disabled { opacity: 0.5; cursor: wait; }
  pre { background: #f9fafb; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; }
  .stat { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
  .stat:last-child { border: 0; }
  .stat strong { color: #111827; }
</style>
</head><body>
<h1>Family budget (sim)</h1>
<p class="sub">Edit budget + auto-approve. Reset transactions to clear spending history.</p>
<nav>
  <a href="/sim">Testers</a>
  <a href="/sim/merchant">Merchant</a>
  <a href="/sim/chat">Chatbot</a>
  <a href="/sim/budget" class="active">Budget</a>
</nav>

<div id="status" class="card">Loading...</div>

<form id="form" class="card" style="display:none">
  <h3 style="margin:0 0 4px">Limits</h3>
  <p style="color:#6b7280; font-size:13px; margin:0 0 12px">Risk engine reads these for every transaction.</p>

  <label>Daily auto-approve limit (RM)</label>
  <input id="autoApprove" type="number" min="0" step="1"/>
  <p class="hint">Transactions at or below this amount auto-pass without alerting the guardian. Crypto destinations always halt regardless.</p>

  <label>Budget cap (RM)</label>
  <input id="budgetAmount" type="number" min="0" step="1"/>
  <p class="hint">When period spending + this transaction exceeds the cap, risk score gets +30 (likely halts).</p>

  <label>Period</label>
  <select id="period">
    <option value="DAILY">Daily</option>
    <option value="WEEKLY">Weekly</option>
    <option value="MONTHLY">Monthly</option>
  </select>

  <label>Warning threshold (% of budget)</label>
  <input id="warningThresholdPercent" type="number" min="20" max="100" step="5"/>
  <p class="hint">Informational only. UI can warn the parent at this %.</p>

  <button type="submit">Save</button>
</form>

<div id="spending" class="card" style="display:none">
  <h3 style="margin:0 0 8px">Current period spending</h3>
  <div class="stat"><span>Period start</span><strong id="periodStart">-</strong></div>
  <div class="stat"><span>Spent in period</span><strong id="spent">-</strong></div>
  <div class="stat"><span>Remaining</span><strong id="remaining">-</strong></div>
  <button id="resetBtn" class="danger" style="margin-top:14px">Reset transactions for this family</button>
  <p class="hint">Deletes all transactions, events and decision logs for this family. Sim only. Use this to start a clean demo.</p>
</div>

<pre id="out"></pre>

<script>
const params = new URLSearchParams(location.search);
let familyId = params.get('familyId');

const $ = (id) => document.getElementById(id);

async function load() {
  if (!familyId) {
    $('status').textContent = 'No familyId in URL. Go back to /sim and pick "Budget".';
    return;
  }
  try {
    const [bRes, fRes] = await Promise.all([
      fetch('/families/' + familyId + '/budget'),
      fetch('/families/' + familyId),
    ]);
    if (!bRes.ok) throw new Error('budget ' + bRes.status);
    if (!fRes.ok) throw new Error('family ' + fRes.status);
    const b = await bRes.json();
    const f = await fRes.json();

    $('status').innerHTML = '<strong>' + (f.parent?.fullName || 'Family ' + familyId.slice(0,8)) + '</strong> · familyId <code>' + familyId + '</code>';
    $('autoApprove').value = parseFloat(b.dailyAutoApproveLimit?.value || '0');
    $('budgetAmount').value = parseFloat(b.amount.value);
    $('period').value = b.period;
    $('warningThresholdPercent').value = b.warningThresholdPercent;
    $('form').style.display = 'block';

    await loadSpending();
  } catch (e) {
    $('status').textContent = 'Failed to load: ' + e.message;
  }
}

async function loadSpending() {
  const res = await fetch('/sim/families/' + familyId + '/spending');
  if (!res.ok) return;
  const s = await res.json();
  $('spending').style.display = 'block';
  $('periodStart').textContent = s.periodStart.slice(0,16).replace('T', ' ');
  $('spent').textContent = 'RM ' + s.spent.toFixed(2);
  $('remaining').textContent = 'RM ' + s.remaining.toFixed(2);
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  const body = {
    amount: parseFloat($('budgetAmount').value),
    period: $('period').value,
    warningThresholdPercent: parseInt($('warningThresholdPercent').value, 10),
    dailyAutoApproveLimit: parseFloat($('autoApprove').value),
  };
  const res = await fetch('/families/' + familyId + '/budget', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  $('out').textContent = JSON.stringify(json, null, 2);
  btn.disabled = false;
  btn.textContent = res.ok ? 'Saved ✓' : 'Save';
  if (res.ok) await loadSpending();
});

$('resetBtn').addEventListener('click', async () => {
  if (!confirm('Delete ALL transactions for this family?')) return;
  const btn = $('resetBtn');
  btn.disabled = true;
  btn.textContent = 'Resetting...';
  const res = await fetch('/sim/families/' + familyId + '/reset-transactions', { method: 'POST' });
  const json = await res.json();
  $('out').textContent = JSON.stringify(json, null, 2);
  btn.disabled = false;
  btn.textContent = 'Reset transactions for this family';
  await loadSpending();
});

load();
</script>
</body></html>`;
  }
}

function startOfBudgetPeriodSim(now: Date, period: string): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'DAILY') return d;
  if (period === 'WEEKLY') {
    const day = d.getDay();
    d.setDate(d.getDate() - ((day + 6) % 7));
    return d;
  }
  d.setDate(1);
  return d;
}
