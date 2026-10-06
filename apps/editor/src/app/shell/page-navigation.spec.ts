import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_NAVIGATION, roomPath } from './page-navigation';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

describe('roomPath', () => {
  it('encodes the room and keeps the query string', () => {
    expect(roomPath('plant 1/a', '?server=http://127.0.0.1:4218')).toBe(
      'r/plant%201%2Fa?server=http://127.0.0.1:4218',
    );
    expect(roomPath('plant', '')).toBe('r/plant');
  });
});

describe('PAGE_NAVIGATION', () => {
  it('reads the search of the current location and assigns a new one', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { search: '?panes=3', assign });
    const navigation = TestBed.inject(PAGE_NAVIGATION);
    expect(navigation.search).toBe('?panes=3');
    navigation.open('/demo');
    expect(assign).toHaveBeenCalledWith('/demo');
  });
});
