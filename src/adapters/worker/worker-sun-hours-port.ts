// Web Worker implementation of the sun-hours port.
//
// Owns a single worker and runs one aggregation at a time. Issuing a new
// request while one is in flight *supersedes* it: the worker is terminated
// (truly cancelling the blocking aggregation loop, not just ignoring its
// result) and the superseded promise rejects with a `SupersededError`. An idle
// worker is reused across sequential requests, so back-to-back heatmaps don't
// pay worker startup each time.

import type { SunHoursGrid } from '../../core';
import type {
  SunHoursPort,
  SunHoursProgress,
  SunHoursRequest,
} from '../../ports';

/** Rejection reason when a newer `aggregate` call cancels an in-flight one. */
export class SupersededError extends Error {
  constructor() {
    super('sun-hours aggregation superseded by a newer request');
    this.name = 'SupersededError';
  }
}

/** Whether a rejection is a {@link SupersededError} — a stale result to ignore. */
export function isSupersededError(error: unknown): error is SupersededError {
  return error instanceof SupersededError;
}

/** Messages the worker posts back: progress ticks then a single result. */
type WorkerMessage =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; grid: SunHoursGrid };

export class WorkerSunHoursPort implements SunHoursPort {
  #worker: Worker | null = null;
  /** Set while a request is in flight; lets a newer request cancel it. */
  #rejectActive: ((error: unknown) => void) | null = null;

  aggregate(
    request: SunHoursRequest,
    onProgress?: (progress: SunHoursProgress) => void,
  ): Promise<SunHoursGrid> {
    this.#cancelInFlight();
    const worker = (this.#worker ??= this.#spawn());

    return new Promise<SunHoursGrid>((resolve, reject) => {
      this.#rejectActive = reject;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === 'progress') {
          onProgress?.({ completed: message.completed, total: message.total });
          return;
        }
        // Result in hand — keep the (now idle) worker for the next request.
        this.#rejectActive = null;
        resolve(message.grid);
      };
      worker.onerror = (event) => {
        this.#discardWorker();
        reject(new Error(`sun-hours worker failed: ${event.message}`));
      };
      worker.postMessage(request);
    });
  }

  dispose(): void {
    this.#cancelInFlight();
  }

  #spawn(): Worker {
    return new Worker(new URL('./sun-hours.worker.ts', import.meta.url), {
      type: 'module',
    });
  }

  /** Rejects the in-flight request (if any) and tears down its worker. */
  #cancelInFlight(): void {
    if (this.#rejectActive) {
      const reject = this.#rejectActive;
      this.#rejectActive = null;
      this.#discardWorker();
      reject(new SupersededError());
    }
  }

  #discardWorker(): void {
    this.#rejectActive = null;
    this.#worker?.terminate();
    this.#worker = null;
  }
}
