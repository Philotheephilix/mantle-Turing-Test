import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: "#0a0a0f",
        felt: "#0d2818",
        uno: {
          red: "#e4002b",
          green: "#3aa935",
          blue: "#0073cf",
          yellow: "#ffcc00",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
