import { ArrowLeft, ArrowRight, Check, ExternalLink, Fingerprint, KeyRound, LockKeyhole, RadioTower, ShieldCheck, Sparkles, UserRoundPlus, Wallet, X } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PageFooter from "@/components/PageFooter";

const steps = [
  {
    number: "01",
    icon: Wallet,
    phase: "Setup",
    phaseVariant: "chain" as const,
    label: "Connect a Solana wallet",
    description:
      "Both parties open SilentCircle and connect a Solana wallet — Phantom, Backpack, or Solflare. The app runs entirely on devnet, so no real funds are at risk. Each browser session needs its own wallet.",
    callout: {
      type: "tip" as const,
      text: "Need devnet SOL for gas? Visit faucet.solana.com and airdrop 2 SOL to each wallet address.",
    },
  },
  {
    number: "02",
    icon: UserRoundPlus,
    phase: "Session",
    phaseVariant: "privacy" as const,
    label: "Start or join a session",
    description:
      "Party A (the initiator) clicks \"Start private session\" — this creates a unique on-chain session account (PDA) and produces a shareable session URL. Party B opens that URL in their own browser with their own wallet connected. Both wallets are now bound to the same session.",
    callout: {
      type: "info" as const,
      text: "Each session is a Program Derived Address (PDA) on Solana devnet. The PDA stores both wallet addresses and all commitment data.",
    },
  },
  {
    number: "03",
    icon: Fingerprint,
    phase: "Commitment",
    phaseVariant: "chain" as const,
    label: "Select assets and commit privately",
    description:
      "Each wallet independently selects which asset types to include — SPL Tokens, NFT Collections, or DAO Memberships. The app fetches your on-chain holdings, hashes each asset ID with SHA-256, and writes only the combined commitment hash to the session PDA. No asset identities leave the browser.",
    callout: {
      type: "info" as const,
      text: "Commitment = SHA-256(sorted fingerprints). Only this single hash is written on-chain — your full asset list never touches the blockchain.",
    },
  },
  {
    number: "04",
    icon: RadioTower,
    phase: "MXE Computing",
    phaseVariant: "chain" as const,
    label: "Arcium MXE runs private set intersection",
    description:
      "Once both wallets have committed, either party triggers the PSI computation. Arcium's Multi-party Execution Environment runs a garbled-circuit Private Set Intersection (PSI): it mathematically finds common elements between both asset sets without either party — or the compute nodes — ever seeing the full lists in plaintext.",
    callout: {
      type: "secure" as const,
      text: "The MXE computation is encrypted end-to-end. Arcium cluster nodes evaluate the garbled circuit but cannot reconstruct either wallet's holdings.",
    },
  },
  {
    number: "05",
    icon: ShieldCheck,
    phase: "Reveal",
    phaseVariant: "privacy" as const,
    label: "Intersection revealed — nothing else",
    description:
      "The on-chain session account is updated with only the count and fingerprints of matched assets. Both browsers poll the PDA in real time and surface the result simultaneously. Your full portfolio is never written anywhere — only what both wallets share is confirmed.",
    callout: {
      type: "success" as const,
      text: "Zero matches is a valid and private result. If nothing overlaps, neither party learns anything about what the other holds.",
    },
  },
];

const assetTypes = [
  {
    icon: KeyRound,
    label: "SPL Tokens",
    value: "tokens",
    description: "Any fungible token on Solana — USDC, BONK, JTO, or any custom mint. Matched by mint address.",
    testTip: "Easiest to test: get devnet USDC for both wallets.",
    mintLabel: "Devnet USDC mint",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    faucetLabel: "spl-token-faucet.com",
    faucetUrl: "https://spl-token-faucet.com",
    difficulty: "Easy",
    difficultyColor: "success" as const,
  },
  {
    icon: Sparkles,
    label: "NFT Collections",
    value: "nfts",
    description: "Verified Metaplex NFT collections. Matched by the shared collection mint address.",
    testTip: "Both wallets need an NFT from the same verified collection on devnet.",
    mintLabel: null,
    mint: null,
    faucetLabel: "Requires minting on devnet",
    faucetUrl: null,
    difficulty: "Moderate",
    difficultyColor: "warning" as const,
  },
  {
    icon: LockKeyhole,
    label: "DAO Memberships",
    value: "daos",
    description: "SPL Governance realm memberships. Matched by the shared realm address.",
    testTip: "Both wallets must hold governance tokens in the same DAO realm.",
    mintLabel: null,
    mint: null,
    faucetLabel: "Requires an existing devnet DAO",
    faucetUrl: null,
    difficulty: "Advanced",
    difficultyColor: "warning" as const,
  },
];

