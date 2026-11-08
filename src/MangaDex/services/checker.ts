// Client for the paperback-mdchecker server (~/projects/paperback-mdchecker).
//
// Every call here is optional. When the checker is not configured (base URL
// or user empty), callers fall back to the plain MangaDex behavior.

import type { Request } from '@paperback/types';

import { getCheckerBaseUrl, getCheckerUser, isCheckerEnabled } from '../implementations/shared/state';
import { chunk } from '../implementations/shared/utils';

// The server rejects more than 2000 ids per batch.
const CHECK_BATCH_SIZE = 500;

type CheckerState = 'ok' | 'no-user' | 'not-admin' | 'no-collection' | 'no-chapter-id' | 'acknowledged' | 'error';

interface CheckerResponse {
  state?: CheckerState;
}

export interface CheckBatchResponse extends CheckerResponse {
  epoch?: number;
  current?: string[];
  updated?: string[];
  unknown?: string[];
  // Ids whose MangaDex metadata changed at or after `since` (server
  // title-check). Optional: older servers don't send it.
  metadataUpdated?: string[];
}

export interface BatchCheckResult {
  // No new chapters: safe to skip.
  current: Set<string>;
  // Metadata changed: fetch and refresh details even if `current`.
  metadataUpdated: Set<string>;
}

export interface CheckerCollection {
  id: string;
  title: string;
}

interface CollectionsResponse extends CheckerResponse {
  collections?: CheckerCollection[];
}

interface CollectionMangaResponse extends CheckerResponse {
  mangaIds?: string[];
}

interface UserInfoResponse extends CheckerResponse {
  isAdmin?: boolean;
}

export interface PotentialManga {
  mangaId: string;
  title: string | null;
  // 0-100, or -1 when no tag of the manga is rated.
  tagScore: number;
  // Why the admin page greys the card out ('added', 'Origin: ko', 'Shounen',
  // 'Tag: …'), or null for a plain suggestion.
  excludeReason: string | null;
}

interface PotentialMangaResponse extends CheckerResponse {
  manga?: PotentialManga[];
}

interface CommitResponse extends CheckerResponse {
  added?: number;
  removed?: number;
}

export class CheckerError extends Error {
  constructor(message: string, readonly state?: string) {
    super(message);
    this.name = 'CheckerError';
  }
}

function stateMessage(state: string | undefined): string {
  switch(state) {
    case 'no-user':
      return `paperback-mdchecker does not know user "${getCheckerUser()}". New users can take a few minutes to show up.`;
    case 'not-admin':
      return `paperback-mdchecker user "${getCheckerUser()}" is not an admin.`;
    case 'no-collection':
      return 'paperback-mdchecker does not know that collection.';
    case undefined:
      return 'paperback-mdchecker returned an invalid response.';
    default:
      return `paperback-mdchecker returned state "${state}".`;
  }
}

function buildUrl(path: string, query: Record<string, string> = {}): string {
  const params = Object.entries({ userId: getCheckerUser(), ...query })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${getCheckerBaseUrl()}${path}?${params}`;
}

async function fetchCheckerJSON<T extends CheckerResponse>(request: Request): Promise<T> {
  let response, buffer;
  try {
    [response, buffer] = await Application.scheduleRequest(request);
  } catch(err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CheckerError(`paperback-mdchecker request failed: ${detail}`);
  }
  const text = Application.arrayBufferToUTF8String(buffer);
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    throw new CheckerError(`paperback-mdchecker returned invalid JSON (HTTP ${response.status})`);
  }
  if(!json || typeof json !== 'object') {
    throw new CheckerError(stateMessage(undefined));
  }
  return json;
}

function postJSON(path: string, body: object): Request {
  return {
    url: `${getCheckerBaseUrl()}${path}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: getCheckerUser(), ...body }),
  };
}

// ===== Update checks =====

