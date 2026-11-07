/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// Managed collections come from paperback-mdchecker when it is configured
// (collections defined per user on the server). Otherwise this falls back to
// the upstream behavior: MangaDex reading statuses, which need a login.

import type { ManagedCollection, ManagedCollectionChangeset, SourceManga } from '@paperback/types';

import {
  commitCheckerCollection,
  getCheckerCollectionMangaIds,
  getCheckerCollections,
} from '../../services/checker';
import { fetchJSON } from '../../services/network';
import { resolveMangaId, resolveMangaIds } from '../shared/legacy';
import { getRatingEnumList } from '../shared/lookups';
import type { MangaDetailsResponse, MangaStatusResponse, SearchResponse } from '../shared/models';
import { parseMangaDetails, readMangaDetailsSettings } from '../shared/parsers';
import { getAccessToken, isCheckerEnabled } from '../shared/state';
import {
  buildMangaListUrl,
  buildMangaStatusListUrl,
  buildMangaStatusWriteUrl,
} from '../shared/urls';
import { MANGA_PAGE_LIMIT, chunk } from '../shared/utils';

// Prefix for server collection ids, so they can never be mistaken for a
// MangaDex reading status (or vice versa) if the checker setting changes.
const CHECKER_COLLECTION_PREFIX = 'mdchecker:';

function toCheckerCollectionId(collectionId: string): string | undefined {
  return collectionId.startsWith(CHECKER_COLLECTION_PREFIX)
    ? collectionId.slice(CHECKER_COLLECTION_PREFIX.length)
    : undefined;
}

// ===== Exports =====

export async function getManagedLibraryCollections(): Promise<ManagedCollection[]> {
  if(isCheckerEnabled()) {
    const collections = await getCheckerCollections();
    return collections.map((c) => ({ id: `${CHECKER_COLLECTION_PREFIX}${c.id}`, title: c.title }));
  }
  return getMangaDexStatusCollections();
}

export async function commitManagedCollectionChanges(
  changeset: ManagedCollectionChangeset,
): Promise<void> {
  const checkerCollectionId = toCheckerCollectionId(changeset.collection.id);
  if(checkerCollectionId !== undefined) {
    if(!isCheckerEnabled()) {
      throw new Error('paperback-mdchecker is not configured');
    }
    return commitToChecker(checkerCollectionId, changeset);
  }
  return commitMangaDexStatusChanges(changeset);
}

export async function getSourceMangaInManagedCollection(
  managedCollection: ManagedCollection,
): Promise<SourceManga[]> {
  const checkerCollectionId = toCheckerCollectionId(managedCollection.id);
  if(checkerCollectionId !== undefined) {
    if(!isCheckerEnabled()) {
      throw new Error('paperback-mdchecker is not configured');
    }
    const ids = await getCheckerCollectionMangaIds(checkerCollectionId);
    return fetchSourceMangaByIds(ids);
  }
  return getMangaDexStatusManga(managedCollection);
}

// ===== paperback-mdchecker collections =====

async function commitToChecker(
  collectionId: string,
  changeset: ManagedCollectionChangeset,
): Promise<void> {
  const additions = (changeset.additions ?? []).map((m) => m.mangaId);
  const deletions = (changeset.deletions ?? []).map((m) => m.mangaId);
  if(additions.length === 0 && deletions.length === 0) { return; }

  // The server stores lowercase UUIDs, so convert legacy numeric ids first.
  // Ids that no longer resolve are dropped.
  const idMap = await resolveMangaIds([...additions, ...deletions]);
  const resolve = (ids: string[]): string[] =>
    ids.map((id) => idMap[id]).filter((id): id is string => !!id);

  await commitCheckerCollection(collectionId, resolve(additions), resolve(deletions));
}

// ===== MangaDex reading statuses (upstream behavior) =====

function getMangaDexStatusCollections(): ManagedCollection[] {
  return [
    { id: 'reading', title: 'Reading' },
    { id: 'on_hold', title: 'On Hold' },
    { id: 'plan_to_read', title: 'Planned' },
    { id: 'dropped', title: 'Dropped' },
    { id: 're_reading', title: 'Re-reading' },
    { id: 'completed', title: 'Completed' },
  ];
}

async function commitMangaDexStatusChanges(changeset: ManagedCollectionChangeset): Promise<void> {
  if(!getAccessToken()) {
    throw new Error('You need to be logged in');
  }

  const postStatus = async (mangaId: string, status: string | null, action: string) => {
    // Convert legacy numeric ids before posting.
    const resolvedId = await resolveMangaId(mangaId);
    try {
      await fetchJSON<{ result?: string }>({
        url: buildMangaStatusWriteUrl(resolvedId).toString(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch(e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`MangaDex collection ${action} failed for ${resolvedId}: ${detail}`);
    }
  };

  // Promise.all aborts the whole changeset on any failure.
  const additionRequests = (changeset.additions ?? []).map((a) =>
    postStatus(a.mangaId, changeset.collection.id, 'add'),
  );
  const deletionRequests = (changeset.deletions ?? []).map((d) =>
    postStatus(d.mangaId, null, 'remove'),
  );
  await Promise.all([...additionRequests, ...deletionRequests]);
}

async function getMangaDexStatusManga(managedCollection: ManagedCollection): Promise<SourceManga[]> {
  if(!getAccessToken()) {
    throw new Error('You need to be logged in');
  }

  const statusjson = await fetchJSON<MangaStatusResponse>({
    url: buildMangaStatusListUrl().toString(),
    method: 'GET',
  });

  if(
    !statusjson.statuses ||
    typeof statusjson.statuses !== 'object' ||
    Array.isArray(statusjson.statuses)
  ) {
    throw new Error('MangaDex returned no status data');
  }

  const ids = Object.keys(statusjson.statuses).filter(
    (x) => statusjson.statuses[x] === managedCollection.id,
  );
  return fetchSourceMangaByIds(ids);
}

// ===== Shared =====

async function fetchSourceMangaByIds(ids: string[]): Promise<SourceManga[]> {
  // Fail on any batch error rather than render a silently partial collection,
  // which could make the user think kept titles were removed. The host retries.
  const responses = await Promise.all(
    chunk(ids, MANGA_PAGE_LIMIT).map((batch) =>
      fetchJSON<SearchResponse>({
        // All ratings, no language filter: show every kept title regardless of settings.
        url: buildMangaListUrl({
          limit: MANGA_PAGE_LIMIT,
          ratings: getRatingEnumList(),
          includes: ['author', 'artist', 'cover_art'],
          ids: batch,
        }).toString(),
        method: 'GET',
      }),
    ),
  );

  const detailsSettings = readMangaDetailsSettings();

  return responses.flatMap((json) => {
    if(!Array.isArray(json.data)) { return []; }
    return json.data.map((item) =>
      parseMangaDetails(
        item.id,
        { result: 'ok', response: 'entity', data: item } as MangaDetailsResponse,
        undefined,
        detailsSettings,
      ),
    );
  });
}
