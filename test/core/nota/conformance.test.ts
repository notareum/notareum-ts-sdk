/**
 * The local content validator: schema, field byte limits (G2), envelope (G1),
 * identifier grammar (G4), alias grammar (G5) and display strings (G6).
 */

import { describe, it, expect } from "vitest";
import { NotaConformanceError } from "../../../src/core/errors.js";
import {
  checkAlias,
  checkContent,
  checkDisplayString,
  checkIdentifier,
  composeNotaDraft,
  isConformingContent,
  isEip55Address,
  registerResourceType,
  validateContent,
} from "../../../src/core/nota/index.js";
import type { NotaContent } from "../../../src/core/nota/index.js";
import { ISSUER, ZERO32, exampleContent, plainContent } from "../fixtures.js";

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function rulesFor(content: unknown, field: string): string[] {
  return checkContent(content)
    .filter((i) => i.field === field)
    .map((i) => i.rule);
}

function mutate(change: (c: Loose) => void): Loose {
  const content = plainContent() as unknown as Loose;
  change(content);
  return content;
}

describe("checkContent: conforming content", () => {
  it("accepts the spec example", () => {
    expect(checkContent(exampleContent())).toEqual([]);
    expect(isConformingContent(exampleContent())).toBe(true);
    expect(() => validateContent(exampleContent())).not.toThrow();
  });

  it("accepts empty values for members that do not apply", () => {
    const content = mutate((c) => {
      c.resource.name = "";
      c.resource.alias = "";
      c.resource.description = "";
      c.issuer.name = "";
      c.issuer.entityType = "";
    });
    expect(checkContent(content)).toEqual([]);
  });
});

describe("schema: every member is required and nothing else is allowed", () => {
  it.each([
    "version",
    "type",
    "chain",
    "resource",
    "issuer",
    "metadataHash",
    "supersedes",
    "issuedAt",
    "expiresAt",
  ])("refuses content with no %s", (member) => {
    const content = mutate((c) => delete c[member]);
    expect(rulesFor(content, member)).toEqual(["SCHEMA"]);
  });

  it.each([
    ["chain", "name"],
    ["chain", "chainId"],
    ["chain", "network"],
    ["resource", "identifier"],
    ["resource", "name"],
    ["resource", "alias"],
    ["resource", "description"],
    ["issuer", "account"],
    ["issuer", "name"],
    ["issuer", "entityType"],
  ])("refuses content with no %s.%s", (parent, member) => {
    const content = mutate((c) => delete c[parent][member]);
    expect(rulesFor(content, `${parent}.${member}`)).toEqual(["SCHEMA"]);
  });

  it("refuses members the content layer does not define", () => {
    // An unknown member is outside the EIP-712 hash: unsigned data inside a signed object.
    expect(rulesFor(mutate((c) => (c.verification = { status: "verified" })), "verification")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.issuer.verified = true)), "issuer.verified")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.resource.metadata = {})), "resource.metadata")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.chain.rpc = "x")), "chain.rpc")).toEqual(["SCHEMA"]);
  });

  it("refuses the wrong JSON types", () => {
    expect(rulesFor(mutate((c) => (c.chain.chainId = "1")), "chain.chainId")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.chain.chainId = 1.5)), "chain.chainId")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.chain.chainId = -1)), "chain.chainId")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.chain.chainId = 2 ** 53)), "chain.chainId")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.issuedAt = "1795564800")), "issuedAt")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.expiresAt = null)), "expiresAt")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.resource.name = 7)), "resource.name")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.chain = "ethereum")), "chain")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.resource = [])), "resource")).toEqual(["SCHEMA"]);
    expect(checkContent(null)[0]).toMatchObject({ rule: "SCHEMA", field: "$" });
    expect(checkContent("{}")[0]).toMatchObject({ rule: "SCHEMA", field: "$" });
    expect(checkContent([])[0]).toMatchObject({ rule: "SCHEMA", field: "$" });
  });

  it("accepts chainId up to 2^53 - 1", () => {
    const content = mutate((c) => {
      c.chain.chainId = Number.MAX_SAFE_INTEGER;
    });
    expect(rulesFor(content, "chain.chainId")).toEqual([]);
  });

  it("requires an EIP-55 issuer account", () => {
    expect(rulesFor(mutate((c) => (c.issuer.account = ISSUER.toLowerCase())), "issuer.account")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.issuer.account = "0x1234")), "issuer.account")).toEqual(["SCHEMA"]);
  });

  it("requires lowercase 32-byte hashes", () => {
    const upper = "0x" + "AB".repeat(32);
    expect(rulesFor(mutate((c) => (c.metadataHash = upper)), "metadataHash")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.supersedes = "0x00")), "supersedes")).toEqual(["SCHEMA"]);
    expect(rulesFor(mutate((c) => (c.supersedes = "0x" + "ab".repeat(32))), "supersedes")).toEqual([]);
  });

  it("validateContent throws the first issue with its rule and member", () => {
    try {
      validateContent(mutate((c) => (c.chain.network = "production")));
      throw new Error("accepted");
    } catch (err) {
      expect(err).toBeInstanceOf(NotaConformanceError);
      expect(err).toMatchObject({ rule: "G1", field: "chain.network" });
    }
  });
});

