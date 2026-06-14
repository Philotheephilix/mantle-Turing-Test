/** Fire-and-forget confetti. Any client component can call fireConfetti(x, y);
 *  a single <ConfettiLayer/> mounted near the root listens and spawns the burst. */

export const CONFETTI_EVENT = "steamlink:confetti";

export function fireConfetti(x: number, y: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONFETTI_EVENT, { detail: { x, y } }));
}

/** Fire from the center of a DOM element (e.g. a button that was clicked). */
export function fireConfettiFrom(el: HTMLElement | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  fireConfetti(r.left + r.width / 2, r.top + r.height / 2);
}