const rolesData = [
  {
    role: "Party A — Initiator",
    color: "primary",
    steps: [
      "Connect your wallet in Browser A",
      "Click \"Start private session\"",
      "Copy the session URL that appears",
      "Send the URL to Party B (any channel)",
      "Wait for the counterparty joined confirmation",
      "Both wallets auto-commit when assets are loaded",
      "Click \"Start PSI\" once both committed",
      "View the intersection results",
    ],
  },
  {
    role: "Party B — Counterparty",
    color: "secondary",
    steps: [
      "Connect your wallet in Browser B",
      "Open the session URL from Party A",
      "The console auto-detects the session",
      "Your wallet commitment is submitted automatically",
      "Wait for Party A to trigger the PSI",
      "Both browsers show results simultaneously",
    ],
  },
];

const privacyGroups = [
  {
    group: "Session identity",
    note: "Minimal metadata bound to the session PDA",
    rows: [
      { item: "Wallet addresses", detail: "Required to associate both signers with the on-chain session account.", partyA: true, partyB: true, onChain: true },
      { item: "Commitment hash", detail: "A single SHA-256 of sorted fingerprints — no asset identities included.", partyA: true, partyB: true, onChain: true },
    ],
  },
  {
    group: "Raw asset holdings",
    note: "Computed locally and never transmitted",
    rows: [
      { item: "Full SPL token list", detail: "Fingerprints derived in-browser via SHA-256; raw mint addresses never leave the client.", partyA: false, partyB: false, onChain: false },
      { item: "NFT collection list", detail: "Verified collection mints hashed locally — the list itself is never sent anywhere.", partyA: false, partyB: false, onChain: false },
      { item: "DAO memberships", detail: "Governance realm addresses processed client-side only.", partyA: false, partyB: false, onChain: false },
      { item: "Non-matching holdings", detail: "Assets held by only one party are invisible — even to the Arcium circuit output.", partyA: false, partyB: false, onChain: false },
    ],
  },
  {
    group: "Computation output",
    note: "What the Arcium MXE returns after garbled-circuit evaluation",
    rows: [
      { item: "Intersection fingerprints", detail: "64-bit truncated hashes of shared assets, verified by the cluster signature before being written.", partyA: true, partyB: true, onChain: true },
      { item: "Match count", detail: "Integer count emitted in the on-chain IntersectionReady event.", partyA: true, partyB: true, onChain: true },
    ],
  },
];

const calloutStyle = (type: "tip" | "info" | "secure" | "success") => {
  switch (type) {
    case "tip":
      return "border-warning/30 bg-warning/8 text-warning";
    case "info":
      return "border-secondary/30 bg-secondary/8 text-secondary";
    case "secure":
      return "border-primary/30 bg-primary/8 text-primary";
    case "success":
      return "border-success/30 bg-success/8 text-success";
  }
};

const calloutLabel = (type: "tip" | "info" | "secure" | "success") => {
  switch (type) {
    case "tip": return "Tip";
    case "info": return "Note";
    case "secure": return "Privacy";
    case "success": return "Result";
  }
};

