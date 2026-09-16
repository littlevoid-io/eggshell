import { BrowserWindow } from 'electron';

const BLACKOUT_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><style>
  html, body { margin: 0; height: 100%; background: #000; opacity: 0; transition: opacity 0.8s ease; }
</style></head>
<body><script>
  window.show = () => { document.body.style.opacity = '1'; };
  window.hide = () => { document.body.style.opacity = '0'; };
</script></body></html>`)}`;

export interface Blackout {
  show(): void;
  hide(): void;
}

function createOverlay(parent: BrowserWindow): BrowserWindow {
  const overlay = new BrowserWindow({
    ...parent.getBounds(),
    parent,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  overlay.setIgnoreMouseEvents(true);
  void overlay.loadURL(BLACKOUT_HTML);
  return overlay;
}

/** A click-through window over the main window that fades to black on demand. */
function fadeIn(overlay: BrowserWindow): void {
  overlay.show();
  void overlay.webContents.executeJavaScript('window.show()').catch(() => undefined);
}

function openAndFadeIn(main: BrowserWindow): BrowserWindow {
  const overlay = createOverlay(main);
  overlay.webContents.once('did-finish-load', () => fadeIn(overlay));
  return overlay;
}

export function createBlackout(getMainWindow: () => BrowserWindow | undefined): Blackout {
  let overlay: BrowserWindow | undefined;
  return {
    show() {
      const main = getMainWindow();
      if (!main) return;
      if (!overlay || overlay.isDestroyed()) {
        overlay = openAndFadeIn(main);
        return;
      }
      overlay.setBounds(main.getBounds());
      fadeIn(overlay);
    },
    hide() {
      void overlay?.webContents.executeJavaScript('window.hide()').catch(() => undefined);
    },
  };
}
