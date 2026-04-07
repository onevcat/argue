import type { SessionStore } from "../contracts/delegate.js";

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, unknown>();

  async save(session: unknown): Promise<void> {
    const key = extractSessionId(session);
    this.sessions.set(key, session);
  }

  async load(sessionId: string): Promise<unknown | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async update(sessionId: string, patch: unknown): Promise<void> {
    const existing = this.sessions.get(sessionId);
    const current = isObject(existing) ? existing : {};
    const next = {
      ...current,
      ...(isObject(patch) ? patch : { patch })
    };
    this.sessions.set(sessionId, next);
  }
}

function extractSessionId(session: unknown): string {
  if (!isObject(session) || typeof session.sessionId !== "string" || session.sessionId.length === 0) {
    throw new Error("session object must contain a non-empty sessionId");
  }
  return session.sessionId;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
