import { toString } from 'qrcode';
import { detectLocalIp } from '../shell/companion/network.js';

export async function printDashboardQr(port: number): Promise<void> {
  const url = `http://${detectLocalIp()}:${port}/`;
  const qr = await toString(url, { type: 'terminal', small: true });
  process.stdout.write(`${qr}\n${url}\n`);
}
