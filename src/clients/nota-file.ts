/**
 * NotaFileClient -- `.nota` files, v1.1.
 *
 * A v1.1 `.nota` file is a binary container that exists only once its content
 * has been minted through the registry. This client walks the mint flow
 * (compose, preflight, sign as EIP-712 typed data, mint, write the container
 * from the `NotaMinted` event) and reads files back under the reader trust
 * rules. Legacy v1.0 JSON documents can be imported as drafts.
 *
 * Everything that touches bytes is the vendored reference implementation in
 * `../core`; this class adds the registry.
 *
 * @license MIT
 * @author Notareum Labs
 */

import type { Signer } from "ethers";
import {
  NotaConformanceError,
  ResourceType,
  composeNotaDraft,
  computeNotaResourceId,
  importLegacyNota,
  isLegacyNotaDocument,
  readNota,
  signNotaContent,
} from "../core/index.js";
import type {
  LegacyImport,
  LegacyImportOptions,
  NotaContent,
  NotaDraft,
  NotaDraftInput,
  NotaFile,
  NotaSignature,
  ReadNotaOptions,
  RegistryDeployment,
} from "../core/index.js";
import {
  ConfigurationError,
  ConformanceFailedError,
  SignerRequiredError,
  UntrustedRegistryError,
} from "../errors.js";
import { notaTypedData, signatureFromWallet } from "../mint.js";
import type { NotaTypedData } from "../mint.js";
import { deriveNotaStanding } from "../standing.js";
import type { NotaStanding } from "../standing.js";
import type { CreateNotaOptions, MintResult } from "../types.js";
import type { MintOptions, RegistryClient } from "./registry.js";

export interface NotaFileClientOptions {
  /** Signs content as the issuer and submits mints. */
  signer?: Signer;
  /** Registry deployments this reader trusts besides the configured one. */
  trustedRegistries?: readonly RegistryDeployment[];
}

/** A file together with the state a reader may present for it. */
export interface NotaVerification {
  file: NotaFile;
  standing: NotaStanding;
}

function isFlatInput(input: CreateNotaOptions | NotaDraftInput): input is CreateNotaOptions {
  return !("chain" in input) || !("resource" in input);
}

export class NotaFileClient {
  private readonly registry: RegistryClient | undefined;
  private readonly signer: Signer | undefined;
  private readonly trustedRegistries: readonly RegistryDeployment[];

  /**
   * @param registry - The registry client. Without it the client still
   *   composes drafts and reads files offline, but cannot mint or confirm.
   */
  constructor(registry?: RegistryClient, options: NotaFileClientOptions = {}) {
    this.registry = registry;
    this.signer = options.signer;
    this.trustedRegistries = options.trustedRegistries ?? [];
  }

  private requireRegistry(method: string): RegistryClient {
    if (!this.registry) {
      throw new ConfigurationError(`NotaFileClient.${method}() needs a RegistryClient: it talks to the registry.`);
    }
    return this.registry;
  }

  // -------------------------------------------------------------------------
  // Mint flow
  // -------------------------------------------------------------------------

  /**
   * Step 1, compose: builds the content layer and canonical metadata, and
   * checks them against every gate rule that can be decided locally.
   *
   * With a registry configured, two members are filled in when left out:
   * `issuedAt` from the registry chain's clock, and `supersedes` from the
   * issuer's current file for the resource (the gate requires a successor to
   * name it). The issuer defaults to the configured signer.
   *
   * The result is a draft. A draft is not a `.nota` file and must not be
   * saved or shared with the `.nota` extension.
   *
   * @throws NotaConformanceError naming the rule and member that does not conform.
   */
  async compose(input: CreateNotaOptions | NotaDraftInput): Promise<NotaDraft> {
    const draftInput = await this.normalize(input);
    if (this.registry) {
      if (draftInput.issuedAt === undefined) draftInput.issuedAt = await this.registry.chainTime();
      if (draftInput.supersedes === undefined) {
        let resourceId: string | undefined;
        try {
          resourceId = computeNotaResourceId({
            type: draftInput.type,
            chain: { name: draftInput.chain.name, chainId: draftInput.chain.chainId, network: "" },
            resource: { identifier: draftInput.resource.identifier, name: "", alias: "", description: "" },
          });
        } catch {
          // An unknown type or a malformed identifier is reported by composeNotaDraft below, with its rule.
        }
        // A malformed issuer address is likewise left for composeNotaDraft to report.
        const account = draftInput.issuer.account;
        if (resourceId !== undefined && /^0x[0-9a-fA-F]{40}$/.test(account)) {
          draftInput.supersedes = await this.registry.headOf(resourceId, account.toLowerCase());
        }
      }
    }
    return composeNotaDraft(draftInput);
  }

