import bs58 from "bs58";

const SESSION_ID_BYTE_LENGTH = 8;

export const encodeSessionId = (sessionIdBytes: Uint8Array) => {
  if (sessionIdBytes.length !== SESSION_ID_BYTE_LENGTH) {
    throw new Error(`Session IDs must be ${SESSION_ID_BYTE_LENGTH} bytes.`);
  }

  return bs58.encode(sessionIdBytes);
};

export const decodeSessionId = (sessionId: string) => {
  const decoded = bs58.decode(sessionId);

  if (decoded.length !== SESSION_ID_BYTE_LENGTH) {
    throw new Error(`Session IDs must decode to ${SESSION_ID_BYTE_LENGTH} bytes.`);
  }

  return decoded;
};

export const isValidSessionId = (sessionId: string) => {
  try {
    decodeSessionId(sessionId);
    return true;
  } catch {
    return false;
  }
};

export const createSessionId = () => {
  const sessionIdBytes = new Uint8Array(SESSION_ID_BYTE_LENGTH);
  globalThis.crypto.getRandomValues(sessionIdBytes);
  return encodeSessionId(sessionIdBytes);
};

export const getSessionUrl = (origin: string, sessionId: string) => {
  const url = new URL(`/session/${sessionId}`, origin);
  return url.toString();
};

export const getTimelineStorageKey = (sessionId: string) => `silentcircle:timeline:${sessionId}`;
