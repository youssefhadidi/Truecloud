/** @format */

// Semaphore for limiting concurrent operations
export class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }

  async acquire(weight = 1) {
    if (this.count + weight <= this.max) {
      this.count += weight;
      return weight;
    }
    return new Promise((resolve) => {
      this.queue.push({ weight, resolve });
    }).then(() => weight);
  }

  release(weight = 1) {
    this.count -= weight;
    if (this.queue.length > 0) {
      const next = this.queue[0];
      if (this.count + next.weight <= this.max) {
        this.queue.shift();
        this.count += next.weight;
        next.resolve();
      }
    }
  }
}
