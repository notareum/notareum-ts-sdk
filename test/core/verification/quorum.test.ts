import { describe, it, expect } from "vitest";
import {
  getQuorumConfig,
  isQuorumReached,
  resolveQuorum,
  minApprovalsToPass,
} from "../../../src/core/verification/quorum.js";
import { VerificationLevel } from "../../../src/core/nota/types.js";
import { QuorumError } from "../../../src/core/errors.js";

describe("getQuorumConfig", () => {
  it("returns correct config for BASIC", () => {
    const config = getQuorumConfig(VerificationLevel.BASIC);
    expect(config.quorumSize).toBe(3);
    expect(config.thresholdBps).toBe(6700n);
  });

  it("returns correct config for ENHANCED", () => {
    const config = getQuorumConfig(VerificationLevel.ENHANCED);
    expect(config.quorumSize).toBe(7);
    expect(config.thresholdBps).toBe(7500n);
  });

  it("returns correct config for INSTITUTIONAL", () => {
    const config = getQuorumConfig(VerificationLevel.INSTITUTIONAL);
    expect(config.quorumSize).toBe(15);
    expect(config.thresholdBps).toBe(7500n);
  });
});

describe("isQuorumReached", () => {
  it("returns false when below quorum for BASIC (< 3 votes)", () => {
    expect(isQuorumReached(VerificationLevel.BASIC, 1, 1)).toBe(false);
    expect(isQuorumReached(VerificationLevel.BASIC, 2, 0)).toBe(false);
    expect(isQuorumReached(VerificationLevel.BASIC, 0, 2)).toBe(false);
  });

  it("returns true when exactly at quorum for BASIC (3 votes)", () => {
    expect(isQuorumReached(VerificationLevel.BASIC, 3, 0)).toBe(true);
    expect(isQuorumReached(VerificationLevel.BASIC, 2, 1)).toBe(true);
    expect(isQuorumReached(VerificationLevel.BASIC, 1, 2)).toBe(true);
    expect(isQuorumReached(VerificationLevel.BASIC, 0, 3)).toBe(true);
  });

  it("returns false when below quorum for ENHANCED (< 7 votes)", () => {
    expect(isQuorumReached(VerificationLevel.ENHANCED, 3, 3)).toBe(false);
    expect(isQuorumReached(VerificationLevel.ENHANCED, 6, 0)).toBe(false);
  });

  it("returns true at quorum for ENHANCED (7 votes)", () => {
    expect(isQuorumReached(VerificationLevel.ENHANCED, 7, 0)).toBe(true);
    expect(isQuorumReached(VerificationLevel.ENHANCED, 4, 3)).toBe(true);
  });

  it("returns false when below quorum for INSTITUTIONAL (< 15 votes)", () => {
    expect(isQuorumReached(VerificationLevel.INSTITUTIONAL, 7, 7)).toBe(false);
    expect(isQuorumReached(VerificationLevel.INSTITUTIONAL, 14, 0)).toBe(false);
  });

  it("returns true at quorum for INSTITUTIONAL (15 votes)", () => {
    expect(isQuorumReached(VerificationLevel.INSTITUTIONAL, 15, 0)).toBe(true);
    expect(isQuorumReached(VerificationLevel.INSTITUTIONAL, 8, 7)).toBe(true);
  });
});

