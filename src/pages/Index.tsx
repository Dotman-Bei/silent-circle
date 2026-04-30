import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Fingerprint,
  Home,
  KeyRound,
  Layers3,
  LockKeyhole,
  MessageCircle,
  RadioTower,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { assetCatalog, assetMaskFromSelection, fetchAssetSnapshot, placeholderAssetSnapshot, selectionFromAssetMask, type AssetSnapshot, type AssetValue } from "@/lib/assets";
import { buildSnapshotCommitmentPreview, getPendingCommitmentGroups, shortenCommitmentHex, type CommitmentPreview } from "@/lib/commitment";
import { resolveSessionIntersectionMatches, type IntersectionMatch } from "@/lib/intersection-matches";
import { fetchSessionAccount, mapSessionStateToPhase, type SessionAccount, type SessionAccountState } from "@/lib/session-account";
import { fetchNextComputationOffset } from "@/lib/arcium-accounts";
import { buildCommitSetPlan, buildCreateSessionPlan, buildStartPsiPlan, createCommitSetInstruction, createSessionInstruction, createStartPsiInstruction, hasConfiguredSilentCircleProgram, serializeSessionInstructionPlan, type SessionInstructionPlan, type StartPsiParams } from "@/lib/session-client";
import { useArciumCluster } from "@/hooks/use-arcium-cluster";
import { createSessionDraft, parseSessionDraft, type SessionDraft } from "@/lib/session-draft";
import { createSessionId, getSessionUrl, getTimelineStorageKey } from "@/lib/session";
import { connectBrowserWallet, disconnectBrowserWallet, formatWalletAddress, getInstalledSolanaWallets, getSolanaExplorerUrl, signAndSendBrowserTransaction, solanaConnection, solanaWalletInstallOptions, type SolanaWalletOption } from "@/lib/solana";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";

const phases = [
  {
    label: "Awaiting counterparty",
    key: "counterparty",
    detail: "Invite sent. Watching for the second wallet commitment.",
    duration: 5_000,
  },
  {
    label: "Both committed",
    key: "commitments",
    detail: "Commitments locked on-chain. Preparing encrypted inputs.",
    duration: 3_500,
  },
  {
    label: "MXE computing",
    key: "mxe",
    detail: "Arcium MXE is evaluating the private set intersection.",
    duration: 6_500,
  },
  {
    label: "Intersection ready",
    key: "intersection",
    detail: "Shared signals are verified and ready to reveal.",
    duration: 0,
  },
];

const totalSessionMs = phases.slice(0, -1).reduce((sum, phase) => sum + phase.duration, 0);

type PhaseFilter = "all" | (typeof phases)[number]["key"];
type SeverityFilter = "all" | "info" | "warn";
type AssetSnapshotLoadState = "idle" | "loading" | "ready" | "error";
type SessionPollState = "idle" | "polling" | "success" | "missing" | "error";

type SessionEvent = {
  id: string;
  time: string;
  phase: (typeof phases)[number]["key"];
  severity: Exclude<SeverityFilter, "all">;
  label: string;
  detail: string;
};

type PersistedTimeline = {
  phase: number;
  phaseElapsed: number;
  sessionActive: boolean;
  counterpartyAddress: string | null;
  sessionDraft: SessionDraft | null;
  eventLog: SessionEvent[];
};

const phaseFilters: { label: string; value: PhaseFilter }[] = [
  { label: "All", value: "all" },
  { label: "Counterparty", value: "counterparty" },
  { label: "Commitments", value: "commitments" },
  { label: "MXE", value: "mxe" },
  { label: "Intersection", value: "intersection" },
];

const severityFilters: { label: string; value: SeverityFilter }[] = [
  { label: "All", value: "all" },
  { label: "Info", value: "info" },
  { label: "Warn", value: "warn" },
];

let eventSequence = 0;

const createEventId = () => {
  eventSequence += 1;
  return `event-${Date.now()}-${eventSequence}`;
};

const formatEventTime = () =>
  new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());

const createSessionEvent = (
  phase: SessionEvent["phase"],
  severity: SessionEvent["severity"],
  label: string,
  detail: string,
): SessionEvent => ({
  id: createEventId(),
  time: formatEventTime(),
  phase,
  severity,
  label,
  detail,
});

const shortenExplorerValue = (value: string) => (value.length <= 10 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`);

const formatUnixTimestamp = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const formatRelativeTimestamp = (timestamp: number | null) => {
  if (!timestamp) {
    return "pending";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (diffSeconds < 5) {
    return "just now";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.floor(diffHours / 24)}d ago`;
};

const describeOnChainState = (sessionAccount: SessionAccount) => {
  switch (sessionAccount.state) {
    case "AwaitingCounterparty":
      return {
        label: "Session awaiting counterparty",
        detail: "The session PDA is live on-chain and waiting for the second wallet commitment.",
        phase: "counterparty" as const,
        severity: "info" as const,
      };
    case "BothCommitted":
      return {
        label: "Both committed",
        detail: "Both wallet commitments are locked on-chain. Either participant can trigger start_psi.",
        phase: "commitments" as const,
        severity: "info" as const,
      };
    case "Computing":
      return {
        label: "MXE computing",
        detail: `Arcium task ${sessionAccount.arciumTaskId || 0} is now running for this session.`,
        phase: "mxe" as const,
        severity: "info" as const,
      };
    case "Done":
      return {
        label: "Intersection ready",
        detail: `The session PDA now stores ${sessionAccount.intersectionCount} intersection item${sessionAccount.intersectionCount === 1 ? "" : "s"}.`,
        phase: "intersection" as const,
        severity: "info" as const,
      };
    case "Expired":
      return {
        label: "Session expired",
        detail: "The on-chain session expired before the private computation completed.",
        phase: "intersection" as const,
        severity: "warn" as const,
      };
  }
};

const isSessionEventPhase = (value: unknown): value is SessionEvent["phase"] =>
  typeof value === "string" && phases.some((phase) => phase.key === value);

const normalizePersistedEventLog = (value: unknown): SessionEvent[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();

  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      const candidate = entry as Partial<SessionEvent>;

      if (!isSessionEventPhase(candidate.phase) || (candidate.severity !== "info" && candidate.severity !== "warn") || typeof candidate.label !== "string" || typeof candidate.detail !== "string") {
        return [];
      }

      let id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : createEventId();

      if (seenIds.has(id)) {
        id = createEventId();
      }

      seenIds.add(id);

      return [
        {
          id,
          time: typeof candidate.time === "string" && candidate.time.trim() ? candidate.time : formatEventTime(),
          phase: candidate.phase,
          severity: candidate.severity,
          label: candidate.label,
          detail: candidate.detail,
        },
      ];
    })
    .slice(0, 8);
};

const readPersistedTimeline = (sessionId: string): PersistedTimeline | null => {
  try {
    const stored = window.localStorage.getItem(getTimelineStorageKey(sessionId));
    if (!stored) return null;

    const parsed = JSON.parse(stored) as PersistedTimeline;
    if (!Number.isInteger(parsed.phase) || !Array.isArray(parsed.eventLog)) return null;

    return {
      phase: Math.min(Math.max(parsed.phase, 0), phases.length - 1),
      phaseElapsed: Math.max(0, Number(parsed.phaseElapsed) || 0),
      sessionActive: Boolean(parsed.sessionActive),
      counterpartyAddress: parsed.counterpartyAddress ?? null,
      sessionDraft: parseSessionDraft(parsed.sessionDraft),
      eventLog: normalizePersistedEventLog(parsed.eventLog),
    };
  } catch {
    return null;
  }
};

