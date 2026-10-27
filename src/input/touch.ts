import { settings, TOUCH_DEFAULT_LAYOUT, type TouchButtonLayout } from '../core/settings';
import type { Btn, Context } from './actions';
import { dirOf, type Dir4 } from './gestures';
import { skillById } from '../match/skills';

const LABELS: Record<Context, Partial<Record<Btn, string>>> = {
  attack: { b1: 'PASS', b2: 'THROUGH', b3: 'LOB', b4: 'SHOOT', sprint: 'SPRINT', skillBtn: 'SKILL', precise: 'SHIELD', modB: 'RUN', modA: 'CHIP' },
  defend: { b1: 'TACKLE', b2: 'KEEPER', b3: 'SLIDE', b4: 'SWITCH', sprint: 'SPRINT', precise: 'CONTAIN', modB: '2ND PRESS', modA: 'SWITCH' },
  setpiece: { b1: 'SHORT', b2: 'THROUGH', b3: 'CROSS', b4: 'SHOOT', sprint: 'RUN', precise: 'FINE', modA: 'WALL ◀', modB: 'WALL ▶' },
  keeper: { b1: 'THROW', b2: 'RUSH', b3: 'KICK', b4: 'SWITCH', sprint: 'SPRINT', precise: 'HOLD', modA: 'DIVE ◀', modB: 'DIVE ▶' },
  penalty: { b4: 'SHOOT', b3: 'CHIP', b1: 'LOW', precise: 'FINE' },
  menu: {},
};
const PRIMARY: Btn[] = ['b1', 'b2', 'b3', 'b4', 'sprint', 'skillBtn', 'precise', 'modA', 'modB', 'pause'];
const COLORS: Partial<Record<Btn, string>> = { b1: '#3b82f6', b2: '#22c55e', b3: '#f59e0b', b4: '#ef4444' };

export class TouchControls {
  readonly root = document.createElement('div');
  private inner = document.createElement('div');
  readonly state = { mx: 0, my: 0, rx: 0, ry: 0, down: new Set<Btn>(), edgeDown: new Set<Btn>(), edgeUp: new Set<Btn>(), flicks: [] as Dir4[], skillSlots: [] as number[] };
  private buttons = new Map<string, HTMLDivElement>();
  private joyBase = document.createElement('div');
  private joyKnob = document.createElement('div');
  private joyPointer = -1;
  private joyOrigin = { x: 0, y: 0 };
  private pads = new Map<number, { btn: Btn; startX: number; startY: number; el: HTMLDivElement }>();
  private skillArmedUntil = 0;
  private flickPointer = -1;
  private flickStart = { x: 0, y: 0 };
  private flickDone = false;
  private context: Context = 'attack';
  private editing = false;
  private editSel: string | null = null;
  private lastB3 = 0;
  private b3Double = false;
  private swipeMod: Btn | null = null;
  private haptics = true;
  onFirstTouch: (() => void) | null = null;
  private orientationMsg = document.createElement('div');
  private toolbar: HTMLDivElement | null = null;
  private layoutLocal: Record<string, TouchButtonLayout> = {};

  constructor(parent: HTMLElement) {
    this.root.className = 'touch-root';
    this.inner.className = 'touch-inner';
    this.root.appendChild(this.inner);
    this.joyBase.className = 'joy-base'; this.joyKnob.className = 'joy-knob'; this.joyBase.appendChild(this.joyKnob); this.inner.appendChild(this.joyBase);
    this.orientationMsg.className = 'orient-msg'; this.orientationMsg.textContent = 'Rotate your device to landscape';
    this.root.appendChild(this.orientationMsg);
    for (const id of [...PRIMARY.filter((b) => b !== 'pause'), 'skill1', 'skill2', 'skill3', 'skill4', 'pause']) this.makeButton(id as Btn);
    parent.appendChild(this.root);
    // zone listeners on the whole overlay
    this.root.addEventListener('pointerdown', (e) => this.onZoneDown(e));
    this.root.addEventListener('pointermove', (e) => this.onZoneMove(e));
    const up = (e: PointerEvent): void => this.onZoneUp(e);
    this.root.addEventListener('pointerup', up); this.root.addEventListener('pointercancel', up);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    window.addEventListener('touchcancel', () => this.releaseAll());
    this.applyLayout();
    settings.on(() => this.applyLayout());
    this.setVisible(false);
  }

