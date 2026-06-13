import type { RelayerAdapter } from "@nexus/relayer";

export interface HealthDTO {
  status: "ok";
  uptime: number;
}

export interface ReadyDTO {
  ready: boolean;
  checks: { relayer: boolean; indexer: boolean; sessionStore: boolean };
}

const startedAt = Date.now();

export function healthz(): HealthDTO {
  return { status: "ok", uptime: Date.now() - startedAt };
}

/**
 * `/readyz` gates traffic during rollout: relayer capabilities resolved, indexer
 * started, session store reachable (phase-05 §4.1).
 */
export async function readyz(deps: {
  relayer: RelayerAdapter;
  indexerReady: () => boolean;
  sessionStoreReachable: () => Promise<boolean>;
}): Promise<ReadyDTO> {
  let relayer = false;
  try {
    await deps.relayer.getCapabilities();
    relayer = true;
  } catch {
    relayer = false;
  }
  const indexer = deps.indexerReady();
  const sessionStore = await deps.sessionStoreReachable().catch(() => false);
  return { ready: relayer && indexer && sessionStore, checks: { relayer, indexer, sessionStore } };
}
