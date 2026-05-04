import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Fingerprint, LockKeyhole, RadioTower, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PageFooter from "@/components/PageFooter";

const featureCards = [
  { icon: Wallet, title: "Connect safely", detail: "Authorize a Solana wallet before any private session starts." },
  { icon: Fingerprint, title: "Commit privately", detail: "Mask selected tokens, NFTs, and DAO signals before comparison." },
  { icon: RadioTower, title: "Track both sides", detail: "Watch counterparty joins, commitments, MXE compute, and reveal readiness." },
  { icon: ShieldCheck, title: "Reveal only matches", detail: "Surface shared wallet signals without exposing either full portfolio." },
];

const PanelChrome = ({ name }: { name: string }) => (
  <div className="flex items-center gap-2 border-b border-border/60 bg-background/40 px-3 py-2">
    <span className="size-2 rounded-full bg-[hsl(0_70%_60%)]/80" />
    <span className="size-2 rounded-full bg-[hsl(45_90%_60%)]/80" />
    <span className="size-2 rounded-full bg-[hsl(139_70%_55%)]/80" />
    <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">{name}</span>
  </div>
);

const connectorTrack = (active: boolean, direction: "h" | "h-left" | "v" | "v-up") => {
  const isH = direction === "h" || direction === "h-left";
  const animName = direction === "h" ? "sweep-h" : direction === "h-left" ? "sweep-left" : direction === "v" ? "sweep-v" : "sweep-up";
  return {
    background: active
      ? `linear-gradient(to ${isH ? "right" : "bottom"}, transparent, hsl(257 100% 63%), transparent)`
      : "hsl(257 100% 63% / 0.1)",
    backgroundSize: active ? (isH ? "60% 100%" : "100% 60%") : "100% 100%",
    backgroundRepeat: "no-repeat" as const,
    animation: active ? `${animName} 1.8s ease-in-out infinite` : "none",
  };
};

