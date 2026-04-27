import { PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const INTERNAL_PLACEHOLDER_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

const workspaceRoot = process.cwd();
const defaultEnvFilePath = path.join(workspaceRoot, ".env.local");
const exampleEnvFilePath = path.join(workspaceRoot, ".env.example");

const usage = () => {
  console.error(
    [
      "Usage:",
      "  node scripts/configure-devnet-env.mjs --program-id <deployed_program_id> [--rpc-url <url>] [--psi-computation-pubkey <pubkey>] [--mxe-pubkey <pubkey>] [--output-env-file <path>]",
      "",
      "Example:",
      "  node scripts/configure-devnet-env.mjs --program-id 8M6J... --psi-computation-pubkey 7a3E... --mxe-pubkey GXtS...",
    ].join("\n"),
  );
};

const parseArgs = (argv) => {
  const options = { _: [] };
  const flagsWithoutValues = new Set(["help"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const key = token.slice(2);

    if (flagsWithoutValues.has(key)) {
      options[key] = true;
      continue;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    options[key] = value;
    index += 1;
  }

  return options;
};

const normalizeOptionCandidate = (value) => {
  if (value == null) {
    return null;
  }

  const normalized = `${value}`.trim();

  if (!normalized || normalized === "true" || normalized === "false") {
    return null;
  }

  return normalized;
};

const pickOption = (options, key, envKey, positionalIndex) =>
  normalizeOptionCandidate(options[key])
  ?? normalizeOptionCandidate(options._[positionalIndex])
  ?? normalizeOptionCandidate(process.env[envKey])
  ?? null;

const normalizePublicKey = (value, label) => {
  if (!value?.trim()) {
    throw new Error(`${label} is required.`);
  }

  let publicKey;

  try {
    publicKey = new PublicKey(value.trim());
  } catch {
    throw new Error(`${label} must be a valid base58 Solana public key.`);
  }

  return publicKey.toBase58();
};

const validateProgramId = (value) => {
  const normalized = normalizePublicKey(value, "Program ID");

  if (normalized === INTERNAL_PLACEHOLDER_PROGRAM_ID || normalized === SYSTEM_PROGRAM_ID) {
    throw new Error("Program ID must be the deployed SilentCircle program address, not a placeholder or unrelated built-in program.");
  }

  return normalized;
};

const loadEnvSource = (envFilePath) => {
  if (fs.existsSync(envFilePath)) {
    return fs.readFileSync(envFilePath, "utf8");
  }

  if (fs.existsSync(exampleEnvFilePath)) {
    return fs.readFileSync(exampleEnvFilePath, "utf8");
  }

  return "";
};

const upsertEnvVar = (source, key, value) => {
  const assignment = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(source)) {
    return source.replace(pattern, assignment);
  }

  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n${assignment}\n` : `${assignment}\n`;
};

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    process.exit(0);
  }

  const envFilePath = path.resolve(
    workspaceRoot,
    pickOption(options, "output-env-file", "npm_config_output_env_file", 1) || defaultEnvFilePath,
  );
  const programId = validateProgramId(pickOption(options, "program-id", "npm_config_program_id", 0));
  const rpcUrl = pickOption(options, "rpc-url", "npm_config_rpc_url", 2)?.trim() || DEFAULT_RPC_URL;
  const psiComputationPubkeyValue = pickOption(options, "psi-computation-pubkey", "npm_config_psi_computation_pubkey", 3);
  const mxePubkeyValue = pickOption(options, "mxe-pubkey", "npm_config_mxe_pubkey", 4);
  const psiComputationPubkey = psiComputationPubkeyValue
    ? normalizePublicKey(psiComputationPubkeyValue, "PSI computation pubkey")
    : null;
  const mxePubkey = mxePubkeyValue
    ? normalizePublicKey(mxePubkeyValue, "Arcium MXE pubkey")
    : null;

  let output = loadEnvSource(envFilePath);
  output = upsertEnvVar(output, "VITE_SOLANA_RPC_URL", rpcUrl);
  output = upsertEnvVar(output, "VITE_SILENT_CIRCLE_PROGRAM_ID", programId);
  output = upsertEnvVar(output, "ANCHOR_PROGRAM_ID", programId);

  if (psiComputationPubkey) {
    output = upsertEnvVar(output, "PSI_COMPUTATION_PUBKEY", psiComputationPubkey);
  }

  if (mxePubkey) {
    output = upsertEnvVar(output, "ARCIUM_MXE_PUBKEY", mxePubkey);
  }

  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  fs.writeFileSync(envFilePath, output);

  console.log(`Configured ${path.relative(workspaceRoot, envFilePath) || path.basename(envFilePath)}.`);
  console.log(`VITE_SILENT_CIRCLE_PROGRAM_ID=${programId}`);

  if (psiComputationPubkey) {
    console.log(`PSI_COMPUTATION_PUBKEY=${psiComputationPubkey}`);
  }

  if (mxePubkey) {
    console.log(`ARCIUM_MXE_PUBKEY=${mxePubkey}`);
  }

  console.log("Restart the Vite dev server after updating env files.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  usage();
  process.exit(1);
}