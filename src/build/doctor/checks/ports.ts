import { isPortFree as defaultIsPortFree } from '../../../process/port.js';
import type { DoctorCheck, DoctorOptions, PortCheckFn } from '../types.js';

const MIN_PORT = 1;
const MAX_PORT = 65535;

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

function extractHttpPort(urlStr: string): number | undefined {
  try {
    const parsed = new URL(urlStr);
    if (parsed.port) {
      const port = Number.parseInt(parsed.port, 10);
      return Number.isNaN(port) ? undefined : port;
    }
    if (parsed.protocol === 'http:') return 80;
    if (parsed.protocol === 'https:') return 443;
    return undefined;
  } catch {
    return undefined;
  }
}

function extractProcessPorts(processes: unknown[], ports: Set<number>): void {
  for (const proc of processes) {
    if (typeof proc !== 'object' || proc === null) continue;
    const p = proc as Record<string, unknown>;
    if (Array.isArray(p.requirePortsFree)) {
      for (const port of p.requirePortsFree) {
        if (typeof port === 'number') ports.add(port);
      }
    }
    if (typeof p.readiness === 'object' && p.readiness !== null) {
      const r = p.readiness as Record<string, unknown>;
      if (r.kind === 'tcp' && typeof r.port === 'number') {
        ports.add(r.port);
      } else if (r.kind === 'http' && typeof r.url === 'string') {
        const port = extractHttpPort(r.url);
        if (port !== undefined) ports.add(port);
      }
    }
  }
}

function extractPluginPorts(plugins: Record<string, unknown>, ports: Set<number>): void {
  if (typeof plugins.dashboard === 'object' && plugins.dashboard !== null) {
    const d = plugins.dashboard as Record<string, unknown>;
    if (d.enabled !== false) {
      ports.add(typeof d.port === 'number' ? d.port : 3005);
    }
  }
}

function extractPortsFromConfig(config: unknown, extraPorts?: readonly number[]): number[] {
  const ports = new Set<number>();
  if (extraPorts) {
    for (const port of extraPorts) ports.add(port);
  }
  if (typeof config === 'object' && config !== null) {
    const raw = config as Record<string, unknown>;
    if (Array.isArray(raw.processes)) {
      extractProcessPorts(raw.processes, ports);
    }
    if (typeof raw.plugins === 'object' && raw.plugins !== null) {
      extractPluginPorts(raw.plugins as Record<string, unknown>, ports);
    }
  }
  return Array.from(ports);
}

interface PortScanResult {
  readonly occupied: readonly number[];
  readonly checkErrors: ReadonlyArray<{ readonly port: number; readonly detail: string }>;
}

async function findOccupiedPorts(
  ports: readonly number[],
  host: string,
  checker: PortCheckFn
): Promise<PortScanResult> {
  const occupied: number[] = [];
  const checkErrors: Array<{ port: number; detail: string }> = [];
  for (const port of ports) {
    try {
      const free = await checker(port, host);
      if (!free) occupied.push(port);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      checkErrors.push({ port, detail });
    }
  }
  return { occupied, checkErrors };
}

export async function checkRequiredPortsFree(options: DoctorOptions): Promise<DoctorCheck> {
  const ports = extractPortsFromConfig(options.config, options.extraPorts);
  const host = options.portsHost ?? '127.0.0.1';
  const checker = options.isPortFree ?? defaultIsPortFree;

  if (ports.length === 0) {
    return { name: 'required ports free', status: 'pass', message: 'No required ports configured.' };
  }
  const invalid = ports.filter(p => !isValidPort(p));
  if (invalid.length > 0) {
    return {
      name: 'required ports free',
      status: 'fail',
      message: `Invalid port number(s): ${invalid.join(', ')}.`,
      remediation: `Configure port numbers as integers between ${MIN_PORT} and ${MAX_PORT}.`,
    };
  }

  const { occupied, checkErrors } = await findOccupiedPorts(ports, host, checker);
  const firstError = checkErrors[0];
  if (firstError !== undefined) {
    const message = checkErrors.length === 1
      ? `could not check port ${firstError.port}: ${firstError.detail}`
      : `could not check ports: ${checkErrors.map(e => `${e.port}: ${e.detail}`).join(', ')}`;
    return {
      name: 'required ports free',
      status: 'fail',
      message,
      remediation: `Verify host "${host}" is valid and accessible, and permissions allow socket probes.`,
    };
  }

  if (occupied.length > 0) {
    return {
      name: 'required ports free',
      status: 'fail',
      message: `Port(s) already in use on ${host}: ${occupied.join(', ')}.`,
      remediation: `Stop processes listening on port(s) ${occupied.join(', ')} or configure alternative ports.`,
    };
  }
  return {
    name: 'required ports free',
    status: 'pass',
    message: `All required ports free (${ports.join(', ')} on ${host}).`,
  };
}
