/** A scrolling sticker strip of guarantees. Pure CSS, loops seamlessly. */
export function Marquee({ items }: { items: string[] }) {
  return (
    <div className="relative overflow-hidden border-y-[2.5px] border-ink bg-ink py-3">
      <div className="flex w-max gap-10 pr-10" style={{ animation: "marquee 26s linear infinite" }}>
        {[...items, ...items, ...items].map((t, i) => (
          <span key={i} className="flex items-center gap-3 whitespace-nowrap font-display text-sm font-bold uppercase tracking-wide text-paper">
            <span className="text-amber">✦</span>
            {t}
          </span>
        ))}
      </div>
      <style>{`@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-33.333%)}}`}</style>
    </div>
  );
}
