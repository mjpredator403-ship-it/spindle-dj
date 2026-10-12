// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
// Tiny DOM helpers + accessible knob widget (no framework).

type Attrs = Record<string, string | number | boolean | undefined | null | ((e: Event) => void)>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** setPointerCapture throws for synthetic/ended pointers; never let that block the action. */
export function safeCapture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}

export function setText(el: HTMLElement, s: string) {
  if (el.textContent !== s) el.textContent = s;
}
export function toggleClass(el: Element, cls: string, on: boolean) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function fmtTime(sec: number, tenths = true): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : Math.floor(s).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

export interface KnobOpts {
  label: string;
  value: number; // 0..1
  def?: number; // double-click reset
  bipolar?: boolean;
  size?: number;
  color?: string;
  format?: (v: number) => string;
  onInput: (v: number) => void;
  title?: string;
}

/** Rotary knob: drag vertically, wheel, arrow keys; double-click resets. role=slider. */
export class Knob {
  readonly el: HTMLDivElement;
  private dial: HTMLDivElement;
  private val: HTMLSpanElement;
  value: number;
  constructor(private o: KnobOpts) {
    this.value = o.value;
    const size = o.size ?? 38;
    this.dial = h('div', { class: 'knob-dial' });
    this.dial.style.width = this.dial.style.height = `${size}px`;
    if (o.color) this.dial.style.setProperty('--kc', o.color);
    this.val = h('span', { class: 'knob-val' });
    this.el = h(
      'div',
      {
        class: 'knob' + (o.bipolar ? ' bipolar' : ''),
        role: 'slider',
        tabindex: 0,
        'aria-label': o.label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        title: o.title ?? `${o.label} — drag up/down, scroll, or use arrow keys. Double-click to reset.`,
      },
      this.dial,
      h('span', { class: 'knob-label', text: o.label }),
      this.val,
    );
    let startY = 0,
      startV = 0,
      dragging = false;
    this.el.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startV = this.value;
      safeCapture(this.el, e.pointerId);
      this.el.focus();
      e.preventDefault();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const fine = e.shiftKey ? 0.25 : 1;
      this.input(startV + ((startY - e.clientY) / 160) * fine);
    });
    const end = () => (dragging = false);
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('dblclick', () => this.input(o.def ?? (o.bipolar ? 0.5 : o.value)));
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.input(this.value - Math.sign(e.deltaY) * 0.02);
      },
      { passive: false },
    );
    this.el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') this.input(this.value + step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') this.input(this.value - step);
      else if (e.key === 'Home') this.input(0);
      else if (e.key === 'End') this.input(1);
      else if (e.key === 'Enter' || e.key === ' ') this.input(o.def ?? 0.5);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    this.render();
  }
  private input(v: number) {
    this.set(v);
    this.o.onInput(this.value);
  }
  /** Update without firing onInput (e.g. MIDI-driven). */
  set(v: number) {
    this.value = Math.max(0, Math.min(1, v));
    this.render();
  }
  private render() {
    const deg = -135 + this.value * 270;
    this.dial.style.setProperty('--rot', `${deg}deg`);
    this.dial.style.setProperty('--pct', `${this.value * 100}%`);
    const txt = this.o.format ? this.o.format(this.value) : `${Math.round(this.value * 100)}`;
    this.val.textContent = txt;
    this.el.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
    this.el.setAttribute('aria-valuetext', txt);
  }
}

/** Vertical/horizontal fader built on <input type=range> (native accessibility). */
export function fader(opts: {
  label: string;
  value: number;
  vertical?: boolean;
  className?: string;
  onInput: (v: number) => void;
  def?: number;
  step?: number;
}): HTMLInputElement {
  const el = h('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: opts.step ?? 0.001,
    value: opts.value,
    class: 'fader ' + (opts.vertical ? 'vertical ' : '') + (opts.className ?? ''),
    'aria-label': opts.label,
    title: `${opts.label} (double-click to reset)`,
  }) as HTMLInputElement;
  el.addEventListener('input', () => opts.onInput(parseFloat(el.value)));
  if (opts.def !== undefined)
    el.addEventListener('dblclick', () => {
      el.value = String(opts.def);
      opts.onInput(opts.def!);
    });
  return el;
}

// ---------------------------------------------------------------- toasts
let toastHost: HTMLElement | null = null;
export function toast(msg: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 4200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastHost.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
