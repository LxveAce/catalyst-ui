import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GpuInfo, HardwareProfile } from './hardware-detection';

/**
 * GPU routing preference for the Ollama daemon.
 *
 * Critical context: Ollama reads its GPU env vars
 * (`CUDA_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`, `OLLAMA_VULKAN`, etc.)
 * at `ollama serve` startup time — NOT per-invocation of `ollama run`.
 * This means a single daemon has a single GPU routing config; the
 * "preference" here is per-app, not per-model.
 *
 * Modes:
 *   - `auto`: let Ollama's own probe decide. Equivalent to "do nothing"
 *     env-wise. The default; matches stock Ollama behavior.
 *   - `gpu`: force a specific GPU. Uses the `targetGpuIndex` to pick the
 *     systeminformation controller index that maps to a `CUDA_VISIBLE_DEVICES`
 *     ordinal (or HIP equivalent). When `targetGpuIndex` is missing, picks
 *     the largest dedicated GPU from the hardware profile.
 *   - `cpu`: force CPU fallback. Sets `CUDA_VISIBLE_DEVICES="-1"` AND
 *     `HIP_VISIBLE_DEVICES="-1"` AND `GGML_VK_VISIBLE_DEVICES="-1"` so every
 *     vendor's path resolves to "no GPU available." Useful for "model is
 *     too big for VRAM, fall back gracefully."
 *
 * Changing the preference requires a daemon restart — `OllamaService`
 * does the stop-and-wait + restart sequence.
 */

export type GpuMode = 'auto' | 'gpu' | 'cpu';

export interface GpuPrefs {
  mode: GpuMode;
  /** When `mode === 'gpu'`, the systeminformation controller index to use.
   *  Null = pick the preferred dedicated GPU automatically. */
  targetGpuIndex: number | null;
  /** Opt-in to Ollama's experimental Vulkan path (required for Intel Arc).
   *  Set `OLLAMA_VULKAN=1` on the daemon when true. */
  enableVulkan: boolean;
  /** Free win on most hardware — `OLLAMA_FLASH_ATTENTION=1`. Default true. */
  flashAttention: boolean;
}

const STORE_FILE = 'gpu-prefs.json';

const DEFAULTS: GpuPrefs = {
  mode: 'auto',
  targetGpuIndex: null,
  enableVulkan: false,
  flashAttention: true,
};

function storePath(): string {
  return path.join(app.getPath('userData'), STORE_FILE);
}

export function readGpuPrefs(): GpuPrefs {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath(), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
    return { ...DEFAULTS };
  }
  let parsed: Partial<GpuPrefs>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }
  return {
    mode:
      parsed.mode === 'auto' || parsed.mode === 'gpu' || parsed.mode === 'cpu'
        ? parsed.mode
        : DEFAULTS.mode,
    targetGpuIndex:
      typeof parsed.targetGpuIndex === 'number' &&
      Number.isFinite(parsed.targetGpuIndex) &&
      parsed.targetGpuIndex >= 0
        ? parsed.targetGpuIndex
        : DEFAULTS.targetGpuIndex,
    enableVulkan:
      typeof parsed.enableVulkan === 'boolean'
        ? parsed.enableVulkan
        : DEFAULTS.enableVulkan,
    flashAttention:
      typeof parsed.flashAttention === 'boolean'
        ? parsed.flashAttention
        : DEFAULTS.flashAttention,
  };
}

export function writeGpuPrefs(patch: Partial<GpuPrefs>): GpuPrefs {
  const current = readGpuPrefs();
  const next: GpuPrefs = {
    mode:
      patch.mode === 'auto' || patch.mode === 'gpu' || patch.mode === 'cpu'
        ? patch.mode
        : current.mode,
    targetGpuIndex:
      patch.targetGpuIndex !== undefined
        ? typeof patch.targetGpuIndex === 'number' && patch.targetGpuIndex >= 0
          ? patch.targetGpuIndex
          : null
        : current.targetGpuIndex,
    enableVulkan:
      typeof patch.enableVulkan === 'boolean'
        ? patch.enableVulkan
        : current.enableVulkan,
    flashAttention:
      typeof patch.flashAttention === 'boolean'
        ? patch.flashAttention
        : current.flashAttention,
  };
  try {
    const target = storePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, target);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
  } catch {
    // Persistence failure is non-fatal — preference applied for current
    // session only.
  }
  return next;
}

/**
 * Compute the env-var dict to inject when spawning `ollama serve`,
 * given the user's prefs + the detected hardware profile.
 *
 * Returns an empty object when prefs.mode === 'auto' AND no special opts
 * are set (no flash-attention override, no Vulkan) — i.e. don't change
 * Ollama's default behavior. This is the path that lets Ollama's own
 * auto-probe do its thing.
 */
export function buildDaemonEnv(
  prefs: GpuPrefs,
  hardware: HardwareProfile | null
): Record<string, string> {
  const env: Record<string, string> = {};

  if (prefs.mode === 'cpu') {
    // Belt-and-suspenders: blind every vendor's GPU enumeration.
    env.CUDA_VISIBLE_DEVICES = '-1';
    env.HIP_VISIBLE_DEVICES = '-1';
    env.ROCR_VISIBLE_DEVICES = '-1';
    env.GGML_VK_VISIBLE_DEVICES = '-1';
    // Also hint Ollama directly to pick a CPU backend.
    env.OLLAMA_LLM_LIBRARY = 'cpu_avx2';
  } else if (prefs.mode === 'gpu') {
    // Find the GPU we're targeting.
    const target = pickTargetGpu(prefs, hardware);
    if (target) {
      // The ordinal Ollama wants is the device-list index for that vendor's
      // backend. For NVIDIA, CUDA_VISIBLE_DEVICES uses the CUDA ordinal —
      // which usually matches the controller index when only NVIDIA cards
      // are present. We pass the systeminformation index as the simplest
      // proxy; advanced users can override via the `targetGpuIndex` pref.
      if (target.vendor === 'nvidia') {
        env.CUDA_VISIBLE_DEVICES = String(target.index);
      } else if (target.vendor === 'amd') {
        env.HIP_VISIBLE_DEVICES = String(target.index);
        env.ROCR_VISIBLE_DEVICES = String(target.index);
      } else if (target.vendor === 'intel') {
        // Intel Arc requires Vulkan; if the user hasn't opted in, this
        // won't accelerate. We set the index but the user will see
        // CPU fallback unless `enableVulkan` is true.
        env.GGML_VK_VISIBLE_DEVICES = String(target.index);
      }
      // Apple Silicon (metal) doesn't need an explicit ordinal —
      // there's only one and it's auto-picked.
    }
  }
  // mode === 'auto' — set nothing; Ollama auto-probe owns the decision.

  if (prefs.enableVulkan) {
    env.OLLAMA_VULKAN = '1';
  }
  if (prefs.flashAttention) {
    env.OLLAMA_FLASH_ATTENTION = '1';
  }

  return env;
}

function pickTargetGpu(
  prefs: GpuPrefs,
  hardware: HardwareProfile | null
): GpuInfo | null {
  if (!hardware) return null;
  if (prefs.targetGpuIndex !== null) {
    const match = hardware.gpus.find((g) => g.index === prefs.targetGpuIndex);
    if (match) return match;
  }
  return hardware.preferredGpu;
}
