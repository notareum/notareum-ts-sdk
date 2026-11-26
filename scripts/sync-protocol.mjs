#!/usr/bin/env node
/**
 * Refreshes what this SDK vendors from its sibling repositories:
 *
 *   core  src/core/   <- core/src/           the @notareum/core reference implementation
 *         test/core/  <- core/test/          its tests, with import paths rewritten
 *                     <- protocol/v1.1/examples/*.nota   the spec's two sample files
 *   abi   src/abi/    <- contracts/artifacts/            run `npx hardhat compile` there first
 *
 * Usage: node scripts/sync-protocol.mjs [core] [abi]      (both when no argument is given)
 *
 * The sibling checkouts are expected next to this repository. Override with
 * NOTAREUM_CORE_DIR, NOTAREUM_CONTRACTS_DIR and NOTAREUM_PROTOCOL_DIR.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = resolve(process.env.NOTAREUM_CORE_DIR ?? join(root, "../core"));
const CONTRACTS = resolve(process.env.NOTAREUM_CONTRACTS_DIR ?? join(root, "../contracts"));
const PROTOCOL = resolve(process.env.NOTAREUM_PROTOCOL_DIR ?? join(root, "../protocol"));

/** Contracts whose ABI the SDK ships, in the order of src/abi/index.ts. */
const CONTRACT_NAMES = [
  "NotareumNotaRegistry",
  "NotareumConformanceGate",
  "NotareumVerificationEngine",
  "NotareumValidatorStaking",
  "NotareumSlashingManager",
  "NotareumFeeManager",
  "NotareumNOTAToken",
  "NotareumVeNOTA",
  "NotareumAccessManager",
];

const EXAMPLE_FILES = ["address-registered.nota", "address-verified.nota"];

function requireDir(path, what) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${what} not found at ${path}`);
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const skipJunk = (source) => !source.endsWith(".DS_Store");

/** Replaces `from` with `to`, and fails when `from` is absent so that drift in core is noticed. */
function replaceRequired(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`${file}: expected to find ${JSON.stringify(from)}`);
  return text.split(from).join(to);
}

function syncCore() {
  requireDir(join(CORE, "src"), "core/src");
  requireDir(join(CORE, "test"), "core/test");
  requireDir(join(PROTOCOL, "v1.1/examples"), "protocol/v1.1/examples");

  const srcOut = join(root, "src/core");
  rmSync(srcOut, { recursive: true, force: true });
  cpSync(join(CORE, "src"), srcOut, { recursive: true, filter: skipJunk });

  const testOut = join(root, "test/core");
  rmSync(testOut, { recursive: true, force: true });
  cpSync(join(CORE, "test"), testOut, { recursive: true, filter: skipJunk });

  // core's tests import "../src/..." (or "../../src/..."); here the source is two levels further away.
  for (const file of walk(testOut).filter((f) => f.endsWith(".ts"))) {
    const depth = relative(testOut, dirname(file)).split(/[\\/]/).filter(Boolean).length;
    const from = `"${"../".repeat(depth + 1)}src/`;
    const to = `"${"../".repeat(depth + 2)}src/core/`;
    let text = readFileSync(file, "utf8").split(from).join(to);
    if (file === join(testOut, "fixtures.ts")) {
      // The spec examples are vendored next to the tests instead of read from a sibling checkout.
      text = replaceRequired(text, 'resolve(here, "../../protocol/v1.1/examples")', 'resolve(here, "./examples")', file);
    }
    writeFileSync(file, text);
  }

  const examplesOut = join(testOut, "examples");
  mkdirSync(examplesOut, { recursive: true });
  for (const name of EXAMPLE_FILES) {
    cpSync(join(PROTOCOL, "v1.1/examples", name), join(examplesOut, name));
  }

  console.log(`core: ${walk(srcOut).length} source files, ${walk(testOut).length} test files`);
}

function syncAbi() {
  const artifacts = join(CONTRACTS, "artifacts/contracts");
  requireDir(artifacts, "contracts/artifacts/contracts (run `npx hardhat compile` in contracts/)");

  const out = join(root, "src/abi");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const name of CONTRACT_NAMES) {
    const artifactPath = join(artifacts, `${name}.sol/${name}.json`);
    if (!existsSync(artifactPath)) throw new Error(`artifact not found: ${artifactPath}`);
    const { abi } = JSON.parse(readFileSync(artifactPath, "utf8"));
    writeFileSync(join(out, `${name}.ts`), `export const ${name}ABI = ${JSON.stringify(abi, null, 2)} as const;\n`);
  }
  writeFileSync(
    join(out, "index.ts"),
    CONTRACT_NAMES.map((name) => `export { ${name}ABI } from "./${name}.js";`).join("\n") + "\n"
  );

  console.log(`abi: ${CONTRACT_NAMES.length} contracts`);
}

const requested = process.argv.slice(2);
const targets = requested.length === 0 ? ["core", "abi"] : requested;
for (const target of targets) {
  if (target === "core") syncCore();
  else if (target === "abi") syncAbi();
  else throw new Error(`unknown target "${target}": use "core" or "abi"`);
}
