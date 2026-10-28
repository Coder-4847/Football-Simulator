import { h, clear, toast } from './dom';
import { settings, MATCH_LENGTHS, SPEEDS, type MatchLength, type Settings } from '../core/settings';
import { audio } from '../audio/engine';
import { PRESETS, type QualityName } from '../render/quality';
import { CAMERA_MODES } from '../render/camera';
import { DIFFICULTIES } from '../match/types';
import { STADIUM_STYLES } from '../render/stadium';
import { downloadJson, pickJsonFile } from '../core/storage';

type Tab = 'Match' | 'Graphics' | 'Audio';
const TABS: Tab[] = ['Match', 'Graphics', 'Audio'];

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

export function buildSettings(parent: HTMLElement, opts: { onBack?: () => void } = {}): void {
  const s = (): Settings => settings.value;
  const upd = (fn: (s: Settings) => void): void => settings.update(fn);
  let tab: Tab = 'Match';
  let query = '';
  const custom = <K extends keyof typeof PRESETS.High>(k: K): (typeof PRESETS.High)[K] => (s().graphics.custom[k] ?? PRESETS.High[k]) as (typeof PRESETS.High)[K];
  const setCustom = (fn: (c: Settings['graphics']['custom']) => void): void => upd((x) => { fn(x.graphics.custom); x.graphics.preset = 'Custom'; });

  const items: Item[] = [
    // ---------------- match
    { tab: 'Match', name: 'Match length', desc: 'How much football is simulated. Every match is played in fast-forward, so a Standard match takes about 75 seconds at 1× speed.', keywords: 'duration minutes time fast', build: () => seg<MatchLength>((Object.keys(MATCH_LENGTHS) as MatchLength[]).map((k) => [k, `${MATCH_LENGTHS[k].label} · ${MATCH_LENGTHS[k].seconds}s`] as [MatchLength, string]), () => s().gameplay.matchLength, (v) => upd((x) => { x.gameplay.matchLength = v; })) },
    { tab: 'Match', name: 'Match speed', desc: 'Playback speed. You can also change it during a match with the buttons or the 1–4 keys.', keywords: 'fast slow playback', build: () => seg<number>(SPEEDS.map((v) => [v, `${v}×`] as [number, string]), () => s().gameplay.matchSpeed, (v) => upd((x) => { x.gameplay.matchSpeed = v; })) },
    { tab: 'Match', name: 'Pause at half-time', desc: 'Shows the stats with tactics and substitutions before the second half.', build: () => toggle(() => s().gameplay.autoPauseHalftime, (v) => upd((x) => { x.gameplay.autoPauseHalftime = v; })) },
    { tab: 'Match', name: 'Goal replays', desc: 'Slow-motion replay after every goal (adds time).', build: () => toggle(() => s().gameplay.goalReplays, (v) => upd((x) => { x.gameplay.goalReplays = v; })) },
    { tab: 'Match', name: 'Camera', build: () => select(CAMERA_MODES.map((c) => [c.id, c.name] as [string, string]), () => s().gameplay.camera, (v) => upd((x) => { x.gameplay.camera = v as typeof x.gameplay.camera; })) },
    { tab: 'Match', name: 'Camera zoom', desc: 'Higher values show more of the pitch.', build: () => range(() => s().gameplay.cameraZoom, (v) => upd((x) => { x.gameplay.cameraZoom = v; }), 0.8, 1.4, 0.05, (v) => `${v.toFixed(2)}×`) },
    { tab: 'Match', name: 'AI difficulty', desc: 'Quality of the computer-managed teams.', build: () => select(DIFFICULTIES.map((d) => [d, d] as [string, string]), () => s().gameplay.difficulty, (v) => upd((x) => { x.gameplay.difficulty = v as typeof x.gameplay.difficulty; })) },
    { tab: 'Match', name: 'Default weather', build: () => select([['random', 'Random'], ['clear', 'Clear'], ['rain', 'Rain'], ['fog', 'Fog'], ['snow', 'Snow']] as Array<[Settings['gameplay']['weather'], string]>, () => s().gameplay.weather, (v) => upd((x) => { x.gameplay.weather = v; })) },
    { tab: 'Match', name: 'Default time of day', build: () => select([['random', 'Random'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']] as Array<[Settings['gameplay']['timeOfDay'], string]>, () => s().gameplay.timeOfDay, (v) => upd((x) => { x.gameplay.timeOfDay = v; })) },
    { tab: 'Match', name: 'Stadium', desc: 'Used when a match does not specify one.', build: () => select([['random', 'Random'], ...STADIUM_STYLES.map((st, i) => [String(i), st.name] as [string, string])], () => String(s().gameplay.stadium), (v) => upd((x) => { x.gameplay.stadium = v === 'random' ? 'random' : Number(v); })) },
    { tab: 'Match', name: 'Commentary ticker', desc: 'Text commentary during play.', build: () => toggle(() => s().gameplay.ticker, (v) => upd((x) => { x.gameplay.ticker = v; })) },
    { tab: 'Match', name: 'Referee strictness', build: () => range(() => s().gameplay.refStrictness, (v) => upd((x) => { x.gameplay.refStrictness = v; })) },
    { tab: 'Match', name: 'Foul frequency', build: () => range(() => s().gameplay.foulFrequency, (v) => upd((x) => { x.gameplay.foulFrequency = v; }), 0, 2, 0.1, (v) => `${v.toFixed(1)}×`) },
    { tab: 'Match', name: 'Offside', build: () => toggle(() => s().gameplay.offside, (v) => upd((x) => { x.gameplay.offside = v; })) },
    { tab: 'Match', name: 'Injuries', build: () => toggle(() => s().gameplay.injuries, (v) => upd((x) => { x.gameplay.injuries = v; })) },
    { tab: 'Match', name: 'Fatigue', build: () => toggle(() => s().gameplay.fatigue, (v) => upd((x) => { x.gameplay.fatigue = v; })) },
    { tab: 'Match', name: 'VAR reviews', build: () => toggle(() => s().gameplay.var, (v) => upd((x) => { x.gameplay.var = v; })) },
    { tab: 'Match', name: 'Extra time & penalties (cups)', build: () => toggle(() => s().gameplay.extraTimeAndPens, (v) => upd((x) => { x.gameplay.extraTimeAndPens = v; })) },
    // ---------------- graphics
    { tab: 'Graphics', name: 'Quality preset', desc: 'Low · Medium · High · Ultra. Mobile defaults to Low.', build: () => seg<QualityName>([['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High'], ['Ultra', 'Ultra'], ['Custom', 'Custom']], () => s().graphics.preset, (v) => upd((x) => { x.graphics.preset = v; })) },
    { tab: 'Graphics', name: 'Resolution scale', desc: 'Render resolution multiplier.', build: () => range(() => s().graphics.resolutionScale, (v) => upd((x) => { x.graphics.resolutionScale = v; }), 0.5, 1.5, 0.05) },
    { tab: 'Graphics', name: 'Shadows', desc: 'Custom preset only.', build: () => select([['off', 'Off'], ['low', 'Simple'], ['medium', 'Soft'], ['high', 'Soft + head']] as Array<['off' | 'low' | 'medium' | 'high', string]>, () => custom('shadows'), (v) => setCustom((c) => { c.shadows = v; })) },
    { tab: 'Graphics', name: 'Vignette', build: () => toggle(() => custom('vignette'), (v) => setCustom((c) => { c.vignette = v; })) },
    { tab: 'Graphics', name: 'Particles', desc: 'Dust, turf, confetti and impact effects.', build: () => range(() => custom('particles'), (v) => setCustom((c) => { c.particles = v; }), 0, 1.4, 0.1) },
    { tab: 'Graphics', name: 'Crowd density', build: () => range(() => custom('crowd'), (v) => setCustom((c) => { c.crowd = v; })) },
    { tab: 'Graphics', name: 'Pitch wear', desc: 'Scuffs and slide marks build up on the grass.', build: () => toggle(() => custom('pitchWear'), (v) => setCustom((c) => { c.pitchWear = v; })) },
    { tab: 'Graphics', name: 'Foot trails', desc: 'Swoosh trails behind kicks and tackles.', build: () => toggle(() => custom('footTrails'), (v) => setCustom((c) => { c.footTrails = v; })) },
    { tab: 'Graphics', name: 'Night & dusk lighting', build: () => toggle(() => custom('lighting'), (v) => setCustom((c) => { c.lighting = v; })) },
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
    { tab: 'Audio', name: 'Spoken commentary (TTS)', desc: 'Uses the browser speech engine. Off by default.', build: () => toggle(() => s().audio.tts, (v) => upd((x) => { x.audio.tts = v; })) },
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
    if (!query) body.appendChild(dataCard());
  };

  clear(parent);
  parent.append(h('div', { class: 'row wrap', style: 'justify-content:space-between;margin-bottom:12px' }, h('div', null, h('div', { class: 'eyebrow' }, 'Preferences'), h('h1', null, 'Settings')), h('div', { class: 'row' }, search, opts.onBack ? h('button', { class: 'btn', 'data-back': true, onclick: opts.onBack }, 'Back') : null)), tabsEl, body);
  render();
}

function dataCard(): HTMLElement {
  return h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', null, 'Data'), h('div', { class: 'row wrap' },
    h('button', { class: 'btn small', onclick: (): void => downloadJson('football-simulator-settings.json', { format: 'football-simulator-settings', data: settings.value }) }, 'Export settings'),
    h('button', { class: 'btn small', onclick: (): void => { void pickJsonFile().then((t) => { const o = JSON.parse(t) as { data?: Partial<Settings> }; if (o.data) { settings.update((s) => Object.assign(s as object, o.data)); toast('Settings imported'); } }).catch(() => toast('Could not read that file')); } }, 'Import settings'),
    h('button', { class: 'btn small danger', onclick: (): void => { if (confirm('Reset all settings to defaults?')) { settings.reset(); toast('Settings reset'); } } }, 'Reset all settings')));
}
