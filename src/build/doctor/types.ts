import type { Clock } from '../../clock.js';
import type { ShellRoots } from '../../paths/roots.js';
import type { TouchProbe } from '../../layout/probes/types.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly message: string;
  readonly remediation?: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly overallStatus: DoctorStatus;
}

export type GetDisplaysFn = () => Promise<readonly unknown[]> | readonly unknown[];
export type ResolveElectronFn = (projectRoot: string) => Promise<string>;
export type PortCheckFn = (port: number, host: string) => Promise<boolean>;
export type AssetExistsFn = (filePath: string) => Promise<boolean> | boolean;

export interface DoctorOptions {
  readonly roots: ShellRoots;
  readonly config: unknown;
  readonly getDisplays?: GetDisplaysFn | undefined;
  readonly touchProbe?: TouchProbe | undefined;
  readonly touchProbeTimeoutMs?: number | undefined;
  readonly resolveElectron?: ResolveElectronFn | undefined;
  readonly isPortFree?: PortCheckFn | undefined;
  readonly portsHost?: string | undefined;
  readonly extraPorts?: readonly number[] | undefined;
  readonly assetExists?: AssetExistsFn | undefined;
  readonly platform?: string | undefined;
  readonly arch?: string | undefined;
  readonly clock?: Clock | undefined;
  readonly checkTimeoutMs?: number | undefined;
}
