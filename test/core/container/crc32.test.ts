import { describe, it, expect } from "vitest";
import { crc32, encodeHeader, encodeObject, bytesToHex, u32be, readU32be } from "../../../src/core/container/index.js";

const ascii = (s: string) => new TextEncoder().encode(s);

describe("crc32 (IEEE 802.3, as used by PNG and zlib)", () => {
  it("matches the standard check values", () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000);
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
    expect(crc32(ascii("a"))).toBe(0xe8b7be43);
    expect(crc32(ascii("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("matches the CRC of a PNG IEND chunk", () => {
    // Every PNG file ends with the chunk type IEND and this CRC.
    expect(crc32(ascii("IEND"))).toBe(0xae426082);
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const input of ["", "a", "abc", "ÿ".repeat(100)]) {
      const c = crc32(ascii(input));
      expect(Number.isInteger(c) && c >= 0 && c <= 0xffffffff).toBe(true);
    }
  });
});

describe("header and object framing", () => {
  it("encodes the header of the worked example", () => {
    expect(bytesToHex(encodeHeader())).toBe("0x894e4f54410d0a1a0a0101003ac55944");
    expect(encodeHeader()).toHaveLength(16);
  });

  it("frames an object as type, number, length, payload, crc", () => {
    const payload = ascii("{}");
    const object = encodeObject("META", 2, payload);
    expect(object).toHaveLength(payload.length + 16);
    expect(new TextDecoder().decode(object.subarray(0, 4))).toBe("META");
    expect(readU32be(object, 4)).toBe(2);
    expect(readU32be(object, 8)).toBe(2);
    expect(readU32be(object, 14)).toBe(crc32(object.subarray(0, 14)));
  });

  it("writes integers big-endian and refuses values that do not fit", () => {
    expect(Array.from(u32be(0x01020304))).toEqual([1, 2, 3, 4]);
    expect(readU32be(u32be(0xffffffff), 0)).toBe(0xffffffff);
    expect(() => u32be(-1)).toThrow(RangeError);
    expect(() => u32be(2 ** 32)).toThrow(RangeError);
    expect(() => u32be(1.5)).toThrow(RangeError);
    expect(() => encodeObject("TOOLONG", 1, payloadOf(0))).toThrow(RangeError);
  });
});

function payloadOf(n: number): Uint8Array {
  return new Uint8Array(n);
}
