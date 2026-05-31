// Per-(user, sub-account) GRVTClient factory with LRU cache.
//
// Multi-tenant: each user has their own GRVT API credentials encrypted
// in the DB. H.5 extends this so a user can have multiple sub-accounts
// — `grvt_credentials` is the default (one per user, sub-account-id =
// null in the cache key), and `grvt_sub_accounts` holds extras.
//
// Cache key: `${userId}:${subAccountId ?? 'default'}`. Each unique
// combination gets its own logged-in GRVTClient instance for 5
// minutes to avoid re-decrypting and re-logging-in on every request.
//
// Usage:
//   const client = await getGrvtClientForUser(userId, db);            // default creds
//   const client = await getGrvtClientForBot(userId, subAccountId, db); // routed
//
// When a user updates default creds:
//   invalidateGrvtClient(userId);          // drops ALL cache entries for that user
// When a user updates a single sub-account:
//   invalidateGrvtClient(userId, subAccountId); // drops just that one
//
// When a running bot's user updates their creds:
//   engine.rebindGrvtClient(userId, subAccountId);  // replaces instance refs

import {
  createExchangeClient,
  getDefaultExchangeId,
  normalizeExchange,
  type ExchangeId,
  type ExchangeClientCreds,
  type TradingClient,
} from './client.js';
import { decryptCredentialFields } from '../auth/crypto.js';
import type { GridBotDB } from '../database/db.js';

interface CacheEntry {
  client: TradingClient;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(userId: number, subAccountId: number | null, exchange: ExchangeId): string {
  return `${exchange}:${userId}:${subAccountId ?? 'default'}`;
}

/**
 * Resolve the GRVTClient for a specific (user, sub-account) pair.
 * subAccountId === null routes to the user's default credentials in
 * grvt_credentials. Non-null routes to grvt_sub_accounts and asserts
 * row.user_id === userId before decrypting (defense in depth — even
 * if a bot row carries an attacker-crafted FK, we never hand back a
 * client bound to a different user's keys).
 */
export async function getGrvtClientForBot(
  userId: number,
  subAccountId: number | null,
  gridBotDb: GridBotDB,
  exchangeArg?: ExchangeId | string | null
): Promise<TradingClient> {
  const exchange = normalizeExchange(exchangeArg ?? getDefaultExchangeId());
  const key = cacheKey(userId, subAccountId, exchange);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.client;
  }

  // Resolve encrypted creds: default vs sub-account.
  let row: Parameters<typeof decryptCredentialFields>[0] | null = null;
  if (subAccountId == null) {
    row = await (gridBotDb as any).getGrvtCredentialsRaw(userId, exchange);
    if (!row) {
      throw new Error(`User ${userId} has no ${exchange.toUpperCase()} credentials configured`);
    }
  } else {
    const sub = await gridBotDb.getGrvtSubAccountRaw(subAccountId);
    if (!sub) {
      throw new Error(`Sub-account ${subAccountId} not found`);
    }
    if (sub.user_id !== userId) {
      // Refuse to bind a client across user boundaries even if a bot
      // row points at someone else's sub-account. The route layer
      // validates ownership at create time; this is belt + braces.
      throw new Error(
        `Sub-account ${subAccountId} does not belong to user ${userId}`
      );
    }
    if (normalizeExchange((sub as any).exchange ?? 'grvt') !== exchange) {
      throw new Error(
        `Sub-account ${subAccountId} is for ${normalizeExchange((sub as any).exchange ?? 'grvt')}, not ${exchange}`
      );
    }
    row = sub;
  }

  const plain = decryptCredentialFields(row);
  const creds: ExchangeClientCreds = {
    apiKey: plain.apiKey,
    apiSecret: plain.apiSecret,
    tradingAddress: plain.tradingAddress,
    accountId: plain.accountId,
    subAccountId: plain.subAccountId,
  };
  const client = createExchangeClient(exchange, creds);

  const ok = await client.login();
  if (!ok) {
    throw new Error(
      `${exchange.toUpperCase()} login failed for user ${userId}${subAccountId != null ? ` sub-account ${subAccountId}` : ''}`
    );
  }

  cache.set(key, { client, expiresAt: Date.now() + TTL_MS });

  // Touch last_used_at on the default credentials path (the only one
  // with that bookkeeping column today). Fire and forget.
  if (subAccountId == null) {
    gridBotDb.touchGrvtCredentialsLastUsed(userId, exchange).catch(() => {});
  }

  return client;
}

/**
 * Backward-compatible wrapper. Existing callers that don't know about
 * sub-accounts (engine paths for legacy bots, single-account flows)
 * route to the user's default credentials.
 */
export async function getGrvtClientForUser(
  userId: number,
  gridBotDb: GridBotDB,
  exchange?: ExchangeId | string | null
): Promise<TradingClient> {
  return getGrvtClientForBot(userId, null, gridBotDb, exchange);
}

/**
 * Drop cached clients. With no subAccountId, removes every entry for
 * the user (correct after a credential rotation that may invalidate
 * the default and all sub-accounts at once). With a subAccountId,
 * removes only that exact key.
 */
export function invalidateGrvtClient(
  userId: number,
  subAccountId?: number | null,
  exchangeArg?: ExchangeId | string | null
): void {
  const exchange = exchangeArg == null ? null : normalizeExchange(exchangeArg);
  if (subAccountId === undefined) {
    const prefix = exchange ? `${exchange}:${userId}:` : null;
    for (const k of Array.from(cache.keys())) {
      if (prefix ? k.startsWith(prefix) : k.includes(`:${userId}:`)) cache.delete(k);
    }
    return;
  }
  if (exchange) {
    cache.delete(cacheKey(userId, subAccountId, exchange));
    return;
  }
  for (const x of ['grvt', 'bitunix'] as const) {
    cache.delete(cacheKey(userId, subAccountId, x));
  }
}

/** Drop all cached clients. Call on server shutdown. */
export function invalidateAll(): void {
  cache.clear();
}
