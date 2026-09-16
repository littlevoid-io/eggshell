import type { Clock } from '../../clock.js';
import type { ResolvedApp } from '../../config/resolved.js';
import type { SoakAction, SoakConfig } from '../../config/types.js';
import type { Logger } from '../../logging/logger.js';
import type { IpcRouter } from '../ipc.js';
import type { ManagedWindow } from '../windows/create.js';

export type { SoakAction, SoakConfig };

export type SoakStepType = SoakAction;

export interface ClickDetails {
  readonly x: number;
  readonly y: number;
  readonly button: 'left' | 'right';
}

export interface MoveDetails {
  readonly x: number;
  readonly y: number;
}

export interface KeyDetails {
  readonly key: string;
}

export interface ScrollDetails {
  readonly deltaX: number;
  readonly deltaY: number;
}

export type SoakStepDetails = ClickDetails | MoveDetails | KeyDetails | ScrollDetails;

export interface SoakStep {
  readonly step: number;
  readonly timestamp: number;
  readonly type: SoakStepType;
  readonly windowId: string;
  readonly details: SoakStepDetails;
}

export interface CrashReport {
  readonly windowId: string;
  readonly timestamp: number;
  readonly reason: string;
  readonly exitCode: number;
}

export interface ConsoleMessageReport {
  readonly windowId: string;
  readonly timestamp: number;
  readonly level: 'error' | 'warning' | 'info' | 'debug';
  readonly message: string;
  readonly lineNumber?: number | undefined;
  readonly sourceId?: string | undefined;
}

export interface SoakReport {
  readonly seed: number;
  readonly startedAt: number;
  readonly stoppedAt?: number | undefined;
  readonly completedActions: number;
  readonly actions: readonly SoakStep[];
  readonly crashes: readonly CrashReport[];
  readonly errors: readonly ConsoleMessageReport[];
}

export interface ReportWriter {
  write(report: SoakReport): Promise<void> | void;
}

export interface SoakState {
  readonly running: boolean;
  readonly seed: number;
  readonly actionCount: number;
  readonly crashCount: number;
  readonly errorCount: number;
}

export interface SoakRunner {
  readonly state: SoakState;
  stop(): Promise<void>;
}

export interface SoakOptions {
  readonly config: SoakConfig;
  readonly windows: readonly ManagedWindow[];
  readonly resolved: ResolvedApp;
  readonly router: IpcRouter;
  readonly logger: Logger;
  readonly isPackaged: boolean;
  readonly clock?: Clock | undefined;
  readonly reportWriter?: ReportWriter | undefined;
}