// Asks the server which manga have no new chapters (`current`) and which had a
// metadata change (`metadataUpdated`) since `since`. Fails open: any id the
// server can't vouch for (or any failed batch, including an unknown user) is
// left out of `current`, so the app fetches it normally. Use the settings
// form's connection test to spot a bad configuration.
export async function checkMangaBatch(mangaIds: string[], since?: Date): Promise<BatchCheckResult> {
  const result: BatchCheckResult = { current: new Set(), metadataUpdated: new Set() };
  if(!isCheckerEnabled() || mangaIds.length === 0) { return result; }

  const sinceMs = since instanceof Date && Number.isFinite(since.getTime()) ? since.getTime() : undefined;
  for(const batch of chunk(mangaIds, CHECK_BATCH_SIZE)) {
    try {
      const json = await fetchCheckerJSON<CheckBatchResponse>(
        postJSON('/manga-check-batch', { mangaIds: batch, since: sinceMs }),
      );
      if(json.state !== 'ok' || !Array.isArray(json.current)) {
        console.log(`[MangaDex] mdchecker batch failed: ${stateMessage(json.state)}`);
        continue;
      }
      for(const id of json.current) {
        if(typeof id === 'string') { result.current.add(id.toLowerCase()); }
      }
      for(const id of Array.isArray(json.metadataUpdated) ? json.metadataUpdated : []) {
        if(typeof id === 'string') { result.metadataUpdated.add(id.toLowerCase()); }
      }
    } catch(err) {
      console.log(`[MangaDex] mdchecker batch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

// Called after a successful chapter fetch. Stamps last_check on the server and
// starts tracking the manga if needed. Never throws.
export async function notifyMangaFetched(mangaId: string): Promise<void> {
  if(!isCheckerEnabled()) { return; }
  try {
    const json = await fetchCheckerJSON<CheckerResponse>({
      url: buildUrl('/manga-fetched', { mangaId }),
      method: 'GET',
    });
    if(json.state !== 'ok') {
      console.log(`[MangaDex] mdchecker manga-fetched ${mangaId}: ${stateMessage(json.state)}`);
    }
  } catch(err) {
    console.log(`[MangaDex] mdchecker manga-fetched ${mangaId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Acknowledges a pending chapter re-release on the server. Never throws.
export async function notifyChapterDownload(chapterId: string): Promise<void> {
  if(!isCheckerEnabled()) { return; }
  try {
    await fetchCheckerJSON<CheckerResponse>({
      url: buildUrl('/chapter-download', { chapterId }),
      method: 'GET',
    });
  } catch(err) {
    console.log(`[MangaDex] mdchecker chapter-download ${chapterId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ===== Managed collections =====

export async function getCheckerCollections(): Promise<CheckerCollection[]> {
  const json = await fetchCheckerJSON<CollectionsResponse>({
    url: buildUrl('/collections'),
    method: 'GET',
  });
  if(json.state !== 'ok' || !Array.isArray(json.collections)) {
    throw new CheckerError(stateMessage(json.state), json.state);
  }
  return json.collections
    .filter((c) => c && c.id !== undefined && c.id !== null)
    .map((c) => ({ id: String(c.id), title: String(c.title ?? c.id) }));
}

export async function getCheckerCollectionMangaIds(collectionId: string): Promise<string[]> {
  const json = await fetchCheckerJSON<CollectionMangaResponse>({
    url: buildUrl('/collections/manga', { collectionId }),
    method: 'GET',
  });
  if(json.state !== 'ok' || !Array.isArray(json.mangaIds)) {
    throw new CheckerError(stateMessage(json.state), json.state);
  }
  return json.mangaIds.filter((id): id is string => typeof id === 'string');
}

// Throws on anything but 'ok' so the app retries the changeset.
export async function commitCheckerCollection(
  collectionId: string,
  additions: string[],
  deletions: string[],
): Promise<void> {
  const json = await fetchCheckerJSON<CommitResponse>(
    postJSON('/collections/commit', { collectionId, additions, deletions }),
  );
  if(json.state !== 'ok') {
    throw new CheckerError(stateMessage(json.state), json.state);
  }
}

// ===== User info =====

// Whether the configured user is a server admin. Throws on a bad state; a server
// without /user-info answers with HTML (invalid JSON), which also throws.
export async function getCheckerIsAdminFromServer(): Promise<boolean> {
  const json = await fetchCheckerJSON<UserInfoResponse>({
    url: buildUrl('/user-info'),
    method: 'GET',
  });
  if(json.state !== 'ok') {
    throw new CheckerError(stateMessage(json.state), json.state);
  }
  return json.isAdmin === true;
}

// ===== Potential manga (admin) =====

// The admin potential-manga list, in the admin page's order. Throws on
// anything but 'ok' (including 'not-admin').
export async function getCheckerPotentialManga(): Promise<PotentialManga[]> {
  const json = await fetchCheckerJSON<PotentialMangaResponse>({
    url: buildUrl('/potential-manga'),
    method: 'GET',
  });
  if(json.state !== 'ok' || !Array.isArray(json.manga)) {
    throw new CheckerError(stateMessage(json.state), json.state);
  }
  return json.manga
    .filter((m) => m && typeof m.mangaId === 'string' && m.mangaId.length > 0)
    .map((m) => ({
      mangaId: m.mangaId.toLowerCase(),
      title: typeof m.title === 'string' && m.title.length > 0 ? m.title : null,
      tagScore: typeof m.tagScore === 'number' && Number.isFinite(m.tagScore) ? m.tagScore : -1,
      excludeReason: typeof m.excludeReason === 'string' && m.excludeReason.length > 0 ? m.excludeReason : null,
    }));
}
