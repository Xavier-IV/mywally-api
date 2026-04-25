/**
 * Quick test: does Alibaba qwen3-tts handle Bahasa Melayu?
 * Run: npx ts-node scripts/test-tts.ts
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

const TESTS = [
  { lang: 'BM', text: 'Apa khabar mama, ada baik hari ini? Berapa duit yang mama belanja hari ini?' },
  { lang: 'EN', text: 'Hello mum, how are you today? How much have you spent today?' },
  { lang: 'BM-EN', text: 'Mama, your spending hari ini berapa? Saya nak check sekejap.' },
];

// Common Qwen TTS voice names (multilingual). Will try in order.
const VOICES = ['Cherry', 'Ethan', 'Chelsie', 'Serena', 'Dylan', 'Jada', 'Sunny'];

async function tryOpenAIAudioSpeech(text: string, voice: string, model: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${COMPAT_URL}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice, input: text, response_format: 'mp3' }),
    });
    if (!res.ok) {
      console.log(`  [compat ${model}/${voice}] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('audio') && !ct.includes('mpeg') && !ct.includes('octet')) {
      const txt = await res.text();
      console.log(`  [compat ${model}/${voice}] non-audio response (${ct}): ${txt.slice(0, 200)}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    console.log(`  [compat ${model}/${voice}] threw: ${e.message}`);
    return null;
  }
}

async function tryNativeMultimodal(text: string, voice: string, model: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${NATIVE_URL}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model,
        input: { text },
        parameters: { voice, format: 'mp3' },
      }),
    });
    if (!res.ok) {
      console.log(`  [native ${model}/${voice}] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const json = await res.json();
    const audioUrl = json?.output?.audio?.url ?? json?.output?.audio_url;
    if (!audioUrl) {
      console.log(`  [native ${model}/${voice}] no audio url:`, JSON.stringify(json).slice(0, 250));
      return null;
    }
    const audioRes = await fetch(audioUrl);
    return Buffer.from(await audioRes.arrayBuffer());
  } catch (e: any) {
    console.log(`  [native ${model}/${voice}] threw: ${e.message}`);
    return null;
  }
}

async function tryNativeSyncTts(text: string, voice: string, model: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${NATIVE_URL}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: { text },
        parameters: { voice, response_format: 'mp3' },
      }),
    });
    if (!res.ok) {
      console.log(`  [sync ${model}/${voice}] HTTP ${res.status}: ${(await res.text()).slice(0, 250)}`);
      return null;
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('audio')) return Buffer.from(await res.arrayBuffer());
    const json = await res.json();
    // Try a few likely shapes
    const audioUrl =
      json?.output?.audio?.url ??
      json?.output?.audio_url ??
      json?.output?.url;
    const base64 =
      json?.output?.audio?.data ??
      json?.output?.audio_base64;
    if (audioUrl) {
      const r = await fetch(audioUrl);
      return Buffer.from(await r.arrayBuffer());
    }
    if (base64) return Buffer.from(base64, 'base64');
    console.log(`  [sync ${model}/${voice}] no audio in response:`, JSON.stringify(json).slice(0, 300));
    return null;
  } catch (e: any) {
    console.log(`  [sync ${model}/${voice}] threw: ${e.message}`);
    return null;
  }
}

async function main() {
  const outDir = path.join(process.cwd(), 'tmp', 'tts-test');
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Output dir: ${outDir}\n`);

  const models = ['qwen3-tts-flash', 'qwen3-tts-instruct-flash'];

  for (const test of TESTS) {
    console.log(`\n=== ${test.lang}: "${test.text.slice(0, 60)}..." ===`);
    let succeeded = false;

    for (const model of models) {
      if (succeeded) break;
      // Try OpenAI-compat first
      for (const voice of VOICES) {
        const audio = await tryOpenAIAudioSpeech(test.text, voice, model);
        if (audio) {
          const file = path.join(outDir, `${model}_${voice}_${test.lang}.mp3`);
          fs.writeFileSync(file, audio);
          console.log(`  ✅ ${model}/${voice} (compat) → ${file} (${audio.length} bytes)`);
          succeeded = true;
          break;
        }
      }
      if (succeeded) break;
      // Try native sync
      for (const voice of VOICES) {
        const audio = await tryNativeSyncTts(test.text, voice, model);
        if (audio) {
          const file = path.join(outDir, `${model}_${voice}_${test.lang}_native.mp3`);
          fs.writeFileSync(file, audio);
          console.log(`  ✅ ${model}/${voice} (native) → ${file} (${audio.length} bytes)`);
          succeeded = true;
          break;
        }
      }
    }
  }

  console.log(`\nDone. Listen with: open ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
