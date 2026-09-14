import { describe, expect, it } from 'vitest';
import { generateQrDataUrl } from './qr.js';

describe('QR code generator (T4.3)', () => {
  it('generates a base64 PNG data URL from a string payload', async () => {
    const payload = 'http://192.168.1.50:3005/';
    const dataUrl = await generateQrDataUrl(payload);

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it('uses injected generator when provided', async () => {
    const customGenerator = async (text: string) => `data:custom/qr;${text}`;
    const result = await generateQrDataUrl('test-payload', customGenerator);

    expect(result).toBe('data:custom/qr;test-payload');
  });

  it('throws an error if payload exceeds maximum length', async () => {
    const hugePayload = 'a'.repeat(2001);
    await expect(generateQrDataUrl(hugePayload)).rejects.toThrow(/exceeds maximum length/);
  });
});
