// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 David Blackwood (original author) and Spindle DJ contributors
import type { Action } from './actions';
import type { Settings } from '../settings';

/** Global keyboard shortcuts (ignored while typing in text fields). */
export function installKeyboard(actions: Map<string, Action>, settings: Settings): () => void {
  const isTyping = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.tagName === 'INPUT') {
      const type = (t as HTMLInputElement).type;
      return !['range', 'checkbox', 'button', 'radio'].includes(type);
    }
    return false;
  };
  const down = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return; // settings/keys editor open
    const id = settings.get('keymap')[e.code];
    const a = id ? actions.get(id) : undefined;
    if (!a || a.kind !== 'button') return;
    e.preventDefault();
    if (e.repeat) return;
    a.run(1);
  };
  const up = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const id = settings.get('keymap')[e.code];
    const a = id ? actions.get(id) : undefined;
    if (a && a.kind === 'button') a.run(0);
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };
}

export function keyLabel(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '↔ ').replace('Comma', ',').replace('Period', '.').replace('Slash', '/');
}