  setVisible(v: boolean): void { this.root.style.display = v ? 'block' : 'none'; if (!v) this.releaseAll(); }

  private sub = '';
  /** `sub` refines the set-piece context (kickoff, throwIn, goalKick, corner, freeKick, penalty). */
  setContext(c: Context, sub = ''): void {
    if (c === this.context && sub === this.sub) return;
    this.context = c; this.sub = sub;
    this.relabel();
  }

  private makeButton(id: Btn | string): void {
    const el = document.createElement('div');
    el.className = `tbtn tbtn-${id}`;
    el.dataset.id = id;
    el.style.touchAction = 'none';
    const label = document.createElement('span'); label.className = 'tbtn-label'; el.appendChild(label);
    this.inner.appendChild(el);
    this.buttons.set(id, el);
    el.addEventListener('pointerdown', (e) => this.onBtnDown(e, id as Btn, el));
    el.addEventListener('pointermove', (e) => this.onBtnMove(e, id as Btn));
    const up = (e: PointerEvent): void => this.onBtnUp(e, id as Btn, el);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }

  private relabel(): void {
    const labels: Partial<Record<Btn, string>> = { ...LABELS[this.context] };
    const SUB: Record<string, Partial<Record<Btn, string>>> = {
      kickoff: { b1: 'PASS', b2: '', b3: '', b4: '', modA: '', modB: '', precise: '', sprint: '' },
      throwIn: { b1: 'THROW', b2: '', b3: 'LONG', b4: 'QUICK', modA: '', modB: '', precise: 'AIM', sprint: '' },
      goalKick: { b1: 'SHORT', b2: '', b3: 'LONG', b4: 'LONG', modA: '', modB: '', precise: 'AIM', sprint: '' },
      corner: { b1: 'SHORT', b2: '', b3: 'CROSS', b4: 'CROSS', modA: 'OUTSWING', modB: 'INSWING', precise: 'AIM', sprint: '' },
      freeKick: { b1: 'SHORT', b2: 'THROUGH', b3: 'CROSS', b4: 'SHOOT', modA: 'WALL ◀', modB: 'WALL ▶', precise: 'AIM', sprint: '' },
      penalty: { b4: 'SHOOT', b3: 'CHIP', b1: 'LOW', precise: 'AIM' },
    };
    if (this.context === 'setpiece' || this.context === 'penalty') Object.assign(labels, SUB[this.sub] ?? {});
    for (const [id, el] of this.buttons) {
      const span = el.firstElementChild as HTMLSpanElement;
      if (id.startsWith('skill') && id !== 'skillBtn') continue;
      const t = labels[id as Btn];
      span.textContent = t ?? (id === 'pause' ? 'II' : '');
      el.classList.toggle('dim', !t && id !== 'pause');
      if (!id.startsWith('skill') || id === 'skillBtn') el.style.visibility = t || id === 'pause' || this.editing ? 'visible' : 'hidden';
      const col = COLORS[id as Btn];
      if (col) el.style.setProperty('--btn', col);
    }
    this.root.dataset.context = this.context;
    this.updateSkillLabels();
  }

  /** Update the 4 assignable skill button labels from the loadout. */
  updateSkillLabels(): void {
    const mode = settings.value.controls.touch.skillMode;
    const lo = settings.value.controls.skillLoadout;
    for (let i = 1; i <= 4; i++) {
      const el = this.buttons.get(`skill${i}`); if (!el) continue;
      const mv = skillById(lo[i - 1] ?? '');
      (el.firstElementChild as HTMLSpanElement).textContent = mv ? mv.name.split(' ').map((w) => w[0]).join('').slice(0, 3) + ' ' + '★'.repeat(mv.stars) : '—';
      el.style.display = mode === 'buttons' ? 'flex' : 'none';
    }
    const sb = this.buttons.get('skillBtn'); if (sb) sb.style.display = mode === 'flick' ? 'flex' : 'none';
  }

