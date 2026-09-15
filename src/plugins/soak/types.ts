/**
 * Types for the soak-test interaction fuzzer plugin (T4.4).
 */

import type { Logger } from '../../logging/logger.js';

export type FuzzActionType = 'click' | 'move' | 'key' | 'scroll';

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

export type FuzzActionDetails = ClickDetails | MoveDetails | KeyDetails | ScrollDetails;

export interface FuzzAction {
  readonly step: number;
  readonly timestamp: number;
  readonly type: FuzzActionType;
  readonly windowId: string;
  readonly details: FuzzActionDetails;
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
  readonly actions: readonly FuzzAction[];
  readonly crashes: readonly CrashReport[];
  readonly errors: readonly ConsoleMessageReport[];
}

export interface ReportWriter {
  write(report: SoakReport): Promise<void> | void;
}

export interface SoakConfig {
  readonly enabled: boolean;
  readonly seed?: number | undefined;
  readonly intervalMs: number;
  readonly actionTypes: readonly FuzzActionType[];
  readonly targetWindowIds?: readonly string[] | undefined;
  readonly maxActions?: number | undefined;
  readonly reportPath?: string | undefined;
}

export interface SoakState {
  readonly running: boolean;
  readonly seed: number;
  readonly actionCount: number;
  readonly crashCount: number;
  readonly errorCount: number;
}

export interface SoakPluginOptions {
  readonly config?: Partial<SoakConfig> | undefined;
  readonly isPackagedFn?: (() => boolean) | undefined;
  readonly reportWriter?: ReportWriter | undefined;
  readonly seedGenerator?: (() => number) | undefined;
  readonly logger?: Logger | undefined;
}
