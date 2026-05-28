import * as os from 'os';
import si from 'systeminformation';

/**
 * HardwareDetection — quick read of the host's RAM / CPU / GPU, classified
 * into a tier that maps to the model catalog's hardwareTiers field.
 *
 * Tiers (sweet-spot for Q4_K_M quants — the catalog seeds use the same scale):
 *   toaster     — under-tier, only 1-3B models. Phones / very old laptops.
 *   low         — 7-8B at Q4 fits in RAM. Integrated GPU or 4-6 GB VRAM.
 *   mid         — 13-14B at Q4 or 7-8B at Q8. 16-32 GB RAM, 8-12 GB VRAM.
 *   high        — 32-34B at Q4 or 70B at Q2/Q3. 32-64 GB RAM, 16-24 GB VRAM.
 *   workstation — 70B at Q4-Q6 or larger MoE. 64+ GB RAM, 48+ GB VRAM or multi-GPU.
 *
 * The heuristic deliberately favors VRAM when present, because moving a model
 * off-GPU collapses throughput. RAM is the fallback for CPU-only inference.
 */

export type HardwareTier =
  | 'toaster'
  | 'low'
  | 'mid'
  | 'high'
  | 'workstation'
  /** NVIDIA Jetson AGX Thor — 128 GB unified memory, Blackwell GPU,
   *  NVFP4 native. Workstation-class edge. Models that NVIDIA explicitly
   *  recommends for Jetson Thor are tagged with this tier. */
  | 'jetson-thor';

/** Canonical GPU vendor used by the Ollama routing decisions. */
export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';

/** Backend Ollama would target for a given GPU. `cpu` is the fallback. */
export type GpuBackend = 'cuda' | 'rocm' | 'metal' | 'vulkan' | 'cpu';

export interface GpuInfo {
  /** Display name from systeminformation (e.g. "NVIDIA GeForce RTX 4090"). */
  name: string;
  vendor: GpuVendor;
  vramGB: number | null;
  /** False when systeminformation marks `vramDynamic === true` (shared with
   *  system RAM) — typical iGPUs. Used to pick the right device for GPU
   *  offload: a 32 GB system-RAM iGPU with `vramDynamic` is still an iGPU. */
  isDedicated: boolean;
  /** PCI vendor ID if known (0x10DE NVIDIA, 0x1002 AMD, 0x8086 Intel). */
  vendorId: number | null;
  /** Backend Ollama would use for this GPU on this OS. */
  backend: GpuBackend;
  /** Index in si.graphics().controllers — used as the
   *  CUDA_VISIBLE_DEVICES / HIP_VISIBLE_DEVICES ordinal when we route. */
  index: number;
}

export interface HardwareProfile {
  cpu: {
    model: string;
    physicalCores: number;
    logicalCores: number;
  };
  ramGB: number;
  gpus: GpuInfo[];
  /** Max VRAM across all GPUs (single-GPU heuristic). 0 = none detected. */
  maxVramGB: number;
  /** Sum of VRAM across all GPUs (multi-GPU upper bound). */
  totalVramGB: number;
  /** The GPU Ollama should target by default — the largest dedicated GPU.
   *  Null if no dedicated GPU is present (Ollama will fall back to CPU,
   *  or to Vulkan-iGPU if OLLAMA_VULKAN is opted into). */
  preferredGpu: GpuInfo | null;
  /** Compatibility hint for the UI: what backend can route to a real GPU? */
  ollamaCompat: GpuBackend;
  tier: HardwareTier;
  /** Short, opinionated paragraph: what this machine can realistically run. */
  summary: string;
  /** OS family for cross-platform behavior in the UI. */
  platform: 'win32' | 'darwin' | 'linux' | 'other';
  detectedAt: string;
}

