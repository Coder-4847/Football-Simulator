import { BUTTONS, emptyFrame, type Btn, type FrameInput } from './actions';
import { FlickDetector, GestureRecognizer, dirOf, type Dir4 } from './gestures';
import { settings, type KeyBindings } from '../core/settings';
import { TouchControls } from './touch';
import type { Device } from './prompts';
import { isMobile } from '../render/quality';

export interface SlotScheme { keyboard: 'p1' | 'p2' | null; pad: number | null; touch: boolean; mouse: boolean }

interface SlotState {
  scheme: SlotScheme;
  kbDown: Set<string>;               // physical key codes currently held (scheme-specific)
  mouseDown: Set<number>;
  padDown: Record<Btn, boolean>;
  prev: Record<Btn, boolean>;
  edgeDown: Set<Btn>; edgeUp: Set<Btn>;
  held: Record<Btn, number>;
  gestures: GestureRecognizer;
  rFlick: FlickDetector;
  pendingFlicks: Dir4[];
  pendingSlots: number[];
  device: Device;
  mouseAim: { x: number; y: number; t: number };
  padPrevRight: { x: number; y: number };
}

const rec = <T>(v: T): Record<Btn, T> => Object.fromEntries(BUTTONS.map((b) => [b, v])) as Record<Btn, T>;

export class InputManager {
  slots: SlotState[] = [];
  touch: TouchControls | null = null;
  active: Device = 'keyboard';
  onDevice: ((d: Device) => void) | null = null;
  onPad: ((id: string | null) => void) | null = null;
  /** radians to rotate stick input by (camera yaw) */
  yaw = 0;
  aimMode = false;
  private time = 0;
  private codeMap = new Map<string, Array<{ slot: number; btn: Btn | 'up' | 'down' | 'left' | 'right' | 'rUp' | 'rDown' | 'rLeft' | 'rRight' }>>();
  private target: HTMLElement;
  private enabled = true;
  private lastTouchAt = -1e9;
  private bound: Array<[EventTarget, string, EventListener]> = [];
  private mousePos = { x: 0, y: 0 };

  constructor(target: HTMLElement, withTouch: boolean) {
    this.target = target;
    this.setSlots([{ keyboard: 'p1', pad: 0, touch: true, mouse: true }]);
    if (withTouch) {
      this.touch = new TouchControls(target);
      this.touch.onFirstTouch = (): void => this.setDevice('touch');
    }
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen(target, 'mousedown', (e) => this.onMouse(e as MouseEvent, true));
    this.listen(window, 'mouseup', (e) => this.onMouse(e as MouseEvent, false));
    this.listen(target, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'mousemove', (e) => this.onMouseMove(e as MouseEvent));
    this.listen(window, 'gamepadconnected', (e) => { this.setDevice('gamepad'); this.onPad?.((e as GamepadEvent).gamepad.id); });
    this.listen(window, 'gamepaddisconnected', () => this.onPad?.(null));
    this.listen(window, 'pointerdown', (e) => { const pt = (e as PointerEvent).pointerType; if (pt === 'touch') { this.lastTouchAt = performance.now(); this.setDevice('touch'); } else if (pt === 'mouse' && withTouch && this.active === 'touch') this.setDevice('keyboard'); }, true);
    if (isMobile()) this.active = 'touch';
    settings.on(() => this.rebuild());
    this.rebuild();
  }

  private listen(t: EventTarget, ev: string, fn: EventListener, capture = false): void { t.addEventListener(ev, fn, capture); this.bound.push([t, ev, fn]); }
  dispose(): void { for (const [t, e, f] of this.bound) t.removeEventListener(e, f); this.touch?.root.remove(); }

  setEnabled(v: boolean): void { this.enabled = v; if (!v) this.releaseAll(); }

  setSlots(schemes: SlotScheme[]): void {
    this.slots = schemes.map((scheme) => ({
      scheme, kbDown: new Set(), mouseDown: new Set(), padDown: rec(false), prev: rec(false), edgeDown: new Set(), edgeUp: new Set(), held: rec(0),
      gestures: new GestureRecognizer(), rFlick: new FlickDetector(), pendingFlicks: [], pendingSlots: [], device: 'keyboard',
      mouseAim: { x: 0, y: 0, t: -10 }, padPrevRight: { x: 0, y: 0 },
    }));
    this.rebuild();
  }

  /** Rebuilds the keycode lookup after bindings changed. */
  private rebuild(): void {
    this.codeMap.clear();
    const c = settings.value.controls;
    this.slots.forEach((s, slot) => {
      if (!s.scheme.keyboard) return;
      const kb: KeyBindings = s.scheme.keyboard === 'p1' ? c.keyboard : c.keyboardP2;
      for (const [name, codes] of Object.entries(kb)) for (const code of codes) {
        const arr = this.codeMap.get(code) ?? []; arr.push({ slot, btn: name as Btn }); this.codeMap.set(code, arr);
      }
      s.gestures.bindings = Object.fromEntries(Object.entries(c.skillBindings).map(([move, seq]) => [seq, move]));
    });
    this.touch?.applyLayout();
  }

