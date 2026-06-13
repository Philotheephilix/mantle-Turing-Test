import { type Backend, type BackendOptions, createBackend } from "./createBackend.js";

/**
 * The config-object form consumed by `nexus.config.ts` (backend spec §3.1,
 * phase-05 §4.3). Returns the SAME `Backend` as `createBackend`; `nexus serve
 * --prod` reads this file. Adapter selection (real defaults vs. mock) is the
 * caller's (CLI's) concern — this just forwards the config.
 */
export type BackendConfig = BackendOptions;

export function defineBackend(cfg: BackendConfig): Backend {
  return createBackend(cfg);
}