  private async normalize(input: CreateNotaOptions | NotaDraftInput): Promise<NotaDraftInput> {
    if (!isFlatInput(input)) {
      return { ...input, chain: { ...input.chain }, resource: { ...input.resource }, issuer: { ...input.issuer } };
    }
    let account = input.issuer;
    if (account === undefined) {
      if (!this.signer) {
        throw new ConfigurationError("Give the issuer account, or configure a signer to act as the issuer.");
      }
      account = await this.signer.getAddress();
    }
    return {
      type: input.type,
      chain: { name: input.chainName, chainId: input.chainId, network: input.network },
      resource: {
        identifier: input.identifier,
        name: input.name,
        alias: input.alias,
        description: input.description,
      },
      issuer: { account, name: input.issuerName, entityType: input.issuerEntityType },
      metadata: input.metadata,
      supersedes: input.supersedes,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };
  }

  /**
   * The EIP-712 request for step 3, for wallets this SDK does not drive
   * (`eth_signTypedData_v4`, wagmi, viem). The digest of the request is the
   * file's `notaId`.
   */
  async typedData(draft: NotaDraft | NotaContent): Promise<NotaTypedData> {
    const content = "content" in draft ? draft.content : draft;
    return notaTypedData(content, await this.requireRegistry("typedData").deployment());
  }

  /**
   * Turns the signature a wallet returned for {@link typedData} into a `SIGN`
   * payload, checking that it is the issuer's.
   */
  async signatureFromWallet(rawSignature: string, draft: NotaDraft | NotaContent): Promise<NotaSignature> {
    const registry = this.requireRegistry("signatureFromWallet");
    const content = "content" in draft ? draft.content : draft;
    return signatureFromWallet(
      rawSignature,
      content,
      await registry.deployment(),
      await registry.isContractAccount(content.issuer.account)
    );
  }

  /**
   * Step 3, sign: the issuer signs the content as EIP-712 typed data with an
   * ethers signer. The signer must be `issuer.account`.
   *
   * This signs as an externally owned account. For a contract account, obtain
   * the ERC-1271 signature from the account and pass it to {@link mint}.
   *
   * @throws NotaSignatureError if signing fails or the signer is not the issuer.
   */
  async sign(draft: NotaDraft | NotaContent, signer?: Signer): Promise<NotaSignature> {
    const registry = this.requireRegistry("sign");
    const using = signer ?? this.signer;
    if (!using) throw new SignerRequiredError("sign");
    const content = "content" in draft ? draft.content : draft;
    return signNotaContent(content, await registry.deployment(), using);
  }

  /**
   * Steps 4 to 7: submits the mint, waits for it to be final, and writes the
   * `.nota` file from the `NotaMinted` event.
   *
   * When `signature` is omitted the configured signer signs as the issuer.
   * The configured signer submits and pays the fees either way; it need not
   * be the issuer when a signature is supplied (relayed minting).
   */
  async mint(draft: NotaDraft, signature?: NotaSignature | string, options?: MintOptions): Promise<MintResult> {
    const registry = this.requireRegistry("mint");
    return registry.mint(draft, signature ?? (await this.sign(draft)), options);
  }

  /**
   * The whole mint flow in one call: compose, preflight, sign, mint, write.
   * The configured signer is the issuer and the submitter.
   *
   * @throws NotaConformanceError or ConformanceFailedError if the content is
   *   refused, before anything is signed.
   */
  async create(input: CreateNotaOptions | NotaDraftInput, options?: MintOptions): Promise<MintResult> {
    const registry = this.requireRegistry("create");
    if (!this.signer) throw new SignerRequiredError("create");
    const draft = await this.compose(input);
    const preflight = await registry.check(draft);
    if (!preflight.readyToSign) {
      throw new ConformanceFailedError(preflight.rule ?? 0, preflight.message ?? "the content was refused");
    }
    return registry.mint(draft, await this.sign(draft), options);
  }

