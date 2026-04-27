import { ArrowRight, Fingerprint, LockKeyhole, RadioTower, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const featureCards = [
  { icon: Wallet, title: "Connect safely", detail: "Authorize a Solana wallet before any private session starts." },
  { icon: Fingerprint, title: "Commit privately", detail: "Mask selected tokens, NFTs, and DAO signals before comparison." },
  { icon: RadioTower, title: "Track both sides", detail: "Watch counterparty joins, commitments, MXE compute, and reveal readiness." },
  { icon: ShieldCheck, title: "Reveal only matches", detail: "Surface shared wallet signals without exposing either full portfolio." },
];

const Welcome = () => (
  <main className="min-h-screen overflow-x-hidden bg-hero text-foreground">
    <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-between gap-8 px-4 py-5 sm:px-5 md:px-8 lg:gap-10 lg:py-8">
      <div className="pointer-events-none absolute inset-0 arcium-dot-field opacity-80" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,hsl(var(--background)/0.22)_46%,hsl(var(--background))_82%)]" />

      <nav className="relative z-10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg border border-primary/30 bg-primary/10 shadow-secure">
            <LockKeyhole className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.38em]">SilentCircle</p>
            <p className="text-xs text-muted-foreground">Private wallet discovery</p>
          </div>
        </div>
        <Badge variant="privacy" className="hidden sm:inline-flex">Devnet RTG</Badge>
      </nav>

      <div className="relative z-10 grid flex-1 items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
        <div className="space-y-6 animate-float-in">
          <Badge variant="chain" className="gap-2 px-3 py-1">
            <Sparkles className="size-3.5" /> Arcium-inspired MPC + Solana PSI
          </Badge>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold uppercase leading-[0.92] tracking-normal sm:text-6xl md:text-7xl xl:text-8xl">
            Private wallet discovery for real two-party sessions.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Start from a guided overview, then launch the interactive session console to connect a wallet, share an invite, emulate a counterparty, and verify the full timeline.
          </p>
          <Button asChild variant="secure" size="lg" className="w-full sm:w-auto">
            <Link to="/deal">
              Open session console <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 md:gap-4">
          {featureCards.map((feature) => (
            <article key={feature.title} className="rounded-lg border border-border bg-panel p-5 shadow-panel backdrop-blur-2xl transition-transform hover:-translate-y-1">
              <div className="mb-5 grid size-11 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <feature.icon className="size-5" />
              </div>
              <h2 className="text-lg font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  </main>
);

export default Welcome;