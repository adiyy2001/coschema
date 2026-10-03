import type { Unsubscribe } from './transport';

export class Emitter<Args extends unknown[]> {
  private readonly handlers = new Set<(...args: Args) => void>();

  subscribe(handler: (...args: Args) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(...args: Args): void {
    for (const handler of [...this.handlers]) handler(...args);
  }

  get size(): number {
    return this.handlers.size;
  }

  clear(): void {
    this.handlers.clear();
  }
}
