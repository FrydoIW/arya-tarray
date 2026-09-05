const DEFAULT_FRESHNESS_MS = 30_000;
const MAX_CACHE_ENTRIES = 80;

type CacheEntry = {
  value: unknown;
  storedAt: number;
};

type InFlightEntry = {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
  abortTimer: ReturnType<typeof setTimeout> | null;
};

export type WorkspaceCacheRead<T> = {
  cached: T | undefined;
  fresh: boolean;
  promise: Promise<T> | null;
  release: () => void;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlightEntry>();
let sessionId: string | null = null;

function writeCache(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, { value, storedAt: Date.now() });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function workspaceCacheKey(scope: string, params?: Record<string, string | number | boolean | null | undefined>) {
  if (!params) return scope;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params).sort(([left], [right]) => left.localeCompare(right))) {
    if (value !== null && value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${scope}?${suffix}` : scope;
}

export function setWorkspaceCacheSession(nextSessionId: string | null) {
  if (sessionId === nextSessionId) return;
  clearWorkspaceCache();
  sessionId = nextSessionId;
}

export function clearWorkspaceCache() {
  cache.clear();
  for (const request of inFlight.values()) {
    if (request.abortTimer) clearTimeout(request.abortTimer);
    request.controller.abort();
  }
  inFlight.clear();
  sessionId = null;
}

export function getWorkspaceCache<T>(key: string, freshnessMs = DEFAULT_FRESHNESS_MS) {
  const entry = cache.get(key);
  if (!entry) return null;
  return {
    value: entry.value as T,
    fresh: Date.now() - entry.storedAt <= freshnessMs
  };
}

export function setWorkspaceCache<T>(key: string, value: T) {
  const request = inFlight.get(key);
  if (request) {
    if (request.abortTimer) clearTimeout(request.abortTimer);
    request.controller.abort();
    inFlight.delete(key);
  }
  writeCache(key, value);
}

export function invalidateWorkspaceCache(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const [key, request] of inFlight) {
    if (!key.startsWith(prefix)) continue;
    if (request.abortTimer) clearTimeout(request.abortTimer);
    request.controller.abort();
    inFlight.delete(key);
  }
}

export function readWorkspace<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
  options: { force?: boolean; freshnessMs?: number } = {}
): WorkspaceCacheRead<T> {
  const cachedEntry = getWorkspaceCache<T>(key, options.freshnessMs);
  if (!options.force && cachedEntry?.fresh) {
    return { cached: cachedEntry.value, fresh: true, promise: null, release: () => undefined };
  }

  let request = inFlight.get(key);
  if (!request) {
    const controller = new AbortController();
    const entry: InFlightEntry = {
      controller,
      promise: Promise.resolve(undefined),
      subscribers: 0,
      abortTimer: null
    };
    entry.promise = loader(controller.signal)
      .then((value) => {
        if (inFlight.get(key) === entry) writeCache(key, value);
        return value;
      })
      .finally(() => {
        if (entry.abortTimer) clearTimeout(entry.abortTimer);
        if (inFlight.get(key) === entry) inFlight.delete(key);
      });
    request = entry;
    inFlight.set(key, request);
  } else if (request.abortTimer) {
    clearTimeout(request.abortTimer);
    request.abortTimer = null;
  }

  request.subscribers += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    request!.subscribers = Math.max(0, request!.subscribers - 1);
    if (request!.subscribers > 0 || inFlight.get(key) !== request) return;
    request!.abortTimer = setTimeout(() => {
      if (request!.subscribers === 0 && inFlight.get(key) === request) {
        inFlight.delete(key);
        request!.controller.abort();
      }
    }, 0);
  };

  return {
    cached: cachedEntry?.value,
    fresh: false,
    promise: request.promise as Promise<T>,
    release
  };
}