let cache: { value: HardwareProfile; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function detectHardware(force = false): Promise<HardwareProfile> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  // CPU + RAM via os module (cheap, no async). Use systeminformation for GPU
  // only because os has no GPU API.
  const ramGB = Math.round((os.totalmem() / 1e9) * 10) / 10;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || 'Unknown CPU';
  const logicalCores = cpus.length;

  let physicalCores = logicalCores;
  try {
    const cpuInfo = await si.cpu();
    if (typeof cpuInfo.physicalCores === 'number' && cpuInfo.physicalCores > 0) {
      physicalCores = cpuInfo.physicalCores;
    }
  } catch {
    // si.cpu failing is non-fatal; logical-cores estimate is fine.
  }

  const gpus: GpuInfo[] = [];
  try {
    const g = await si.graphics();
    const controllers = g.controllers ?? [];
    for (let i = 0; i < controllers.length; i++) {
      const c = controllers[i];
      const vendorRaw = (c.vendor || '').trim();
      const name = (c.model || '').trim();
      if (!name) continue;
      // systeminformation types VRAM as `vram` (MB). Some Windows drivers
      // report 0 for iGPUs (their VRAM is dynamic and reported elsewhere).
      const vramMB = (c as unknown as { vram?: number }).vram;
      const vramGB =
        typeof vramMB === 'number' && vramMB > 0
          ? Math.round((vramMB / 1024) * 10) / 10
          : null;
      const vramDynamic = (c as unknown as { vramDynamic?: boolean }).vramDynamic;
      const vendorIdRaw = (c as unknown as { vendorId?: string }).vendorId;
      const vendorId = parseVendorId(vendorIdRaw);
      const vendor = classifyVendor(vendorRaw, name, vendorId);
      const isDedicated = computeIsDedicated(vendor, vramDynamic, vramGB);
      const backend = pickBackend(vendor, isDedicated);
      gpus.push({ name, vendor, vramGB, isDedicated, vendorId, backend, index: i });
    }
  } catch {
    // GPU detection fails on locked-down systems; not fatal.
  }

  const vramValues = gpus.map((g) => g.vramGB ?? 0);
  const maxVramGB = vramValues.length ? Math.max(...vramValues) : 0;
  const totalVramGB = vramValues.reduce((a, b) => a + b, 0);

  // Pick the GPU we'd default to: the dedicated one with the most VRAM.
  // Apple Silicon (`metal` backend) wins automatically because there's
  // exactly one and it's always "dedicated" via unified memory.
  const dedicated = gpus.filter((g) => g.isDedicated);
  const preferredGpu =
    dedicated.length === 0
      ? null
      : dedicated.reduce((best, g) =>
          (g.vramGB ?? 0) > (best.vramGB ?? 0) ? g : best
        );
  const ollamaCompat: GpuBackend = preferredGpu?.backend ?? 'cpu';

  const tier = classifyTier(ramGB, maxVramGB, totalVramGB, gpus.length);

  const profile: HardwareProfile = {
    cpu: { model: cpuModel, physicalCores, logicalCores },
    ramGB,
    gpus,
    maxVramGB,
    totalVramGB,
    preferredGpu,
    ollamaCompat,
    tier,
    summary: buildSummary(ramGB, maxVramGB, tier, gpus),
    platform: normalizePlatform(process.platform),
    detectedAt: new Date().toISOString(),
  };

  cache = { value: profile, expiresAt: Date.now() + CACHE_TTL_MS };
  return profile;
}

export function classifyTier(
  ramGB: number,
  maxVramGB: number,
  totalVramGB: number,
  gpuCount: number
): HardwareTier {
  // Workstation: 70B-class workloads.
  if (ramGB >= 64 && (totalVramGB >= 48 || gpuCount >= 2)) return 'workstation';
  // High: 32B at Q4 single-GPU.
  if (ramGB >= 32 && maxVramGB >= 16) return 'high';
  // Mid: 13B at Q4 or 7B at Q8.
  if (ramGB >= 16 && maxVramGB >= 8) return 'mid';
  if (ramGB >= 16 && totalVramGB >= 8) return 'mid';
  if (ramGB >= 24) return 'mid'; // CPU-friendly mid: lots of RAM, weak GPU
  // Low: 7-8B at Q4 fits.
  if (ramGB >= 8) return 'low';
  return 'toaster';
}

function buildSummary(
  ramGB: number,
  maxVramGB: number,
  tier: HardwareTier,
  gpus: HardwareProfile['gpus']
): string {
  const dedicated = gpus.find((g) => g.isDedicated);
  const gpuLabel = dedicated
    ? `${dedicated.name}${maxVramGB > 0 ? ` (${maxVramGB} GB VRAM)` : ''}`
    : gpus.length === 0
      ? 'no GPU detected'
      : `${gpus[0].name} (integrated)`;
  const sweetSpot = sweetSpotFor(tier);
  return `${ramGB} GB RAM · ${gpuLabel}. Sweet spot: ${sweetSpot}.`;
}

/**
 * Convert si.graphics().controllers[].vendorId (string like "0x10DE") to a
 * number. Returns null if absent or unparseable.
 */
function parseVendorId(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    return parseInt(raw, 16);
  } catch {
    return null;
  }
}

