const quote = (value: string): string => JSON.stringify(value);

export const CONFIG_TEMPLATE = (
  appId: string,
  productName: string
): string => `import { defineConfig } from 'eggshell';

export default defineConfig(({ isDev }) => ({
  appId: ${quote(appId)},
  productName: ${quote(productName)},
  windows: [
    {
      id: 'main',
      // A URL, or a file path relative to this directory.
      url: 'public/index.html',
      kiosk: !isDev,
    },
  ],
}));
`;

export const INDEX_HTML_TEMPLATE = (productName: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${productName}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #111; color: #eee; font: 24px system-ui, sans-serif; }
      body { display: grid; place-items: center; }
    </style>
  </head>
  <body>
    <main>${productName}</main>
  </body>
</html>
`;

export const GITIGNORE_LINES = ['node_modules', 'release/', '.eggshell/'];
