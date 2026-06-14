/**
 * Deterministic deck shuffle seeded by an ON-CHAIN random word.
 *
 * The authoritative deck order is NEVER produced by Math.random. The server asks
 * the on-chain RandomnessCoordinator for a random word (its `fast`/prevrandao
 * tier — a single tx, perfect for a low-stakes card game; documented in
 * RandomnessCoordinator.sol), then expands that 256-bit word into a stream of
 * unbiased indices via keccak (mirroring the coordinator's own `dice` rejection
 * sampling) and runs Fisher-Yates. Given the same on-chain word the shuffle is
 * fully reproducible and auditable — and no one can peek the order before the
 * deal, because the word only exists after the on-chain tx mines.
 *
 * RANDOMNESS CHOICE (documented): we use the coordinator's `fast` tier for the
 * seed. It is fully on-chain and real (a tx + a `FastRandom` event carrying the
 * word). A full two-block commit-reveal is also supported by the coordinator but
 * adds a block-wait per game; for the demo we keep the seed on-chain via `fast`.
 * No off-chain entropy enters the authoritative shuffle.
 */
import { keccak256, encodePacked } from "viem";

/** Expand an on-chain 256-bit word into a deterministic keccak stream. */
function* wordStream(word: bigint): Generator<bigint> {
  let i = 0n;
  for (;;) {
    yield BigInt(keccak256(encodePacked(["uint256", "uint256"], [word, i])));
    i++;
  }
}

/**
 * Fisher-Yates shuffle of `deck` seeded by the on-chain `word`. Uses rejection
 * sampling per draw (same technique as the coordinator's `dice`) so each index
 * is unbiased. Pure + deterministic from `(deck.length, word)`.
 */
export function shuffleWithWord<T>(deck: readonly T[], word: bigint): T[] {
  const out = deck.slice();
  const stream = wordStream(word);
  for (let i = out.length - 1; i > 0; i--) {
    const n = BigInt(i + 1);
    // Largest multiple of n that fits in 2^256; draws at/above are the biased tail.
    const max = 2n ** 256n;
    const limit = max - (max % n);
    let draw = stream.next().value as bigint;
    while (draw >= limit) draw = stream.next().value as bigint;
    const j = Number(draw % n);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
