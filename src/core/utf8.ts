/**
 * Strict UTF-8 encoding and decoding.
 *
 * The platform TextDecoder substitutes U+FFFD for malformed input (or, in
 * fatal mode, strips a byte order mark by default). A `.nota` reader must do
 * neither: Content Safety Rule T1 refuses overlong encodings, surrogates and
 * anything above U+10FFFF, and canonical JSON forbids a byte order mark. This
 * decoder reports the first malformed sequence instead of repairing it.
 */

/** Malformed UTF-8, or a string that has no UTF-8 encoding (a lone surrogate). */
export class Utf8Error extends Error {
  /** Byte offset (decoding) or UTF-16 code unit index (encoding) of the fault. */
  public readonly index: number;
  constructor(message: string, index: number) {
    super(message);
    this.name = "Utf8Error";
    this.index = index;
  }
}

/**
 * Decodes UTF-8 with no repair and no byte order mark handling.
 *
 * @throws Utf8Error on overlong encodings, surrogates, code points above
 *   U+10FFFF, stray continuation bytes, and truncated sequences.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const n = bytes.length;
  const units: number[] = [];
  let out = "";
  let i = 0;
  while (i < n) {
    const b0 = bytes[i];
    let cp: number;
    let len: number;
    if (b0 < 0x80) {
      cp = b0;
      len = 1;
    } else if (b0 < 0xc0) {
      throw new Utf8Error(`stray continuation byte 0x${hex2(b0)}`, i);
    } else if (b0 < 0xc2) {
      throw new Utf8Error(`overlong encoding (lead byte 0x${hex2(b0)})`, i);
    } else if (b0 < 0xe0) {
      cp = b0 & 0x1f;
      len = 2;
    } else if (b0 < 0xf0) {
      cp = b0 & 0x0f;
      len = 3;
    } else if (b0 < 0xf5) {
      cp = b0 & 0x07;
      len = 4;
    } else {
      throw new Utf8Error(`lead byte 0x${hex2(b0)} encodes a value above U+10FFFF`, i);
    }
    if (i + len > n) {
      throw new Utf8Error("truncated multi-byte sequence", i);
    }
    for (let k = 1; k < len; k++) {
      const b = bytes[i + k];
      if ((b & 0xc0) !== 0x80) {
        throw new Utf8Error(`invalid continuation byte 0x${hex2(b)}`, i + k);
      }
      cp = (cp << 6) | (b & 0x3f);
    }
    if (len === 3) {
      if (cp < 0x800) throw new Utf8Error("overlong encoding", i);
      if (cp >= 0xd800 && cp <= 0xdfff) {
        throw new Utf8Error(`encoded surrogate U+${cp.toString(16).toUpperCase()}`, i);
      }
    } else if (len === 4) {
      if (cp < 0x10000) throw new Utf8Error("overlong encoding", i);
      if (cp > 0x10ffff) throw new Utf8Error("code point above U+10FFFF", i);
    }
    if (cp < 0x10000) {
      units.push(cp);
    } else {
      const v = cp - 0x10000;
      units.push(0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff));
    }
    if (units.length >= 4096) {
      out += String.fromCharCode(...units);
      units.length = 0;
    }
    i += len;
  }
  if (units.length > 0) out += String.fromCharCode(...units);
  return out;
}

/** Index of the first lone surrogate in `text`, or -1 if the string is well formed. */
export function findLoneSurrogate(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return i;
    }
    if (u >= 0xdc00 && u <= 0xdfff) return i;
  }
  return -1;
}

/**
 * Encodes a string as UTF-8.
 *
 * @throws Utf8Error if the string contains a lone surrogate, which the
 *   platform encoder would silently replace with U+FFFD.
 */
export function encodeUtf8(text: string): Uint8Array {
  const bad = findLoneSurrogate(text);
  if (bad >= 0) {
    throw new Utf8Error("string contains a lone surrogate", bad);
  }
  return new TextEncoder().encode(text);
}

/** Length of `text` in UTF-8 bytes. Lone surrogates count as three bytes. */
export function utf8ByteLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    if (u < 0x80) n += 1;
    else if (u < 0x800) n += 2;
    else if (u >= 0xd800 && u <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else n += 3;
  }
  return n;
}

function hex2(b: number): string {
  return b.toString(16).padStart(2, "0");
}
