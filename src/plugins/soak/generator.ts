/**
 * Deterministic action-sequence generator for soak fuzzer (T4.4).
 */

import type { Mulberry32Generator } from './prng.js';
import type {
  ClickDetails,
  FuzzAction,
  FuzzActionDetails,
  FuzzActionType,
  KeyDetails,
  MoveDetails,
  ScrollDetails,
} from './types.js';

export interface ActionGeneratorOptions {
  readonly random: Mulberry32Generator;
  readonly actionTypes?: readonly FuzzActionType[] | undefined;
  readonly viewportWidth?: number | undefined;
  readonly viewportHeight?: number | undefined;
}

const DEFAULT_ACTION_TYPES: readonly FuzzActionType[] = ['click', 'move', 'key', 'scroll'];
const DEFAULT_VIEWPORT_WIDTH = 1920;
const DEFAULT_VIEWPORT_HEIGHT = 1080;
const DEFAULT_KEYS = ['a', 'b', 'c', '1', '2', 'Enter', 'Tab', 'Escape', 'ArrowDown'];

export class ActionGenerator {
  private readonly random: Mulberry32Generator;
  private readonly actionTypes: readonly FuzzActionType[];
  private readonly viewportWidth: number;
  private readonly viewportHeight: number;
  private stepCount = 0;

  constructor(options: ActionGeneratorOptions) {
    this.random = options.random;
    this.actionTypes =
      options.actionTypes && options.actionTypes.length > 0
        ? options.actionTypes
        : DEFAULT_ACTION_TYPES;
    this.viewportWidth = options.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH;
    this.viewportHeight = options.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT;
  }

  nextAction(windowId: string, timestamp: number = Date.now()): FuzzAction {
    this.stepCount++;
    const type = this.random.pick(this.actionTypes);
    const details = this.generateDetails(type);
    return {
      step: this.stepCount,
      timestamp,
      type,
      windowId,
      details,
    };
  }

  getStepCount(): number {
    return this.stepCount;
  }

  private generateDetails(type: FuzzActionType): FuzzActionDetails {
    if (type === 'click') {
      return this.createClick();
    }
    if (type === 'move') {
      return this.createMove();
    }
    if (type === 'key') {
      return this.createKey();
    }
    return this.createScroll();
  }

  private createClick(): ClickDetails {
    return {
      x: this.random.nextInt(0, this.viewportWidth),
      y: this.random.nextInt(0, this.viewportHeight),
      button: this.random.next() > 0.5 ? 'right' : 'left',
    };
  }

  private createMove(): MoveDetails {
    return {
      x: this.random.nextInt(0, this.viewportWidth),
      y: this.random.nextInt(0, this.viewportHeight),
    };
  }

  private createKey(): KeyDetails {
    return {
      key: this.random.pick(DEFAULT_KEYS),
    };
  }

  private createScroll(): ScrollDetails {
    return {
      deltaX: this.random.nextInt(-100, 100),
      deltaY: this.random.nextInt(-200, 200),
    };
  }
}
