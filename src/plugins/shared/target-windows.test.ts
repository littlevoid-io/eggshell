import { describe, expect, it, vi } from 'vitest';
import type { WindowRegistry } from '../../plugin-api/types.js';
import { filterTargetWindowIds, updateViews } from './target-windows.js';

describe('filterTargetWindowIds', () => {
  it('returns all window ids when targetWindowIds is undefined', () => {
    const windows: WindowRegistry = {
      get: () => undefined,
      list: () => [{ id: 'win-1' }, { id: 'win-2' }],
    };
    const ids = filterTargetWindowIds({ windows }, {});
    expect(ids).toEqual(['win-1', 'win-2']);
  });

  it('filters window ids to only allowed targets', () => {
    const windows: WindowRegistry = {
      get: () => undefined,
      list: () => [{ id: 'win-1' }, { id: 'win-2' }, { id: 'win-3' }],
    };
    const ids = filterTargetWindowIds({ windows }, { targetWindowIds: ['win-1', 'win-3'] });
    expect(ids).toEqual(['win-1', 'win-3']);
  });
});

describe('updateViews', () => {
  it('calls show with targets when showing is true', () => {
    const windows: WindowRegistry = {
      get: () => undefined,
      list: () => [{ id: 'win-1' }],
    };
    const show = vi.fn();
    const hide = vi.fn();
    updateViews({ windows }, true, { show, hide }, {});
    expect(show).toHaveBeenCalledWith(['win-1']);
    expect(hide).not.toHaveBeenCalled();
  });

  it('calls hide with targets when showing is false', () => {
    const windows: WindowRegistry = {
      get: () => undefined,
      list: () => [{ id: 'win-1' }],
    };
    const show = vi.fn();
    const hide = vi.fn();
    updateViews({ windows }, false, { show, hide }, {});
    expect(hide).toHaveBeenCalledWith(['win-1']);
    expect(show).not.toHaveBeenCalled();
  });
});