const HowItWorks = () => (
  <main className="min-h-screen overflow-x-hidden bg-hero text-foreground">
    <div className="relative mx-auto w-full max-w-4xl px-4 py-5 sm:px-5 md:px-8">
      {/* Background layers */}
      <div className="pointer-events-none absolute inset-0 arcium-dot-field opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,hsl(var(--background)/0.22)_46%,hsl(var(--background))_82%)]" />

      {/* Navbar */}
      <nav className="relative z-10">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface/40 px-3 py-2 backdrop-blur-md sm:px-4 sm:py-2.5">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-tight sm:tracking-[0.38em]">SilentCircle</p>
              <p className="text-xs text-muted-foreground">How it works</p>
            </div>
          </div>
          <Button asChild variant="glass" size="sm">
            <Link to="/"><ArrowLeft className="size-3.5" /><span className="hidden sm:inline"> Back to home</span></Link>
          </Button>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.4)] to-transparent" />
      </nav>

      {/* Hero */}
      <section className="relative z-10 mt-8 space-y-5 animate-float-in text-center sm:mt-12">
        <Badge variant="privacy" className="gap-2 px-3 py-1">
          <Sparkles className="size-3.5" /> Protocol walkthrough
        </Badge>
        <h1 className="text-balance text-3xl font-semibold uppercase leading-[0.92] tracking-normal sm:text-4xl md:text-5xl lg:text-6xl">
          How SilentCircle works
        </h1>
        <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          Two wallets. Zero disclosure. One shared result. Here's the complete flow from connection to intersection — including what you need to run a real session on devnet.
        </p>
      </section>

      {/* Divider */}
      <div className="relative z-10 my-8 h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.25)] to-transparent sm:my-12" />

      {/* Protocol steps */}
      <section className="relative z-10 space-y-6">
        <div className="mb-8 text-center">
          <h2 className="text-base font-semibold uppercase tracking-[0.2em] sm:text-xl">The 5-step protocol</h2>
          <p className="mt-2 text-sm text-muted-foreground">Follow these steps in order across two browsers for a complete session.</p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical rail */}
          <div className="absolute left-[1.6rem] top-6 hidden h-[calc(100%-3rem)] w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent sm:block" />

          <div className="space-y-5">
            {steps.map((step) => (
              <article key={step.number} className="relative rounded-xl border border-border/60 bg-panel backdrop-blur-xl shadow-panel overflow-hidden">
                <div className="flex gap-4 p-5 sm:gap-6">
                  {/* Step number badge */}
                  <div className="relative shrink-0">
                    <div className="grid size-12 place-items-center rounded-full border border-primary/40 bg-primary/15 text-primary shadow-secure font-mono text-[0.7rem] font-semibold tracking-widest">
                      {step.number}
                    </div>
                    {/* Icon inside */}
                    <div className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border border-border/60 bg-surface text-primary">
                      <step.icon className="size-2.5" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={step.phaseVariant} className="text-[0.65rem]">{step.phase}</Badge>
                      <h3 className="text-sm font-semibold sm:text-base">{step.label}</h3>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{step.description}</p>
                    {/* Callout */}
                    <div className={`rounded-lg border px-3 py-2 text-xs leading-5 ${calloutStyle(step.callout.type)}`}>
                      <span className="mr-1.5 font-semibold uppercase tracking-[0.15em]">{calloutLabel(step.callout.type)}:</span>
                      {step.callout.text}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="relative z-10 my-8 h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.25)] to-transparent sm:my-12" />

      {/* Session Roles */}
      <section className="relative z-10 space-y-6">
        <div className="text-center">
          <h2 className="text-base font-semibold uppercase tracking-[0.2em] sm:text-xl">Who does what</h2>
          <p className="mt-2 text-sm text-muted-foreground">Run each role in a separate browser window with a separate wallet connected.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {rolesData.map((role) => (
            <article key={role.role} className={`rounded-xl border backdrop-blur-xl overflow-hidden shadow-panel ${role.color === "primary" ? "border-primary/30 bg-panel" : "border-secondary/30 bg-panel"}`}>
              <div className={`border-b px-4 py-2.5 ${role.color === "primary" ? "border-primary/20 bg-primary/8" : "border-secondary/20 bg-secondary/8"}`}>
                <p className={`font-mono text-[0.7rem] font-semibold uppercase tracking-[0.2em] ${role.color === "primary" ? "text-primary" : "text-secondary"}`}>
                  {role.role}
                </p>
              </div>
              <ul className="space-y-0 p-4">
                {role.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 py-1.5 border-b border-border/30 last:border-0">
                    <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border text-[0.55rem] font-bold ${role.color === "primary" ? "border-primary/40 bg-primary/15 text-primary" : "border-secondary/40 bg-secondary/15 text-secondary"}`}>
                      {i + 1}
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">{s}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="relative z-10 my-8 h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.25)] to-transparent sm:my-12" />

      {/* Asset Types + Getting Test Assets */}
      <section className="relative z-10 space-y-6">
        <div className="text-center">
          <h2 className="text-base font-semibold uppercase tracking-[0.2em] sm:text-xl">Supported assets & how to get them</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            For a match to appear, <strong className="text-foreground">both wallets must hold the identical mint, collection, or realm address</strong> on devnet.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {assetTypes.map((asset) => (
            <article key={asset.value} className="rounded-xl border border-border/60 bg-panel p-5 shadow-panel backdrop-blur-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="grid size-9 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                  <asset.icon className="size-4" />
                </div>
                <Badge variant={asset.difficultyColor === "success" ? "privacy" : "warning"} className="text-[0.6rem]">
                  {asset.difficulty}
                </Badge>
              </div>
              <div>
                <h3 className="text-sm font-semibold">{asset.label}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{asset.description}</p>
              </div>
              <div className="rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-[0.68rem] leading-5 text-success">
                {asset.testTip}
              </div>
              {asset.mint && (
                <div className="space-y-1">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-muted-foreground">{asset.mintLabel}</p>
                  <p className="break-all font-mono text-[0.62rem] text-foreground/70 select-all">{asset.mint}</p>
                </div>
              )}
              {asset.faucetUrl ? (
                <a
                  href={asset.faucetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-[0.7rem] text-primary hover:underline"
                >
                  <ExternalLink className="size-3" /> {asset.faucetLabel}
                </a>
              ) : (
                <p className="text-[0.68rem] text-muted-foreground">{asset.faucetLabel}</p>
              )}
            </article>
          ))}
        </div>

        {/* Quickstart box */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 sm:p-5">
          <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-primary">Quickstart for devnet testing</p>
          <ol className="space-y-2 text-sm text-muted-foreground">
            {[
              <span>Go to <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">faucet.solana.com</a> — airdrop <strong className="text-foreground">2 devnet SOL</strong> to each of your two test wallets.</span>,
              <span>Go to <a href="https://spl-token-faucet.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">spl-token-faucet.com</a> — select <strong className="text-foreground">devnet USDC</strong> and airdrop to <em>both</em> wallet addresses.</span>,
              <span>Open SilentCircle in <strong className="text-foreground">two browser windows</strong>. Connect wallet A in one, wallet B in the other.</span>,
              <span>In Browser A: click <strong className="text-foreground">Start private session</strong>. Select <strong className="text-foreground">SPL Tokens</strong>. Copy the session URL.</span>,
              <span>In Browser B: paste the session URL. Connect wallet B. Join the session.</span>,
              <span>In Browser A: click <strong className="text-foreground">Start PSI</strong> once both wallets show as committed.</span>,
              <span>Both browsers will reveal <strong className="text-foreground">1 match</strong> — devnet USDC.</span>,
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/15 font-mono text-[0.6rem] font-bold text-primary">{i + 1}</span>
                <span className="leading-6">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Divider */}
      <div className="relative z-10 my-8 h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.25)] to-transparent sm:my-12" />

      {/* Privacy model */}
      <section className="relative z-10 space-y-6">
        <div className="text-center">
          <h2 className="text-base font-semibold uppercase tracking-[0.2em] sm:text-xl">Trust boundaries</h2>
          <p className="mt-2 text-sm text-muted-foreground">Exactly what each party and the blockchain can — and cannot — see.</p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/60 bg-panel shadow-panel backdrop-blur-xl">
          <div className="min-w-[30rem]">

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_5.5rem_5.5rem_5.5rem] border-b border-border/60 bg-surface/60 px-5 py-3">
              <div />
              {[
                { label: "Party A", sub: "Initiator", color: "text-primary" },
                { label: "Party B", sub: "Counterparty", color: "text-secondary" },
                { label: "On-chain", sub: "Solana PDA", color: "text-muted-foreground" },
              ].map(col => (
                <div key={col.label} className="flex flex-col items-center gap-0.5">
                  <span className={`font-mono text-[0.62rem] uppercase tracking-[0.18em] ${col.color}`}>{col.label}</span>
                  <span className="font-mono text-[0.5rem] uppercase tracking-widest text-muted-foreground/50">{col.sub}</span>
                </div>
              ))}
            </div>

            {/* Groups */}
            {privacyGroups.map((group) => (
              <div key={group.group}>
                {/* Group label */}
                <div className="flex items-center gap-3 border-b border-border/40 bg-surface/25 px-5 py-2">
                  <span className="font-mono text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground/60">{group.group}</span>
                  <span className="hidden text-[0.6rem] text-muted-foreground/35 sm:block">— {group.note}</span>
                </div>

                {/* Rows */}
                {group.rows.map((row, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_5.5rem_5.5rem_5.5rem] items-start border-b border-border/20 px-5 py-3 last:border-0 transition-colors hover:bg-surface/20"
                  >
                    <div className="pr-4">
                      <p className="text-xs font-medium text-foreground">{row.item}</p>
                      <p className="mt-0.5 hidden text-[0.6rem] leading-4 text-muted-foreground/55 sm:block">{row.detail}</p>
                    </div>
                    {[row.partyA, row.partyB, row.onChain].map((visible, j) => (
                      <div key={j} className="flex flex-col items-center gap-0.5 pt-0.5">
                        {visible ? (
                          <>
                            <Check className="size-3.5 text-success" />
                            <span className="hidden font-mono text-[0.47rem] uppercase tracking-wider text-success/55 sm:block">visible</span>
                          </>
                        ) : (
                          <>
                            <X className="size-3 text-muted-foreground/35" />
                            <span className="hidden font-mono text-[0.47rem] uppercase tracking-wider text-muted-foreground/35 sm:block">hidden</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}

          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="relative z-10 my-8 h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.25)] to-transparent sm:my-12" />

      {/* CTA */}
      <section className="relative z-10 flex flex-col items-center gap-5 pb-10 text-center sm:pb-16">
        <h2 className="text-xl font-semibold uppercase tracking-[0.15em] sm:text-2xl">Ready to run a session?</h2>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          Open the session console in two browser windows, connect your wallets, and follow the steps above. The entire flow takes under two minutes on devnet.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild variant="secure" size="lg">
            <Link to="/deal">Open session console <ArrowRight className="size-4" /></Link>
          </Button>
          <Button asChild variant="glass" size="lg">
            <Link to="/">Back to overview <ArrowLeft className="size-4" /></Link>
          </Button>
        </div>
      </section>
    </div>
    <PageFooter />
  </main>
);

export default HowItWorks;
