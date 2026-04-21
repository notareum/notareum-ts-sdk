/**
 * Custom error classes for the @notareum/core library.
 */

export class NotaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotaParseError";
  }
}

export class NotaValidationError extends Error {
  public readonly field: string;
  constructor(field: string, message: string) {
    super(`[${field}] ${message}`);
    this.name = "NotaValidationError";
    this.field = field;
  }
}

export class NotaSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotaSignatureError";
  }
}

export class NotaHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotaHashError";
  }
}

export class QuorumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuorumError";
  }
}

export class StakingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StakingError";
  }
}

export class ResourceIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceIdError";
  }
}
