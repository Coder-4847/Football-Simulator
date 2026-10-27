/** Keyboard + gamepad spatial navigation for menus. */
export class MenuNav {
  enabled = true;
  private padPrev = { up: false, down: false, left: false, right: false, a: false, b: false };
  private raf = 0;

  constructor() {
    window.addEventListener('keydown', this.onKey);
    const poll = (): void => { this.raf = requestAnimationFrame(poll); this.pollPad(); };
    poll();
  }

  private scope(): HTMLElement {
    const layers = [...document.querySelectorAll<HTMLElement>('.modal-bg, .ui-layer, .touch-toolbar')];
    return layers[layers.length - 1] ?? document.body;
  }

  private items(): HTMLElement[] {
    const root = this.scope();
    return [...root.querySelectorAll<HTMLElement>('button, select, input, [tabindex="0"], summary')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !(e as HTMLButtonElement).disabled;
    });
  }

  move(dir: 'up' | 'down' | 'left' | 'right'): void {
    const items = this.items();
    if (!items.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !items.includes(cur)) { items[0]!.focus(); return; }
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best: HTMLElement | null = null; let bs = Infinity;
    for (const it of items) {
      if (it === cur) continue;
      const r = it.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      if (along <= 4) continue;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      const s = along + across * 2.2;
      if (s < bs) { bs = s; best = it; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) { if (e.key === 'Escape') (t as HTMLElement).blur(); return; }
    const map: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const d = map[e.key];
    if (d) {
      if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range' && (d === 'left' || d === 'right')) return;
      e.preventDefault(); this.move(d);
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      const back = this.scope().querySelector<HTMLElement>('[data-back]'); if (back && !(t && t.tagName === 'INPUT')) back.click();
    }
  };

  private pollPad(): void {
    if (!this.enabled) return;
    const p = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
    if (!p) return;
    const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
    const now = {
      up: ay < -0.6 || !!p.buttons[12]?.pressed, down: ay > 0.6 || !!p.buttons[13]?.pressed, left: ax < -0.6 || !!p.buttons[14]?.pressed, right: ax > 0.6 || !!p.buttons[15]?.pressed,
      a: !!p.buttons[0]?.pressed, b: !!p.buttons[1]?.pressed,
    };
    for (const k of ['up', 'down', 'left', 'right'] as const) if (now[k] && !this.padPrev[k]) this.move(k);
    if (now.a && !this.padPrev.a) (document.activeElement as HTMLElement | null)?.click?.();
    if (now.b && !this.padPrev.b) this.scope().querySelector<HTMLElement>('[data-back]')?.click();
    this.padPrev = now;
  }

  dispose(): void { window.removeEventListener('keydown', this.onKey); cancelAnimationFrame(this.raf); }
}