  /**
   * Step 7 on its own: writes the `.nota` file of a mint transaction that was
   * sent by something other than this SDK, once it has enough confirmations.
   */
  async fromTransaction(
    transactionHash: string,
    options?: MintOptions & { notaId?: string }
  ): Promise<MintResult> {
    return this.requireRegistry("fromTransaction").mintedFromTransaction(transactionHash, options);
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * Reads a `.nota` file offline (trust rules 1 to 3, and rule 4 against
   * `options.trustedRegistries` when given). There is no lenient mode.
   *
   * The result is the Unconfirmed state: well formed, internally consistent
   * and signed by `issuer.account`. It does not show that the file was
   * minted. Use {@link verify} to establish that.
   *
   * @throws NotaContainerError or NotaConformanceError if the file is invalid.
   */
  read(file: Uint8Array, options?: ReadNotaOptions): NotaFile {
    return readNota(file, options);
  }

  /**
   * Reads a file against this client's pinned registries: the configured
   * deployment and any `trustedRegistries`.
   *
   * @throws UntrustedRegistryError if the file names any other registry.
   */
  async open(file: Uint8Array): Promise<NotaFile> {
    const pinned = [...this.trustedRegistries];
    if (this.registry) pinned.unshift(await this.registry.deployment());
    try {
      return readNota(file, { trustedRegistries: pinned });
    } catch (err) {
      if (err instanceof NotaConformanceError && err.rule === "REGISTRY" && err.field === "RCPT.registry") {
        throw new UntrustedRegistryError(readNota(file).receipt.registry);
      }
      throw err;
    }
  }

  /**
   * Reads a file and establishes the state a reader may present for it, by
   * all five trust rules: strict parse, recomputation, signature, pinned
   * registry, and the on-chain record.
   *
   * An invalid file throws, as in {@link read}. Otherwise `standing.state` is
   * `registered`, `socially-verified` or `warning` when the registry
   * confirmed the file; `invalid` when the registry has no matching record
   * (a fabricated receipt); and `unconfirmed` when the registry could not be
   * reached, in which case `standing.notes` says why.
   */
  async verify(file: Uint8Array): Promise<NotaVerification> {
    const registry = this.requireRegistry("verify");
    const nota = await this.open(file);
    const deployment = await registry.deployment();
    const sameRegistry =
      nota.receipt.registry.chainId === deployment.chainId &&
      nota.receipt.registry.address.toLowerCase() === deployment.address.toLowerCase();
    if (!sameRegistry) {
      const standing = deriveNotaStanding(nota);
      standing.notes.push(
        "The file was minted on another trusted registry. Confirm it with a client configured for that deployment."
      );
      return { file: nota, standing };
    }
    try {
      const [record, canonical, now] = await Promise.all([
        registry.getNota(nota.notaId),
        registry.canonicalOf(nota.resourceId),
        registry.chainTime(),
      ]);
      return { file: nota, standing: deriveNotaStanding(nota, { record, canonical, now }) };
    } catch (err) {
      const standing = deriveNotaStanding(nota);
      standing.notes.push(
        `The registry could not be reached: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`
      );
      return { file: nota, standing };
    }
  }

  // -------------------------------------------------------------------------
  // Legacy v1.0 documents
  // -------------------------------------------------------------------------

  /** True when the bytes start with `{`: a v1.0 JSON document, not a v1.1 file. */
  isLegacy(file: Uint8Array | string): boolean {
    return isLegacyNotaDocument(file);
  }

  /**
   * Imports a v1.0 JSON document as a v1.1 draft: its fields are mapped onto
   * the content layer, and its `verification` block, signature and
   * `issuer.verified` are dropped. The draft is not signed and not minted; a
   * v1.0 document must never be presented as registered or verified.
   *
   * `issues` lists what stops the draft from being minted as it stands, and
   * `notes` what was changed while mapping. Review both, then `compose` and
   * mint the draft's content like any other.
   *
   * @throws NotaParseError if the input is not a v1.0 JSON document.
   */
  importLegacy(document: string | Uint8Array, options?: LegacyImportOptions): LegacyImport {
    return importLegacyNota(document, options);
  }

  /** Well-known resource type constants. */
  readonly ResourceType = ResourceType;
}
