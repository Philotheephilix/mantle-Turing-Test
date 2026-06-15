# Steamlink — DESIGN

Aesthetic lane: **Sunny sticker-book isometric.** Warm cream paper, chunky ink
outlines with hard offset shadows (toy/sticker tactility), candy game-piece colors, a
hand-built isometric SVG game world. Reference points: premium board-game box art +
Monument Valley. Deliberately NOT dark-neon-crypto, NOT flat-corporate-isometric.

## Theme
Light / warm. Scene sentence: *a player on the couch in the afternoon, wanting a quick
fun game with friends, no crypto-wallet anxiety.* That forces bright and inviting.

## Color (Full palette, anchored on coral)
All tokens in `tailwind.config.ts` as OKLCH with a ` / <alpha-value>` channel — this
is REQUIRED for Tailwind opacity modifiers (`text-paper/90`, `bg-coral/15`) to work on
custom colors. Bare `oklch()` strings break the `/alpha` modifier (text goes invisible).

- **Neutrals (never #fff/#000):** `paper` cream bg, `paper-deep`/`paper-dark` panels,
  `ink` warm near-black text, `ink-soft`/`ink-faint` secondary text.
- **Candy palette:** `coral` (primary / CTAs), `grape`, `sky`, `grass`, `amber`,
  `berry`. Each library game owns one accent (its "color world") via `lib/games.ts`.
- Background is a warm radial wash + faint dotted "tabletop" texture (`globals.css`).

## Typography
- Display: **Bricolage Grotesque** (characterful, playful, has personality).
- Body: **Hanken Grotesk** (clean, friendly).
- Deliberately NOT Space Grotesk (the demos' font, and on the reflex-reject list).
- Headlines: `clamp()` fluid, extrabold, tight tracking (-0.02em), leading ~0.95.

## Signature treatment: the sticker
`.sticker` = `2.5px solid ink` border + hard offset shadow (`4px 4px 0 ink`). This is
the defining tactile trait — buttons, cards, badges, chips, the code panel all use it.
- `.sticker-lift` — hover translates up-left and deepens the shadow (toy lifting off).
- `.sticker-press` — active translates down-right, shadow collapses (button press).
- Chunky pill/rounded shapes (`rounded-chunk` = 1.25rem) everywhere.

## The isometric scene (`components/IsoScene.tsx`)
Hand-built 2:1 dimetric SVG, drawn programmatically with a `Cuboid` helper (3 shaded
faces: top lightest, right medium, left darkest). Scene = warm board slab + UNO card
deck + USDC coin stack + two dice + a little house. Floats via CSS `bob` keyframes
(`.float-a/b/c`), all gated behind `prefers-reduced-motion`. viewBox is tightly framed
(`-255 -120 510 290`) with a contact-shadow ellipse grounding the board.

## Motion
- Entrance: `.rise` (opacity + translateY, ease-out-quart). Hero only, restrained.
- Marquee strip of guarantees: pure-CSS infinite translateX.
- Iso scene: gentle perpetual bob. No bounce, no elastic. Reduced-motion disables all.

## Layout
- Asymmetric hero: headline left (1.05fr) + iso scene right (1fr).
- Sections: `py-12 sm:py-20`, `scroll-mt-20` for anchor nav.
- Cards used intentionally for the games library (the right affordance). Per-game color
  world prevents the identical-card-grid failure mode.
- Max width `max-w-6xl`, horizontal pad `px-5 sm:px-8`.

## Structure
Nav (sticky, sticker logo + Play) → Hero (+ IsoScene) → Marquee → How it works (3
sticker steps) → Games library (`GameCard` grid) → Developers (split panel + code) →
Footer.

## Audience split (the door + two worlds)
First visit shows `EntryChooser` — a full-screen splash asking "Gamer or Developer?"
with the two Sparky mascots. The choice persists to `localStorage` (`lib/mode.ts`) and
is switchable any time via the nav's segmented toggle (sliding sticker thumb) or the
footer prompt. `app/page.tsx` is a client component holding the `mode` state:
- `mode === null` → `EntryChooser`
- else → `PageShell` (shared nav + footer) wrapping `GamerHome` or `DeveloperHome`,
  cross-faded with `AnimatePresence mode="wait"`.

The two homes are genuinely different content, not reskins:
- **GamerHome** (coral/amber lead): play-first. Hero "Play onchain games. Zero gas." +
  `IsoScene` tabletop, how-to-play, the games library (centerpiece), "the pot is real".
- **DeveloperHome** (sky/grape lead): build-first. Hero "Build onchain games. One sig."
  + `IsoWorkbench`, the workflow, one-delegation/caveats + `defineGame` code, the
  `@steamlink/*` SDK surface, "built with Steamlink", get-started.

Note: the home route is now client-rendered (interactive chooser), so it isn't SSG.
`/play/[slug]` stays static. Mode state read on mount behind a `mounted` gate to avoid
hydration flash.

## Motion & cuteness (framer-motion)
- `Mascot` (Sparky): SVG bot with blinking eyes (CSS `blink`), rosy cheeks, bolt
  antenna; recolorable; bobs via animate loop. Wiggles on hover in the chooser.
- `IsoTilt`: pointer-reactive 3D tilt (spring rotateX/rotateY) wrapping the hero scenes.
- `Sparkles`: drifting background bits (stars, coins, pips, a card) on the chooser.
- `Reveal`: scroll-triggered fade-up (whileInView, once) on section blocks.
- `Marquee`: shared CSS guarantee strip, content differs per mode.
- New keyframes in globals: `wiggle`, `blink`, `twinkle`, `drift`. All motion gated by
  `prefers-reduced-motion`.

## Brand marks & characters
- **Logo** (`components/Logo.tsx`): a coral sticker tile holding interlocked chain
  links (the "link" = onchain) with an amber energy spark (the "steam"); two-tone
  wordmark "Steam" + coral "link". Tile tilts and spark twinkles on hover. Used in
  every header/footer.
- **Mascot "Pip"** (`components/Mascot.tsx`): a soft glossy blob (gradient body,
  gloss highlight, little feet, spark antenna, rosy cheeks) — replaced the earlier
  boxy robot. Keeps the loved cursor-tracking eyes (spring pupils + blink) and
  squishes (scaleX/scaleY) on hover.

## Interactive background
`components/InteractiveBackground.tsx`, mounted globally (home + play routes) at
`-z-10 fixed`: a warm radial **cursor spotlight** that springs toward the pointer,
plus ~7 **parallax game bits** (stars/coins/pips/ring/card) that shift at different
depths with the pointer and gently drift. Subtle by design so it doesn't fight
content. `prefers-reduced-motion` disables tracking. Replaced the chooser's old
static `Sparkles`.

## Game page = arcade cabinet (the porting seam)
`app/play/[slug]/page.tsx` is branded chrome around a big **GameCanvas**
(`components/GameCanvas.tsx`): an arcade-cabinet bezel (marquee bulbs, title, STANDBY
light) around a powered-on screen — grid + scanlines + a moving scan bar, drifting
suit glyphs, the game monogram, "Game loads here" with a blinking caret, and Pip
peeking. The screen is where the real game mounts when ported. Below the cabinet:
"About this table", a "How it plays" 1-2-3, and a back-to-library CTA. The canvas
fills most of the first viewport; the rest is our page.

## Interactive toys & SVG motion
Punchy, tactile interactions (all `prefers-reduced-motion` aware):
- **Mascot** cursor-tracking: pupils follow the pointer (spring) over a dark
  "screen" face, plus CSS blink and a wiggling bolt antenna.
- **ConfettiLayer** (`lib/confetti.ts`): `fireConfetti(x,y)` dispatches a window
  event; a single root-mounted layer spawns a framer-motion burst. Fired on mode
  select and on rolling a 6.
- **DiceRoller**: clickable SVG die, tumbles (rotate/scale) and shuffles pip faces,
  lands on a face; a 6 fires confetti from the button.
- **MagneticButton**: primary CTAs lean toward the cursor (spring) and spring back.
- **GaslessFlow**: an SVG band where a coin travels a path via native
  `<animateMotion><mpath/></animateMotion>`, over a marching-ants dashed line
  (`@keyframes ants` on stroke-dashoffset) with a wiggling "0 GAS" badge. Themed
  per audience (coral→"You win" coin / sky→"Mantle settles" blocks). NOTE: keep the
  CSS-animated rotation on a *separate inner `<g>`* from the positioning `transform`
  attribute — CSS transform overrides the attribute and the element jumps to origin.
- **SquiggleUnderline**: hand-drawn underline that strokes itself in via
  `@keyframes draw` (stroke-dashoffset, `pathLength={1}`). Used as the hero accent.
- **GameCard**: pointer-driven 3D tilt (spring rotateX/Y), a shine sweep on hover,
  and a popping/rotating monogram tile.
- **Sparkles**: drifting stars/coins/pips/card behind the chooser.

## The porting seam
`lib/games.ts` is the catalog source of truth (`status`, `accent`, `embedUrl`).
`app/play/[slug]/page.tsx` renders a placeholder "game surface"; branch on
`status`/`embedUrl` there to mount the real game when porting. Adding a game = a
registry edit, not a page rewrite.
