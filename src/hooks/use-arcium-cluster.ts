import { useEffect, useState } from "react";

import { resolveClusterX25519Pubkey } from "@/lib/arcium-accounts";
import { hasArciumConfigured } from "@/lib/arcium-config";
import { solanaConnection } from "@/lib/solana";

export type ArciumClusterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; x25519Pubkey: Uint8Array }
  | { status: "error"; message: string };

/**
 * Fetches the MXE cluster's X25519 public key once on mount.
 *
 * Resolution order:
 *   1. VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX env var (instant, no RPC call)
 *   2. On-chain fetch from the cluster account via the configured RPC
 *   3. Error state if neither is available
 *
 * Returns `{ status: "idle" }` when Arcium is not yet configured so callers
 * can differentiate "not configured" from "fetch in progress".
 */
export const useArciumCluster = (): ArciumClusterState => {
  const [state, setState] = useState<ArciumClusterState>(
    hasArciumConfigured() ? { status: "loading" } : { status: "idle" },
  );

  useEffect(() => {
    if (!hasArciumConfigured()) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    resolveClusterX25519Pubkey(solanaConnection)
      .then((key) => {
        if (cancelled) {
          return;
        }

        if (key) {
          setState({ status: "ready", x25519Pubkey: key });
        } else {
          setState({
            status: "error",
            message:
              "Arcium cluster account not found on devnet. " +
              "Set VITE_ARCIUM_CLUSTER_PUBKEY and VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX, " +
              "or run `arcium register-mxe --cluster devnet`.",
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to fetch Arcium cluster key.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};
