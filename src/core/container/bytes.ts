/**
 * Byte helpers for the container. All integers are unsigned and big-endian.
 */

/** Encodes an unsigned 32-bit integer, big-endian. */
export function u32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`not an unsigned 32-bit integer: ${value}`);
  }
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  );
}

/** Reads an unsigned 32-bit big-endian integer. The caller checks bounds. */
export function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Encodes an ASCII string, one byte per character. */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) throw new RangeError(`not ASCII: ${JSON.stringify(text)}`);
    out[i] = c;
  }
  return out;
}

/** Reads `length` bytes as Latin-1 characters. Used for four-letter type tags. */
export function latin1String(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

/** Concatenates byte arrays into a new array. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** True when `bytes[offset ...]` starts with `expected`. */
export function bytesMatch(
  bytes: Uint8Array,
  offset: number,
  expected: ArrayLike<number>
): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

/** Lowercase `0x`-prefixed hex of `bytes`. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Decodes `0x`-prefixed hex with an even number of digits. */
export function hexToBytes(hex: string): Uint8Array {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new RangeError("not a 0x-prefixed hex string with an even number of digits");
  }
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return out;
}
