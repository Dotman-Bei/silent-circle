import { Connection, PublicKey, Transaction, clusterApiUrl, type SendOptions, type TransactionInstruction } from "@solana/web3.js";

export type SolanaProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isExodus?: boolean;
  isGlow?: boolean;
  name?: string;
  publicKey?: { toString: () => string };
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
  signAndSendTransaction?: (transaction: Transaction, options?: SendOptions) => Promise<{ signature: string }>;
};

type SolanaConnectionLike = Pick<Connection, "getLatestBlockhash" | "confirmTransaction">;

type SendBrowserTransactionInput = {
  instructions: TransactionInstruction[];
  provider?: SolanaProvider;
  connection?: SolanaConnectionLike;
  feePayer?: string;
};

type SolanaBrowserWindow = {
  solana?: SolanaProvider;
  phantom?: { solana?: SolanaProvider };
  solflare?: SolanaProvider | { solana?: SolanaProvider };
  backpack?: SolanaProvider | { solana?: SolanaProvider };
  exodus?: SolanaProvider | { solana?: SolanaProvider };
  glowSolana?: SolanaProvider | { solana?: SolanaProvider };
};

export type SolanaExplorerResource = "address" | "tx";
export type SolanaWalletOption = {
  id: string;
  label: string;
  provider: SolanaProvider;
};
export type SolanaWalletInstallOption = {
  id: string;
  label: string;
  description: string;
  url: string;
};

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider | { solana?: SolanaProvider };
    backpack?: SolanaProvider | { solana?: SolanaProvider };
    exodus?: SolanaProvider | { solana?: SolanaProvider };
    glowSolana?: SolanaProvider | { solana?: SolanaProvider };
  }
}

const unwrapProvider = (value?: SolanaProvider | { solana?: SolanaProvider }) => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if ("connect" in value) {
    return value as SolanaProvider;
  }

  if ("solana" in value) {
    return value.solana;
  }

  return undefined;
};

export const solanaWalletInstallOptions: SolanaWalletInstallOption[] = [
  {
    id: "phantom",
    label: "Phantom",
    description: "Popular Solana wallet extension.",
    url: "https://phantom.app/download",
  },
  {
    id: "solflare",
    label: "Solflare",
    description: "Solana wallet for browser and mobile.",
    url: "https://solflare.com/download",
  },
  {
    id: "backpack",
    label: "Backpack",
    description: "Multi-chain wallet with Solana support.",
    url: "https://backpack.app/download",
  },
  {
    id: "exodus",
    label: "Exodus",
    description: "Desktop and browser wallet with Solana support.",
    url: "https://www.exodus.com/download/",
  },
];

export const getSolanaRpcEndpoint = (rpcUrl = import.meta.env.VITE_SOLANA_RPC_URL) => rpcUrl?.trim() || clusterApiUrl("devnet");

export const getSolanaExplorerUrl = (resource: SolanaExplorerResource, value: string, rpcUrl = getSolanaRpcEndpoint()) => {
  const baseUrl = `https://explorer.solana.com/${resource}/${value}`;
  const normalizedRpcUrl = rpcUrl.trim().toLowerCase();

  if (!normalizedRpcUrl || normalizedRpcUrl.includes("devnet")) {
    return `${baseUrl}?cluster=devnet`;
  }

  if (normalizedRpcUrl.includes("testnet")) {
    return `${baseUrl}?cluster=testnet`;
  }

  if (normalizedRpcUrl.includes("mainnet")) {
    return baseUrl;
  }

  return `${baseUrl}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
};

export const createSolanaConnection = (rpcUrl = getSolanaRpcEndpoint()) => new Connection(rpcUrl, "confirmed");

export const solanaConnection = createSolanaConnection();

export const getInstalledSolanaWallets = (browserWindow: SolanaBrowserWindow = window): SolanaWalletOption[] => {
  const seenProviders = new Set<SolanaProvider>();
  const wallets: SolanaWalletOption[] = [];

  const addWallet = (id: string, label: string, provider?: SolanaProvider) => {
    if (!provider || seenProviders.has(provider)) {
      return;
    }

    seenProviders.add(provider);
    wallets.push({ id, label, provider });
  };

  addWallet("phantom", "Phantom", browserWindow.phantom?.solana ?? (browserWindow.solana?.isPhantom ? browserWindow.solana : undefined));
  addWallet("solflare", "Solflare", unwrapProvider(browserWindow.solflare) ?? (browserWindow.solana?.isSolflare ? browserWindow.solana : undefined));
  addWallet("backpack", "Backpack", unwrapProvider(browserWindow.backpack) ?? (browserWindow.solana?.isBackpack ? browserWindow.solana : undefined));
  addWallet("exodus", "Exodus", unwrapProvider(browserWindow.exodus) ?? (browserWindow.solana?.isExodus ? browserWindow.solana : undefined));
  addWallet("glow", "Glow", unwrapProvider(browserWindow.glowSolana) ?? (browserWindow.solana?.isGlow ? browserWindow.solana : undefined));

  if (browserWindow.solana && !seenProviders.has(browserWindow.solana)) {
    addWallet("injected", browserWindow.solana.name?.trim() || "Injected Solana wallet", browserWindow.solana);
  }

  return wallets;
};

export const getBrowserSolanaProvider = (browserWindow: SolanaBrowserWindow = window) => getInstalledSolanaWallets(browserWindow)[0]?.provider;

export const hasInstalledWalletProvider = (browserWindow: SolanaBrowserWindow = window) => getInstalledSolanaWallets(browserWindow).length > 0;

export const getBrowserWalletAddress = (provider = getBrowserSolanaProvider()) => provider?.publicKey?.toString() ?? null;

export const connectBrowserWallet = async (provider = getBrowserSolanaProvider()) => {
  if (!provider) {
    throw new Error("No Solana wallet provider found.");
  }

  // Always disconnect first to clear any cached trusted session so the wallet
  // extension always presents its approval popup, even for the same wallet/browser.
  await provider.disconnect?.().catch(() => undefined);
  const response = await provider.connect({ onlyIfTrusted: false });
  return response.publicKey.toString();
};

export const disconnectBrowserWallet = async (provider = getBrowserSolanaProvider()) => {
  await provider?.disconnect?.();
};

export const signAndSendBrowserTransaction = async ({
  instructions,
  provider = getBrowserSolanaProvider(),
  connection = solanaConnection,
  feePayer = getBrowserWalletAddress(provider) ?? undefined,
}: SendBrowserTransactionInput) => {
  if (!provider) {
    throw new Error("No Solana wallet provider found.");
  }

  if (!provider.signAndSendTransaction) {
    throw new Error("The connected wallet cannot sign and send Solana transactions.");
  }

  if (!feePayer) {
    throw new Error("Connect a Solana wallet before sending transactions.");
  }

  if (instructions.length === 0) {
    throw new Error("At least one Solana instruction is required.");
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = new PublicKey(feePayer);
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  transaction.add(...instructions);

  const { signature } = await provider.signAndSendTransaction(transaction, {
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed",
  );

  return signature;
};

export const formatWalletAddress = (address: string | null, fallback = "Not connected") => {
  if (!address) {
    return fallback;
  }

  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 4)}…${address.slice(-4)}`;
};
