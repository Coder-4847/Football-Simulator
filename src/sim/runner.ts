import { execute, type Command, type CommandResult } from '../manager/commands';
import type { CareerState } from '../manager/state';

/**
 * Runs career commands in a Web Worker so long simulations never block the UI.
 * Falls back to the main thread where workers are unavailable (e.g. tests, very old browsers).
 */
export class CareerRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { res: (r: CommandResult) => void; rej: (e: Error) => void }>();

  constructor() {
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent): void => {
          const d = e.data as { id: number; ok: boolean; state?: CareerState; report?: CommandResult['report']; error?: string };
          const p = this.pending.get(d.id); if (!p) return;
          this.pending.delete(d.id);
          if (d.ok) p.res({ state: d.state!, report: d.report! }); else p.rej(new Error(d.error));
        };
        this.worker.onerror = (): void => { this.worker?.terminate(); this.worker = null; for (const p of this.pending.values()) p.rej(new Error('worker failed')); this.pending.clear(); };
      }
    } catch { this.worker = null; }
  }

  run(state: CareerState, command: Command): Promise<CommandResult> {
    if (!this.worker) return Promise.resolve().then(() => execute(state, command));
    const id = ++this.seq;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.worker!.postMessage({ id, state, command }); })
      .catch(() => execute(state, command)) as Promise<CommandResult>;
  }

  dispose(): void { this.worker?.terminate(); this.worker = null; }
}
