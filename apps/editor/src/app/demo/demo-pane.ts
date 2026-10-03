import { InjectionToken, signal } from '@angular/core';
import type { RandomSource } from '@coschema/model';
import { SimulatedLink, type LinkConfig, type LinkStats } from '@coschema/sim/link';
import type { Clock, Transport } from '@coschema/sync';
import type { ConnectionTarget } from '../collab/connection';
import type { Identity } from '../collab/identity';
import type { DocumentSession } from '../core/document-session';

export interface PaneLinkLimits {
  readonly latencyMs: { readonly min: number; readonly max: number };
  readonly jitterMs: { readonly min: number; readonly max: number };
  readonly lossPercent: { readonly min: number; readonly max: number };
}

export const PANE_LINK_LIMITS: PaneLinkLimits = {
  latencyMs: { min: 0, max: 1500 },
  jitterMs: { min: 0, max: 600 },
  lossPercent: { min: 0, max: 60 },
};

export interface DemoPaneInit {
  readonly key: number;
  readonly identity: Identity;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly accept: (transport: Transport) => void;
  readonly config: LinkConfig;
  readonly target: ConnectionTarget;
}

function emptyStats(): LinkStats {
  return {
    sent: 0,
    delivered: 0,
    duplicated: 0,
    droppedByLoss: 0,
    droppedByPartition: 0,
    droppedByOffline: 0,
    droppedBecauseClosed: 0,
    connects: 0,
  };
}

export class DemoPane {
  readonly key: number;
  readonly identity: Identity;
  readonly target: ConnectionTarget;
  readonly link: SimulatedLink;
  readonly latencyMs = signal(0);
  readonly jitterMs = signal(0);
  readonly lossPercent = signal(0);
  readonly offline = signal(false);
  readonly stats = signal<LinkStats>(emptyStats());
  readonly session = signal<DocumentSession | undefined>(undefined);

  constructor(init: DemoPaneInit) {
    this.key = init.key;
    this.identity = init.identity;
    this.target = init.target;
    this.link = new SimulatedLink({
      clock: init.clock,
      random: init.random,
      accept: init.accept,
      config: init.config,
    });
    this.readConfig();
  }

  setLatency(value: number): void {
    this.configure({ latencyMs: value });
  }

  setJitter(value: number): void {
    this.configure({ jitterMs: value });
  }

  setLossPercent(value: number): void {
    this.configure({ lossRate: value / 100 });
  }

  applyConfig(config: LinkConfig): void {
    this.link.configure(config);
    this.readConfig();
  }

  setOffline(offline: boolean): void {
    this.link.setOffline(offline);
    this.offline.set(offline);
  }

  refresh(): void {
    this.stats.set({ ...this.link.stats });
  }

  private configure(patch: Partial<LinkConfig>): void {
    this.link.configure({ ...this.link.currentConfig, ...patch });
    this.readConfig();
  }

  private readConfig(): void {
    const config = this.link.currentConfig;
    this.latencyMs.set(config.latencyMs);
    this.jitterMs.set(config.jitterMs);
    this.lossPercent.set(Math.round(config.lossRate * 100));
  }
}

export const DEMO_PANE = new InjectionToken<DemoPane>('DEMO_PANE');
