import { h, clear, toast } from './dom';
import { settings, DEFAULT_KEYBOARD, DEFAULT_KEYBOARD_P2, DEFAULT_PAD, type Settings } from '../core/settings';
import { audio } from '../audio/engine';
import { PRESETS, type QualityName } from '../render/quality';
import { CAMERA_MODES } from '../render/camera';
import { DIFFICULTIES } from '../match/types';
import { SKILL_MOVES, skillById } from '../match/skills';
import { findKeyConflicts, findPadConflicts, keyLabel, padLabel } from '../input/prompts';
import { FlickDetector, dirOf, type Dir4 } from '../input/gestures';
import { downloadJson, pickJsonFile } from '../core/storage';
import type { InputManager } from '../input/manager';

type Tab = 'Graphics' | 'Audio' | 'Controls' | 'Gameplay';
const TABS: Tab[] = ['Graphics', 'Audio', 'Controls', 'Gameplay'];

interface Item { tab: Tab; name: string; desc?: string; build: () => HTMLElement; keywords?: string }

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function toggle(get: () => boolean, set: (v: boolean) => void): HTMLElement {
  return h('input', { class: 'toggle', type: 'checkbox', checked: get(), onchange: (e: Event): void => { set((e.target as HTMLInputElement).checked); audio.ui('click'); } });
}
function range(get: () => number, set: (v: number) => void, min = 0, max = 1, step = 0.05, fmt: (v: number) => string = pct): HTMLElement {
  const val = h('span', { class: 'muted', style: 'min-width:44px;text-align:right' }, fmt(get()));
  const input = h('input', { type: 'range', min, max, step, value: get(), oninput: (e: Event): void => { const v = Number((e.target as HTMLInputElement).value); set(v); val.textContent = fmt(v); } });
  return h('div', { class: 'row', style: 'width:100%' }, input, val);
}
function seg<T extends string | number>(opts: Array<[T, string]>, get: () => T, set: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'seg' });
  const render = (): void => { clear(wrap); for (const [v, label] of opts) wrap.appendChild(h('button', { class: get() === v ? 'on' : '', onclick: (): void => { set(v); audio.ui('click'); render(); } }, label)); };
  render(); return wrap;
}
function select<T extends string | number>(opts: Array<[T, string]>, get: () => T, set: (v: T) => void): HTMLElement {
  return h('select', { onchange: (e: Event): void => { const idx = (e.target as HTMLSelectElement).selectedIndex; set(opts[idx]![0]); } }, opts.map(([v, l]) => h('option', { value: String(v), selected: v === get() }, l)));
}

