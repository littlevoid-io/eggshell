import type { ClickDetails, KeyDetails, MoveDetails, ScrollDetails, SoakStep } from './types.js';

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

export function buildActionScript(step: SoakStep): string {
  if (step.type === 'click') {
    return buildClickScript(step.details as ClickDetails);
  }
  if (step.type === 'move') {
    return buildMoveScript(step.details as MoveDetails);
  }
  if (step.type === 'key') {
    return buildKeyScript(step.details as KeyDetails);
  }
  return buildScrollScript(step.details as ScrollDetails);
}
