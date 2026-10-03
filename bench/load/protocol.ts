import type { LoadOptions } from './options';

export interface WorkerSetup {
  readonly options: LoadOptions;
  readonly wsUrl: string;
  readonly httpUrl: string;
  readonly roomIds: readonly number[];
}

export type WorkerCommand =
  | { readonly type: 'connect' }
  | { readonly type: 'start' }
  | { readonly type: 'begin-window' }
  | { readonly type: 'end-window' }
  | { readonly type: 'stop' }
  | { readonly type: 'shutdown' };

export interface WindowReport {
  readonly type: 'window';
  readonly delivery: Float64Array;
  readonly acknowledgement: Float64Array;
  readonly operations: number;
  readonly disconnects: number;
  readonly denials: number;
  readonly eventLoopUtilization: number;
  readonly eventLoopDelayP99Ms: number;
}

export type WorkerReply =
  | { readonly type: 'ready'; readonly clients: number }
  | { readonly type: 'started' }
  | { readonly type: 'began' }
  | WindowReport
  | { readonly type: 'stopped'; readonly rooms: number; readonly convergedRooms: number }
  | { readonly type: 'failed'; readonly message: string };