const getMatchLabelHint = (match: IntersectionMatch, assetSnapshotLoadState: AssetSnapshotLoadState) => {
  if (match.labelSource === "metadata") {
    return {
      badgeLabel: "Metadata name",
      badgeVariant: "privacy" as const,
      detail: "Resolved from token metadata, NFT collection metadata, or DAO realm data.",
    };
  }

  if (match.labelSource === "fallback") {
    if (assetSnapshotLoadState === "loading") {
      return {
        badgeLabel: "Metadata pending",
        badgeVariant: "chain" as const,
        detail: "Wallet metadata is still loading. This shortened address may upgrade to a friendly name.",
      };
    }

    if (assetSnapshotLoadState === "error") {
      return {
        badgeLabel: "RPC fallback",
        badgeVariant: "warning" as const,
        detail: "The latest wallet metadata refresh failed, so this card is using an address fallback.",
      };
    }

    return {
      badgeLabel: "Address fallback",
      badgeVariant: "outline" as const,
      detail: "No friendly token, collection, or realm name was available for this asset.",
    };
  }

  return {
    badgeLabel: "Hash only",
    badgeVariant: "warning" as const,
    detail: "This client cannot map the returned hash into its local asset snapshot yet.",
  };
};

const getAssetCountCaption = (walletAddress: string | null, assetSnapshotLoadState: AssetSnapshotLoadState) => {
  if (!walletAddress) {
    return "connect wallet to discover";
  }

  switch (assetSnapshotLoadState) {
    case "loading":
      return "loading from wallet";
    case "ready":
      return "live assets discovered";
    case "error":
      return "snapshot unavailable";
    default:
      return "awaiting wallet fetch";
  }
};

