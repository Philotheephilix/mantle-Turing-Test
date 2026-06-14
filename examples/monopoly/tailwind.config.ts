import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "ui-monospace", "monospace"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        felt: "#0a2e2a",
        ink: "#0b1220",
      },
      boxShadow: {
        token: "0 6px 0 rgba(0,0,0,0.35), 0 12px 28px rgba(0,0,0,0.45)",
        tile: "inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.4)",
      },
      keyframes: {
        rolldice: {
          "0%": { transform: "rotate(0deg) scale(1)" },
          "50%": { transform: "rotate(180deg) scale(1.18)" },
          "100%": { transform: "rotate(360deg) scale(1)" },
        },
        hop: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pop: {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        rolldice: "rolldice 0.6s ease-in-out",
        hop: "hop 0.4s ease-in-out",
        pop: "pop 0.25s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
