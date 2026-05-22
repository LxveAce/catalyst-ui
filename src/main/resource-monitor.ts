import { EventEmitter } from 'events';
import type { ResourceSnapshot } from '../shared/types';

let si: typeof import('systeminformation') | null = null;
try {
  si = require('systeminformation');
} catch {
  // systeminformation not available
}

export class ResourceMonitor extends EventEmitter {
  private interval: ReturnType<typeof setInterval> | null = null;
  /**
   * Set of Claude root PIDs we sum process-trees for. Phase 7c switched from a
   * single PID to N PIDs (one per split pane); the snapshot's `claude.*` fields
   * are *aggregated* across all live panes.
   */
  private claudePids: Set<number> = new Set();

  /** Back-compat single-PID setter; equivalent to `setClaudePids([pid])`. */
  setClaudePid(pid: number) {
    this.claudePids.clear();
    if (pid > 0) this.claudePids.add(pid);
  }

  /** Replace the tracked PID set with the supplied list (zeros ignored). */
  setClaudePids(pids: number[]) {
    this.claudePids.clear();
    for (const p of pids) {
      if (typeof p === 'number' && p > 0 && Number.isFinite(p)) {
        this.claudePids.add(p);
      }
    }
  }

  start(intervalMs = 2000) {
    if (this.interval || !si) return;
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    if (!si) return;

    try {
      const [cpu, mem, gpu, procs] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.graphics().catch(() => null),
        this.claudePids.size > 0 ? si.processes() : Promise.resolve(null),
      ]);

      let claudeCpu = 0;
      let claudeRam = 0;
      let claudePidCount = 0;

      if (procs && this.claudePids.size > 0) {
        // Walk each root's process tree and de-dup at the leaf level. If two
        // panes happen to share an ancestor (shouldn't, but defensive), we
        // wouldn't double-count.
        const seen = new Set<number>();
        for (const root of this.claudePids) {
          const treeProcs = this.getProcessTree(procs.list, root, seen);
          for (const proc of treeProcs) {
            claudeCpu += proc.cpu;
            claudeRam += proc.mem_rss;
            claudePidCount++;
          }
        }
      }

      const ramTotalGB = mem.total / (1024 ** 3);
      const ramUsedGB = mem.used / (1024 ** 3);

      let gpuPercent: number | null = null;
      if (gpu?.controllers?.length) {
        const ctrl = gpu.controllers[0];
        if (typeof ctrl.utilizationGpu === 'number') {
          gpuPercent = ctrl.utilizationGpu;
        }
      }

      const snapshot: ResourceSnapshot = {
        system: {
          cpuPercent: Math.round(cpu.currentLoad * 10) / 10,
          ramPercent: Math.round((ramUsedGB / ramTotalGB) * 1000) / 10,
          ramUsedGB: Math.round(ramUsedGB * 100) / 100,
          ramTotalGB: Math.round(ramTotalGB * 100) / 100,
          gpuPercent,
        },
        claude: {
          cpuPercent: Math.round(claudeCpu * 10) / 10,
          ramPercent: Math.round((claudeRam / mem.total) * 1000) / 10,
          ramMB: Math.round(claudeRam / (1024 * 1024)),
          pidCount: claudePidCount,
        },
        timestamp: Date.now(),
      };

      this.emit('update', snapshot);
    } catch {
      // Silently skip failed polls
    }
  }

  private getProcessTree(
    list: Array<{ pid: number; parentPid: number; cpu: number; mem_rss: number }>,
    rootPid: number,
    visited: Set<number> = new Set()
  ): Array<{ cpu: number; mem_rss: number }> {
    const result: Array<{ cpu: number; mem_rss: number }> = [];
    const queue = [rootPid];

    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (visited.has(pid)) continue;
      visited.add(pid);

      const proc = list.find((p) => p.pid === pid);
      if (proc) {
        result.push({ cpu: proc.cpu, mem_rss: proc.mem_rss });
      }

      for (const child of list) {
        if (child.parentPid === pid && !visited.has(child.pid)) {
          queue.push(child.pid);
        }
      }
    }

    return result;
  }
}
