import { GameCanvas } from "@/components/GameCanvas";
import { InteractiveBackground } from "@/components/InteractiveBackground";
import { Logo } from "@/components/Logo";
import { GAMES, type GameAccent, getGame } from "@/lib/games";
import Link from "next/link";
import { notFound } from "next/navigation";

const ACCENT_TILE: Record<GameAccent, string> = {
  coral: "bg-coral text-paper",
  grape: "bg-grape text-paper",
  sky: "bg-sky text-paper",
  grass: "bg-grass text-ink",
  amber: "bg-amber text-ink",
  berry: "bg-berry text-paper",
};

const HOW = [
  { t: "Sign once", b: "One delegation sets your caps and turn rules." },
  { t: "Play gasless", b: "Every move is relayed. No popups, no gas." },
  { t: "Win the pot", b: "Real USDC, paid out onchain by the contract." },
];

export function generateStaticParams() {
  return GAMES.map((g) => ({ slug: g.slug }));
}

export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();

  return (
    <div className="min-h-screen">
      <InteractiveBackground />

      {/* branded top bar */}
      <header className="sticky top-0 z-50 border-b-[2.5px] border-ink bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <Link href="/">
            <Logo />
          </Link>
          <Link
            href="/"
            className="sticker sticker-lift sticker-press inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-2 text-sm font-bold"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M13 8H4m4-4-4 4 4 4"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Library
          </Link>
        </div>
      </header>

      {/* the cabinet */}
      <main className="mx-auto max-w-5xl px-5 pb-16 pt-8 sm:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <span
            className={`grid h-14 w-14 place-items-center rounded-2xl border-[2.5px] border-ink font-display text-2xl font-extrabold shadow-sticker ${ACCENT_TILE[game.accent]}`}
          >
            {game.monogram}
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                {game.title}
              </h1>
              <span className="rounded-full border-[2px] border-ink bg-paper px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                {game.status === "coming-soon" ? "Coming soon" : game.status}
              </span>
            </div>
            <p className="mt-0.5 text-sm font-semibold text-ink-faint">
              {game.players} players · Mantle
            </p>
          </div>
          <div className="hidden flex-wrap gap-1.5 sm:flex">
            {game.tags.map((tag) => (
              <span key={tag} className="sticker rounded-full bg-paper px-3 py-1 text-xs font-bold">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <GameCanvas monogram={game.monogram} title={game.title} accent={game.accent} />

        {/* below-the-cabinet: our page */}
        <div className="mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="sticker rounded-chunk bg-paper p-7">
            <span className="font-display text-sm font-extrabold uppercase tracking-wider text-coral">
              About this table
            </span>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{game.description}</p>
            <div className="mt-5 flex flex-wrap gap-1.5 sm:hidden">
              {game.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border-[2px] border-ink bg-paper-deep px-2.5 py-0.5 text-[11px] font-bold"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="sticker rounded-chunk bg-paper-deep p-7">
            <span className="font-display text-sm font-extrabold uppercase tracking-wider text-coral">
              How it plays
            </span>
            <ol className="mt-4 space-y-3">
              {HOW.map((h, i) => (
                <li key={h.t} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border-[2px] border-ink bg-coral text-xs font-extrabold text-paper">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-bold">{h.t}</p>
                    <p className="text-[13px] leading-snug text-ink-soft">{h.b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-chunk border-[2.5px] border-dashed border-ink/25 p-6">
          <p className="font-display text-lg font-bold">Not your game? Pull up another chair.</p>
          <Link
            href="/"
            className="sticker sticker-lift sticker-press rounded-full bg-coral px-6 py-3 text-sm font-bold text-paper"
          >
            Back to the library
          </Link>
        </div>
      </main>

      <footer className="border-t-[2.5px] border-ink bg-paper-deep">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-8 sm:px-8">
          <Logo size={34} />
          <p className="text-sm font-medium text-ink-soft">
            Gasless onchain games, settled on Mantle.
          </p>
        </div>
      </footer>
    </div>
  );
}
