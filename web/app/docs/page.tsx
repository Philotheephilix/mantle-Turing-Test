"use client";

import { CONTRIBUTE_NAV, ContributeDocs } from "@/components/docs/ContributeDocs";
import { type DocTab, DocsShell } from "@/components/docs/DocsShell";
import { SDK_NAV, SdkDocs } from "@/components/docs/SdkDocs";
import { useState } from "react";

const TABS: DocTab[] = [
  { key: "sdk", label: "SDK reference", sub: "Use the @steamlink/* packages" },
  {
    key: "contribute",
    label: "Contribute a game",
    sub: "Raise a PR to add UNO/Monopoly-style games",
  },
];

export default function DocsPage() {
  const [tab, setTab] = useState<string>("sdk");

  function switchTab(key: string) {
    setTab(key);
    window.scrollTo({ top: 0 });
  }

  const nav = tab === "sdk" ? SDK_NAV : CONTRIBUTE_NAV;

  return (
    <DocsShell tabs={TABS} activeTab={tab} onTab={switchTab} nav={nav}>
      {tab === "sdk" ? <SdkDocs /> : <ContributeDocs />}
    </DocsShell>
  );
}
