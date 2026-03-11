/**
 * RamN AI — Server-Side Rate Limiter
 *
 * Stores per-user hourly counters in RamN_UserMap.requestUsage.
 */

import { getUserMap, updateUserMap } from './dynamo.js';

const HOURLY_LIMIT = parseInt(process.env.HOURLY_REQUEST_LIMIT || '10', 10);
const RETENTION_HOURS = Number(process.env.HOURLY_USAGE_RETENTION || 48);

function toHourKey(date = new Date()) {
    return date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function pruneOldBuckets(usageByHour, now) {
    const minTs = now.getTime() - RETENTION_HOURS * 60 * 60 * 1000;
    const next = {};
    for (const [hourKey, count] of Object.entries(usageByHour || {})) {
        const bucketTs = new Date(`${hourKey}:00:00.000Z`).getTime();
        if (!Number.isNaN(bucketTs) && bucketTs >= minTs) {
            next[hourKey] = Number(count) || 0;
        }
    }
    return next;
}

export async function checkAndRecordUsage(userId, scope = 'ai') {
    const now = new Date();
    const hourKey = toHourKey(now);
    const userMap = await getUserMap(userId);

    const requestUsage = userMap.requestUsage || {};
    const scopedUsage = pruneOldBuckets(requestUsage[scope] || {}, now);
    const usedThisHour = Number(scopedUsage[hourKey] || 0);

    if (usedThisHour >= HOURLY_LIMIT) {
        const resetAt = new Date(`${hourKey}:00:00.000Z`).getTime() + 60 * 60 * 1000;
        return {
            allowed: false,
            limit: HOURLY_LIMIT,
            used: usedThisHour,
            remaining: 0,
            resetAt: new Date(resetAt).toISOString()
        };
    }

    scopedUsage[hourKey] = usedThisHour + 1;
    await updateUserMap(userId, {
        requestUsage: {
            ...requestUsage,
            [scope]: scopedUsage
        }
    });

    return {
        allowed: true,
        limit: HOURLY_LIMIT,
        used: scopedUsage[hourKey],
        remaining: Math.max(0, HOURLY_LIMIT - scopedUsage[hourKey]),
        resetAt: new Date(new Date(`${hourKey}:00:00.000Z`).getTime() + 60 * 60 * 1000).toISOString()
    };
}

