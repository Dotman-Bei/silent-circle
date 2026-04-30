import { Keypair } from "@solana/web3.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const deployKeypairPath = path.join(workspaceRoot, "target", "deploy", "silent_circle-keypair.json");
const configureEnvScriptPath = path.join(workspaceRoot, "scripts", "configure-devnet-env.mjs");
const defaultEnvFilePath = path.join(workspaceRoot, ".env.local");
const deployCluster = "devnet";

const usage = () => {
  console.error(
    [
      "Usage:",
      "  node scripts/deploy-devnet.mjs [--dry-run] [--wsl-distro <name>] [--rpc-url <url>] [--psi-computation-pubkey <pubkey>] [--mxe-pubkey <pubkey>] [--output-env-file <path>]",
      "",
      "Examples:",
      "  node scripts/deploy-devnet.mjs --dry-run",
      "  node scripts/deploy-devnet.mjs --wsl-distro Ubuntu",
      "  node scripts/deploy-devnet.mjs --psi-computation-pubkey 7a3E... --mxe-pubkey GXtS...",
    ].join("\n"),
  );
};

const parseArgs = (argv) => {
  const options = { _: [] };
  const flagsWithoutValues = new Set(["help", "dry-run"]);

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

const pickBooleanOption = (options, key, envKey) => {
  if (options[key] === true) {
    return true;
  }

  const envValue = normalizeOptionCandidate(process.env[envKey]);
  return envValue === "1" || envValue === "true";
};

const quoteBash = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;

const toWslPath = (filePath) => {
  const match = /^([A-Za-z]):\\(.*)$/.exec(path.resolve(filePath));

  if (!match) {
    throw new Error(`Cannot translate path to WSL format: ${filePath}`);
  }

  const [, driveLetter, remainder] = match;
  return `/mnt/${driveLetter.toLowerCase()}/${remainder.replace(/\\/g, "/")}`;
};

const buildDeployShellCommand = (projectPath) => [
  "set -euo pipefail",
  `cd ${quoteBash(projectPath)}`,
  "anchor build",
  "anchor keys sync",
  "anchor build",
  `anchor deploy --provider.cluster ${deployCluster}`,
].join("; ");

const buildRunner = (wslDistro) => {
  if (process.platform === "win32") {
    const args = [];

    if (wslDistro) {
      args.push("-d", wslDistro);
    }

    args.push("--", "bash", "-lc", buildDeployShellCommand(toWslPath(workspaceRoot)));

    return {
      command: "wsl.exe",
      args,
      label: wslDistro ? `WSL distro ${wslDistro}` : "default WSL distro",
    };
  }

  // Use -c (not -lc) on Linux to skip login-shell RVM/nvm init scripts that
  // crash under set -u. PATH is pre-exported below so anchor/solana are found.
  const toolchainPath = [
    `${process.env.HOME}/.cargo/bin`,
    `${process.env.HOME}/.local/share/solana/install/active_release/bin`,
    `${process.env.HOME}/.avm/bin`,
    process.env.PATH,
  ].filter(Boolean).join(":");

  return {
    command: "bash",
    args: ["-c", buildDeployShellCommand(workspaceRoot)],
    label: "local bash shell",
    env: { ...process.env, PATH: toolchainPath },
  };
};

const runCommand = (command, args, env = process.env) => {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(`${command} is not available in this environment.`);
    }

    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}.`);
  }
};

const readProgramIdFromKeypair = () => {
  if (!fs.existsSync(deployKeypairPath)) {
    throw new Error(`Expected deploy keypair at ${path.relative(workspaceRoot, deployKeypairPath)}, but it was not created.`);
  }

  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(deployKeypairPath, "utf8")));
  return Keypair.fromSecretKey(secretKey).publicKey.toBase58();
};

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    process.exit(0);
  }

  const dryRun = pickBooleanOption(options, "dry-run", "npm_config_dry_run");
  const wslDistro = pickOption(options, "wsl-distro", "npm_config_wsl_distro", 0);
  const rpcUrl = pickOption(options, "rpc-url", "npm_config_rpc_url", 1);
  const psiComputationPubkey = pickOption(options, "psi-computation-pubkey", "npm_config_psi_computation_pubkey", 2);
  const mxePubkey = pickOption(options, "mxe-pubkey", "npm_config_mxe_pubkey", 3);
  const outputEnvFile = pickOption(options, "output-env-file", "npm_config_output_env_file", 4) || defaultEnvFilePath;
  const runner = buildRunner(wslDistro);

  if (dryRun) {
    console.log(`Dry run only. Deployment would execute through ${runner.label}.`);
    console.log("");
    console.log(`${runner.command} ${runner.args.join(" ")}`);
    console.log("");
    console.log("After a successful deploy, this script would also run:");
    console.log(`${process.execPath} ${path.relative(workspaceRoot, configureEnvScriptPath)} --program-id <deployed_program_id> --output-env-file ${outputEnvFile}`);

    if (psiComputationPubkey) {
      console.log(`  --psi-computation-pubkey ${psiComputationPubkey}`);
    }

    if (mxePubkey) {
      console.log(`  --mxe-pubkey ${mxePubkey}`);
    }

    if (rpcUrl) {
      console.log(`  --rpc-url ${rpcUrl}`);
    }

    process.exit(0);
  }

  console.log(`Deploying SilentCircle to ${deployCluster} through ${runner.label}...`);
  runCommand(runner.command, runner.args, runner.env);

  const programId = readProgramIdFromKeypair();
  const configureArgs = [
    configureEnvScriptPath,
    "--program-id",
    programId,
    "--output-env-file",
    outputEnvFile,
  ];

  if (rpcUrl) {
    configureArgs.push("--rpc-url", rpcUrl);
  }

  if (psiComputationPubkey) {
    configureArgs.push("--psi-computation-pubkey", psiComputationPubkey);
  }

  if (mxePubkey) {
    configureArgs.push("--mxe-pubkey", mxePubkey);
  }

  runCommand(process.execPath, configureArgs);

  console.log("");
  console.log(`Deployed program ID: ${programId}`);
  console.log(`Updated env file: ${path.relative(workspaceRoot, path.resolve(workspaceRoot, outputEnvFile)) || path.basename(outputEnvFile)}`);
  console.log("Restart the Vite dev server before testing on-chain create/join flows.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  usage();
  process.exit(1);
}