  private setDevice(d: Device): void {
    const pref = settings.value.controls.device;
    if (pref !== 'auto' && pref !== d) return;
    if (this.active !== d) { this.active = d; this.onDevice?.(d); }
    this.touch?.root.classList.toggle('active', d === 'touch');
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const hits = this.codeMap.get(e.code);
    if (!hits) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.ctrlKey || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    this.setDevice('keyboard');
    for (const h of hits) {
      const s = this.slots[h.slot]!;
      if (down) s.kbDown.add(e.code + '|' + h.btn); else s.kbDown.delete(e.code + '|' + h.btn);
      s.device = 'keyboard';
      if (['rUp', 'rDown', 'rLeft', 'rRight'].includes(h.btn) && down) {
        const d: Dir4 = h.btn === 'rUp' ? 'U' : h.btn === 'rDown' ? 'D' : h.btn === 'rLeft' ? 'L' : 'R';
        s.pendingFlicks.push(d);
      }
      if (!['up', 'down', 'left', 'right', 'rUp', 'rDown', 'rLeft', 'rRight'].includes(h.btn)) {
        if (down) s.edgeDown.add(h.btn as Btn); else s.edgeUp.add(h.btn as Btn);
      }
    }
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    if (!this.enabled) return;
    const slot = this.slots.findIndex((s) => s.scheme.mouse);
    if (slot < 0) return;
    const s = this.slots[slot]!;
    if (down && (e.target as HTMLElement).closest?.('.ui-layer')) return;
    if (performance.now() - this.lastTouchAt < 800) return; // compatibility mouse events after a touch
    this.setDevice('keyboard');
    const btn: Btn | null = e.button === 0 ? 'b1' : e.button === 2 ? 'b2' : null;
    if (e.button === 1 && down) { e.preventDefault(); }
    if (!btn) return;
    if (down) { s.mouseDown.add(e.button); s.edgeDown.add(btn); } else { s.mouseDown.delete(e.button); s.edgeUp.add(btn); }
  }

  private onMouseMove(e: MouseEvent): void {
    const slot = this.slots.findIndex((s) => s.scheme.mouse);
    if (slot < 0) return;
    const r = this.target.getBoundingClientRect();
    this.mousePos = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
    const s = this.slots[slot]!;
    s.mouseAim = { x: this.mousePos.x, y: this.mousePos.y, t: this.time };
    // middle-button / alt held: mouse gestures act as skill flicks
    if (e.buttons & 4 || e.altKey) {
      const mx = e.movementX, my = e.movementY;
      if (Math.hypot(mx, my) > 14) s.pendingFlicks.push(dirOf(mx, my));
    }
  }

  releaseAll(): void {
    for (const s of this.slots) { s.kbDown.clear(); s.mouseDown.clear(); s.padDown = rec(false); }
    this.touch?.releaseAll();
  }

  vibrate(slot: number, ms: number, strong = 0.6, weak = 0.4): void {
    if (!settings.value.controls.vibration) return;
    const s = this.slots[slot];
    if (!s) return;
    if (s.device === 'touch') { this.touch?.haptic(ms); return; }
    if (s.device === 'gamepad' && s.scheme.pad !== null) {
      const pad = navigator.getGamepads?.()[s.scheme.pad] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null | undefined;
      void pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    }
  }

