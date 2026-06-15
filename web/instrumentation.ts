/**
 * Next.js instrumentation hook (runtime only). Boots BOTH game backends so a single
 * `next start` runs the whole mono-app: UNO (/api/uno/*) and Monopoly (/api/monopoly/*)
 * each auto-seat a table + run their in-process bots. Both redeem through the shared
 * relayer key; each backend already serializes its own submissions and retries on
 * nonce/underpriced collisions, so the two games coexist on one key.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startAutoGame } = await import("./lib/uno/auto-start");
    await startAutoGame();
  } catch (e) {
    console.error("[instrumentation] UNO auto-start failed:", e instanceof Error ? e.message : e);
  }
  try {
    const { startAutoGame } = await import("./lib/monopoly/auto-start");
    await startAutoGame();
  } catch (e) {
    console.error("[instrumentation] Monopoly auto-start failed:", e instanceof Error ? e.message : e);
  }
}
