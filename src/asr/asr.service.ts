import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

interface TempAudio {
  bytes: Buffer;
  mime: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60_000;

@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);
  private readonly store = new Map<string, TempAudio>();

  constructor(private readonly config: ConfigService) {}

  /** Stash audio bytes and return an id for the temp public URL. */
  store_audio(bytes: Buffer, mime: string): string {
    this.prune();
    const id = randomUUID();
    this.store.set(id, { bytes, mime, expiresAt: Date.now() + TTL_MS });
    return id;
  }

  get(id: string): TempAudio | null {
    this.prune();
    return this.store.get(id) ?? null;
  }

  publicUrl(id: string): string {
    const baseUrl = this.config.get<string>('PUBLIC_BASE_URL') ?? '';
    return `${baseUrl}/audio/${id}`;
  }

  /**
   * Transcribe via Alibaba qwen3-asr-flash. Saves audio, exposes via
   * temp public URL, fires the ASR job, polls until done, returns the
   * transcript or null.
   */
  async transcribe(bytes: Buffer, mime: string): Promise<{ transcript: string | null; raw?: unknown; error?: string }> {
    const apiKey = this.config.get<string>('ALIBABA_API_KEY');
    if (!apiKey) return { transcript: null, error: 'ALIBABA_API_KEY not set' };

    const id = this.store_audio(bytes, mime);
    const url = this.publicUrl(id);
    this.logger.log(`Transcribing ${bytes.length} bytes via ${url}`);

    try {
      const res = await fetch(
        'https://dashscope-intl.aliyuncs.com/api/v1/services/audio/asr/transcription',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model: 'qwen3-asr-flash',
            input: { file_urls: [url] },
          }),
        },
      );
      const json: any = await res.json();
      if (!res.ok || !json?.output?.task_id) {
        return { transcript: null, raw: json, error: `submit failed: HTTP ${res.status}` };
      }
      const taskId = json.output.task_id;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const pollRes = await fetch(`https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const pollJson: any = await pollRes.json();
        const status = pollJson?.output?.task_status;
        if (status === 'SUCCEEDED') {
          const tUrl = pollJson?.output?.results?.[0]?.transcription_url;
          if (!tUrl) return { transcript: null, raw: pollJson, error: 'no transcription_url' };
          const tRes = await fetch(tUrl);
          const tJson: any = await tRes.json();
          const text = tJson?.transcripts?.[0]?.text ?? null;
          return { transcript: text, raw: tJson };
        }
        if (status === 'FAILED') {
          return { transcript: null, raw: pollJson, error: 'task FAILED' };
        }
      }
      return { transcript: null, error: 'polling timed out' };
    } catch (e: any) {
      return { transcript: null, error: e.message };
    } finally {
      // Best-effort cleanup; TTL also handles it.
      this.store.delete(id);
    }
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.store) if (v.expiresAt < now) this.store.delete(k);
  }
}