  /** Called once per simulation tick; returns the current frame for a slot. */
  frame(slotIdx: number, dt: number): FrameInput {
    this.time += dt / Math.max(1, this.slots.length);
    const s = this.slots[slotIdx];
    const f = emptyFrame();
    if (!s || !this.enabled) return f;
    const c = settings.value.controls;
    const down = rec(false);
    let mx = 0, my = 0, rx = 0, ry = 0;

    // ---- keyboard
    if (s.scheme.keyboard) {
      const names = [...s.kbDown].map((k) => k.split('|')[1]!);
      const has = (n: string): boolean => names.includes(n);
      if (has('left')) mx -= 1; if (has('right')) mx += 1; if (has('up')) my -= 1; if (has('down')) my += 1;
      if (mx !== 0 && my !== 0) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
      for (const b of BUTTONS) if (has(b)) down[b] = true;
      if (s.mouseDown.has(0)) down.b1 = true; if (s.mouseDown.has(2)) down.b2 = true;
      // mouse aim (set pieces) overrides WASD for a while after the mouse moved
      if (this.aimMode && c.mouseAim && this.time - s.mouseAim.t < 2.5 && s.scheme.mouse) { mx = Math.max(-1, Math.min(1, s.mouseAim.x * 1.15)); my = Math.max(-1, Math.min(1, s.mouseAim.y * 1.15)); }
      if (has('rLeft')) rx -= 1; if (has('rRight')) rx += 1; if (has('rUp')) ry -= 1; if (has('rDown')) ry += 1;
      if (mx || my || Object.values(down).some(Boolean)) s.device = 'keyboard';
    }

    // ---- gamepad
    if (s.scheme.pad !== null) {
      // pick the Nth *connected* pad (browsers keep empty slots and hide pads until a button is pressed)
      const pads = [...(navigator.getGamepads?.() ?? [])].filter((g): g is Gamepad => !!g && g.connected);
      const pad = pads[s.scheme.pad] ?? null;
      if (pad && pad.connected) {
        const dz = c.deadzone;
        const ax = (i: number): number => pad.axes[i] ?? 0;
        let lx = ax(0), ly = ax(1);
        const lm = Math.hypot(lx, ly);
        if (lm < dz) { lx = 0; ly = 0; } else { const k = Math.min(1, (lm - dz) / (1 - dz)) / lm; lx *= k * c.sensitivity; ly *= k * c.sensitivity; }
        let rx2 = ax(2), ry2 = ax(3);
        const rm = Math.hypot(rx2, ry2);
        if (rm < dz) { rx2 = 0; ry2 = 0; }
        // d-pad also moves
        const dpad = (i: number): boolean => !!pad.buttons[i]?.pressed;
        if (dpad(14)) lx = -1; if (dpad(15)) lx = 1; if (dpad(12)) ly = -1; if (dpad(13)) ly = 1;
        const padBtn: Record<Btn, boolean> = rec(false);
        for (const b of BUTTONS) for (const i of c.gamepad[b] ?? []) if (pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5) padBtn[b] = true;
        const any = Math.abs(lx) > 0.1 || Math.abs(ly) > 0.1 || Object.values(padBtn).some(Boolean) || rm > 0.5;
        if (any) { s.device = 'gamepad'; this.setDevice('gamepad'); }
        if (s.device === 'gamepad') {
          if (Math.hypot(lx, ly) > Math.hypot(mx, my)) { mx = lx; my = ly; }
          if (rm >= dz) { rx = rx2; ry = ry2; }
          for (const b of BUTTONS) if (padBtn[b]) down[b] = true;
          // flick detection on the right stick
          const d = s.rFlick.update(rx2, ry2, this.time);
          if (d) s.pendingFlicks.push(d);
        }
      }
    }

    // ---- touch
    const t = this.touch;
    if (t && s.scheme.touch && (this.active === 'touch' || t.state.down.size || t.state.mx || t.state.my)) {
      if (Math.hypot(t.state.mx, t.state.my) > Math.hypot(mx, my)) { mx = t.state.mx; my = t.state.my; }
      for (const b of t.state.down) down[b] = true;
      for (const b of t.state.edgeDown) s.edgeDown.add(b);
      for (const b of t.state.edgeUp) s.edgeUp.add(b);
      t.state.edgeDown.clear(); t.state.edgeUp.clear();
      for (const d of t.state.flicks) s.pendingFlicks.push(d);
      for (const sl of t.state.skillSlots) s.pendingSlots.push(sl);
      t.state.flicks.length = 0; t.state.skillSlots.length = 0;
      if (t.state.mx || t.state.my) s.device = 'touch';
    }

    // ---- edges & hold times
    for (const b of BUTTONS) {
      const isDown = down[b];
      const pressed = (isDown && !s.prev[b]) || s.edgeDown.has(b);
      const released = (!isDown && s.prev[b]) || (s.edgeUp.has(b) && !isDown);
      if (pressed && !s.prev[b]) s.held[b] = 0;
      if (isDown) s.held[b] += dt;
      f.pressed[b] = pressed; f.released[b] = released;
      f.down[b] = isDown;
      f.held[b] = isDown ? s.held[b] : 0;
      if (released) { f.heldAtRelease[b] = Math.max(s.held[b], 0.03); s.held[b] = 0; }
      s.prev[b] = isDown;
    }
    s.edgeDown.clear(); s.edgeUp.clear();

    // ---- skills
    s.gestures.bindings = Object.fromEntries(Object.entries(c.skillBindings).map(([move, seq]) => [seq, move]));
    for (const d of s.pendingFlicks) { const r = s.gestures.flick(d, this.time); if (r) { if (r.moveId) f.skillMoveId = r.moveId; else f.skillSlot = r.slot; } }
    const p = s.gestures.poll(this.time);
    if (p) { if (p.moveId) f.skillMoveId = p.moveId; else f.skillSlot = p.slot; }
    s.pendingFlicks.length = 0;
    for (const sl of s.pendingSlots) f.skillSlot = sl;
    s.pendingSlots.length = 0;
    for (let i = 1; i <= 4; i++) if (f.pressed[`skill${i}` as Btn]) f.skillSlot = i - 1;
    // arrow/mouse flicks also count as right-stick direction for the frame
    if (f.skillSlot >= 0) { const v = [[0, -1], [1, 0], [0, 1], [-1, 0]][f.skillSlot]!; rx = rx || v[0]!; ry = ry || v[1]!; }

    // ---- rotate stick by camera yaw
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    f.mx = mx * cy - my * sy; f.my = mx * sy + my * cy;
    f.rx = rx * cy - ry * sy; f.ry = rx * sy + ry * cy;
    f.device = s.device;
    return f;
  }
}
