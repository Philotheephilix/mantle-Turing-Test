import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus UNO — onchain, gasless, x402",
  description:
    "A fully onchain UNO demo on Base Sepolia. One delegation powers gasless moves; the 1 USDC entry fee is a real x402 payment.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="felt-grain antialiased">{children}</body>
    </html>
  );
}
