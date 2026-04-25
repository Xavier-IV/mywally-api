/**
 * Test Alibaba ASR for Bahasa Melayu.
 *
 * Usage:
 *   npx ts-node scripts/test-asr.ts <path/to/audio.mp3>
 *
 * Records you should make (~5-10 sec):
 *   - "Berapa duit saya hari ini"
 *   - "Tolong tambah anak saya, Adam, nombor 0123456789"
 *   - Code-switched: "Macam mana check my balance?"
 *
 * Run via QuickTime / Voice Memos / phone, save as mp3/m4a/wav, pass path.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const API_KEY = process.env.ALIBABA_API_KEY;
const NATIVE_URL = 'https://dashscope-intl.aliyuncs.com/api/v1';
const COMPAT_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

if (!API_KEY) {
  console.error('ALIBABA_API_KEY not set');
  process.exit(1);
}

const audioPath = process.argv[2];
if (!audioPath) {
  console.error('Usage: npx ts-node scripts/test-asr.ts <audio-file>');
  process.exit(1);
}
if (!fs.existsSync(audioPath)) {
  console.error(`File not found: ${audioPath}`);
  process.exit(1);
}

const audioBytes = fs.readFileSync(audioPath);
const audioBase64 = audioBytes.toString('base64');
const ext = path.extname(audioPath).slice(1).toLowerCase() || 'mp3';
const mime = ext === 'm4a' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : 'audio/mpeg';

console.log(`Input: ${audioPath} (${audioBytes.length} bytes, ${mime})\n`);

async function tryOpenAITranscriptions(): Promise<string | null> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audioBytes)], { type: mime }), `audio.${ext}`);
  form.append('model', 'qwen3-asr-flash');

  try {
    const res = await fetch(`${COMPAT_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      console.log(`[compat /audio/transcriptions] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const json = await res.json();
    return json.text ?? JSON.stringify(json);
  } catch (e: any) {
    console.log(`[compat /audio/transcriptions] threw: ${e.message}`);
    return null;
  }
}

async function tryMultimodalAudioInput(): Promise<string | null> {
  // Qwen3-Omni / Audio understanding pattern: pass audio in messages content
  try {
    const res = await fetch(`${NATIVE_URL}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3-asr-flash',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { audio: `data:${mime};base64,${audioBase64}` },
                { text: 'Transcribe the audio verbatim. Return only the spoken words.' },
              ],
            },
          ],
        },
        parameters: {},
      }),
    });
    if (!res.ok) {
      console.log(`[native multimodal] HTTP ${res.status}: ${(await res.text()).slice(0, 250)}`);
      return null;
    }
    const json = await res.json();
    const text = json?.output?.choices?.[0]?.message?.content?.[0]?.text ?? json?.output?.text;
    if (!text) {
      console.log(`[native multimodal] no text in response:`, JSON.stringify(json).slice(0, 350));
      return null;
    }
    return text;
  } catch (e: any) {
    console.log(`[native multimodal] threw: ${e.message}`);
    return null;
  }
}

async function tryDashScopeAsrJob(): Promise<string | null> {
  // The classic DashScope ASR job is async with file URL input.
  // For a quick test we'd need to host the file. Skipping unless above fails.
  console.log('[native async] would need file URL hosting, skipping for now');
  return null;
}

async function main() {
  console.log('=== Trying OpenAI-compatible /audio/transcriptions ===');
  let transcript = await tryOpenAITranscriptions();
  if (transcript) {
    console.log(`\n✅ TRANSCRIPT (compat):\n${transcript}\n`);
    return;
  }

  console.log('\n=== Trying native multimodal-generation with audio input ===');
  transcript = await tryMultimodalAudioInput();
  if (transcript) {
    console.log(`\n✅ TRANSCRIPT (native):\n${transcript}\n`);
    return;
  }

  console.log('\n=== Falling back to async ASR job ===');
  await tryDashScopeAsrJob();
  console.log('\n❌ No method succeeded. Paste the errors above for debugging.');
}

main().catch((e) => { console.error(e); process.exit(1); });
