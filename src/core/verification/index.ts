export { VerificationLevel, AttestationResult, QUORUM_CONFIGS } from "./types.js";
export type { QuorumConfig } from "./types.js";
export {
  getQuorumConfig,
  isQuorumReached,
  resolveQuorum,
  minApprovalsToPass,
} from "./quorum.js";
