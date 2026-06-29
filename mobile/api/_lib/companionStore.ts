const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const PING_EXTENSION_MS = 60 * 60 * 1000;

export { SESSION_TTL_MS, PING_EXTENSION_MS };

export interface CompanionSession {
  token: string;
  ownerSecret: string;
  displayName?: string;
  active: boolean;
  lastLat?: number;
  lastLon?: number;
  lastAccuracy?: number;
  lastHeading?: number;
  lastSpeed?: number;
  lastUpdate?: string;
  createdAt: string;
  expiresAt: string;
  pingCount: number;
}

type GlobalCompanion = typeof globalThis & {
  __buddywalkCompanionSessions?: Map<string, CompanionSession>;
};

function sessions(): Map<string, CompanionSession> {
  const g = globalThis as GlobalCompanion;
  if (!g.__buddywalkCompanionSessions) {
    g.__buddywalkCompanionSessions = new Map();
  }
  return g.__buddywalkCompanionSessions;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, session] of sessions()) {
    if (new Date(session.expiresAt).getTime() <= now) {
      sessions().delete(token);
    }
  }
}

export const companionStore = {
  exists(token: string): boolean {
    pruneExpired();
    return sessions().has(token);
  },

  create(data: Omit<CompanionSession, 'pingCount'>): CompanionSession {
    pruneExpired();
    const doc: CompanionSession = { pingCount: 0, ...data };
    sessions().set(doc.token, doc);
    return doc;
  },

  findOne(token: string): CompanionSession | null {
    pruneExpired();
    const session = sessions().get(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      sessions().delete(token);
      return null;
    }
    return session;
  },

  save(session: CompanionSession): CompanionSession {
    sessions().set(session.token, session);
    return session;
  },
};
