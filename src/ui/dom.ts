type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string; onclick?: (e: MouseEvent) => void };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'value') (el as unknown as { value: unknown }).value = v;
      else if (k === 'checked') (el as unknown as { checked: boolean }).checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}
function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** Appends children (null-safe, arrays allowed). */
export function add<T extends Element>(el: T, ...children: Child[]): T { append(el, children); return el; }

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }

export function toast(msg: string, ms = 2400): void {
  let host = document.querySelector('.toast-host');
  if (!host) { host = h('div', { class: 'toast-host' }); document.body.appendChild(host); }
  const t = h('div', { class: 'toast' }, msg);
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export const money = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : String(Math.round(a));
  return `${v < 0 ? '-' : ''}¤${s}`;
};

export function kitChip(color: string): HTMLElement { return h('span', { class: 'kit-chip', style: `background:${color}` }); }