export function buildSettings(parent: HTMLElement, input: InputManager | null, opts: { onBack?: () => void } = {}): void {
  const s = (): Settings => settings.value;
  const upd = (fn: (s: Settings) => void): void => settings.update(fn);
  let tab: Tab = 'Graphics';
  let query = '';

  const items: Item[] = [
    // ---------------- graphics
    { tab: 'Graphics', name: 'Quality preset', desc: 'Low · Medium · High · Ultra. Mobile defaults to Low.', build: () => seg<QualityName>([['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High'], ['Ultra', 'Ultra'], ['Custom', 'Custom']], () => s().graphics.preset, (v) => upd((x) => { x.graphics.preset = v; })) },
    { tab: 'Graphics', name: 'Resolution scale', desc: 'Render resolution multiplier.', build: () => range(() => s().graphics.resolutionScale, (v) => upd((x) => { x.graphics.resolutionScale = v; }), 0.5, 1.5, 0.05) },
    { tab: 'Graphics', name: 'Shadows', desc: 'Custom preset only.', build: () => select([['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as Array<['off' | 'low' | 'medium' | 'high', string]>, () => s().graphics.custom.shadows ?? PRESETS.High.shadows, (v) => upd((x) => { x.graphics.custom.shadows = v; x.graphics.custom.shadowMapSize = v === 'high' ? 4096 : v === 'medium' ? 2048 : 1024; x.graphics.preset = 'Custom'; })) },
    { tab: 'Graphics', name: 'Anti-aliasing', desc: 'Custom preset only.', build: () => select([['off', 'Off'], ['fxaa', 'FXAA'], ['smaa', 'SMAA'], ['msaa', 'MSAA 4×']] as Array<['off' | 'fxaa' | 'smaa' | 'msaa', string]>, () => s().graphics.custom.antialias ?? 'msaa', (v) => upd((x) => { x.graphics.custom.antialias = v; x.graphics.preset = 'Custom'; })) },
    { tab: 'Graphics', name: 'Bloom', build: () => toggle(() => s().graphics.custom.bloom ?? PRESETS[(s().graphics.preset === 'Custom' ? 'High' : s().graphics.preset) as 'High'].bloom, (v) => upd((x) => { x.graphics.custom.bloom = v; x.graphics.preset = 'Custom'; })) },
    { tab: 'Graphics', name: 'Film grain', build: () => toggle(() => s().graphics.custom.filmGrain ?? false, (v) => upd((x) => { x.graphics.custom.filmGrain = v; x.graphics.preset = 'Custom'; })) },
    { tab: 'Graphics', name: 'Motion blur', build: () => toggle(() => s().graphics.custom.motionBlur ?? false, (v) => upd((x) => { x.graphics.custom.motionBlur = v; x.graphics.preset = 'Custom'; })) },
    { tab: 'Graphics', name: 'Crowd density', build: () => range(() => s().graphics.custom.crowd ?? PRESETS.High.crowd, (v) => upd((x) => { x.graphics.custom.crowd = v; x.graphics.preset = 'Custom'; })) },
    { tab: 'Graphics', name: 'Grass quality', desc: 'Blade instances near the camera.', build: () => seg<number>([[0, 'Texture'], [14000, 'Blades'], [40000, 'Dense']], () => s().graphics.custom.grassBlades ?? 14000, (v) => upd((x) => { x.graphics.custom.grassBlades = v; x.graphics.preset = 'Custom'; })) },
    { tab: 'Graphics', name: 'Weather effects', build: () => toggle(() => s().graphics.weatherEffects, (v) => upd((x) => { x.graphics.weatherEffects = v; })) },
    { tab: 'Graphics', name: 'Ball trail', build: () => toggle(() => s().graphics.ballTrail, (v) => upd((x) => { x.graphics.ballTrail = v; })) },
    { tab: 'Graphics', name: 'Colour grade', build: () => seg([['broadcast', 'Broadcast'], ['cinematic', 'Cinematic'], ['natural', 'Natural']] as Array<['broadcast' | 'cinematic' | 'natural', string]>, () => s().graphics.grade, (v) => upd((x) => { x.graphics.grade = v; })) },
    { tab: 'Graphics', name: 'Frame-rate cap', desc: 'VSync-style limiter.', keywords: 'fps vsync', build: () => seg<number>([[30, '30'], [60, '60'], [120, '120'], [0, 'Uncapped']], () => s().graphics.fpsCap, (v) => upd((x) => { x.graphics.fpsCap = v as 0 | 30 | 60 | 120; })) },
    { tab: 'Graphics', name: 'Show FPS counter', build: () => toggle(() => s().graphics.showFps, (v) => upd((x) => { x.graphics.showFps = v; })) },
    { tab: 'Graphics', name: 'Fullscreen', build: () => h('button', { class: 'btn small', onclick: (): void => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); } }, 'Toggle fullscreen') },
    // ---------------- audio
    { tab: 'Audio', name: 'Master volume', build: () => range(() => s().audio.master, (v) => upd((x) => { x.audio.master = v; })) },
    { tab: 'Audio', name: 'Music', build: () => range(() => s().audio.music, (v) => upd((x) => { x.audio.music = v; })) },
    { tab: 'Audio', name: 'Crowd', build: () => range(() => s().audio.crowd, (v) => upd((x) => { x.audio.crowd = v; })) },
    { tab: 'Audio', name: 'Sound effects', build: () => range(() => s().audio.sfx, (v) => upd((x) => { x.audio.sfx = v; })) },
    { tab: 'Audio', name: 'Menu music', build: () => toggle(() => s().audio.menuMusic, (v) => upd((x) => { x.audio.menuMusic = v; if (v) audio.startMusic('menu'); else audio.stopMusic(); })) },
    { tab: 'Audio', name: 'Mute when tab is hidden', build: () => toggle(() => s().audio.muteOnBlur, (v) => upd((x) => { x.audio.muteOnBlur = v; })) },
    { tab: 'Audio', name: 'Dynamic crowd intensity', desc: 'Crowd reacts to chances and goals.', build: () => toggle(() => s().audio.dynamicCrowd, (v) => upd((x) => { x.audio.dynamicCrowd = v; })) },
    { tab: 'Audio', name: 'Commentary ticker', desc: 'Text commentary during play.', build: () => toggle(() => s().gameplay.ticker, (v) => upd((x) => { x.gameplay.ticker = v; })) },
    { tab: 'Audio', name: 'Spoken commentary (TTS)', desc: 'Uses the browser speech engine. Off by default.', build: () => toggle(() => s().audio.tts, (v) => upd((x) => { x.audio.tts = v; })) },
    // ---------------- gameplay
    { tab: 'Gameplay', name: 'Difficulty', build: () => select(DIFFICULTIES.map((d) => [d, d] as [string, string]), () => s().gameplay.difficulty, (v) => upd((x) => { x.gameplay.difficulty = v as typeof x.gameplay.difficulty; })) },
    { tab: 'Gameplay', name: 'Match length (per half)', build: () => seg<number>([3, 5, 8, 10, 15, 20].map((n) => [n, `${n}m`] as [number, string]), () => s().gameplay.halfLength, (v) => upd((x) => { x.gameplay.halfLength = v; })) },
    { tab: 'Gameplay', name: 'Game speed', build: () => seg([['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']] as Array<['slow' | 'normal' | 'fast', string]>, () => s().gameplay.gameSpeed, (v) => upd((x) => { x.gameplay.gameSpeed = v; })) },
    { tab: 'Gameplay', name: 'Referee strictness', build: () => range(() => s().gameplay.refStrictness, (v) => upd((x) => { x.gameplay.refStrictness = v; })) },
    { tab: 'Gameplay', name: 'Foul frequency', build: () => range(() => s().gameplay.foulFrequency, (v) => upd((x) => { x.gameplay.foulFrequency = v; }), 0, 2, 0.1, (v) => `${v.toFixed(1)}×`) },
    { tab: 'Gameplay', name: 'Offside', build: () => toggle(() => s().gameplay.offside, (v) => upd((x) => { x.gameplay.offside = v; })) },
    { tab: 'Gameplay', name: 'Injuries', build: () => toggle(() => s().gameplay.injuries, (v) => upd((x) => { x.gameplay.injuries = v; })) },
    { tab: 'Gameplay', name: 'Fatigue', build: () => toggle(() => s().gameplay.fatigue, (v) => upd((x) => { x.gameplay.fatigue = v; })) },
    { tab: 'Gameplay', name: 'VAR reviews', build: () => toggle(() => s().gameplay.var, (v) => upd((x) => { x.gameplay.var = v; })) },
    { tab: 'Gameplay', name: 'Dynamic difficulty', desc: 'AI quality adapts gently to the scoreline.', build: () => toggle(() => s().gameplay.dynamicDifficulty, (v) => upd((x) => { x.gameplay.dynamicDifficulty = v; })) },
    { tab: 'Gameplay', name: 'Extra time & penalties (cups)', build: () => toggle(() => s().gameplay.extraTimeAndPens, (v) => upd((x) => { x.gameplay.extraTimeAndPens = v; })) },
    { tab: 'Gameplay', name: 'Default camera', build: () => select(CAMERA_MODES.map((c) => [c.id, c.name] as [string, string]), () => s().gameplay.camera, (v) => upd((x) => { x.gameplay.camera = v as typeof x.gameplay.camera; })) },
    { tab: 'Gameplay', name: 'Camera height', build: () => range(() => s().gameplay.cameraHeight, (v) => upd((x) => { x.gameplay.cameraHeight = v; }), 0.6, 1.6, 0.05, (v) => `${v.toFixed(2)}×`) },
    { tab: 'Gameplay', name: 'Camera zoom', build: () => range(() => s().gameplay.cameraZoom, (v) => upd((x) => { x.gameplay.cameraZoom = v; }), 0.6, 1.6, 0.05, (v) => `${v.toFixed(2)}×`) },
    { tab: 'Gameplay', name: 'Radar', build: () => toggle(() => s().gameplay.radar, (v) => upd((x) => { x.gameplay.radar = v; })) },
    { tab: 'Gameplay', name: 'Player names', build: () => toggle(() => s().gameplay.playerNames, (v) => upd((x) => { x.gameplay.playerNames = v; })) },
    { tab: 'Gameplay', name: 'Stamina bars', build: () => toggle(() => s().gameplay.staminaBars, (v) => upd((x) => { x.gameplay.staminaBars = v; })) },
    { tab: 'Gameplay', name: 'Language', desc: 'English first; strings are structured for translation.', build: () => select([['en', 'English']], () => s().gameplay.language, (v) => upd((x) => { x.gameplay.language = v; })) },
    // ---------------- controls
    { tab: 'Controls', name: 'Input device', build: () => seg([['auto', 'Auto'], ['keyboard', 'Keyboard'], ['gamepad', 'Gamepad'], ['touch', 'Touch']] as Array<['auto' | 'keyboard' | 'gamepad' | 'touch', string]>, () => s().controls.device, (v) => upd((x) => { x.controls.device = v; })) },
    { tab: 'Controls', name: 'Stick sensitivity', build: () => range(() => s().controls.sensitivity, (v) => upd((x) => { x.controls.sensitivity = v; }), 0.5, 1.5, 0.05, (v) => `${v.toFixed(2)}×`) },
    { tab: 'Controls', name: 'Stick deadzone', build: () => range(() => s().controls.deadzone, (v) => upd((x) => { x.controls.deadzone = v; }), 0.05, 0.4, 0.01) },
    { tab: 'Controls', name: 'Vibration / haptics', build: () => toggle(() => s().controls.vibration, (v) => upd((x) => { x.controls.vibration = v; })) },
    { tab: 'Controls', name: 'Mouse aiming at set pieces', build: () => toggle(() => s().controls.mouseAim, (v) => upd((x) => { x.controls.mouseAim = v; })) },
    { tab: 'Controls', name: 'Pass assist', build: () => range(() => s().controls.assist.pass, (v) => upd((x) => { x.controls.assist.pass = v; })) },
    { tab: 'Controls', name: 'Shot assist', build: () => range(() => s().controls.assist.shot, (v) => upd((x) => { x.controls.assist.shot = v; })) },
    { tab: 'Controls', name: 'Cross assist', build: () => range(() => s().controls.assist.cross, (v) => upd((x) => { x.controls.assist.cross = v; })) },
    { tab: 'Controls', name: 'Keeper assist', build: () => range(() => s().controls.assist.keeper, (v) => upd((x) => { x.controls.assist.keeper = v; })) },
    { tab: 'Controls', name: 'Aim assist', build: () => range(() => s().controls.assist.aim, (v) => upd((x) => { x.controls.assist.aim = v; })) },
    { tab: 'Controls', name: 'Auto-switch player', build: () => toggle(() => s().controls.assist.autoSwitch, (v) => upd((x) => { x.controls.assist.autoSwitch = v; })) },
    { tab: 'Controls', name: 'Touch: auto-assist', desc: 'Auto-pass targeting, auto-switch and assisted shooting.', build: () => range(() => s().controls.touch.autoAssist, (v) => upd((x) => { x.controls.touch.autoAssist = v; })) },
    { tab: 'Controls', name: 'Touch: joystick size', build: () => range(() => s().controls.touch.joystickSize, (v) => upd((x) => { x.controls.touch.joystickSize = v; }), 0.6, 1.6, 0.05, (v) => `${v.toFixed(2)}×`) },
    { tab: 'Controls', name: 'Touch: joystick sensitivity', build: () => range(() => s().controls.touch.joystickSensitivity, (v) => upd((x) => { x.controls.touch.joystickSensitivity = v; }), 0.6, 1.6, 0.05, (v) => `${v.toFixed(2)}×`) },
    { tab: 'Controls', name: 'Touch: skill input', desc: 'Skill button + flick on the right pad, or four assignable skill buttons.', build: () => seg([['flick', 'Skill + flick'], ['buttons', '4 buttons']] as Array<['flick' | 'buttons', string]>, () => s().controls.touch.skillMode, (v) => upd((x) => { x.controls.touch.skillMode = v; })) },
    { tab: 'Controls', name: 'Touch: haptics', build: () => toggle(() => s().controls.touch.haptics, (v) => upd((x) => { x.controls.touch.haptics = v; })) },
    { tab: 'Controls', name: 'Touch: layout editor', desc: 'Drag and resize every button, adjust opacity, save presets.', build: () => h('button', { class: 'btn small', onclick: (): void => { if (input?.touch) { input.touch.setEditing(true); parent.closest('.screen, .modal-bg')?.setAttribute('style', 'display:none'); toast('Drag buttons. Press Done when finished.'); const done = setInterval(() => { if (!input.touch!.root.classList.contains('editing')) { clearInterval(done); parent.closest('.screen, .modal-bg')?.removeAttribute('style'); input.touch!.setVisible(false); } }, 300); } else toast('Touch controls are not available'); } }, 'Open editor') },
  ];

  const body = h('div');
  const tabsEl = h('div', { class: 'tabs' });
  const search = h('input', { type: 'search', placeholder: 'Search settings…', style: 'max-width:320px', oninput: (e: Event): void => { query = (e.target as HTMLInputElement).value.toLowerCase(); render(); } });

  const render = (): void => {
    clear(tabsEl); clear(body);
    if (!query) for (const t of TABS) tabsEl.appendChild(h('button', { class: t === tab ? 'on' : '', onclick: (): void => { tab = t; audio.ui('click'); render(); } }, t));
    const list = query ? items.filter((i) => `${i.name} ${i.desc ?? ''} ${i.keywords ?? ''} ${i.tab}`.toLowerCase().includes(query)) : items.filter((i) => i.tab === tab);
    const card = h('div', { class: 'card' });
    for (const it of list) card.appendChild(h('div', { class: 'setting' }, h('div', null, h('div', { class: 'name' }, it.name, query ? h('span', { class: 'pill', style: 'margin-left:8px' }, it.tab) : null), it.desc ? h('div', { class: 'desc' }, it.desc) : null), h('div', { class: 'ctl' }, it.build())));
    if (!list.length) card.appendChild(h('div', { class: 'muted' }, 'No settings match your search.'));
    body.appendChild(card);
    if (!query && tab === 'Controls') { body.appendChild(padTestCard()); body.appendChild(rebindingCard(input)); body.appendChild(skillCard()); }
    if (!query && tab === 'Gameplay') body.appendChild(dataCard());
  };

  clear(parent);
  parent.append(h('div', { class: 'row wrap', style: 'justify-content:space-between;margin-bottom:12px' }, h('h2', null, 'Settings'), h('div', { class: 'row' }, search, opts.onBack ? h('button', { class: 'btn', 'data-back': true, onclick: opts.onBack }, 'Back') : null)), tabsEl, body);
  render();
}

// ---------------------------------------------------------------- rebinding
const ACTION_ROWS: Array<[string, string]> = [
  ['up', 'Move up'], ['down', 'Move down'], ['left', 'Move left'], ['right', 'Move right'], ['b1', 'Pass / Tackle'], ['b2', 'Through / Keeper charge'], ['b3', 'Lob·Cross / Slide·Clear'], ['b4', 'Shoot / Switch'],
  ['sprint', 'Sprint'], ['precise', 'Precision · Shield · Contain'], ['modA', 'Chip / Low cross / Switch'], ['modB', 'Finesse / Run call / 2nd press'], ['skill1', 'Skill slot 1'], ['skill2', 'Skill slot 2'], ['skill3', 'Skill slot 3'], ['skill4', 'Skill slot 4'],
  ['rUp', 'Skill flick up'], ['rRight', 'Skill flick right'], ['rDown', 'Skill flick down'], ['rLeft', 'Skill flick left'], ['pause', 'Pause'],
];
const PAD_ROWS = ACTION_ROWS.filter(([k]) => !['up', 'down', 'left', 'right', 'rUp', 'rDown', 'rLeft', 'rRight'].includes(k));

function rebindingCard(input: InputManager | null): HTMLElement {
  const card = h('div', { class: 'card', style: 'margin-top:16px' });
  let device: 'keyboard' | 'keyboardP2' | 'gamepad' = 'keyboard';
  const render = (): void => {
    clear(card);
    const c = settings.value.controls;
    const profiles = Object.keys(c.profiles);
    const kb = device === 'keyboard' ? c.keyboard : c.keyboardP2;
    const conflicts = device === 'gamepad' ? findPadConflicts(c.gamepad as unknown as Record<string, number[]>) : findKeyConflicts(kb as unknown as Record<string, string[]>);
    const bad = new Set(conflicts.flatMap((x) => x.actions));
    card.appendChild(h('div', { class: 'row wrap', style: 'justify-content:space-between;margin-bottom:12px' }, h('h3', null, 'Button mapping'),
      h('div', { class: 'row wrap' }, h('div', { class: 'seg' }, ([['keyboard', 'Keyboard P1'], ['keyboardP2', 'Keyboard P2'], ['gamepad', 'Gamepad']] as const).map(([d, l]) => h('button', { class: device === d ? 'on' : '', onclick: (): void => { device = d; render(); } }, l))),
        h('select', { onchange: (e: Event): void => { const n = (e.target as HTMLSelectElement).value; if (n && c.profiles[n]) settings.update((s) => { s.controls.keyboard = structuredClone(c.profiles[n]!.keyboard); s.controls.gamepad = structuredClone(c.profiles[n]!.gamepad); s.controls.profile = n; }); render(); } }, [h('option', { value: '' }, 'Profiles…'), ...profiles.map((p) => h('option', { value: p, selected: p === c.profile }, p))]),
        h('button', { class: 'btn small', onclick: (): void => { const n = prompt('Profile name?', `Profile ${profiles.length + 1}`); if (n) { settings.update((s) => { s.controls.profiles[n] = { keyboard: structuredClone(s.controls.keyboard), gamepad: structuredClone(s.controls.gamepad) }; s.controls.profile = n; }); render(); } } }, 'Save profile'),
        h('button', { class: 'btn small', onclick: (): void => { settings.update((s) => { s.controls.keyboard = structuredClone(DEFAULT_KEYBOARD); s.controls.keyboardP2 = structuredClone(DEFAULT_KEYBOARD_P2); s.controls.gamepad = structuredClone(DEFAULT_PAD); }); render(); } }, 'Reset to default'))));
    if (conflicts.length) card.appendChild(h('div', { class: 'pill warn', style: 'margin-bottom:10px' }, `Conflict: ${conflicts.map((x) => `${typeof x.code === 'string' ? keyLabel(x.code) : padLabel(x.code)} → ${x.actions.join(' + ')}`).join('; ')}`));
    const table = h('table');
    for (const [key, label] of device === 'gamepad' ? PAD_ROWS : ACTION_ROWS) {
      const cur: Array<string | number> = device === 'gamepad' ? ((c.gamepad as unknown as Record<string, number[]>)[key] ?? []) : ((kb as unknown as Record<string, string[]>)[key] ?? []);
      const btn = h('button', { class: 'btn small' + (bad.has(key) ? ' danger' : ''), onclick: (): void => capture(key, btn) }, cur.length ? cur.map((x) => (typeof x === 'string' ? keyLabel(x) : padLabel(x))).join(' / ') : 'Unbound');
      table.appendChild(h('tr', null, h('td', null, label), h('td', { style: 'text-align:right' }, btn)));
    }
    card.appendChild(table);
  };
  const capture = (key: string, btn: HTMLElement): void => {
    btn.textContent = device === 'gamepad' ? 'Press a button…' : 'Press a key… (Esc cancels)';
    input?.setEnabled(false);
    let done = false;
    const finish = (): void => { done = true; window.removeEventListener('keydown', onKey, true); clearInterval(poll); setTimeout(() => input?.setEnabled(true), 100); render(); };
    const onKey = (e: KeyboardEvent): void => {
      if (device === 'gamepad') return;
      e.preventDefault(); e.stopPropagation();
      if (e.code !== 'Escape') settings.update((s) => { const m = (device === 'keyboard' ? s.controls.keyboard : s.controls.keyboardP2) as unknown as Record<string, string[]>; m[key] = [e.code]; });
      finish();
    };
    window.addEventListener('keydown', onKey, true);
    const before = new Set<number>();
    const poll = setInterval(() => {
      if (done || device !== 'gamepad') return;
      const p = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
      if (!p) return;
      p.buttons.forEach((b, i) => { if (b.pressed && !before.has(i)) { settings.update((s) => { (s.controls.gamepad as unknown as Record<string, number[]>)[key] = [i]; }); finish(); } });
    }, 50);
  };
  render();
  return card;
}

// ---------------------------------------------------------------- controller test
function padTestCard(): HTMLElement {
  const info = h('div', { class: 'muted', style: 'font-size:13px;line-height:1.7;font-variant-numeric:tabular-nums' }, 'Press any button on your controller…');
  const card = h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', null, 'Controller test'), info);
  const iv = setInterval(() => {
    if (!card.isConnected) { clearInterval(iv); return; }
    const pads = [...(navigator.getGamepads?.() ?? [])].filter((g): g is Gamepad => !!g && g.connected);
    if (!pads.length) { info.textContent = 'No controller detected. Connect it and press a button (browsers hide controllers until then).'; return; }
    info.innerHTML = pads.map((p, i) => `<b>Pad ${i + 1}:</b> ${p.id.slice(0, 60)} · mapping: ${p.mapping || 'non-standard'}<br>Sticks: L ${p.axes[0]?.toFixed(2)}, ${p.axes[1]?.toFixed(2)} · R ${p.axes[2]?.toFixed(2)}, ${p.axes[3]?.toFixed(2)}<br>Pressed: ${p.buttons.map((b, k) => (b.pressed ? padLabel(k) : '')).filter(Boolean).join(' ') || '—'}`).join('<br>');
  }, 100);
  return card;
}

// ---------------------------------------------------------------- skills
export function skillCard(): HTMLElement {
  const card = h('div', { class: 'card', style: 'margin-top:16px' });
  let stars = 5;
  let slot = 0;
  const render = (): void => {
    clear(card);
    const c = settings.value.controls;
    const lo = c.skillLoadout;
    card.appendChild(h('div', { class: 'row wrap', style: 'justify-content:space-between' }, h('h3', null, 'Skill move loadout (pick any 4)'),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Show moves up to'), h('div', { class: 'seg' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: stars === n ? 'on' : '', onclick: (): void => { stars = n; render(); } }, '★'.repeat(n)))))));
    card.appendChild(h('div', { class: 'row wrap', style: 'margin:12px 0' }, [0, 1, 2, 3].map((i) => {
      const mv = skillById(lo[i] ?? '');
      return h('button', { class: 'btn' + (slot === i ? ' primary' : ''), onclick: (): void => { slot = i; render(); } }, `Slot ${i + 1}: ${mv ? mv.name : '—'}`, mv ? h('span', { class: 'pill' }, '★'.repeat(mv.stars)) : null);
    })));
    const grid = h('div', { class: 'split' });
    for (let st = 1; st <= stars; st++) {
      const col = h('div', { class: 'col', style: 'gap:6px' }, h('h3', null, '★'.repeat(st)));
      for (const mv of SKILL_MOVES.filter((m) => m.stars === st)) {
        const bound = c.skillBindings[mv.id];
        col.appendChild(h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn small grow' + (lo.includes(mv.id) ? ' primary' : ''), title: mv.desc, onclick: (): void => { settings.update((s) => { const prev = s.controls.skillLoadout.indexOf(mv.id); if (prev >= 0) s.controls.skillLoadout[prev] = s.controls.skillLoadout[slot]!; s.controls.skillLoadout[slot] = mv.id; }); render(); } }, mv.name),
          h('button', { class: 'btn small ghost', title: 'Rebind this move\'s flick gesture', onclick: (ev: MouseEvent): void => captureGesture(mv.id, ev.currentTarget as HTMLElement) }, bound ? bound.split('').map((d) => ({ U: '↑', D: '↓', L: '←', R: '→' })[d]).join('') : mv.pattern.map((d) => ({ U: '↑', D: '↓', L: '←', R: '→' })[d]).join(''))));
      }
      grid.appendChild(col);
    }
    card.appendChild(grid);
    card.appendChild(h('div', { class: 'row', style: 'margin-top:12px' }, h('span', { class: 'muted' }, 'Slots map to right-stick up/right/down/left, arrow keys, number keys 1–4 and touch skill buttons. Press the arrow chip to record a custom flick sequence for a move.'),
      h('button', { class: 'btn small', onclick: (): void => { settings.update((s) => { s.controls.skillBindings = {}; }); render(); } }, 'Clear gestures')));
  };
  const captureGesture = (id: string, el: HTMLElement): void => {
    el.textContent = 'flick…';
    const seq: Dir4[] = []; let last = performance.now(); const fd = new FlickDetector();
    const finish = (): void => { window.removeEventListener('keydown', onKey, true); clearInterval(poll); if (seq.length) settings.update((s) => { const key = seq.join(''); for (const k of Object.keys(s.controls.skillBindings)) if (s.controls.skillBindings[k] === key) delete s.controls.skillBindings[k]; s.controls.skillBindings[id] = key; }); render(); };
    const push = (d: Dir4): void => { seq.push(d); last = performance.now(); el.textContent = seq.map((x) => ({ U: '↑', D: '↓', L: '←', R: '→' })[x]).join(''); if (seq.length >= 3) setTimeout(finish, 200); };
    const onKey = (e: KeyboardEvent): void => {
      const m: Record<string, Dir4> = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };
      if (e.code === 'Escape') { seq.length = 0; finish(); return; }
      const d = m[e.code]; if (d) { e.preventDefault(); e.stopPropagation(); push(d); }
    };
    window.addEventListener('keydown', onKey, true);
    const poll = setInterval(() => {
      const p = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
      if (p) { const d = fd.update(p.axes[2] ?? 0, p.axes[3] ?? 0, performance.now() / 1000); if (d) push(d); }
      if (seq.length && performance.now() - last > 1400) finish();
    }, 30);
    void dirOf;
  };
  render();
  return card;
}

// ---------------------------------------------------------------- data
function dataCard(): HTMLElement {
  return h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', null, 'Data'), h('div', { class: 'row wrap' },
    h('button', { class: 'btn small', onclick: (): void => downloadJson('football-simulator-settings.json', { format: 'football-simulator-settings', data: settings.value }) }, 'Export settings'),
    h('button', { class: 'btn small', onclick: (): void => { void pickJsonFile().then((t) => { const o = JSON.parse(t) as { data?: Partial<Settings> }; if (o.data) { settings.update((s) => Object.assign(s as object, o.data)); toast('Settings imported'); } }).catch(() => toast('Could not read that file')); } }, 'Import settings'),
    h('button', { class: 'btn small danger', onclick: (): void => { if (confirm('Reset all settings to defaults?')) { settings.reset(); toast('Settings reset'); } } }, 'Reset all settings')));
}
