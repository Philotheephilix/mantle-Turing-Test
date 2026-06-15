"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { EntryChooser } from "@/components/EntryChooser";
import { GamerHome } from "@/components/GamerHome";
import { DeveloperHome } from "@/components/DeveloperHome";
import { PageShell } from "@/components/PageShell";
import { ConfettiLayer } from "@/components/ConfettiLayer";
import { InteractiveBackground } from "@/components/InteractiveBackground";
import { readMode, writeMode, type Mode } from "@/lib/mode";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    setMounted(true);
    setMode(readMode());
  }, []);

  function choose(m: Mode) {
    setMode(m);
    writeMode(m);
    window.scrollTo({ top: 0 });
  }

  // Avoid a hydration flash: render the empty canvas until we've read storage.
  if (!mounted) return <div className="min-h-screen" />;

  return (
    <>
      <InteractiveBackground />
      <ConfettiLayer />
      {mode === null ? (
        <AnimatePresence mode="wait">
          <EntryChooser key="chooser" onChoose={choose} />
        </AnimatePresence>
      ) : (
        <PageShell mode={mode} onSwitch={choose}>
          <AnimatePresence mode="wait">
            {mode === "gamer" ? <GamerHome key="gamer" /> : <DeveloperHome key="developer" />}
          </AnimatePresence>
        </PageShell>
      )}
    </>
  );
}
