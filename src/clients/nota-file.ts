/**
 * NotaFileClient -- .nota file operations wrapping @notareum/core.
 *
 * @license BUSL-1.1
 * @author Notareum Labs
 */

import type { Signer } from "ethers";
import {
  buildUnsignedNota,
  parseNota,
  validateNota,
  serializeNota,
  isValidNota,
  ResourceType,
  resolveResourceTypeId,
} from "../core/index.js";
import type { NotaFile } from "../core/index.js";
import type { CreateNotaOptions } from "../types.js";

/** A .nota file builder with fluent chaining. */
export class NotaBuilder {
  private _unsigned: Omit<NotaFile, "signature">;
  private _signature?: NotaFile["signature"];

  constructor(unsigned: Omit<NotaFile, "signature">) {
    this._unsigned = unsigned;
  }

  /** Sign the .nota file with an ethers Signer. */
  async sign(signer: Signer): Promise<NotaBuilder> {
    const address = await signer.getAddress();
    const timestamp = Math.floor(Date.now() / 1000);
    const message = JSON.stringify({
      version: this._unsigned.version,
      resource: this._unsigned.resource,
      chain: this._unsigned.chain,
      type: this._unsigned.type,
      timestamp,
    });
    const sig = await signer.signMessage(message);
    this._signature = {
      algorithm: "ECDSA",
      curve: "secp256k1",
      address,
      message,
      signature: sig,
      timestamp,
    };
    return this;
  }

  /** Serialize to JSON string. */
  serialize(): string {
    return serializeNota(this.build());
  }

  /** Get the raw NotaFile object. */
  build(): NotaFile {
    if (!this._signature) {
      // Return unsigned with a placeholder signature for validation purposes
      return {
        ...this._unsigned,
        signature: {
          algorithm: "ECDSA",
          curve: "secp256k1",
          address: "",
          message: "",
          signature: "",
          timestamp: 0,
        },
      };
    }
    return { ...this._unsigned, signature: this._signature };
  }

  /** Validate the .nota file. Throws on error. */
  validate(): NotaBuilder {
    validateNota(this.build());
    return this;
  }
}

export class NotaFileClient {
  /**
   * Create a new .nota file builder.
   *
   * @example
   * const nota = ntm.nota
   *   .create({ type: "address", chainId: 1, chainName: "ethereum", identifier: "0x..." })
   *   .validate();
   * const signed = await nota.sign(signer);
   * signed.serialize();
   */
  create(options: CreateNotaOptions): NotaBuilder {
    const typeId = resolveResourceTypeId(options.type);
    if (typeId === undefined) {
      throw new Error(`Unknown resource type "${options.type}". Register via registerResourceType() if governance-added.`);
    }
    const nota = buildUnsignedNota({
      type: options.type,
      chainName: options.chainName,
      chainId: options.chainId,
      network: options.network,
      identifier: options.identifier,
      name: options.name,
      description: options.description,
      resourceMetadata: options.resourceMetadata,
      issuerName: options.issuerName,
      issuerEntityType: options.issuerEntityType,
    });
    return new NotaBuilder(nota);
  }

  /**
   * Parse a .nota JSON string into a NotaFile object.
   */
  parse(content: string): NotaFile {
    return parseNota(content);
  }

  /**
   * Validate a NotaFile. Throws NotaValidationError on failure.
   */
  validate(nota: NotaFile): void {
    validateNota(nota);
  }

  /**
   * Return true if the NotaFile is valid; false otherwise.
   */
  isValid(nota: NotaFile): boolean {
    return isValidNota(nota);
  }

  /**
   * Serialize a NotaFile to a JSON string.
   */
  serialize(nota: NotaFile): string {
    return serializeNota(nota);
  }

  /** Well-known resource type constants. */
  readonly ResourceType = ResourceType;
}
