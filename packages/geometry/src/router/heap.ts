export class MinHeap {
  private readonly priorities: number[] = [];
  private readonly sequences: number[] = [];
  private readonly values: number[] = [];
  private counter = 0;

  get size(): number {
    return this.values.length;
  }

  push(priority: number, value: number): void {
    let index = this.values.length;
    this.priorities.push(priority);
    this.sequences.push(this.counter);
    this.values.push(value);
    this.counter += 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.precedes(index, parent)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  peekPriority(): number {
    return this.priorities[0] ?? Number.POSITIVE_INFINITY;
  }

  pop(): number | undefined {
    const top = this.values[0];
    const lastPriority = this.priorities.pop();
    const lastSequence = this.sequences.pop();
    const lastValue = this.values.pop();
    if (this.values.length > 0 && lastPriority !== undefined && lastSequence !== undefined) {
      this.priorities[0] = lastPriority;
      this.sequences[0] = lastSequence;
      this.values[0] = lastValue ?? 0;
      this.siftDown();
    }
    return top;
  }

  private siftDown(): void {
    const length = this.values.length;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.precedes(left, smallest)) smallest = left;
      if (right < length && this.precedes(right, smallest)) smallest = right;
      if (smallest === index) return;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private precedes(first: number, second: number): boolean {
    const firstPriority = this.priorities[first] ?? 0;
    const secondPriority = this.priorities[second] ?? 0;
    if (firstPriority !== secondPriority) return firstPriority < secondPriority;
    return (this.sequences[first] ?? 0) < (this.sequences[second] ?? 0);
  }

  private swap(first: number, second: number): void {
    const priority = this.priorities[first] ?? 0;
    const sequence = this.sequences[first] ?? 0;
    const value = this.values[first] ?? 0;
    this.priorities[first] = this.priorities[second] ?? 0;
    this.sequences[first] = this.sequences[second] ?? 0;
    this.values[first] = this.values[second] ?? 0;
    this.priorities[second] = priority;
    this.sequences[second] = sequence;
    this.values[second] = value;
  }
}