const Index = () => {
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>();
  const arciumCluster = useArciumCluster();
  const [selected, setSelected] = useState<AssetValue[]>(["tokens", "nfts", "daos"]);
  const [sessionId, setSessionId] = useState(() => routeSessionId ?? "");
  const [phase, setPhase] = useState(0);
  const [phaseElapsed, setPhaseElapsed] = useState(0);
  const [sessionActive, setSessionActive] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<SolanaWalletOption | null>(null);
  const [counterpartyAddress, setCounterpartyAddress] = useState<string | null>(null);
  const [assetSnapshot, setAssetSnapshot] = useState<AssetSnapshot>(placeholderAssetSnapshot);
  const [assetSnapshotLoadState, setAssetSnapshotLoadState] = useState<AssetSnapshotLoadState>("idle");
  const [assetSnapshotRefreshNonce, setAssetSnapshotRefreshNonce] = useState(0);
  const [commitmentPreview, setCommitmentPreview] = useState<CommitmentPreview | null>(null);
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null);
  const [createSessionPlan, setCreateSessionPlan] = useState<SessionInstructionPlan | null>(null);
  const [commitSetPlan, setCommitSetPlan] = useState<SessionInstructionPlan | null>(null);
  const [startPsiPlan, setStartPsiPlan] = useState<SessionInstructionPlan | null>(null);
  const [sessionAccount, setSessionAccount] = useState<SessionAccount | null>(null);
  const [resolvedMatches, setResolvedMatches] = useState<IntersectionMatch[]>([]);
  const [lastOnChainState, setLastOnChainState] = useState<SessionAccountState | null>(null);
  const [lastSessionPollSuccessAt, setLastSessionPollSuccessAt] = useState<number | null>(null);
  const [sessionPollState, setSessionPollState] = useState<SessionPollState>("idle");
  const [sessionPollError, setSessionPollError] = useState<string | null>(null);
  const [sessionPollRefreshNonce, setSessionPollRefreshNonce] = useState(0);
  const [lastOnChainSignature, setLastOnChainSignature] = useState<string | null>(null);
  const [isSubmittingSession, setIsSubmittingSession] = useState(false);
  const [isJoiningSession, setIsJoiningSession] = useState(false);
  const [isStartingPsi, setIsStartingPsi] = useState(false);
  const [eventLog, setEventLog] = useState<SessionEvent[]>(() => [
    createSessionEvent("counterparty", "info", "Session idle", "Waiting for a private session to start."),
  ]);
  const hydratedRouteSessionRef = useRef<string | null>(null);

  const hasShareableInvite = Boolean(routeSessionId || sessionDraft);
  const inviteUrl = useMemo(() => (hasShareableInvite ? getSessionUrl(window.location.origin, sessionId) : ""), [hasShareableInvite, sessionId]);
  const assetMask = useMemo(() => assetMaskFromSelection(selected), [selected]);
  const pendingCommitmentGroups = useMemo(() => getPendingCommitmentGroups(selected), [selected]);
  const availableWallets = useMemo(() => getInstalledSolanaWallets(), [walletAddress]);
  const switchableWallets = useMemo(
    () => availableWallets.filter((wallet) => wallet.id !== connectedWallet?.id),
    [availableWallets, connectedWallet?.id],
  );
  const walletPreview = formatWalletAddress(walletAddress);
  const counterpartyPreview = formatWalletAddress(counterpartyAddress, "Waiting");
  const completedMs = phases.slice(0, phase).reduce((sum, item) => sum + item.duration, 0);
  const sessionProgress = phase === phases.length - 1 ? 100 : Math.min(99, Math.round(((completedMs + phaseElapsed) / totalSessionMs) * 100));
  const phaseRemaining = Math.max(0, Math.ceil((phases[phase].duration - phaseElapsed) / 1000));
  const activePhase = phases[phase];
  const isInitiatorWallet = Boolean(sessionDraft && walletAddress && sessionDraft.walletAddress === walletAddress);
  const isSessionParticipant = Boolean(
    walletAddress && sessionAccount && (walletAddress === sessionAccount.walletA || walletAddress === sessionAccount.walletB),
  );
  const activeSessionPlan = useMemo(
    () => startPsiPlan ?? (routeSessionId && commitSetPlan && !isInitiatorWallet && !counterpartyAddress ? commitSetPlan : createSessionPlan),
    [commitSetPlan, counterpartyAddress, createSessionPlan, isInitiatorWallet, routeSessionId, startPsiPlan],
  );
  const sessionRequest = useMemo(
    () => (activeSessionPlan ? serializeSessionInstructionPlan(activeSessionPlan) : ""),
    [activeSessionPlan],
  );
  const refreshAssetSnapshotLabel =
    assetSnapshotLoadState === "loading" ? "Refreshing metadata" : assetSnapshotLoadState === "error" ? "Retry metadata" : "Refresh metadata";
  const refreshSessionPollLabel = sessionPollState === "polling" ? "Refreshing session" : sessionPollState === "error" ? "Retry session" : "Refresh session";
  const hasConfiguredProgramId = useMemo(() => hasConfiguredSilentCircleProgram(), []);
  const canJoinAsCounterparty = Boolean(
    routeSessionId &&
      walletAddress &&
      commitmentPreview &&
      hasConfiguredProgramId &&
      !isInitiatorWallet &&
      !counterpartyAddress &&
      (!sessionAccount || sessionAccount.state === "AwaitingCounterparty"),
  );
  const canPrepareStartPsi = Boolean(
    routeSessionId &&
      walletAddress &&
      hasConfiguredProgramId &&
      sessionAccount?.state === "BothCommitted" &&
      isSessionParticipant,
  );
  const statusBadgeLabel = useMemo(() => {
    if (sessionAccount) {
      switch (sessionAccount.state) {
        case "AwaitingCounterparty":
          return "Awaiting join";
        case "BothCommitted":
          return "Ready to start";
        case "Computing":
          return "Computing";
        case "Done":
          return "Ready";
        case "Expired":
          return "Expired";
      }
    }

    return phase === phases.length - 1 ? "Ready" : sessionActive ? `${phaseRemaining}s` : "Standby";
  }, [phase, phaseRemaining, sessionActive, sessionAccount]);
  const sessionAssetLabels = useMemo(
    () =>
      sessionAccount
        ? selectionFromAssetMask(sessionAccount.assetMask)
            .map((asset) => assetCatalog.find((item) => item.value === asset)?.label)
            .filter((label): label is (typeof assetCatalog)[number]["label"] => Boolean(label))
        : [],
    [sessionAccount],
  );
  const sessionPollSummary = useMemo(() => {
    if (!hasConfiguredProgramId || !routeSessionId) {
      return "Configure a program id to enable PDA polling.";
    }

    if (sessionPollState === "polling" && !lastSessionPollSuccessAt) {
      return "Fetching the session PDA on devnet.";
    }

    if (sessionPollState === "missing") {
      return "The session PDA is not on-chain yet. Create the session on-chain or load a live invite route.";
    }

    if (sessionPollState === "error") {
      return lastSessionPollSuccessAt
        ? `Polling is stale. The last successful PDA sync was ${formatRelativeTimestamp(lastSessionPollSuccessAt)}.`
        : "Polling failed before the first session snapshot could be loaded.";
    }

    if (lastSessionPollSuccessAt) {
      return `Last successful PDA sync ${formatRelativeTimestamp(lastSessionPollSuccessAt)}.`;
    }

    return "Polling session PDA every 3 seconds.";
  }, [hasConfiguredProgramId, lastSessionPollSuccessAt, routeSessionId, sessionPollState]);
  const sessionPollBadge = useMemo(() => {
    switch (sessionPollState) {
      case "success":
        return { label: "Live", variant: "privacy" as const };
      case "polling":
        return { label: "Polling", variant: "chain" as const };
      case "missing":
        return { label: "Not found", variant: "outline" as const };
      case "error":
        return { label: "Stale", variant: "warning" as const };
      default:
        return { label: "Idle", variant: "outline" as const };
    }
  }, [sessionPollState]);
  const sessionExplorerUrl = useMemo(
    () => (sessionAccount ? getSolanaExplorerUrl("address", sessionAccount.address) : null),
    [sessionAccount],
  );
  const latestSignatureExplorerUrl = useMemo(
    () => (lastOnChainSignature ? getSolanaExplorerUrl("tx", lastOnChainSignature) : null),
    [lastOnChainSignature],
  );
  const expiryStatus = useMemo(() => {
    if (!sessionAccount) {
      return null;
    }

    const expiresAtMs = sessionAccount.expiresAtUnix * 1000;

    if (sessionAccount.state === "Expired" || expiresAtMs <= Date.now()) {
      return "Expired";
    }

    return `Window closes ${formatRelativeTimestamp(expiresAtMs)}`;
  }, [sessionAccount]);
  const sessionPollMetric = useMemo(() => {
    if (!hasConfiguredProgramId || !routeSessionId) {
      return "3s";
    }

    if (sessionPollState === "error") {
      return lastSessionPollSuccessAt ? "stale" : "error";
    }

    if (sessionPollState === "missing") {
      return "missing";
    }

    return lastSessionPollSuccessAt ? formatRelativeTimestamp(lastSessionPollSuccessAt) : "3s";
  }, [hasConfiguredProgramId, lastSessionPollSuccessAt, routeSessionId, sessionPollState]);
  const fallbackLabelCount = useMemo(
    () => resolvedMatches.filter((match) => match.labelSource === "fallback").length,
    [resolvedMatches],
  );
  const matchResultSummary = useMemo(() => {
    if (sessionAccount?.state === "Done") {
      if (sessionAccount.intersectionCount === 0) {
        return "The private set intersection completed with no shared assets.";
      }

      if (resolvedMatches.some((match) => match.type === "Unknown")) {
        return "The on-chain intersection is available, but some hashes could not be mapped to this client’s local asset snapshot.";
      }

      if (fallbackLabelCount > 0) {
        if (assetSnapshotLoadState === "loading") {
          return `Resolved ${resolvedMatches.length} shared asset${resolvedMatches.length === 1 ? "" : "s"}. Some shortened labels may upgrade after the wallet metadata refresh finishes.`;
        }

        if (assetSnapshotLoadState === "error") {
          return `Resolved ${resolvedMatches.length} shared asset${resolvedMatches.length === 1 ? "" : "s"}, but the latest wallet metadata refresh failed so some cards are using address fallbacks.`;
        }

        return `Resolved ${resolvedMatches.length} shared asset${resolvedMatches.length === 1 ? "" : "s"}. Some cards are using address fallbacks because no friendly metadata name was available.`;
      }

      return `Resolved ${resolvedMatches.length} shared asset${resolvedMatches.length === 1 ? "" : "s"} from the on-chain intersection.`;
    }

    return "Neither wallet saw the other’s full portfolio.";
  }, [assetSnapshotLoadState, fallbackLabelCount, resolvedMatches, sessionAccount]);
  const filteredEvents = eventLog.filter(
    (event) => (phaseFilter === "all" || event.phase === phaseFilter) && (severityFilter === "all" || event.severity === severityFilter),
  );

  const applyPersistedTimeline = useCallback((nextSessionId: string, persistedTimeline: PersistedTimeline | null) => {
    setSessionId(nextSessionId);
    setPhase(0);
    setPhaseElapsed(0);
    setSessionActive(false);
    setCounterpartyAddress(null);
    setSessionDraft(persistedTimeline?.sessionDraft ?? null);
    setEventLog(
      persistedTimeline?.eventLog.length
        ? persistedTimeline.eventLog
        : [createSessionEvent("counterparty", "info", "Session loaded", `Loaded invite session ${nextSessionId}.`)],
    );
  }, []);

  const appendEvent = useCallback((label: string, detail: string, eventPhase: PhaseFilter, severity: Exclude<SeverityFilter, "all"> = "info") => {
    if (eventPhase === "all") return;
    setEventLog((current) => [createSessionEvent(eventPhase, severity, label, detail), ...current].slice(0, 8));
  }, []);

  useEffect(() => {
    setLastOnChainSignature(null);
  }, [routeSessionId]);

  const refreshAssetSnapshot = useCallback(() => {
    if (!walletAddress || assetSnapshotLoadState === "loading") {
      return;
    }

    setAssetSnapshotLoadState("loading");
    setAssetSnapshotRefreshNonce((current) => current + 1);
    appendEvent("Metadata refresh requested", "Refreshing wallet assets and metadata for the connected wallet.", "commitments", "info");
  }, [appendEvent, assetSnapshotLoadState, walletAddress]);

  const refreshSessionPoll = useCallback(() => {
    if (!routeSessionId || !hasConfiguredProgramId || sessionPollState === "polling") {
      return;
    }

    setSessionPollState("polling");
    setSessionPollError(null);
    setSessionPollRefreshNonce((current) => current + 1);
    appendEvent("Session refresh requested", "Refreshing the session PDA from Solana now.", phases[phase].key, "info");
  }, [appendEvent, hasConfiguredProgramId, phase, routeSessionId, sessionPollState]);

  useEffect(() => {
    if (!routeSessionId) {
      hydratedRouteSessionRef.current = null;
      return;
    }

    if (hydratedRouteSessionRef.current === routeSessionId) {
      return;
    }

    hydratedRouteSessionRef.current = routeSessionId;

    applyPersistedTimeline(routeSessionId, readPersistedTimeline(routeSessionId));
  }, [applyPersistedTimeline, routeSessionId]);

  useEffect(() => {
    if (!routeSessionId) {
      return;
    }

    const timelineStorageKey = getTimelineStorageKey(routeSessionId);

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== timelineStorageKey) {
        return;
      }

      applyPersistedTimeline(routeSessionId, readPersistedTimeline(routeSessionId));
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [applyPersistedTimeline, routeSessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const timeline: PersistedTimeline = {
      phase,
      phaseElapsed,
      sessionActive,
      counterpartyAddress,
      sessionDraft,
      eventLog,
    };

    window.localStorage.setItem(getTimelineStorageKey(sessionId), JSON.stringify(timeline));
  }, [counterpartyAddress, eventLog, phase, phaseElapsed, sessionActive, sessionDraft, sessionId]);

  useEffect(() => {
    if (!routeSessionId || !hasConfiguredProgramId) {
      setSessionAccount(null);
      setLastOnChainState(null);
      setLastSessionPollSuccessAt(null);
      setSessionPollState("idle");
      setSessionPollError(null);
      return;
    }

    setSessionAccount(null);
    setLastOnChainState(null);
    setLastSessionPollSuccessAt(null);
    setSessionPollState("polling");
    setSessionPollError(null);
  }, [hasConfiguredProgramId, routeSessionId]);

  useEffect(() => {
    if (!routeSessionId || !hasConfiguredProgramId) {
      return;
    }

    let cancelled = false;

    const syncSessionAccount = async () => {
      if (!cancelled) {
        setSessionPollState((current) => (current === "success" ? current : "polling"));
      }

      try {
        const account = await fetchSessionAccount(routeSessionId);

        if (!cancelled) {
          setSessionAccount(account);
          setSessionPollError(account ? null : "Session PDA not found on-chain yet.");
          setSessionPollState(account ? "success" : "missing");

          if (account) {
            setLastSessionPollSuccessAt(Date.now());
          }
        }
      } catch (error) {
        if (!cancelled) {
          setSessionPollState("error");
          setSessionPollError(error instanceof Error ? error.message : "Could not fetch the session PDA.");
        }
      }
    };

    void syncSessionAccount();
    const timer = window.setInterval(() => {
      void syncSessionAccount();
    }, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasConfiguredProgramId, routeSessionId, sessionPollRefreshNonce]);

  useEffect(() => {
    if (!sessionAccount) {
      return;
    }

    setCounterpartyAddress(sessionAccount.walletB);
    setPhase(mapSessionStateToPhase(sessionAccount.state));
    setPhaseElapsed(0);
    setSessionActive(sessionAccount.state === "AwaitingCounterparty" || sessionAccount.state === "Computing");

    if (lastOnChainState === sessionAccount.state) {
      return;
    }

    if (lastOnChainState !== null) {
      const nextStateEvent = describeOnChainState(sessionAccount);
      appendEvent(nextStateEvent.label, nextStateEvent.detail, nextStateEvent.phase, nextStateEvent.severity);
    }

    setLastOnChainState(sessionAccount.state);
  }, [appendEvent, lastOnChainState, sessionAccount]);

  useEffect(() => {
    if (phase === phases.length - 1) {
      setSessionActive(false);
      setPhaseElapsed(0);
    }
  }, [phase]);

  useEffect(() => {
    if (!walletAddress) {
      setAssetSnapshot(placeholderAssetSnapshot);
      setAssetSnapshotLoadState("idle");
      return;
    }

    let cancelled = false;
    setAssetSnapshotLoadState("loading");

    void fetchAssetSnapshot(walletAddress)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        setAssetSnapshot(snapshot);
        setAssetSnapshotLoadState("ready");
        appendEvent("Portfolio fetched", `${snapshot.counts.tokens} SPL token mints, ${snapshot.counts.nfts} NFT collections, and ${snapshot.counts.daos} DAO memberships discovered on devnet.`, "commitments", "info");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setAssetSnapshot(placeholderAssetSnapshot);
        setAssetSnapshotLoadState("error");
        toast.error("Could not fetch wallet assets", {
          description: "RPC fetch failed. Use Refresh metadata in Match result to retry the wallet snapshot.",
        });
        appendEvent("Portfolio fetch failed", "RPC fetch for wallet assets failed; use the Match result refresh action to retry the wallet snapshot.", "commitments", "warn");
      });

    return () => {
      cancelled = true;
    };
  }, [appendEvent, assetSnapshotRefreshNonce, walletAddress]);

  useEffect(() => {
    if (!walletAddress || assetSnapshotLoadState !== "ready") {
      setCommitmentPreview(null);
      return;
    }

    let cancelled = false;

    void buildSnapshotCommitmentPreview(selected, assetSnapshot)
      .then((preview) => {
        if (!cancelled) {
          setCommitmentPreview(preview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommitmentPreview(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assetSnapshot, assetSnapshotLoadState, selected, walletAddress]);

  useEffect(() => {
    if (!sessionDraft || !hasConfiguredProgramId) {
      setCreateSessionPlan(null);
      return;
    }

    let cancelled = false;

    void buildCreateSessionPlan(sessionDraft)
      .then((plan) => {
        if (!cancelled) {
          setCreateSessionPlan(plan);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCreateSessionPlan(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasConfiguredProgramId, sessionDraft]);

  useEffect(() => {
    let cancelled = false;

    void resolveSessionIntersectionMatches(sessionAccount, assetSnapshot)
      .then((matches) => {
        if (!cancelled) {
          setResolvedMatches(matches);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedMatches([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assetSnapshot, sessionAccount]);

  useEffect(() => {
    if (!hasConfiguredProgramId || !routeSessionId || !walletAddress || !commitmentPreview || isInitiatorWallet) {
      setCommitSetPlan(null);
      return;
    }

    if (sessionAccount && sessionAccount.state !== "AwaitingCounterparty") {
      setCommitSetPlan(null);
      return;
    }

    let cancelled = false;

    void buildCommitSetPlan({
      sessionId: routeSessionId,
      signer: walletAddress,
      commitmentHex: commitmentPreview.commitmentHex,
    })
      .then((plan) => {
        if (!cancelled) {
          setCommitSetPlan(plan);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommitSetPlan(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [commitmentPreview, hasConfiguredProgramId, isInitiatorWallet, routeSessionId, sessionAccount, walletAddress]);

  useEffect(() => {
    if (!hasConfiguredProgramId || !routeSessionId || !walletAddress || !canPrepareStartPsi) {
      setStartPsiPlan(null);
      return;
    }

    // Don't build the plan yet if the cluster key is still loading.
    const clusterKey =
      arciumCluster.status === "ready"
        ? arciumCluster.x25519Pubkey
        : new Uint8Array(32); // placeholder — plan will refresh when key arrives

    let cancelled = false;

    void buildStartPsiPlan({
      sessionId: routeSessionId,
      signer: walletAddress,
      ownFingerprintHexes: commitmentPreview?.assetHashesHex ?? [],
      isInitiator: isInitiatorWallet,
      clusterX25519Pubkey: clusterKey,
      // Plan uses offset 0n as a preview; the real offset is fetched fresh
      // from the mempool right before the wallet signs.
      computationOffset: 0n,
    })
      .then((plan) => {
        if (!cancelled) {
          setStartPsiPlan(plan);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStartPsiPlan(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [arciumCluster, canPrepareStartPsi, commitmentPreview, hasConfiguredProgramId, isInitiatorWallet, routeSessionId, walletAddress]);

  const toggleAsset = (value: AssetValue) => {
    setSelected((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  };

  const startSession = async () => {
    if (!walletAddress) {
      appendEvent("Wallet required", "Connect a Solana wallet before starting a private session.", "counterparty", "warn");
      return;
    }

    if (!commitmentPreview) {
      toast.error("No live commitment available", {
        description: "Fetch at least one live hashable asset before starting a session.",
      });
      appendEvent("Commitment required", "A live commitment must be prepared before the session can start.", "commitments", "warn");
      return;
    }

    if (!hasConfiguredProgramId) {
      toast.error("Program id required", {
        description: "Set VITE_SILENT_CIRCLE_PROGRAM_ID before creating a session on-chain.",
      });
      appendEvent("Program id required", "Configure VITE_SILENT_CIRCLE_PROGRAM_ID before broadcasting create_session.", "commitments", "warn");
      return;
    }

    const nextSessionId = routeSessionId ?? createSessionId();
    const nextSessionDraft = createSessionDraft({
      sessionId: nextSessionId,
      walletAddress,
      assetMask,
      commitmentPreview,
      pendingAssetGroups: pendingCommitmentGroups,
    });
    const startedEvent = createSessionEvent(
      phases[0].key,
      "info",
      phases[0].label,
      `Session ${nextSessionId} started from ${walletPreview} with mask ${nextSessionDraft.assetMaskBinary} and commitment ${shortenCommitmentHex(nextSessionDraft.commitmentHex)}.`,
    );

    try {
      setIsSubmittingSession(true);
      toast.info("Awaiting wallet approval…", {
        description: "Approve the create_session transaction in your Solana wallet.",
      });

      const signature = await signAndSendBrowserTransaction({
        instructions: [await createSessionInstruction(nextSessionDraft)],
        provider: connectedWallet?.provider,
      });
      setLastOnChainSignature(signature);
      setSessionId(nextSessionId);
      setSessionDraft(nextSessionDraft);
      navigate(`/session/${nextSessionId}`, { replace: Boolean(routeSessionId) });
      setPhase(0);
      setPhaseElapsed(0);
      setCounterpartyAddress(null);
      setSessionActive(true);

      setEventLog([
        createSessionEvent(
          "commitments",
          "info",
          "Session created on-chain",
          `Transaction ${shortenExplorerValue(signature)} created the session PDA on Solana devnet.`,
        ),
        startedEvent,
      ]);
      setSessionActive(true);
      toast.success("Session created on-chain", {
        description: `Signature ${shortenExplorerValue(signature)} confirmed on devnet.`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The create_session transaction was rejected or failed to confirm.";

      appendEvent("On-chain create failed", detail, "commitments", "warn");
      toast.error("Could not create session on-chain", {
        description: detail,
      });
    } finally {
      setIsSubmittingSession(false);
    }
  };

  const joinSessionAsCounterparty = async () => {
    if (!routeSessionId) {
      appendEvent("Invite required", "Open a session invite link before joining as the second wallet.", "counterparty", "warn");
      return;
    }

    if (!walletAddress) {
      appendEvent("Wallet required", "Connect a Solana wallet before joining as the counterparty.", "counterparty", "warn");
      return;
    }

    if (!commitmentPreview) {
      toast.error("No live commitment available", {
        description: "Fetch at least one live hashable asset before joining this session.",
      });
      appendEvent("Commitment required", "A live commitment must be prepared before the counterparty can join.", "commitments", "warn");
      return;
    }

    if (isInitiatorWallet) {
      toast.error("Switch wallets to join", {
        description: "The initiator wallet cannot also submit the counterparty commitment from this client.",
      });
      appendEvent("Different wallet required", "Switch to a second wallet before submitting commit_set.", "counterparty", "warn");
      return;
    }

    const joinedDetail = `${walletPreview} submitted a live wallet commitment for session ${routeSessionId}.`;

    try {
      setIsJoiningSession(true);
      toast.info("Awaiting wallet approval…", {
        description: "Approve the commit_set transaction in your Solana wallet.",
      });

      const signature = await signAndSendBrowserTransaction({
        instructions: [
          await createCommitSetInstruction({
            sessionId: routeSessionId,
            signer: walletAddress,
            commitmentHex: commitmentPreview.commitmentHex,
          }),
        ],
        provider: connectedWallet?.provider,
      });
      setLastOnChainSignature(signature);

      setCounterpartyAddress(walletAddress);
      setPhase(1);
      setPhaseElapsed(0);
      setSessionActive(false);
      appendEvent("Both committed", `Transaction ${shortenExplorerValue(signature)} stored the counterparty commitment on Solana devnet.`, "commitments", "info");
      appendEvent("Counterparty joined", joinedDetail, "counterparty", "info");
      toast.success("Counterparty committed on-chain", {
        description: `Signature ${shortenExplorerValue(signature)} confirmed on devnet.`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The commit_set transaction was rejected or failed to confirm.";

      toast.error("Could not join session on-chain", {
        description: detail,
      });
      appendEvent("On-chain commit failed", detail, "commitments", "warn");
    } finally {
      setIsJoiningSession(false);
    }
  };

  const startPsi = async () => {
    if (!routeSessionId) {
      appendEvent("Invite required", "Open a session invite link before starting PSI.", "mxe", "warn");
      return;
    }

    if (!walletAddress) {
      appendEvent("Wallet required", "Connect a Solana wallet before starting PSI.", "mxe", "warn");
      return;
    }

    if (!canPrepareStartPsi) {
      appendEvent("PSI not ready", "Wait until both commitments are locked before starting the MXE task.", "mxe", "warn");
      return;
    }

    if (!hasConfiguredProgramId) {
      toast.error("Program id required", {
        description: "Set VITE_SILENT_CIRCLE_PROGRAM_ID before starting PSI on-chain.",
      });
      appendEvent("Program id required", "Configure VITE_SILENT_CIRCLE_PROGRAM_ID before broadcasting start_psi.", "mxe", "warn");
      return;
    }

    try {
      setIsStartingPsi(true);
      toast.info("Awaiting wallet approval…", {
        description: "Approve the start_psi transaction in your Solana wallet.",
      });

      // Resolve the cluster X25519 key (from hook state or fall back to zero).
      const clusterX25519Pubkey =
        arciumCluster.status === "ready" ? arciumCluster.x25519Pubkey : new Uint8Array(32);

      // Fetch the next computation offset from the Arcium mempool right before
      // signing — this prevents using an offset already taken by a concurrent call.
      const computationOffset = await fetchNextComputationOffset(solanaConnection);

      const startPsiParams: StartPsiParams = {
        sessionId: routeSessionId,
        signer: walletAddress,
        ownFingerprintHexes: commitmentPreview?.assetHashesHex ?? [],
        isInitiator: isInitiatorWallet,
        clusterX25519Pubkey,
        computationOffset,
      };

      const signature = await signAndSendBrowserTransaction({
        instructions: [await createStartPsiInstruction(startPsiParams)],
        provider: connectedWallet?.provider,
      });
      setLastOnChainSignature(signature);
      setSessionPollState("polling");
      setSessionPollError(null);
      setSessionPollRefreshNonce((current) => current + 1);
      appendEvent("MXE computing", `Transaction ${shortenExplorerValue(signature)} triggered start_psi on Solana devnet.`, "mxe", "info");
      toast.success("PSI started on-chain", {
        description: `Signature ${shortenExplorerValue(signature)} confirmed on devnet.`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The start_psi transaction was rejected or failed to confirm.";

      toast.error("Could not start PSI on-chain", {
        description: detail,
      });
      appendEvent("On-chain PSI start failed", detail, "mxe", "warn");
    } finally {
      setIsStartingPsi(false);
    }
  };

  const connectWallet = async (wallet: SolanaWalletOption) => {
    try {
      toast.info(`Opening ${wallet.label} approval…`);
      const address = await connectBrowserWallet(wallet.provider);
      setConnectedWallet(wallet);
      setWalletAddress(address);
      toast.success(`${wallet.label} connected`);
      appendEvent("Wallet connected", `${wallet.label} ${address.slice(0, 4)}…${address.slice(-4)} authorized session setup.`, "counterparty", "info");
    } catch {
      toast.error("Wallet connection cancelled");
      appendEvent("Wallet connection rejected", `The ${wallet.label} authorization request was cancelled.`, "counterparty", "warn");
    }
  };

  const disconnectWallet = async () => {
    await disconnectBrowserWallet(connectedWallet?.provider);
    setConnectedWallet(null);
    setWalletAddress(null);
    setSessionDraft(null);
    setSessionActive(false);
    appendEvent("Wallet disconnected", "Session controls returned to standby.", "counterparty", "warn");
  };

  // The "other" wallet in the session — what the Dialect deep-link should target.
  const dialectCounterparty = useMemo(() => {
    if (!sessionAccount) {
      return counterpartyAddress && counterpartyAddress !== walletAddress ? counterpartyAddress : null;
    }
    if (walletAddress === sessionAccount.walletA) {
      return sessionAccount.walletB;
    }
    if (walletAddress === sessionAccount.walletB) {
      return sessionAccount.walletA;
    }
    // Observer with no wallet match — default to wallet B, then A.
    return sessionAccount.walletB ?? sessionAccount.walletA;
  }, [counterpartyAddress, sessionAccount, walletAddress]);

  const openDialectThread = useCallback(() => {
    if (!dialectCounterparty) {
      toast.error("No counterparty to message", {
        description: "Wait for the second wallet to commit before opening a Dialect thread.",
      });
      appendEvent("Dialect link unavailable", "No counterparty wallet is known yet.", phases[phase].key, "warn");
      return;
    }
    // Dialect's universal wallet-to-wallet thread URL.
    const url = `https://dialect.to/?wallet=${dialectCounterparty}`;
    window.open(url, "_blank", "noopener,noreferrer");
    appendEvent("Dialect thread opened", `Opened a Dialect chat with ${formatWalletAddress(dialectCounterparty)}.`, phases[phase].key, "info");
  }, [appendEvent, dialectCounterparty, phase]);

  const copyToClipboard = async (value: string, label: string) => {
    if (!value.trim()) {
      toast.error(`${label} is not ready`, {
        description: `Prepare a session before copying the ${label.toLowerCase()}.`,
      });
      appendEvent(`${label} unavailable`, `The ${label.toLowerCase()} is not ready yet.`, phases[phase].key, "warn");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
      appendEvent(`${label} copied`, "The value was copied to the clipboard.", phases[phase].key, "info");
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
      appendEvent("Clipboard unavailable", `The browser blocked copying ${label.toLowerCase()}.`, phases[phase].key, "warn");
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-hero text-foreground">
      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-5 md:px-8 lg:gap-8 lg:py-8">
        <div className="pointer-events-none absolute inset-0 arcium-dot-field opacity-70" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,hsl(var(--background)/0.28)_48%,hsl(var(--background))_84%)]" />

        <nav className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 shadow-secure">
              <LockKeyhole className="size-5 text-primary" />
            </div>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.38em]">SilentCircle</p>
                <p className="text-xs text-muted-foreground">Private wallet discovery</p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="glass" size="sm" className="gap-2" onClick={() => navigate("/") }>
              <Home className="size-4" /> Home
            </Button>
            <Badge variant="privacy" className="hidden sm:inline-flex">Devnet RTG</Badge>
          </div>
        </nav>

        <div className="relative z-10 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-4xl space-y-4 animate-float-in">
            <Badge variant="chain" className="gap-2 px-3 py-1">
              <Sparkles className="size-3.5" /> Arcium-inspired MPC + Solana PSI
            </Badge>
            <h1 className="text-balance text-4xl font-semibold uppercase leading-[0.95] tracking-normal sm:text-5xl md:text-6xl">
              Session console for private wallet matching.
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              SilentCircle encrypts each wallet’s asset set, commits on-chain, and reveals only mutual tokens, NFT collections, and DAO memberships through Private Set Intersection.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[32rem]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="glass" size="lg" className="w-full sm:w-auto">
                  <Wallet className="size-4" /> {walletAddress ? walletPreview : "Connect wallet"} <ChevronDown className="size-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {walletAddress ? (
                  <>
                    <DropdownMenuLabel>Connected wallet</DropdownMenuLabel>
                    <div className="px-2 py-1.5 text-sm">
                      <p className="font-medium text-foreground">{connectedWallet?.label ?? "Solana wallet"}</p>
                      <p className="text-xs text-muted-foreground">{walletPreview}</p>
                    </div>
                    {switchableWallets.length > 0 ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Switch wallet</DropdownMenuLabel>
                        {switchableWallets.map((wallet) => (
                          <DropdownMenuItem key={wallet.id} onSelect={() => void connectWallet(wallet)}>
                            <div className="flex flex-col">
                              <span>{wallet.label}</span>
                              <span className="text-xs text-muted-foreground">Use this Solana wallet instead.</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void disconnectWallet()}>
                      <div className="flex flex-col">
                        <span>Disconnect wallet</span>
                        <span className="text-xs text-muted-foreground">Remove the connected Solana wallet from this session.</span>
                      </div>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuLabel>Connect a Solana wallet</DropdownMenuLabel>
                    {availableWallets.length > 0 ? (
                      availableWallets.map((wallet) => (
                        <DropdownMenuItem key={wallet.id} onSelect={() => void connectWallet(wallet)}>
                          <div className="flex flex-col">
                            <span>{wallet.label}</span>
                            <span className="text-xs text-muted-foreground">Use this detected Solana wallet for the session.</span>
                          </div>
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">No injected Solana wallet was detected in this browser yet.</div>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Suggested wallets</DropdownMenuLabel>
                    {solanaWalletInstallOptions.map((wallet) => (
                      <DropdownMenuItem key={wallet.id} onSelect={() => window.open(wallet.url, "_blank", "noopener,noreferrer")}>
                        <div className="flex flex-col">
                          <span>{wallet.label}</span>
                          <span className="text-xs text-muted-foreground">{wallet.description}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secure" size="lg" className="w-full sm:w-auto" onClick={startSession} disabled={Boolean(routeSessionId) || sessionActive || isSubmittingSession}>
              {routeSessionId ? "Invite session loaded" : !hasConfiguredProgramId ? "Program id required" : isSubmittingSession ? "Awaiting signature" : sessionActive ? "Session running" : phase === phases.length - 1 ? "Restart private session" : "Start private session"} <ArrowRight className="size-4" />
            </Button>
            <Button variant="glass" size="lg" className="w-full sm:w-auto" onClick={() => copyToClipboard(inviteUrl, "Invite link")} disabled={!inviteUrl}>
              <Copy className="size-4" /> Copy invite link
            </Button>
          </div>
        </div>

        <div className="relative z-10 grid gap-3 sm:grid-cols-3">
            {[
              [String(sessionAccount?.intersectionCount ?? resolvedMatches.length), "mutual assets revealed"],
              ["24h", "session expiry"],
              [sessionPollMetric, hasConfiguredProgramId && routeSessionId ? "last PDA sync" : "PDA polling"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-lg border border-border bg-surface/60 p-4 backdrop-blur-xl">
                <p className="text-2xl font-semibold text-primary">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
        </div>

        <div className="relative z-10 pb-8">
          <div className="group relative rounded-lg border border-border bg-panel p-3 shadow-panel backdrop-blur-2xl sm:p-4 md:p-5">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-primary-gradient" />
            <div className="pointer-events-none absolute inset-x-5 top-10 h-24 animate-scan-line bg-gradient-to-b from-transparent via-primary/10 to-transparent opacity-0 group-hover:opacity-100 motion-reduce:hidden" />

            <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-4 rounded-lg border border-border bg-surface/70 p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Session setup</p>
                    <p className="text-xs text-muted-foreground">Asset mask selection</p>
                  </div>
                  <Wallet className="size-5 text-primary" />
                </div>

                <div className="space-y-3">
                  {assetCatalog.map((asset) => {
                    const active = selected.includes(asset.value);
                    const assetCount = assetSnapshot.counts[asset.value];
                    return (
                      <button
                        key={asset.value}
                        onClick={() => toggleAsset(asset.value)}
                        className="flex w-full items-center justify-between rounded-lg border border-border bg-background/40 p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span>
                          <span className="block text-sm font-medium">{asset.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {assetCount} {getAssetCountCaption(walletAddress, assetSnapshotLoadState)}
                          </span>
                        </span>
                        <span className={`grid size-6 place-items-center rounded-md border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted"}`}>
                          {active && <Check className="size-3.5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <Fingerprint className="size-4" /> Commitment preview
                  </div>
                  <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                    {walletPreview} ↔ {counterpartyPreview} · mask {assetMask.toString(2).padStart(3, "0")} · {commitmentPreview ? `sha256(set) ${shortenCommitmentHex(commitmentPreview.commitmentHex)} · ${commitmentPreview.assetIds.length} live assets` : "awaiting live asset hashes"}
                  </p>
                  <p className="mt-2 text-[0.68rem] text-muted-foreground">
                    {pendingCommitmentGroups.length > 0
                      ? `Some selected asset groups are still excluded from the live commitment preview: ${pendingCommitmentGroups.map((asset) => assetCatalog.find((item) => item.value === asset)?.label).filter(Boolean).join(" and ")}.`
                      : "All selected groups currently participate in the live commitment preview."}
                  </p>
                  <p className="mt-2 text-[0.68rem] text-muted-foreground">
                    {sessionDraft
                      ? `Session payload ready until ${new Date(sessionDraft.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}.`
                      : hasConfiguredProgramId
                        ? "Start the session to freeze this commitment into a shareable session payload."
                        : "Configure VITE_SILENT_CIRCLE_PROGRAM_ID before creating a shareable on-chain session payload."}
                  </p>
                  <p className="mt-2 text-[0.68rem] text-muted-foreground">
                    {activeSessionPlan
                      ? `${activeSessionPlan.instructionName} request prepared for program ${activeSessionPlan.programId.slice(0, 4)}…${activeSessionPlan.programId.slice(-4)}.`
                      : hasConfiguredProgramId
                        ? "The active Solana session request will be derived from the current wallet state and invite context."
                        : "No Solana session request is generated until VITE_SILENT_CIRCLE_PROGRAM_ID is configured."}
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-background/35 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Counterparty join</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{counterpartyPreview}</p>
                    </div>
                    <UserRoundPlus className="size-5 text-secondary" />
                  </div>
                  <p className="mb-3 text-[0.68rem] text-muted-foreground">
                    {routeSessionId
                      ? isInitiatorWallet
                        ? "Switch to a different wallet to submit the second commitment from this invite route."
                        : hasConfiguredProgramId
                          ? "Join this invite by sending a real commit_set transaction from the connected wallet."
                          : "Configure VITE_SILENT_CIRCLE_PROGRAM_ID before broadcasting commit_set for this invite route."
                      : "Copy an invite link or start a session before a counterparty can join."}
                  </p>
                  <div className="grid gap-2">
                    <Button variant="glass" size="sm" onClick={joinSessionAsCounterparty} disabled={!canJoinAsCounterparty || isJoiningSession}>
                      {isJoiningSession ? "Awaiting signature" : hasConfiguredProgramId ? "Join on-chain" : "Program id required"}
                    </Button>
                  </div>
                </div>
              </div>

                <div className="space-y-4 rounded-lg border border-border bg-background/35 p-3 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Private computation</p>
                    <p className="text-xs text-muted-foreground">{activePhase.detail}</p>
                  </div>
                    <Badge variant="warning" className="w-fit">{statusBadgeLabel}</Badge>
                </div>

                <div className="space-y-3 rounded-lg border border-border bg-surface/60 p-3">
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {inviteUrl || "Create the session on-chain to generate a shareable invite link."}
                  </span>
                  <Button variant="glass" size="sm" className="w-full" onClick={() => copyToClipboard(inviteUrl, "Share link")} disabled={!inviteUrl}>
                    <Copy className="size-4" /> Copy share link
                  </Button>
                </div>

                <div className="space-y-3 rounded-lg border border-border bg-surface/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">On-chain session</p>
                      <p className="text-xs text-muted-foreground">{sessionPollSummary}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="glass"
                        size="sm"
                        className="px-3"
                        onClick={refreshSessionPoll}
                        disabled={!hasConfiguredProgramId || !routeSessionId || sessionPollState === "polling"}
                      >
                        {refreshSessionPollLabel}
                      </Button>
                      <Badge variant={sessionPollBadge.variant}>{sessionPollBadge.label}</Badge>
                      <RadioTower className="size-5 text-primary" />
                    </div>
                  </div>
                  {sessionPollError ? <p className="rounded-md border border-accent/20 bg-accent/5 p-2 text-[0.68rem] text-accent">{sessionPollError}</p> : null}
                  {sessionAccount ? (
                    <div className="grid gap-2 rounded-lg border border-border bg-background/35 p-3 text-[0.72rem] text-muted-foreground sm:grid-cols-2">
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Session PDA</p>
                        <p className="mt-1 break-all font-mono text-xs text-foreground">{sessionAccount.address}</p>
                        {sessionExplorerUrl ? (
                          <a
                            href={sessionExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-[0.68rem] text-primary transition-colors hover:text-primary/80"
                          >
                            Open in explorer <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Task ID</p>
                        <p className="mt-1 font-mono text-xs text-foreground">{sessionAccount.arciumTaskId || 0}</p>
                        <p className="mt-1 text-[0.68rem]">Last synced {formatRelativeTimestamp(lastSessionPollSuccessAt)}</p>
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Wallet A</p>
                        <p className="mt-1 break-all font-mono text-xs text-foreground">{sessionAccount.walletA}</p>
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Wallet B</p>
                        <p className="mt-1 break-all font-mono text-xs text-foreground">{sessionAccount.walletB ?? "Waiting for join"}</p>
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Asset Mask</p>
                        <p className="mt-1 text-xs text-foreground">
                          {sessionAssetLabels.length > 0 ? sessionAssetLabels.join(" / ") : `0b${sessionAccount.assetMask.toString(2).padStart(3, "0")}`}
                        </p>
                        <p className="mt-1 font-mono text-[0.68rem]">0b{sessionAccount.assetMask.toString(2).padStart(3, "0")}</p>
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Intersection</p>
                        <p className="mt-1 text-xs text-foreground">{sessionAccount.intersectionCount} item{sessionAccount.intersectionCount === 1 ? "" : "s"}</p>
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Created</p>
                        <p className="mt-1 text-xs text-foreground">{formatUnixTimestamp(sessionAccount.createdAtUnix)}</p>
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Expires</p>
                        <p className="mt-1 text-xs text-foreground">{formatUnixTimestamp(sessionAccount.expiresAtUnix)}</p>
                        <p className="mt-1 text-[0.68rem]">{expiryStatus}</p>
                      </div>
                      <div>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-primary/80">Latest signature</p>
                        <p className="mt-1 break-all font-mono text-xs text-foreground">{lastOnChainSignature ?? "No confirmed transaction yet"}</p>
                        {latestSignatureExplorerUrl ? (
                          <a
                            href={latestSignatureExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-[0.68rem] text-primary transition-colors hover:text-primary/80"
                          >
                            Open signature <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <Button variant="secure" size="sm" className="w-full" onClick={startPsi} disabled={!canPrepareStartPsi || isStartingPsi}>
                    {isStartingPsi ? "Awaiting signature" : hasConfiguredProgramId ? "Start MXE on-chain" : "Program id required"}
                  </Button>
                </div>

                <div className="space-y-3">
                  {phases.map((item, index) => (
                    <div
                      key={item.label}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left"
                    >
                      <span className={`grid size-8 place-items-center rounded-lg border ${index <= phase ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                        {index <= phase ? <Check className="size-4" /> : index + 1}
                      </span>
                      <span className="text-sm">{item.label}</span>
                    </div>
                  ))}
                </div>

                <Progress value={sessionProgress} className="h-2" />

                <div className="rounded-lg border border-border bg-surface/55 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Live event log</p>
                    <span className="font-mono text-xs text-muted-foreground">{sessionProgress}%</span>
                  </div>
                  <div className="mb-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {phaseFilters.map((filter) => (
                        <button
                          key={filter.value}
                          onClick={() => setPhaseFilter(filter.value)}
                          className={`rounded-md border px-2 py-1 text-[0.68rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${phaseFilter === filter.value ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/35 text-muted-foreground hover:bg-surface/70"}`}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {severityFilters.map((filter) => (
                        <button
                          key={filter.value}
                          onClick={() => setSeverityFilter(filter.value)}
                          className={`rounded-md border px-2 py-1 text-[0.68rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${severityFilter === filter.value ? "border-secondary bg-secondary/15 text-secondary" : "border-border bg-background/35 text-muted-foreground hover:bg-surface/70"}`}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                    {filteredEvents.map((event) => (
                      <div key={event.id} className="grid gap-2 rounded-md border border-border bg-background/35 p-2 sm:grid-cols-[4.5rem_1fr]">
                        <span className="font-mono text-[0.68rem] leading-5 text-muted-foreground">{event.time}</span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2 text-xs font-medium">
                            {event.label}
                            <span className={`rounded border px-1.5 py-0.5 text-[0.62rem] uppercase ${event.severity === "warn" ? "border-accent/30 text-accent" : "border-primary/30 text-primary"}`}>{event.severity}</span>
                          </span>
                          <span className="block text-[0.68rem] leading-4 text-muted-foreground">{event.detail}</span>
                        </span>
                      </div>
                    ))}
                    {filteredEvents.length === 0 && <p className="rounded-md border border-border bg-background/35 p-3 text-xs text-muted-foreground">No events match these filters.</p>}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-surface/55 p-3">
                    <KeyRound className="mb-3 size-5 text-secondary" />
                    <p className="text-sm font-medium">Encrypted inputs</p>
                    <p className="text-xs text-muted-foreground">No plaintext holdings leave the client.</p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface/55 p-3">
                    <RadioTower className="mb-3 size-5 text-primary" />
                    <p className="text-sm font-medium">Callback proof</p>
                    <p className="text-xs text-muted-foreground">Only Arcium writes the intersection.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-surface/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Match result</p>
                  <p className="text-xs text-muted-foreground">{matchResultSummary}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="glass"
                    size="sm"
                    className="px-3"
                    onClick={refreshAssetSnapshot}
                    disabled={!walletAddress || assetSnapshotLoadState === "loading"}
                  >
                    {refreshAssetSnapshotLabel}
                  </Button>
                  <ShieldCheck className="size-5 animate-secure-pulse text-success motion-reduce:animate-none" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {resolvedMatches.length > 0 ? (
                  resolvedMatches.map((match) => {
                    const labelHint = getMatchLabelHint(match, assetSnapshotLoadState);

                    return (
                    <div key={match.id} className="rounded-lg border border-border bg-background/45 p-3 transition-transform hover:-translate-y-0.5">
                      <div className="mb-5 flex items-center justify-between gap-2">
                        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                          <Layers3 className="size-4" />
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Badge variant="outline">{match.type}</Badge>
                          <Badge variant={labelHint.badgeVariant}>{labelHint.badgeLabel}</Badge>
                        </div>
                      </div>
                      <p className="font-semibold">{match.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{match.detail}</p>
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{labelHint.detail}</p>
                    </div>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-background/35 p-4 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
                    {sessionAccount?.state === "Done"
                      ? "No mutual assets were revealed for this session yet, or this client cannot resolve the returned hashes into its local asset snapshot."
                      : "The match result cards will populate from the session PDA once Arcium writes the intersection back on-chain."}
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Button variant="secure" className="flex-1" onClick={openDialectThread} disabled={!dialectCounterparty}>
                  <MessageCircle className="size-4" />
                  {dialectCounterparty ? "Message on Dialect" : "Message on Dialect (no counterparty)"}
                </Button>
                <Button variant="glass" className="flex-1" onClick={() => copyToClipboard(sessionRequest, "Session request")} disabled={!activeSessionPlan}>
                  <Copy className="size-4" /> Copy session request
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Index;