/**
 * Map systeminformation's free-form vendor string + name + PCI ID into the
 * canonical 5-vendor enum we route on. Belt-and-suspenders because the
 * vendor string is inconsistent across OSes ("NVIDIA Corporation" on Linux
 * vs "NVIDIA" on Windows etc.).
 */
function classifyVendor(
  vendorRaw: string,
  name: string,
  vendorId: number | null
): GpuVendor {
  if (vendorId === 0x10de) return 'nvidia';
  if (vendorId === 0x1002) return 'amd';
  if (vendorId === 0x8086) return 'intel';
  const v = vendorRaw.toLowerCase();
  if (v.includes('nvidia')) return 'nvidia';
  if (v.includes('amd') || v.includes('advanced micro devices') || v.includes('ati')) return 'amd';
  if (v.includes('intel')) return 'intel';
  if (v.includes('apple')) return 'apple';
  const n = name.toLowerCase();
  if (/geforce|quadro|rtx|gtx|tesla/.test(n)) return 'nvidia';
  if (/radeon|firepro|instinct/.test(n)) return 'amd';
  if (/arc |iris|uhd graphics|hd graphics/.test(n)) return 'intel';
  if (/apple/.test(n)) return 'apple';
  return 'other';
}

/**
 * "Dedicated" means the GPU has its own memory and is realistically usable
 * for ML inference. Apple Silicon's unified memory counts as dedicated
 * because it IS the GPU's memory. Intel iGPUs and AMD APUs have
 * `vramDynamic === true` and we treat as not-dedicated even when they
 * report a generous "VRAM" number (which is actually system RAM).
 */
function computeIsDedicated(
  vendor: GpuVendor,
  vramDynamic: boolean | undefined,
  vramGB: number | null
): boolean {
  if (vendor === 'apple') return true; // unified memory
  if (vramDynamic === true) return false; // shared system RAM
  // Conservative threshold: anything reporting under 1 GB VRAM probably
  // isn't a real dedicated GPU even if vramDynamic is unset (driver lies).
  if (vramGB !== null && vramGB < 1) return false;
  if (vendor === 'nvidia' || vendor === 'amd') return true;
  return false;
}

/**
 * Pick the Ollama backend per (vendor, OS, dedicated-ness). Returns 'cpu'
 * for anything we can't accelerate (e.g. Intel Arc without OLLAMA_VULKAN=1).
 */
function pickBackend(vendor: GpuVendor, isDedicated: boolean): GpuBackend {
  if (!isDedicated) return 'cpu';
  if (vendor === 'apple') return process.platform === 'darwin' ? 'metal' : 'cpu';
  if (vendor === 'nvidia') return 'cuda';
  if (vendor === 'amd') {
    if (process.platform === 'win32' || process.platform === 'linux') return 'rocm';
    return 'cpu';
  }
  if (vendor === 'intel') return 'vulkan'; // requires OLLAMA_VULKAN=1 at daemon start
  return 'cpu';
}

function sweetSpotFor(tier: HardwareTier): string {
  switch (tier) {
    case 'workstation':
      return '70B at Q4-Q6, or large MoE models';
    case 'jetson-thor':
      return 'Edge-optimized 30-70B at Q4 / NVFP4, or 120B MoE';
    case 'high':
      return '32-34B at Q4, or 70B at heavy quant';
    case 'mid':
      return '13-14B at Q4, or 7-8B at Q8';
    case 'low':
      return '7-8B at Q4_K_M';
    case 'toaster':
      return '1-3B models at heavy quant';
  }
}

function normalizePlatform(p: NodeJS.Platform): HardwareProfile['platform'] {
  if (p === 'win32' || p === 'darwin' || p === 'linux') return p;
  return 'other';
}

/** Tier ordering for "this model needs at least tier X" comparisons. */
export const TIER_ORDER: Record<HardwareTier, number> = {
  toaster: 0,
  low: 1,
  mid: 2,
  high: 3,
  workstation: 4,
  // Jetson Thor sits alongside workstation in compute (128 GB unified
  // memory, NVFP4 Blackwell), so it gets the same ordinal for "model
  // can run here" comparisons. The badge / tag is still distinct so the
  // UI can surface Jetson-targeted recommendations separately.
  'jetson-thor': 4,
};

export function tierMeetsOrExceeds(have: HardwareTier, need: HardwareTier): boolean {
  return TIER_ORDER[have] >= TIER_ORDER[need];
}
