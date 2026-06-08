import type { IpcMain } from 'electron';

export interface CompareResult {
  model: string;
  response: string;
  durationMs: number;
  error?: string;
}

const OLLAMA_BASE = 'http://localhost:11434';
const TIMEOUT_MS = 120_000;

async function generateOne(model: string, prompt: string): Promise<CompareResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const t0 = Date.now();

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        model,
        response: '',
        durationMs: Date.now() - t0,
        error: `HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`,
      };
    }

    const data = (await res.json()) as { response?: string };
    return {
      model,
      response: data.response ?? '',
      durationMs: Date.now() - t0,
    };
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      model,
      response: '',
      durationMs: Date.now() - t0,
      error: isAbort
        ? `Timed out after ${TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function run(prompt: string, models: string[]): Promise<CompareResult[]> {
  return Promise.all(models.map((m) => generateOne(m, prompt)));
}

export function setupCompareIPC(ipcMain: IpcMain): void {
  ipcMain.handle('compare:run', async (_event, prompt: string, models: string[]) => {
    if (!prompt || !Array.isArray(models) || models.length < 2) {
      return [{ model: '', response: '', durationMs: 0, error: 'At least 2 models and a prompt are required.' }];
    }
    return run(prompt, models);
  });
}