const Welcome = () => {
  const [activePanel, setActivePanel] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setActivePanel(p => (p + 1) % 4), 2200);
    return () => clearInterval(timer);
  }, []);

  const panelCls = (idx: number) =>
    `rounded-xl border backdrop-blur-xl overflow-hidden transition-all duration-700 ${
      activePanel === idx
        ? "border-primary/70 shadow-secure bg-panel"
        : "border-primary/15 shadow-panel bg-panel opacity-75"
    }`;

  return (
    <main className="min-h-screen overflow-x-hidden bg-hero text-foreground">
      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-5 sm:px-5 md:px-8 lg:gap-10 lg:py-8">
        <div className="pointer-events-none absolute inset-0 arcium-dot-field opacity-80" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,hsl(var(--background)/0.22)_46%,hsl(var(--background))_82%)]" />

        {/* Navbar */}
        <nav className="relative z-10">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface/40 px-3 py-2 backdrop-blur-md sm:px-4 sm:py-2.5">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-tight sm:tracking-[0.38em]">SilentCircle</p>
                <p className="hidden text-xs text-muted-foreground sm:block">Private wallet discovery</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="hidden items-center gap-2 sm:flex">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-success" />
                </span>
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">Live on devnet</span>
              </div>
              <Button asChild variant="glass" size="sm" className="gap-1.5">
                <Link to="/how-it-works"><BookOpen className="size-3.5" /><span className="hidden sm:inline"> How it works</span></Link>
              </Button>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.4)] to-transparent" />
        </nav>

        {/* Hero: copy + live demo */}
        <div className="relative z-10 grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
          {/* Left copy */}
          <div className="space-y-6 animate-float-in">
            <Badge variant="chain" className="gap-2 px-3 py-1">
              <Sparkles className="size-3.5" /> Arcium-inspired MPC + Solana PSI
            </Badge>
            <h1 className="max-w-3xl text-balance text-4xl font-semibold uppercase leading-[0.92] tracking-normal sm:text-5xl md:text-6xl xl:text-8xl">
              Private wallet discovery for real two-party sessions.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Start from a guided overview, then launch the interactive session console to connect a wallet, share an invite, emulate a counterparty, and verify the full timeline.
            </p>
          </div>

          {/* Right: 3×3 grid — panels + animated connectors forming a clockwise flow */}
          {/*  [A] →conn→ [B]       */}
          {/*   ↑  conn  conn↓      */}
          {/*  [D] ←conn← [C]       */}
          <div className="hidden md:grid grid-cols-[1fr_2rem_1fr] grid-rows-[auto_2rem_auto] overflow-hidden lg:grid-cols-[1fr_2.5rem_1fr] lg:grid-rows-[auto_2.5rem_auto]">
            {/* ── Panel A (0): Wallet Gateway — top-left ── */}
            <article className={panelCls(0)}>
              <PanelChrome name="wallet_gateway.tsx" />
              <div className="relative p-3 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
                    <span className="grid size-6 place-items-center rounded bg-primary/15 text-primary"><Wallet className="size-3" /></span>
                    <span className="font-mono text-[0.7rem] text-foreground">7xK3...mP9q</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
                    <span className="grid size-6 place-items-center rounded bg-secondary/15 text-secondary"><Wallet className="size-3" /></span>
                    <span className="font-mono text-[0.7rem] text-foreground">38xH...s6td</span>
                  </div>
                </div>
                <div className="relative mt-4 flex items-center justify-center">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-primary/0 via-primary/60 to-primary/0" />
                  <div className="relative grid size-12 place-items-center rounded-full border border-primary/40 bg-primary/15 text-primary shadow-secure">
                    <LockKeyhole className="size-5" />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>session.connect</span>
                  <span className="text-success">authorized</span>
                </div>
              </div>
            </article>

            {/* ── Connector A→B: rightward ── */}
            <div className="flex items-center justify-center px-1">
              <div className="h-px w-full rounded-full" style={connectorTrack(activePanel === 0, "h")} />
            </div>

            {/* ── Panel B (1): Private Commitment — top-right ── */}
            <article className={panelCls(1)}>
              <PanelChrome name="private_commit.tsx" />
              <div className="p-3 sm:p-5">
                <div className="space-y-2">
                  {[{ label: "Tokens", checked: true }, { label: "NFTs", checked: true }, { label: "DAOs", checked: false }].map(row => (
                    <div key={row.label} className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-1.5">
                      <span className="text-xs text-foreground">{row.label}</span>
                      <span className={`grid size-4 place-items-center rounded border ${row.checked ? "border-primary bg-primary" : "border-border bg-muted/50"}`}>
                        {row.checked && <span className="block size-1.5 rounded-sm bg-primary-foreground" />}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary shadow-secure">
                    <Fingerprint className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5">
                    <p className="text-[0.6rem] uppercase tracking-[0.18em] text-primary/80">commitment</p>
                    <p className="truncate font-mono text-[0.7rem] text-foreground">e3b0c44298fc1c…</p>
                  </div>
                </div>
              </div>
            </article>

            {/* ── Connector D→A: upward (left column) ── */}
            <div className="flex h-full justify-center py-1">
              <div className="h-full w-px rounded-full" style={connectorTrack(activePanel === 3, "v-up")} />
            </div>

            {/* Center cell */}
            <div className="flex items-center justify-center">
              <span className="size-1.5 rounded-full bg-primary/20" />
            </div>

            {/* ── Connector B→C: downward (right column) ── */}
            <div className="flex h-full justify-center py-1">
              <div className="h-full w-px rounded-full" style={connectorTrack(activePanel === 1, "v")} />
            </div>

            {/* ── Panel D (3): Intersection — bottom-left ── */}
            <article className={panelCls(3)}>
              <PanelChrome name="intersection.tsx" />
              <div className="p-3 sm:p-5">
                <div className="relative mx-auto h-24">
                  <div className="absolute left-2 top-1/2 size-20 -translate-y-1/2 rounded-full border border-primary/40 bg-primary/15" />
                  <div className="absolute right-2 top-1/2 size-20 -translate-y-1/2 rounded-full border border-secondary/40 bg-secondary/15" />
                  <div className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-success/30 bg-success/20">
                    <ShieldCheck className="size-5 text-success" />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-md border border-success/30 bg-success/10 px-3 py-2">
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-success">matches</span>
                  <span className="font-mono text-base font-semibold text-success">02</span>
                </div>
              </div>
            </article>

            {/* ── Connector C→D: leftward ── */}
            <div className="flex items-center justify-center px-1">
              <div className="h-px w-full rounded-full" style={connectorTrack(activePanel === 2, "h-left")} />
            </div>

            {/* ── Panel C (2): Arcium MXE — bottom-right ── */}
            <article className={panelCls(2)}>
              <PanelChrome name="arcium_mxe.tsx" />
              <div className="p-3 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                    <RadioTower className="size-4" />
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="size-1.5 animate-secure-pulse rounded-full bg-primary motion-reduce:animate-none" />
                    <span className="size-1.5 animate-secure-pulse rounded-full bg-primary [animation-delay:200ms] motion-reduce:animate-none" />
                    <span className="size-1.5 animate-secure-pulse rounded-full bg-primary [animation-delay:400ms] motion-reduce:animate-none" />
                  </div>
                </div>
                <div className="relative mx-auto mt-4 grid w-fit grid-cols-3 gap-3">
                  <span className="pointer-events-none absolute inset-0 mx-auto h-px w-full self-center bg-gradient-to-r from-primary/0 via-primary/30 to-primary/0" />
                  <span className="pointer-events-none absolute inset-0 mx-auto h-full w-px justify-self-center bg-gradient-to-b from-primary/0 via-primary/30 to-primary/0" />
                  {Array.from({ length: 9 }).map((_, i) => (
                    <span
                      key={i}
                      className={`relative size-2 rounded-full ${
                        i === 4 ? "animate-secure-pulse bg-primary shadow-secure motion-reduce:animate-none" : "bg-primary/40"
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>mxe.compute</span>
                  <span className="text-primary">running</span>
                </div>
              </div>
            </article>
          </div>
        </div>

        {/* Feature cards */}
        <div className="relative z-10 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {featureCards.map(feature => (
            <article key={feature.title} className="rounded-lg border border-border bg-panel p-4 shadow-panel backdrop-blur-2xl transition-transform hover:-translate-y-1">
              <div className="mb-3 grid size-9 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <feature.icon className="size-4" />
              </div>
              <h2 className="text-sm font-semibold">{feature.title}</h2>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{feature.detail}</p>
            </article>
          ))}
        </div>

        {/* CTA */}
        <div className="relative z-10 flex flex-col items-center gap-4 pb-8">
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button asChild variant="secure" size="lg">
              <Link to="/deal">Open session console <ArrowRight className="size-4" /></Link>
            </Button>
          </div>
        </div>
      </section>
      <PageFooter />
    </main>
  );
};

export default Welcome;
