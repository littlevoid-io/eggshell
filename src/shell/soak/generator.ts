import type { Mulberry32Generator } from './prng.js';
import type {
  ClickDetails,
  KeyDetails,
  MoveDetails,
  ScrollDetails,
  SoakStep,
  SoakStepDetails,
  SoakStepType,
} from './types.js';

export interface ActionGeneratorOptions {
  readonly random: Mulberry32Generator;
  readonly actionTypes?: readonly SoakStepType[] | undefined;
  readonly viewportWidth?: number | undefined;
  readonly viewportHeight?: number | undefined;
}

const DEFAULT_ACTION_TYPES: readonly SoakStepType[] = ['click', 'move', 'key', 'scroll'];
const DEFAULT_VIEWPORT_WIDTH = 1920;
const DEFAULT_VIEWPORT_HEIGHT = 1080;
const DEFAULT_KEYS = ['a', 'b', 'c', '1', '2', 'Enter', 'Tab', 'Escape', 'ArrowDown'];

export class ActionGenerator {
  private readonly random: Mulberry32Generator;
  private readonly actionTypes: readonly SoakStepType[];
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

  private resolveDimensions(width?: number, height?: number) {
    return {
      width: width !== undefined && width > 0 ? width : this.viewportWidth,
      height: height !== undefined && height > 0 ? height : this.viewportHeight,
    };
  }

  nextStep(
    windowId: string,
    timestamp: number = Date.now(),
    viewportWidth?: number,
    viewportHeight?: number
  ): SoakStep {
    this.stepCount++;
    const { width, height } = this.resolveDimensions(viewportWidth, viewportHeight);
    const type = this.random.pick(this.actionTypes);
    const details = this.generateDetails(type, width, height);
    return { step: this.stepCount, timestamp, type, windowId, details };
  }

  nextAction(
    windowId: string,
    timestamp: number = Date.now(),
    viewportWidth?: number,
    viewportHeight?: number
  ): SoakStep {
    return this.nextStep(windowId, timestamp, viewportWidth, viewportHeight);
  }

  getStepCount(): number {
    return this.stepCount;
  }

  private generateDetails(type: SoakStepType, width: number, height: number): SoakStepDetails {
    if (type === 'click') {
      return this.createClick(width, height);
    }
    if (type === 'move') {
      return this.createMove(width, height);
    }
    if (type === 'key') {
      return this.createKey();
    }
    return this.createScroll();
  }

  private createClick(width: number, height: number): ClickDetails {
    return {
      x: this.random.nextInt(0, width),
      y: this.random.nextInt(0, height),
      button: this.random.next() > 0.5 ? 'right' : 'left',
    };
  }

  private createMove(width: number, height: number): MoveDetails {
    return {
      x: this.random.nextInt(0, width),
      y: this.random.nextInt(0, height),
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
