import { decodeFunctionData, encodePacked, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { RANDOMNESS_COORDINATOR_ABI, commitmentFor, dice, random } from "./index.js";

const COORD = "0x00000000000000000000000000000000000000c0" as `0x${string}`;
const SECRET = keccak256(encodePacked(["string"], ["super-secret"]));

describe("random facade — calldata building", () => {
  it("commitReveal builds requestCommit(commitment) calldata and exposes the commitment", () => {
    const call = random.commitReveal(SECRET, { coordinator: COORD });
    expect(call.to).toBe(COORD);
    expect(call.fn).toBe("requestCommit");
    expect(call.tier).toBe("commit-reveal");
    expect(call.commitment).toBe(commitmentFor(SECRET));

    const decoded = decodeFunctionData({ abi: RANDOMNESS_COORDINATOR_ABI, data: call.data });
    expect(decoded.functionName).toBe("requestCommit");
    expect(decoded.args[0]).toBe(call.commitment);
  });

  it("commitmentFor matches keccak256(abi.encodePacked(secret))", () => {
    expect(commitmentFor(SECRET)).toBe(keccak256(encodePacked(["bytes32"], [SECRET])));
  });

  it("reveal builds reveal(requestId, secret) calldata", () => {
    const call = random.reveal(7n, SECRET, { coordinator: COORD });
    expect(call.fn).toBe("reveal");
    const decoded = decodeFunctionData({ abi: RANDOMNESS_COORDINATOR_ABI, data: call.data });
    expect(decoded.functionName).toBe("reveal");
    expect(decoded.args[0]).toBe(7n);
    expect(decoded.args[1]).toBe(SECRET);
  });

  it("fast builds fastRandom() calldata with the fast tier", () => {
    const call = random.fast({ coordinator: COORD });
    expect(call.fn).toBe("fastRandom");
    expect(call.tier).toBe("fast");
    const decoded = decodeFunctionData({ abi: RANDOMNESS_COORDINATOR_ABI, data: call.data });
    expect(decoded.functionName).toBe("fastRandom");
  });

  it("exposes all three tiers including the vrf seam", () => {
    expect(random.tiers).toEqual(["vrf", "commit-reveal", "fast"]);
  });
});

describe("dice — range and determinism", () => {
  it("dice(word, 6, 2) returns two values each in [1,6]", () => {
    const word = BigInt(keccak256(encodePacked(["string"], ["entropy"])));
    const rolls = dice(word, 6, 2);
    expect(rolls).toHaveLength(2);
    for (const r of rolls) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });

  it("is deterministic from the same inputs", () => {
    const word = BigInt(keccak256(encodePacked(["string"], ["seed"])));
    expect(dice(word, 20, 3)).toEqual(dice(word, 20, 3));
  });

  it("stays in range across many words and sizes (no out-of-bound, no modulo overflow)", () => {
    for (let s = 1; s <= 32; s++) {
      const word = BigInt(keccak256(encodePacked(["uint256"], [BigInt(s)])));
      const rolls = dice(word, s === 0 ? 1 : Math.max(1, s), 4);
      expect(rolls).toHaveLength(4);
      for (const r of rolls) {
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(s);
      }
    }
  });

  it("rejects invalid params", () => {
    const word = 123n;
    expect(() => dice(word, 0, 2)).toThrow();
    expect(() => dice(word, 6, 0)).toThrow();
    expect(() => dice(word, 256, 2)).toThrow();
  });
});
