import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "./wallet";

export const metadata: Metadata = {
  title: "NEXUS · Onchain Monopoly",
  description: "Fully onchain Monopoly on Base Sepolia — gasless dice, real USDC payments via Nexus delegations.",
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
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
