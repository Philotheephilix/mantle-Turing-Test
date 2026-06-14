/** Which face of Steamlink a visitor chose at the door. */
export type Mode = "gamer" | "developer";

export const MODE_STORAGE_KEY = "steamlink-mode";

export function readMode(): Mode | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(MODE_STORAGE_KEY);
  return v === "gamer" || v === "developer" ? v : null;
}

export function writeMode(mode: Mode) {
  if (typeof window !== "undefined") window.localStorage.setItem(MODE_STORAGE_KEY, mode);
}
