/**
 * Generic DOM event fuzzer helper for eggshell soak testing (T4.4).
 * Generates synthetic clicks, moves, and keyboard input on DOM elements.
 */
(function () {
  if (typeof window === 'undefined') return;

  function dispatchAction(action) {
    if (!action || typeof action !== 'object') return;
    if (action.type === 'click') {
      const el = document.elementFromPoint(action.x, action.y) || document.body;
      if (!el) return;
      el.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: action.x,
          clientY: action.y,
          view: window,
        })
      );
      el.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          clientX: action.x,
          clientY: action.y,
          view: window,
        })
      );
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: action.x,
          clientY: action.y,
          view: window,
        })
      );
    } else if (action.type === 'move') {
      const el = document.elementFromPoint(action.x, action.y) || document.body;
      if (!el) return;
      el.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: action.x,
          clientY: action.y,
          view: window,
        })
      );
    } else if (action.type === 'type') {
      const target = document.activeElement || document.body;
      if (!target) return;
      target.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: action.key })
      );
      target.dispatchEvent(
        new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: action.key })
      );
      if ('value' in target && typeof target.value === 'string' && action.key.length === 1) {
        target.value += action.key;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      target.dispatchEvent(
        new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: action.key })
      );
    }
  }

  window.__eggshellFuzzer = { dispatch: dispatchAction };
})();
