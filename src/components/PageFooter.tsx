const PageFooter = () => (
  <footer className="relative z-10 w-full">
    <div className="h-px bg-gradient-to-r from-transparent via-[hsl(257_100%_63%/0.25)] to-transparent" />
    <div className="flex items-center justify-center gap-3 py-5 px-4">
      <span className="size-1 rounded-full bg-primary/30" />
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.28em] text-muted-foreground">
        Zero-knowledge · Solana devnet · Arcium MXE
      </p>
      <span className="size-1 rounded-full bg-primary/30" />
    </div>
  </footer>
);

export default PageFooter;
