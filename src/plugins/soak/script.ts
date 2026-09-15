/**
 * Injected script builder for soak fuzzer (T4.4).
 * Plain, self-contained template strings executing synthetic DOM events.
 * Never serializes live functions via Function.prototype.toString().
 */

import type { ClickDetails, FuzzAction, KeyDetails, MoveDetails, ScrollDetails } from './types.js';

export function buildActionScript(action: FuzzAction): string {
  if (action.type === 'click') {
    return buildClickScript(action.details as ClickDetails);
  }
  if (action.type === 'move') {
    return buildMoveScript(action.details as MoveDetails);
  }
  if (action.type === 'key') {
    return buildKeyScript(action.details as KeyDetails);
  }
  return buildScrollScript(action.details as ScrollDetails);
}

function buildClickScript(details: ClickDetails): string {
  const buttonCode = details.button === 'right' ? 2 : 0;
  return `(() => {
  const x = ${details.x};
  const y = ${details.y};
  const target = document.elementFromPoint(x, y) || document.body;
  if (!target) return;
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: ${buttonCode} };
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new MouseEvent('mouseup', init));
  target.dispatchEvent(new MouseEvent('click', init));
})();`;
}

function buildMoveScript(details: MoveDetails): string {
  return `(() => {
  const x = ${details.x};
  const y = ${details.y};
  const target = document.elementFromPoint(x, y) || document.body;
  if (!target) return;
  target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
})();`;
}

function buildKeyScript(details: KeyDetails): string {
  const escaped = JSON.stringify(details.key);
  return `(() => {
  const target = document.activeElement || document.body;
  if (!target) return;
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ${escaped} }));
  target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ${escaped} }));
})();`;
}

function buildScrollScript(details: ScrollDetails): string {
  return `(() => {
  window.scrollBy({ left: ${details.deltaX}, top: ${details.deltaY}, behavior: 'auto' });
})();`;
}
