export { computeResourceIdHash } from "./hash.js";
export {
  NOTA_EIP712_TYPES,
  NOTA_EIP712_PRIMARY_TYPE,
  NOTA_EIP712_TYPE_STRING,
  NOTA_EIP712_TYPE_HASH,
  notaDomain,
  notaDomainSeparator,
  hashNotaStruct,
  computeNotaId,
  signNotaContent,
  recoverNotaSigner,
  verifyNotaSignature,
  checkEcdsaSignature,
} from "./eip712.js";
export type { NotaTypedDataSigner } from "./eip712.js";
