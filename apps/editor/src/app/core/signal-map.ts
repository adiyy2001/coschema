import { signal, untracked, type Signal, type WritableSignal } from '@angular/core';

export class SignalMap<Key, Value> {
  private readonly signals = new Map<Key, WritableSignal<Value | undefined>>();

  read(key: Key): Signal<Value | undefined> {
    return this.slot(key).asReadonly();
  }

  peek(key: Key): Value | undefined {
    const slot = this.signals.get(key);
    return slot === undefined ? undefined : untracked(slot);
  }

  set(key: Key, value: Value | undefined): void {
    this.slot(key).set(value);
  }

  private slot(key: Key): WritableSignal<Value | undefined> {
    const existing = this.signals.get(key);
    if (existing !== undefined) return existing;
    const created = signal<Value | undefined>(undefined);
    this.signals.set(key, created);
    return created;
  }
}
