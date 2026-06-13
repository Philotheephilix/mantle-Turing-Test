import type { RelayerAdapter, RelayerCapabilities } from "@nexus/relayer";
import type { FacilitatorAdapter } from "@nexus/server";
import { type Address, asAddress } from "@nexus/types";
import { AwaitingRegistry } from "../lifecycles/awaiting.js";
import { MemoryWebhookLedger, WebhookHandler, type WebhookLedger } from "../lifecycles/webhook.js";
import type { IndexerAdapter } from "../ports/indexer.js";
import { PotService } from "../pots/PotService.js";
import { RoomService } from "../rooms/RoomService.js";
import { type CaveatPolicy, DEFAULT_CAVEAT_POLICY } from "../rooms/caveats.js";
import type { SessionStore } from "../rooms/store.js";
import type { GameModule } from "../types.js";
import {
  defaultFacilitator,
  defaultIndexer,
  defaultSessionStore,
  requireRelayer,
} from "./defaults.js";
import { allIndexerSchemas, indexGames } from "./discover.js";
import type { GatewayRequest, GatewayResponse, Middleware } from "./middleware.js";

export interface BackendOptions {
  chain: "base";
  world: Address;
  /** REQUIRED — DirectRelayer (dev) or OneShotRelayer (prod). */
  relayer?: RelayerAdapter;
  indexer?: IndexerAdapter;
  facilitator?: FacilitatorAdapter;
  sessionStore?: SessionStore;
  webhookLedger?: WebhookLedger;
  games: GameModule[];
  /** Webhook URL the relayer POSTs status to. Default "/nexus/webhook". */
  webhookUrl?: string;
  /** Caveat sanity overrides (thresholds). */
  caveatPolicy?: Partial<Omit<CaveatPolicy, "targetAddress">>;
}

/**
 * The assembled backend. Holds the wired services + adapters, the middleware
 * pipeline, and lifecycle hooks. `createGatewayApp(backend)` turns it into a Hono
 * app; `backend.use(mw)` appends middleware; `backend.start()` resolves the
 * relayer capabilities and starts the indexer.
 */
export interface Backend {
  readonly chain: "base";
  readonly world: Address;
  readonly games: Map<string, GameModule>;
  readonly rooms: RoomService;
  readonly pots: PotService;
  readonly relayer: RelayerAdapter;
  readonly indexer: IndexerAdapter;
  readonly facilitator: FacilitatorAdapter;
  readonly store: SessionStore;
  readonly ledger: WebhookLedger;
  readonly awaiting: AwaitingRegistry;
  readonly webhook: WebhookHandler;
  readonly webhookUrl: string;
  readonly middleware: Middleware[];
  /** The resolved relayer capabilities (set after `start()`). */
  capabilities?: RelayerCapabilities;
  use(mw: Middleware): Backend;
  start(): Promise<void>;
  runPipeline(
    req: GatewayRequest,
    terminal: (r: GatewayRequest) => Promise<GatewayResponse>,
  ): Promise<GatewayResponse>;
}

/**
 * The runtime composition root (backend spec §10, phase-05 §4.3). Instantiates
 * any adapters not supplied from `defaults.ts`, constructs `RoomService`,
 * `PotService`, the awaiting registry, and the webhook handler, registers webhook
 * ingestion into the awaiting registry, and returns a `Backend`.
 */
export function createBackend(opts: BackendOptions): Backend {
  if (opts.chain !== "base") throw new Error('createBackend: chain must be "base"');

  const games = indexGames(opts.games);
  const relayer = requireRelayer(opts.relayer);
  const indexer = opts.indexer ?? defaultIndexer();
  const store = opts.sessionStore ?? defaultSessionStore();
  const ledger = opts.webhookLedger ?? new MemoryWebhookLedger();
  const webhookUrl = opts.webhookUrl ?? "/nexus/webhook";

  const capsResolver = (): Promise<RelayerCapabilities> => relayer.getCapabilities();
  const facilitator = opts.facilitator ?? defaultFacilitator(capsResolver);

  const awaiting = new AwaitingRegistry();
  // Webhook ingestion drives the hot path: emitted StatusEvents resolve awaiting
  // calls. The relayer's own onStatus also feeds the registry (DirectRelayer).
  const webhook = new WebhookHandler(ledger);
  webhook.onStatus((e) => awaiting.ingest(e));
  awaiting.attach((cb) => relayer.onStatus(cb));

  const caveatPolicyState: { target: Address } = {
    target: asAddress("0x0000000000000000000000000000000000000000"),
  };
  const caveatPolicy = (): CaveatPolicy => ({
    ...DEFAULT_CAVEAT_POLICY,
    ...opts.caveatPolicy,
    targetAddress: caveatPolicyState.target,
  });

  const rooms = new RoomService({ store, games, caveatPolicy });

  const potBalances = new Map<string, string>();
  const pots = new PotService({
    store,
    relayer,
    economyOf: (roomId) => {
      try {
        const room = rooms.getRoom(roomId);
        return games.get(room.game)?.economy;
      } catch {
        return undefined;
      }
    },
    potBalance: (roomId) => potBalances.get(roomId) ?? "0",
  });

  const middleware: Middleware[] = [];

  const backend: Backend = {
    chain: "base",
    world: opts.world,
    games,
    rooms,
    pots,
    relayer,
    indexer,
    facilitator,
    store,
    ledger,
    awaiting,
    webhook,
    webhookUrl,
    middleware,
    use(mw: Middleware) {
      middleware.push(mw);
      return backend;
    },
    async start() {
      const caps = await relayer.getCapabilities();
      backend.capabilities = caps;
      caveatPolicyState.target = caps.targetAddress;
      await indexer.start({
        chain: "base",
        world: opts.world,
        games: allIndexerSchemas(games),
      });
    },
    async runPipeline(req, terminal) {
      const { composeMiddleware } = await import("./middleware.js");
      return composeMiddleware(middleware, terminal)(req);
    },
  };
  return backend;
}
