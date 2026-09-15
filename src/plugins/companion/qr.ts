/**
 * QR code generator using the qrcode library (T4.3).
 */

import { toDataURL } from 'qrcode';

export type QrCodeGenerator = (text: string) => Promise<string>;

export async function generateQrDataUrl(
  payload: string,
  generator?: QrCodeGenerator
): Promise<string> {
  if (payload.length > 2000) {
    throw new Error(`QR code payload exceeds maximum length of 2000 characters (got ${payload.length})`);
  }

  if (generator) {
    return generator(payload);
  }
  return toDataURL(payload, {
    margin: 2,
    width: 256,
    errorCorrectionLevel: 'M',
  });
}
