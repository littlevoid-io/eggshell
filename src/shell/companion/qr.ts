import { toDataURL } from 'qrcode';

export async function qrDataUrl(text: string): Promise<string> {
  return toDataURL(text);
}
