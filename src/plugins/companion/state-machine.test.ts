import { describe, expect, it } from 'vitest';
import { CompanionStateMachine } from './state-machine.js';

describe('CompanionStateMachine (T4.3)', () => {
  it('initializes with given properties', () => {
    const machine = new CompanionStateMachine({
      url: 'http://127.0.0.1:3005/',
      qrDataUrl: 'data:image/png;base64,mock',
      title: 'Kiosk Companion',
      description: 'Scan code',
      isShowing: true,
    });

    const state = machine.getState();
    expect(state.url).toBe('http://127.0.0.1:3005/');
    expect(state.qrDataUrl).toBe('data:image/png;base64,mock');
    expect(state.title).toBe('Kiosk Companion');
    expect(state.description).toBe('Scan code');
    expect(state.isShowing).toBe(true);
  });

  it('manages show and hide transitions', () => {
    const machine = new CompanionStateMachine({
      url: 'http://127.0.0.1:3005/',
      qrDataUrl: 'data:image/png;base64,mock',
      title: 'Companion',
    });

    expect(machine.getState().isShowing).toBe(false);
    expect(machine.hide()).toBe(false);

    expect(machine.show()).toBe(true);
    expect(machine.getState().isShowing).toBe(true);
    expect(machine.show()).toBe(false);

    expect(machine.hide()).toBe(true);
    expect(machine.getState().isShowing).toBe(false);
  });

  it('toggles visibility state', () => {
    const machine = new CompanionStateMachine({
      url: 'http://127.0.0.1:3005/',
      qrDataUrl: 'data:image/png;base64,mock',
      title: 'Companion',
    });

    expect(machine.toggle()).toBe(true);
    expect(machine.getState().isShowing).toBe(true);

    expect(machine.toggle()).toBe(true);
    expect(machine.getState().isShowing).toBe(false);
  });

  it('updates payload url and qrDataUrl', () => {
    const machine = new CompanionStateMachine({
      url: 'http://127.0.0.1:3005/',
      qrDataUrl: 'data:image/png;base64,old',
      title: 'Companion',
    });

    const changed = machine.updatePayload('http://192.168.1.5:3005/', 'data:image/png;base64,new');
    expect(changed).toBe(true);
    expect(machine.getState().url).toBe('http://192.168.1.5:3005/');

    const unchanged = machine.updatePayload(
      'http://192.168.1.5:3005/',
      'data:image/png;base64,new'
    );
    expect(unchanged).toBe(false);
  });
});
