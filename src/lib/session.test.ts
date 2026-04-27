import { describe, expect, it } from "vitest";

import {
  createSessionId,
  decodeSessionId,
  encodeSessionId,
  getSessionUrl,
  getTimelineStorageKey,
  isValidSessionId,
} from "@/lib/session";

describe("session utilities", () => {
  it("round-trips an 8-byte session ID through base58", () => {
    const sessionIdBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encoded = encodeSessionId(sessionIdBytes);

    expect(decodeSessionId(encoded)).toEqual(sessionIdBytes);
    expect(isValidSessionId(encoded)).toBe(true);
  });

  it("creates valid base58 session IDs", () => {
    const sessionId = createSessionId();

    expect(isValidSessionId(sessionId)).toBe(true);
    expect(decodeSessionId(sessionId)).toHaveLength(8);
  });

  it("rejects IDs that do not decode to eight bytes", () => {
    expect(isValidSessionId("abc")).toBe(false);
    expect(() => decodeSessionId("abc")).toThrow("Session IDs must decode to 8 bytes.");
  });

  it("builds invite URLs and storage keys from a session ID", () => {
    const sessionId = encodeSessionId(new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]));

    expect(getSessionUrl("https://silentcircle.app", sessionId)).toBe(`https://silentcircle.app/session/${sessionId}`);
    expect(getTimelineStorageKey(sessionId)).toBe(`silentcircle:timeline:${sessionId}`);
  });
});