  applyLayout(): void {
    const t = settings.value.controls.touch;
    this.haptics = t.haptics;
    this.layoutLocal = { ...TOUCH_DEFAULT_LAYOUT, ...t.layout };
    this.root.style.setProperty('--op', String(t.opacity));
    const base = Math.min(window.innerWidth, window.innerHeight);
    const unit = Math.max(52, Math.min(96, base * 0.15));
    this.root.style.setProperty('--unit', `${unit}px`);
    for (const [id, el] of this.buttons) {
      const l = this.layoutLocal[id] ?? { x: 0.5, y: 0.5, s: 1 };
      el.style.left = `${l.x * 100}%`; el.style.top = `${l.y * 100}%`; el.style.width = el.style.height = `calc(var(--unit) * ${l.s})`;
    }
    const j = this.layoutLocal.joystick ?? { x: 0.14, y: 0.7, s: 1 };
    const js = t.joystickSize;
    this.joyBase.style.width = this.joyBase.style.height = `calc(var(--unit) * 1.9 * ${js})`;
    if (this.joyPointer < 0) { this.joyBase.style.left = `${j.x * 100}%`; this.joyBase.style.top = `${j.y * 100}%`; this.joyBase.classList.add('idle'); }
    this.relabel();
  }

  // ----- joystick / flick zone
  private onZoneDown(e: PointerEvent): void {
    this.onFirstTouch?.();
    if (e.target !== this.root && e.target !== this.inner && e.target !== this.joyBase && e.target !== this.joyKnob) return;
    if (this.editing) return;
    const rect = this.inner.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < rect.width * 0.5 && this.joyPointer < 0) {
      this.joyPointer = e.pointerId;
      this.joyOrigin = { x, y };
      this.joyBase.classList.remove('idle');
      this.joyBase.style.left = `${x}px`; this.joyBase.style.top = `${y}px`;
      this.root.setPointerCapture?.(e.pointerId);
    } else if (x >= rect.width * 0.5 && this.flickPointer < 0 && (performance.now() < this.skillArmedUntil || this.state.down.has('skillBtn'))) {
      this.flickPointer = e.pointerId; this.flickStart = { x: e.clientX, y: e.clientY }; this.flickDone = false;
    }
  }

  private onZoneMove(e: PointerEvent): void {
    if (e.pointerId === this.joyPointer) {
      const rect = this.inner.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const R = this.joyBase.offsetWidth / 2;
      let dx = x - this.joyOrigin.x, dy = y - this.joyOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // floating base follows the thumb when dragged past the edge
        const k = (d - R) / d;
        this.joyOrigin.x += dx * k; this.joyOrigin.y += dy * k;
        this.joyBase.style.left = `${this.joyOrigin.x}px`; this.joyBase.style.top = `${this.joyOrigin.y}px`;
        dx = x - this.joyOrigin.x; dy = y - this.joyOrigin.y;
      }
      const m = Math.min(1, Math.hypot(dx, dy) / R);
      const ang = Math.atan2(dy, dx);
      const dz = settings.value.controls.deadzone * 0.6;
      const sens = settings.value.controls.touch.joystickSensitivity;
      const mag = m < dz ? 0 : Math.min(1, ((m - dz) / (1 - dz)) * sens);
      this.state.mx = Math.cos(ang) * mag; this.state.my = Math.sin(ang) * mag;
      this.joyKnob.style.transform = `translate(${Math.cos(ang) * m * R * 0.7}px, ${Math.sin(ang) * m * R * 0.7}px)`;
    } else if (e.pointerId === this.flickPointer && !this.flickDone) {
      const dx = e.clientX - this.flickStart.x, dy = e.clientY - this.flickStart.y;
      if (Math.hypot(dx, dy) > 34) { this.flickDone = true; this.state.flicks.push(dirOf(dx, dy)); this.skillArmedUntil = 0; this.buttons.get('skillBtn')?.classList.remove('armed'); this.buzz(12); }
    }
  }

  private onZoneUp(e: PointerEvent): void {
    if (e.pointerId === this.joyPointer) {
      this.joyPointer = -1; this.state.mx = 0; this.state.my = 0;
      this.joyKnob.style.transform = 'translate(0,0)'; this.applyLayout();
    }
    if (e.pointerId === this.flickPointer) { this.flickPointer = -1; }
  }

  // ----- buttons
  private onBtnDown(e: PointerEvent, id: Btn | string, el: HTMLDivElement): void {
    e.stopPropagation(); e.preventDefault();
    this.onFirstTouch?.();
    if (this.editing) { this.beginDrag(e, id as string, el); return; }
    el.setPointerCapture?.(e.pointerId);
    if (typeof id === 'string' && id.startsWith('skill') && id !== 'skillBtn') {
      const slot = Number(id.slice(5)) - 1;
      this.state.skillSlots.push(slot); el.classList.add('down'); this.buzz(14); return;
    }
    const btn = id as Btn;
    if (btn === 'skillBtn') { this.skillArmedUntil = performance.now() + 1500; el.classList.add('armed'); this.state.down.add('skillBtn'); this.state.edgeDown.add('skillBtn'); el.classList.add('down'); this.buzz(10); return; }
    this.pads.set(e.pointerId, { btn, startX: e.clientX, startY: e.clientY, el });
    if (btn === 'b3') { const now = performance.now(); this.b3Double = now - this.lastB3 < 300; this.lastB3 = now; if (this.b3Double) { this.state.down.add('modA'); this.state.edgeDown.add('modA'); } }
    this.state.down.add(btn); this.state.edgeDown.add(btn);
    el.classList.add('down');
    this.buzz(btn === 'b4' ? 18 : 10);
  }

  private onBtnMove(e: PointerEvent, id: Btn | string): void {
    if (this.editing) { this.dragMove(e); return; }
    const p = this.pads.get(e.pointerId);
    if (!p || id !== 'b4') return;
    const dy = e.clientY - p.startY;
    // swipe on the shoot button: up = finesse, down = chip
    const want: Btn | null = dy < -42 ? 'modB' : dy > 42 ? 'modA' : null;
    if (want !== this.swipeMod) {
      if (this.swipeMod) { this.state.down.delete(this.swipeMod); this.state.edgeUp.add(this.swipeMod); }
      if (want) { this.state.down.add(want); this.state.edgeDown.add(want); this.buzz(10); }
      this.swipeMod = want;
    }
  }

  private onBtnUp(e: PointerEvent, id: Btn | string, el: HTMLDivElement): void {
    if (this.editing) { this.endDrag(e); return; }
    if (typeof id === 'string' && id.startsWith('skill') && id !== 'skillBtn') { el.classList.remove('down'); return; }
    const p = this.pads.get(e.pointerId);
    if (!p && id !== 'skillBtn') return;
    this.pads.delete(e.pointerId);
    const btn = id as Btn;
    if (this.state.down.has(btn)) { this.state.down.delete(btn); this.state.edgeUp.add(btn); }
    if (btn === 'b3' && this.b3Double) { this.state.down.delete('modA'); this.state.edgeUp.add('modA'); this.b3Double = false; }
    if (btn === 'b4' && this.swipeMod) { this.state.down.delete(this.swipeMod); this.state.edgeUp.add(this.swipeMod); this.swipeMod = null; }
    el.classList.remove('down');
  }

  private buzz(ms: number): void { if (this.haptics && 'vibrate' in navigator) try { navigator.vibrate(ms); } catch { /* unsupported */ } }
  haptic(ms: number): void { this.buzz(ms); }

  releaseAll(): void {
    for (const b of this.state.down) this.state.edgeUp.add(b);
    this.state.down.clear(); this.pads.clear(); this.state.mx = this.state.my = 0; this.joyPointer = -1; this.flickPointer = -1; this.swipeMod = null;
    for (const el of this.buttons.values()) el.classList.remove('down');
    this.joyKnob.style.transform = 'translate(0,0)';
  }

  // ----- layout editor
  private dragging: { id: string; pid: number; el: HTMLDivElement } | null = null;
  setEditing(on: boolean): void {
    this.editing = on;
    this.root.classList.toggle('editing', on);
    this.setVisible(true);
    for (const b of this.buttons.values()) { b.classList.remove('dim'); }
    if (on) this.showToolbar(); else { this.toolbar?.remove(); this.toolbar = null; this.relabel(); }
    this.updateSkillLabels();
    if (on) for (const id of ['skill1', 'skill2', 'skill3', 'skill4', 'skillBtn']) { const e = this.buttons.get(id); if (e) e.style.display = 'flex'; }
    // joystick placeholder is draggable too
    this.joyBase.classList.toggle('idle', true);
  }

  private beginDrag(e: PointerEvent, id: string, el: HTMLDivElement): void {
    this.dragging = { id, pid: e.pointerId, el }; this.editSel = id;
    el.setPointerCapture?.(e.pointerId);
    for (const b of this.buttons.values()) b.classList.remove('selected'); el.classList.add('selected');
    this.refreshToolbar();
  }
  private dragMove(e: PointerEvent): void {
    if (!this.dragging || e.pointerId !== this.dragging.pid) return;
    const rect = this.inner.getBoundingClientRect();
    const x = Math.min(0.97, Math.max(0.03, (e.clientX - rect.left) / rect.width)), y = Math.min(0.97, Math.max(0.03, (e.clientY - rect.top) / rect.height));
    this.setLayout(this.dragging.id, { x, y });
  }
  private endDrag(e: PointerEvent): void { if (this.dragging && e.pointerId === this.dragging.pid) this.dragging = null; }
  private setLayout(id: string, patch: Partial<TouchButtonLayout>): void {
    settings.update((s) => { const cur = s.controls.touch.layout[id] ?? this.layoutLocal[id] ?? { x: 0.5, y: 0.5, s: 1 }; s.controls.touch.layout[id] = { ...cur, ...patch }; });
  }

  private showToolbar(): void {
    const tb = document.createElement('div'); tb.className = 'touch-toolbar';
    tb.innerHTML = `<b>Layout editor</b> <span class="sel">drag a button</span>
      <label>Size <input type="range" class="sz" min="0.4" max="1.8" step="0.05" value="1"></label>
      <label>Opacity <input type="range" class="op" min="0.2" max="1" step="0.05"></label>
      <button class="save">Save preset</button><button class="reset">Reset</button><button class="done">Done</button>`;
    tb.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(tb); this.toolbar = tb;
    (tb.querySelector('.sz') as HTMLInputElement).oninput = (ev): void => { if (this.editSel) this.setLayout(this.editSel, { s: Number((ev.target as HTMLInputElement).value) }); };
    const op = tb.querySelector('.op') as HTMLInputElement; op.value = String(settings.value.controls.touch.opacity);
    op.oninput = (ev): void => settings.update((s) => { s.controls.touch.opacity = Number((ev.target as HTMLInputElement).value); });
    (tb.querySelector('.reset') as HTMLButtonElement).onclick = (): void => settings.update((s) => { s.controls.touch.layout = structuredClone(TOUCH_DEFAULT_LAYOUT); });
    (tb.querySelector('.save') as HTMLButtonElement).onclick = (): void => { const name = prompt('Preset name?', `Layout ${Object.keys(settings.value.controls.touch.presets).length + 1}`); if (name) settings.update((s) => { s.controls.touch.presets[name] = structuredClone(s.controls.touch.layout); }); };
    (tb.querySelector('.done') as HTMLButtonElement).onclick = (): void => this.setEditing(false);
  }
  private refreshToolbar(): void {
    if (!this.toolbar || !this.editSel) return;
    (this.toolbar.querySelector('.sel') as HTMLElement).textContent = this.editSel;
    (this.toolbar.querySelector('.sz') as HTMLInputElement).value = String((this.layoutLocal[this.editSel] ?? { s: 1 }).s);
  }
}
