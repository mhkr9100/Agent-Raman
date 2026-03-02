/**
 * Strict Rate Limiter — 15 Requests per Hour per User
 * Uses localStorage to persist request timestamps across page reloads.
 * Hard limit: once 15 requests are made within a rolling 60-minute window, 
 * the user is blocked until the oldest request expires.
 */

const MAX_REQUESTS = 15;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour in milliseconds
const STORAGE_KEY_PREFIX = 'ramn_rate_';

function getStorageKey(userId: string): string {
    return `${STORAGE_KEY_PREFIX}${userId}`;
}

function getTimestamps(userId: string): number[] {
    try {
        const raw = localStorage.getItem(getStorageKey(userId));
        if (!raw) return [];
        const timestamps: number[] = JSON.parse(raw);
        const now = Date.now();
        // Purge expired timestamps (older than 1 hour)
        return timestamps.filter(t => now - t < WINDOW_MS);
    } catch {
        return [];
    }
}

function saveTimestamps(userId: string, timestamps: number[]): void {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(timestamps));
}

/**
 * Check if a request is allowed for the given user.
 * Returns { allowed, remaining, resetTime }
 */
export function canMakeRequest(userId: string): {
    allowed: boolean;
    remaining: number;
    resetTime: Date | null;
    retryAfterMs?: number;
} {
    const timestamps = getTimestamps(userId);
    const remaining = MAX_REQUESTS - timestamps.length;

    if (remaining > 0) {
        return { allowed: true, remaining, resetTime: null };
    }

    // All 10 slots used — find when the oldest one expires
    const oldestTimestamp = Math.min(...timestamps);
    const resetTime = new Date(oldestTimestamp + WINDOW_MS);
    const retryAfterMs = resetTime.getTime() - Date.now();

    return {
        allowed: false,
        remaining: 0,
        resetTime,
        retryAfterMs: Math.max(0, retryAfterMs)
    };
}

/**
 * Record that a request was made.
 */
export function recordRequest(userId: string): void {
    const timestamps = getTimestamps(userId);
    timestamps.push(Date.now());
    saveTimestamps(userId, timestamps);
}

/**
 * Get current usage info for UI display.
 */
export function getUsageInfo(userId: string): {
    used: number;
    remaining: number;
    limit: number;
    resetTime: Date | null;
} {
    const timestamps = getTimestamps(userId);
    const used = timestamps.length;
    const remaining = Math.max(0, MAX_REQUESTS - used);

    let resetTime: Date | null = null;
    if (used >= MAX_REQUESTS) {
        const oldestTimestamp = Math.min(...timestamps);
        resetTime = new Date(oldestTimestamp + WINDOW_MS);
    }

    return { used, remaining, limit: MAX_REQUESTS, resetTime };
}

/**
 * Format reset time for display (e.g., "5:45 PM")
 */
export function formatResetTime(resetTime: Date): string {
    return resetTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}