describe("G1: envelope", () => {
  it("requires version 1.1", () => {
    expect(rulesFor(mutate((c) => (c.version = "1.0")), "version")).toEqual(["G1"]);
    expect(rulesFor(mutate((c) => (c.version = "1.10")), "version")).toEqual(["G1"]);
  });

  it("requires a registered resource type", () => {
    expect(rulesFor(mutate((c) => (c.type = "wallet")), "type")).toEqual(["G1"]);
    expect(rulesFor(mutate((c) => (c.type = "Address")), "type")).toEqual(["G1"]);
    expect(rulesFor(mutate((c) => (c.type = "")), "type")).toEqual(["G1"]);
  });

  it("requires chain.name to match [a-z0-9-]{1,32}", () => {
    for (const bad of ["", "Ethereum", "bnb chain", "ethereum_classic", "a".repeat(33)]) {
      expect(rulesFor(mutate((c) => (c.chain.name = bad)), "chain.name"), bad).toContain("G1");
    }
    for (const good of ["ethereum", "bnb-smart-chain", "base", "x1", "a".repeat(32)]) {
      expect(rulesFor(mutate((c) => (c.chain.name = good)), "chain.name"), good).toEqual([]);
    }
  });

  it("requires chain.network to be mainnet, testnet or devnet", () => {
    for (const good of ["mainnet", "testnet", "devnet"]) {
      expect(rulesFor(mutate((c) => (c.chain.network = good)), "chain.network")).toEqual([]);
    }
    for (const bad of ["", "Mainnet", "sepolia", "main"]) {
      expect(rulesFor(mutate((c) => (c.chain.network = bad)), "chain.network"), bad).toEqual(["G1"]);
    }
  });

  it("requires issuer.entityType to be empty, individual or organization", () => {
    for (const good of ["", "individual", "organization"]) {
      expect(rulesFor(mutate((c) => (c.issuer.entityType = good)), "issuer.entityType")).toEqual([]);
    }
    for (const bad of ["company", "Organization", "dao"]) {
      expect(rulesFor(mutate((c) => (c.issuer.entityType = bad)), "issuer.entityType"), bad).toEqual(["G1"]);
    }
  });
});

describe("G2: field byte limits", () => {
  // [member path, limit in UTF-8 bytes, a setter that keeps the value otherwise valid]
  const cases: [string, number, (c: Loose, bytes: number) => void][] = [
    ["resource.name", 64, (c, n) => (c.resource.name = "n".repeat(n))],
    ["resource.description", 512, (c, n) => (c.resource.description = "d".repeat(n))],
    ["issuer.name", 64, (c, n) => (c.issuer.name = "i".repeat(n))],
    [
      "resource.identifier",
      256,
      (c, n) => {
        c.type = "metadata";
        c.resource.identifier = "urn:" + "x".repeat(n - 4);
      },
    ],
  ];

  it.each(cases)("%s is limited to %i bytes", (field, limit, set) => {
    expect(rulesFor(mutate((c) => set(c, limit)), field)).toEqual([]);
    expect(rulesFor(mutate((c) => set(c, limit + 1)), field)).toEqual(["G2"]);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // 22 three-byte characters are 66 bytes: over the 64-byte limit at 22 characters.
    expect(rulesFor(mutate((c) => (c.resource.name = "日".repeat(21))), "resource.name")).toEqual([]);
    expect(rulesFor(mutate((c) => (c.resource.name = "日".repeat(22))), "resource.name")).toEqual(["G2"]);
    // 16 four-byte characters are exactly 64 bytes.
    expect(rulesFor(mutate((c) => (c.issuer.name = "😀".repeat(16))), "issuer.name")).toEqual([]);
    expect(rulesFor(mutate((c) => (c.issuer.name = "😀".repeat(17))), "issuer.name")).toEqual(["G2"]);
  });

  it("limits type, chain.name, chain.network and resource.alias", () => {
    expect(rulesFor(mutate((c) => (c.type = "t".repeat(33))), "type")).toContain("G2");
    expect(rulesFor(mutate((c) => (c.chain.name = "c".repeat(33))), "chain.name")).toContain("G2");
    expect(rulesFor(mutate((c) => (c.chain.network = "n".repeat(17))), "chain.network")).toContain("G2");
    expect(rulesFor(mutate((c) => (c.resource.alias = "a".repeat(64) + ".nota")), "resource.alias")).toContain("G2");
  });
});

