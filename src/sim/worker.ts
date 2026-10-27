/// <reference lib="webworker" />
import { execute, type Command } from '../manager/commands';
import type { CareerState } from '../manager/state';

interface Req { id: number; state: CareerState; command: Command }

self.onmessage = (e: MessageEvent<Req>): void => {
  const { id, state, command } = e.data;
  try {
    const res = execute(state, command);
    (self as unknown as Worker).postMessage({ id, ok: true, ...res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err instanceof Error ? err.stack ?? err.message : err) });
  }
};
