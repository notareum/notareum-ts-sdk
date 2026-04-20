/**
 * SDK error classes for @notareum/sdk.
 */

/** Thrown when a signer is required but not provided. */
export class SignerRequiredError extends Error {
  constructor(method: string) {
    super(`Signer is required for write operation: ${method}`);
    this.name = "SignerRequiredError";
  }
}

/** Thrown when a contract call fails. */
export class ContractCallError extends Error {
  public readonly contractMethod: string;
  constructor(method: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Contract call failed [${method}]: ${msg}`);
    this.name = "ContractCallError";
    this.contractMethod = method;
  }
}

/** Thrown when an invalid configuration is provided. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Thrown when a resource is not found. */
export class ResourceNotFoundError extends Error {
  public readonly resourceId: string;
  constructor(resourceId: string) {
    super(`Resource not found: ${resourceId}`);
    this.name = "ResourceNotFoundError";
    this.resourceId = resourceId;
  }
}