describe("G4: identifier grammar per type", () => {
  const ok = (type: string, chainId: number, id: string) =>
    expect(checkIdentifier(type, chainId, id), `${type}/${chainId}/${id}`).toBeNull();
  const bad = (type: string, chainId: number, id: string) =>
    expect(checkIdentifier(type, chainId, id), `${type}/${chainId}/${id}`).not.toBeNull();

  const ADDR = ISSUER;
  const TX = "0x" + "ab".repeat(32);

  it.each(["address", "contract"])("%s on an EVM chain: an EIP-55 address", (type) => {
    ok(type, 1, ADDR);
    ok(type, 137, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    ok(type, 1, "0x0000000000000000000000000000000000001101"); // no letters: trivially checksummed
    bad(type, 1, ADDR.toLowerCase());
    bad(type, 1, "0x" + ADDR.slice(2).toUpperCase());
    bad(type, 1, ADDR.slice(0, -1) + (ADDR.endsWith("6") ? "7" : "6")); // one digit off
    bad(type, 1, "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266"); // one letter's case changed
    bad(type, 1, ADDR.slice(2));
    bad(type, 1, ADDR + "00");
    bad(type, 1, ADDR.slice(0, -2));
    bad(type, 1, "XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS"); // ICAP is not an identifier
    bad(type, 1, "vitalik.eth");
    bad(type, 1, "");
  });

  it("transaction on an EVM chain: 0x and 64 lowercase hex digits", () => {
    ok("transaction", 1, TX);
    bad("transaction", 1, "0x" + "AB".repeat(32));
    bad("transaction", 1, TX.slice(0, -2));
    bad("transaction", 1, TX + "ab");
    bad("transaction", 1, TX.slice(2));
    bad("transaction", 1, "");
  });

  it("nft on an EVM chain: an EIP-55 address, '/', and a decimal token ID", () => {
    ok("nft", 1, `${ADDR}/0`);
    ok("nft", 1, `${ADDR}/1`);
    ok("nft", 1, `${ADDR}/9007199254740993`);
    ok("nft", 1, `${ADDR}/${(2n ** 256n - 1n).toString()}`);
    bad("nft", 1, `${ADDR}/${(2n ** 256n).toString()}`);
    bad("nft", 1, `${ADDR}/01`); // leading zero
    bad("nft", 1, `${ADDR}/00`);
    bad("nft", 1, `${ADDR}/`);
    bad("nft", 1, `${ADDR}/0x1f`);
    bad("nft", 1, `${ADDR}/-1`);
    bad("nft", 1, `${ADDR}/1/2`);
    bad("nft", 1, `${ADDR}:1`);
    bad("nft", 1, ADDR);
    bad("nft", 1, `${ADDR.toLowerCase()}/1`);
  });

  it("ipfs on any chain: a bare CIDv0 or lowercase base32 CIDv1", () => {
    const v0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    const v1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    for (const chainId of [0, 1]) {
      ok("ipfs", chainId, v0);
      ok("ipfs", chainId, v1);
    }
    bad("ipfs", 1, "ipfs://" + v0); // the v1.0 prefix must not be used
    bad("ipfs", 1, "ipfs://" + v1);
    bad("ipfs", 1, v0.slice(0, -1)); // 43 characters after Qm
    bad("ipfs", 1, v0 + "a");
    bad("ipfs", 1, "Qm" + "0".repeat(44)); // 0 is not base58btc
    bad("ipfs", 1, "Qm" + "l".repeat(44)); // nor is l
    bad("ipfs", 1, v1.toUpperCase());
    bad("ipfs", 1, "bafy1"); // 1 is not base32
    bad("ipfs", 1, "b");
    bad("ipfs", 1, "zb2rhe5P4gXftAwvA4eXQ5HJwsER2owDyS9sKaQRRVQPn93bA"); // base58 CIDv1
    bad("ipfs", 1, "");
  });

  it("metadata on any chain: a URI of printable ASCII", () => {
    ok("metadata", 0, "https://example.com/credential.json");
    ok("metadata", 1, "urn:uuid:6e8bc430-9c3a-11d9-9669-0800200c9a66");
    ok("metadata", 1, "did:web:example.com");
    ok("metadata", 1, "x-custom+v1.2:anything~here");
    bad("metadata", 1, "HTTPS://example.com"); // scheme must be lowercase
    bad("metadata", 1, "1http://example.com"); // scheme must start with a letter
    bad("metadata", 1, "example.com/no-scheme");
    bad("metadata", 1, "https:"); // nothing after the colon
    bad("metadata", 1, "https://example.com/a b"); // space is not printable ASCII here
    bad("metadata", 1, "https://exämple.com");
    bad("metadata", 1, "");
  });

  it.each(["address", "contract", "transaction", "nft"])(
    "%s on a chain without an EIP-155 ID: 1 to 128 printable ASCII characters",
    (type) => {
      ok(type, 0, "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
      ok(type, 0, "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV");
      ok(type, 0, "!");
      ok(type, 0, "~".repeat(128));
      bad(type, 0, "~".repeat(129));
      bad(type, 0, "");
      bad(type, 0, "has space");
      bad(type, 0, "tab\there");
      bad(type, 0, "ünïcode");
    }
  );

  it("an EVM grammar does not apply at chainId 0, nor the native one above it", () => {
    ok("address", 0, ADDR.toLowerCase());
    bad("address", 1, "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
  });

  it("governance-added types: printable ASCII", () => {
    registerResourceType(200, "domain-name");
    ok("domain-name", 1, "example.com");
    ok("domain-name", 0, "anything!printable~");
    bad("domain-name", 1, "exämple.com");
    bad("domain-name", 1, "two words");
    bad("domain-name", 1, "");
    const content = mutate((c) => {
      c.type = "domain-name";
      c.resource.identifier = "example.com";
    });
    expect(checkContent(content)).toEqual([]);
  });

  it("is applied by checkContent as rule G4", () => {
    expect(rulesFor(mutate((c) => (c.resource.identifier = ISSUER.toLowerCase())), "resource.identifier")).toEqual(["G4"]);
    expect(rulesFor(mutate((c) => (c.resource.identifier = "")), "resource.identifier")).toEqual(["G4"]);
    expect(
      rulesFor(
        mutate((c) => {
          c.type = "ipfs";
          c.resource.identifier = "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
        }),
        "resource.identifier"
      )
    ).toEqual(["G4"]);
  });

  it("isEip55Address accepts only the checksummed spelling", () => {
    expect(isEip55Address(ISSUER)).toBe(true);
    expect(isEip55Address(ISSUER.toLowerCase())).toBe(false);
    expect(isEip55Address(ISSUER.toUpperCase().replace("0X", "0x"))).toBe(false);
    expect(isEip55Address(123)).toBe(false);
    expect(isEip55Address(undefined)).toBe(false);
  });
});

describe("G5: alias grammar", () => {
  it.each([
    "",
    "a.nota",
    "alice.nota",
    "example-treasury.nota",
    "0x.nota",
    "a1-b2-c3.nota",
    "a".repeat(63) + ".nota",
    "a--b.nota",
  ])("accepts %j", (alias) => {
    expect(checkAlias(alias)).toBeNull();
    expect(rulesFor(mutate((c) => (c.resource.alias = alias)), "resource.alias")).toEqual([]);
  });

  it.each([
    "alice",
    "alice.eth",
    ".nota",
    "Alice.nota",
    "-alice.nota",
    "alice-.nota",
    "al_ice.nota",
    "al ice.nota",
    "alice.nota.nota",
    "alice.NOTA",
    "alice.nota ",
    "älice.nota",
    "аlice.nota", // Cyrillic a
    "a".repeat(64) + ".nota",
    "alice.notax",
    "alice\n.nota",
  ])("refuses %j", (alias) => {
    expect(checkAlias(alias)).not.toBeNull();
    expect(rulesFor(mutate((c) => (c.resource.alias = alias)), "resource.alias")).toContain("G5");
  });
});

describe("G6: display string rules", () => {
  const fields = ["resource.name", "resource.description", "issuer.name"] as const;
  const set = (field: string, value: string) =>
    mutate((c) => {
      const [parent, member] = field.split(".");
      c[parent][member] = value;
    });

  it.each([
    ["a leading space", " Treasury"],
    ["a trailing space", "Treasury "],
    ["two consecutive spaces", "Example  Treasury"],
    ["a link", "see https://example.com"],
    ["any ://", "ipfs://Qm"],
    ["an embedded address", "pay 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"],
    ["0x and eight hex digits", "id 0x1234abcd"],
    ["0X and eight hex digits", "id 0X1234ABCD"],
    ["a lone space", " "],
  ])("refuses %s", (_name, value) => {
    expect(checkDisplayString(value)).not.toBeNull();
    for (const field of fields) {
      expect(rulesFor(set(field, value), field), field).toEqual(["G6"]);
    }
  });

  it.each([
    "",
    "Example Treasury",
    "A - B : C / D",
    "0x1234abc", // seven hex digits
    "0xg1234567890", // not hex after 0x
    "version 0x7 of 12345678",
    "http:/one-slash",
    "Ünïcödé 日本語 😀",
  ])("accepts %j", (value) => {
    expect(checkDisplayString(value)).toBeNull();
    for (const field of fields) expect(rulesFor(set(field, value), field), field).toEqual([]);
  });

  it("does not apply to the identifier or the alias", () => {
    const content = mutate((c) => {
      c.type = "metadata";
      c.resource.identifier = "https://example.com/0x1234abcd";
    });
    expect(checkContent(content)).toEqual([]);
  });
});

describe("NFC", () => {
  const decomposed = "Café"; // e + combining acute
  const composed = "Café";

  it("is not required of a reader, which must not be stricter than the gate", () => {
    expect(checkContent(mutate((c) => (c.resource.name = decomposed)))).toEqual([]);
  });

  it("is required before signing when requireNfc is set", () => {
    const issues = checkContent(mutate((c) => (c.resource.name = decomposed)), { requireNfc: true });
    expect(issues).toEqual([expect.objectContaining({ rule: "NFC", field: "resource.name" })]);
    expect(checkContent(mutate((c) => (c.resource.name = composed)), { requireNfc: true })).toEqual([]);
  });

  it("composeNotaDraft normalizes strings to NFC and fills empty values", () => {
    const draft = composeNotaDraft({
      type: "address",
      chain: { name: "ethereum", chainId: 1 },
      resource: { identifier: ISSUER, name: decomposed },
      issuer: { account: ISSUER.toLowerCase() },
      metadata: { tags: [decomposed] },
      issuedAt: 1795564800,
    });
    const expected: NotaContent = {
      version: "1.1",
      type: "address",
      chain: { name: "ethereum", chainId: 1, network: "mainnet" },
      resource: { identifier: ISSUER, name: composed, alias: "", description: "" },
      issuer: { account: ISSUER, name: "", entityType: "" },
      metadataHash: draft.content.metadataHash,
      supersedes: ZERO32,
      issuedAt: 1795564800,
      expiresAt: 0,
    };
    expect(draft.content).toEqual(expected);
    expect(new TextDecoder().decode(draft.metadata!)).toBe(`{"tags":["${composed}"]}`);
    expect(draft.content.metadataHash).not.toBe(ZERO32);
  });

  it("composeNotaDraft refuses what the gate would refuse", () => {
    const base = {
      type: "address",
      chain: { name: "ethereum", chainId: 1 },
      resource: { identifier: ISSUER },
      issuer: { account: ISSUER },
    };
    expect(() => composeNotaDraft({ ...base, resource: { identifier: ISSUER, name: "Pay 0xdeadbeef00" } })).toThrow(/G6/);
    expect(() => composeNotaDraft({ ...base, resource: { identifier: ISSUER, alias: "Alice.nota" } })).toThrow(/G5/);
    expect(() => composeNotaDraft({ ...base, resource: { identifier: ISSUER.toLowerCase() } })).toThrow(/G4/);
    expect(() => composeNotaDraft({ ...base, metadata: { note: "a‮b" } })).toThrow(/T3/);
    expect(composeNotaDraft(base).metadata).toBeNull();
    expect(composeNotaDraft(base).content.metadataHash).toBe(ZERO32);
  });
});