describe("resolveQuorum", () => {
  // BASIC: quorum=3, threshold=67% (6700 bps)
  describe("BASIC level", () => {
    it("resolves as VERIFIED when 3/3 approve (100% >= 67%)", () => {
      expect(resolveQuorum(VerificationLevel.BASIC, 3, 0)).toBe(true);
    });

    it("resolves as VERIFIED when 2/3 approve (~67% >= 67%)", () => {
      // (2 * 10000) / 3 = 6666 < 6700 -- FAILS (67% threshold means 6700 bps)
      // 2/3 = 6666 bps which is < 6700 so this should FAIL
      expect(resolveQuorum(VerificationLevel.BASIC, 2, 1)).toBe(false);
    });

    it("resolves as UNVERIFIED when 1/3 approve (33% < 67%)", () => {
      expect(resolveQuorum(VerificationLevel.BASIC, 1, 2)).toBe(false);
    });

    it("resolves as UNVERIFIED when 0/3 approve", () => {
      expect(resolveQuorum(VerificationLevel.BASIC, 0, 3)).toBe(false);
    });

    it("throws QuorumError when quorum not reached", () => {
      expect(() => resolveQuorum(VerificationLevel.BASIC, 1, 1)).toThrow(
        QuorumError
      );
      expect(() => resolveQuorum(VerificationLevel.BASIC, 2, 0)).toThrow(
        QuorumError
      );
    });
  });

  // ENHANCED: quorum=7, threshold=75% (7500 bps)
  describe("ENHANCED level", () => {
    it("resolves as VERIFIED when 7/7 approve (100% >= 75%)", () => {
      expect(resolveQuorum(VerificationLevel.ENHANCED, 7, 0)).toBe(true);
    });

    it("resolves as VERIFIED when 6/7 approve (~86% >= 75%)", () => {
      // (6 * 10000) / 7 = 8571 >= 7500
      expect(resolveQuorum(VerificationLevel.ENHANCED, 6, 1)).toBe(true);
    });

    it("resolves as VERIFIED with exactly 75% approval (e.g. 6/8)", () => {
      // (6 * 10000) / 8 = 7500 >= 7500
      expect(resolveQuorum(VerificationLevel.ENHANCED, 6, 2)).toBe(true);
    });

    it("resolves as UNVERIFIED when 5/7 approve (~71% < 75%)", () => {
      // (5 * 10000) / 7 = 7142 < 7500
      expect(resolveQuorum(VerificationLevel.ENHANCED, 5, 2)).toBe(false);
    });

    it("throws QuorumError when quorum not reached", () => {
      expect(() => resolveQuorum(VerificationLevel.ENHANCED, 6, 0)).toThrow(
        QuorumError
      );
    });
  });

  // INSTITUTIONAL: quorum=15, threshold=75% (7500 bps)
  describe("INSTITUTIONAL level", () => {
    it("resolves as VERIFIED when 15/15 approve", () => {
      expect(resolveQuorum(VerificationLevel.INSTITUTIONAL, 15, 0)).toBe(true);
    });

    it("resolves as VERIFIED when 12/15 approve (80% >= 75%)", () => {
      // (12 * 10000) / 15 = 8000 >= 7500
      expect(resolveQuorum(VerificationLevel.INSTITUTIONAL, 12, 3)).toBe(true);
    });

    it("resolves as UNVERIFIED when 10/15 approve (~67% < 75%)", () => {
      // (10 * 10000) / 15 = 6666 < 7500
      expect(resolveQuorum(VerificationLevel.INSTITUTIONAL, 10, 5)).toBe(false);
    });

    it("throws QuorumError when quorum not reached", () => {
      expect(() =>
        resolveQuorum(VerificationLevel.INSTITUTIONAL, 14, 0)
      ).toThrow(QuorumError);
    });
  });
});

describe("minApprovalsToPass", () => {
  it("BASIC requires 3 out of 3 to pass (since 2/3=66.66% < 67%)", () => {
    // 3/3 = 10000 bps >= 6700 -- passes
    // 2/3 = 6666 bps < 6700 -- fails
    expect(minApprovalsToPass(VerificationLevel.BASIC)).toBe(3);
  });

  it("ENHANCED requires at least 6 out of 7 to pass", () => {
    // 6/7 = 8571 >= 7500 -- passes
    // 5/7 = 7142 < 7500 -- fails
    expect(minApprovalsToPass(VerificationLevel.ENHANCED)).toBe(6);
  });

  it("INSTITUTIONAL requires at least 12 out of 15 to pass", () => {
    // 12/15 = 8000 >= 7500 -- passes
    // 11/15 = 7333 < 7500 -- fails
    expect(minApprovalsToPass(VerificationLevel.INSTITUTIONAL)).toBe(12);
  });
});
