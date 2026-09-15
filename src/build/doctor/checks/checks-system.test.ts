import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { checkRequiredPortsFree } from './ports.js';
import { checkDisplayCount } from './displays.js';
import { checkTouchProbe } from './touch.js';
import { checkPluginAssets } from './assets.js';
import { checkUserDataWriteAccess } from './user-data.js';

describe('doctor system checks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-system-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('passes port check when ports are free and fails when occupied', async () => {
    const config = {
      processes: [{ id: 'srv', command: 'node', phase: 'always', requirePortsFree: [3001] }],
    };
    const freeCheck = await checkRequiredPortsFree({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      isPortFree: async () => true,
    });
    expect(freeCheck.status).toBe('pass');

    const occupiedCheck = await checkRequiredPortsFree({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      isPortFree: async () => false,
    });
    expect(occupiedCheck.status).toBe('fail');
    expect(occupiedCheck.remediation).toBeDefined();
  });

  it('reports display count match, warn on mismatch, and warn on query failure', async () => {
    const config = {
      windows: [
        { id: 'w1', url: 'u', target: { kind: 'index', index: 0 } },
        { id: 'w2', url: 'u', target: { kind: 'index', index: 1 } },
      ],
    };
    const match = await checkDisplayCount({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      getDisplays: async () => [{ id: 0 }, { id: 1 }],
    });
    expect(match.status).toBe('pass');

    const mismatch = await checkDisplayCount({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      getDisplays: async () => [{ id: 0 }],
    });
    expect(mismatch.status).toBe('warn');
    expect(mismatch.message).toContain('mismatch');
  });

  it('handles touch probe detection, warnings, and errors', async () => {
    const touchConfig = {
      windows: [{ id: 'w', url: 'u', target: { kind: 'role', role: 'touch' } }],
    };
    const noTouchProbe = { detect: async () => [] };
    const warnCheck = await checkTouchProbe({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: touchConfig,
      touchProbe: noTouchProbe,
    });
    expect(warnCheck.status).toBe('warn');

    const throwingProbe = {
      detect: async () => {
        throw new Error('Hardware digitizer disconnected');
      },
    };
    const failCheck = await checkTouchProbe({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: {},
      touchProbe: throwingProbe,
    });
    expect(failCheck.status).toBe('fail');
    expect(failCheck.message).toContain('Hardware digitizer disconnected');
  });

  it('checks plugin assets and fails on missing prebuilts', async () => {
    const config = { plugins: { offline: { enabled: true } } };
    const passCheck = await checkPluginAssets({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      assetExists: async () => true,
    });
    expect(passCheck.status).toBe('pass');

    const failCheck = await checkPluginAssets({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      assetExists: async () => false,
    });
    expect(failCheck.status).toBe('fail');
    expect(failCheck.message).toContain('offline');
  });

  it('proves real filesystem write access to userDataRoot', async () => {
    const check = await checkUserDataWriteAccess({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config: {},
    });
    expect(check.status).toBe('pass');
  });

  it('passes when userDataRoot does not exist yet but is creatable', async () => {
    // Regression: a fresh machine's userDataRoot commonly doesn't exist until
    // Electron's own app.getPath('userData') creates it lazily on first real
    // use — a provisioning gate must be able to run before that has ever
    // happened, so a missing-but-creatable directory is a pass, not a fail.
    const check = await checkUserDataWriteAccess({
      roots: {
        packageRoot: tempDir,
        projectRoot: tempDir,
        userDataRoot: path.join(tempDir, 'missing', 'nested'),
      },
      config: {},
    });
    expect(check.status).toBe('pass');
  });

  it('fails write access check when userDataRoot cannot be created', async () => {
    // A regular file sitting where a directory segment is expected makes the
    // path fundamentally uncreatable (ENOTDIR), unlike a merely-missing one.
    const blockingFilePath = path.join(tempDir, 'blocking-file');
    await fs.writeFile(blockingFilePath, 'not a directory', 'utf8');

    const check = await checkUserDataWriteAccess({
      roots: {
        packageRoot: tempDir,
        projectRoot: tempDir,
        userDataRoot: path.join(blockingFilePath, 'nested'),
      },
      config: {},
    });
    expect(check.status).toBe('fail');
    expect(check.remediation).toBeDefined();
  });

  it('extracts port from process http readiness URLs including defaults', async () => {
    const checkedPorts: number[] = [];
    const config = {
      processes: [
        {
          id: 'custom-http',
          command: 'node',
          phase: 'always',
          readiness: { kind: 'http', url: 'http://127.0.0.1:8080/health' },
        },
        {
          id: 'default-http',
          command: 'node',
          phase: 'always',
          readiness: { kind: 'http', url: 'http://127.0.0.1/ready' },
        },
        {
          id: 'default-https',
          command: 'node',
          phase: 'always',
          readiness: { kind: 'http', url: 'https://127.0.0.1/ready' },
        },
      ],
    };

    const check = await checkRequiredPortsFree({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      isPortFree: async port => {
        checkedPorts.push(port);
        return true;
      },
    });

    expect(check.status).toBe('pass');
    expect(checkedPorts).toContain(8080);
    expect(checkedPorts).toContain(80);
    expect(checkedPorts).toContain(443);
  });

  it('reports distinct failure when port check rejects rather than reporting occupied', async () => {
    const config = {
      processes: [{ id: 'srv', command: 'node', phase: 'always', requirePortsFree: [3001] }],
    };
    const check = await checkRequiredPortsFree({
      roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
      config,
      isPortFree: async () => {
        throw new Error('EADDRNOTAVAIL: address not available');
      },
    });

    expect(check.status).toBe('fail');
    expect(check.message).toContain('could not check port 3001: EADDRNOTAVAIL');
    expect(check.message).not.toContain('already in use');
  });

  it('passes write access check when unlink fails after successful write', async () => {
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockRejectedValueOnce(new Error('EBUSY: resource locked'));
    try {
      const check = await checkUserDataWriteAccess({
        roots: { packageRoot: tempDir, projectRoot: tempDir, userDataRoot: tempDir },
        config: {},
      });
      expect(check.status).toBe('pass');
      expect(check.message).toContain('Verified write access');
      expect(check.message).toContain('probe cleanup failed');
    } finally {
      unlinkSpy.mockRestore();
    }
  });
});
