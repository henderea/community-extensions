/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  Chapter,
  ChapterDetails,
  MangaInfo,
  SourceManga,
  UpdateManager,
} from '@paperback/types';

import { checkMangaBatch, notifyChapterDownload, notifyMangaFetched } from '../../services/checker';
import { fetchJSON } from '../../services/network';
import { getMangaDetails } from '../manga/main';
import { MDLanguages } from '../shared/languages';
import { resolveChapterId, resolveMangaId, resolveMangaIds } from '../shared/legacy';
import type {
  ChapterDetailsResponse,
  ChapterRelationship,
  ChapterResponse,
  DatumAttributes,
} from '../shared/models';
import {
  assertDataArray,
  findMangaRelationship,
} from '../shared/parsers';
import {
  getBlockedGroups,
  getBlockedUploaders,
  getDataSaver,
  getForcePort443,
  getFuzzyBlockingEnabled,
  getGroupBlockingEnabled,
  getLanguages,
  getMetadataUpdater,
  getRatings,
  getSkipSameChapter,
} from '../shared/state';
import {
  buildAtHomeServerUrl,
  buildMangaFeedUrl,
} from '../shared/urls';
import {
  FEED_PAGE_LIMIT,
  MAX_API_OFFSET,
  decodeHTML,
  formatPublishAtSince,
  parseDateOrUndefined,
  precomputeQuery,
} from '../shared/utils';
import {
  assignChapterNumber,
  buildChapterIdentifier,
  extractScanlationGroupNames,
  normalizePagesCount,
} from './parsers';
import { isGroupNameBlocked, isRatingAllowed } from './utils';

// The first feed page inlines the full manga entity into the "manga"
// relationship slot so the cast is guarded.
function readInlinedMangaItem(
  rel: ChapterRelationship | undefined,
): { id: string; attributes: DatumAttributes } | undefined {
  if(!rel || typeof rel.id !== 'string' || !rel.attributes || typeof rel.attributes !== 'object') {
    return undefined;
  }
  return { id: rel.id, attributes: rel.attributes as unknown as DatumAttributes };
}

// Manga that paperback-mdchecker reported as having changed metadata during
// the current update run. getChapters consumes an entry by doing a full details
// refresh. In memory only: if it is lost, the worst case is a missed refresh.
const pendingMetadataRefresh = new Set<string>();

export async function getChapters(
  sourceManga: SourceManga,
  sinceDate?: Date,
  skipMetadataUpdate: boolean = false,
): Promise<Chapter[]> {
  // Update in place so the Chapter[] points at the current UUID, not a stale legacy id.
  const mangaId = await resolveMangaId(sourceManga.mangaId);
  if(sourceManga.mangaId !== mangaId) {
    sourceManga.mangaId = mangaId;
  }

  if(!sourceManga.mangaInfo) {
    sourceManga.mangaInfo = {} as MangaInfo;
  }
  if(!sourceManga.mangaInfo.additionalInfo) {
    sourceManga.mangaInfo.additionalInfo = {};
  }

  const metadataUpdaterEnabled = !skipMetadataUpdate && getMetadataUpdater();
  const serverMetadataChanged = !skipMetadataUpdate && pendingMetadataRefresh.has(mangaId);
  const needsFullRefresh =
    metadataUpdaterEnabled ||
    serverMetadataChanged ||
    !sourceManga.mangaInfo.status ||
    !sourceManga.mangaInfo.contentRating ||
    !sourceManga.mangaInfo.shareUrl;
  if(needsFullRefresh) {
    const previousAdditionalInfo = sourceManga.mangaInfo?.additionalInfo;
    const updatedManga = await getMangaDetails(mangaId);
    sourceManga.mangaInfo = updatedManga.mangaInfo;
    sourceManga.mangaInfo.additionalInfo = {
      ...previousAdditionalInfo,
      ...updatedManga.mangaInfo.additionalInfo,
    };    pendingMetadataRefresh.delete(mangaId);
  }

  const languages: string[] = getLanguages();
  const languageSet = new Set(languages);
  const skipSameChapter = getSkipSameChapter();
  const ratings: string[] = getRatings();

  {
    const storedMdRating = sourceManga.mangaInfo.additionalInfo?.mdContentRating as
      | string
      | undefined;
    const mangaPbRating = sourceManga.mangaInfo.contentRating;
    if(!isRatingAllowed(storedMdRating, mangaPbRating, ratings)) {
      const ratingForMessage = storedMdRating ?? mangaPbRating;
      throw new Error(
        `Content rating (${ratingForMessage}) not enabled in source settings (if it shows UNKNOWN, open the manga again).`,
      );
    }
  }

  const groupBlockingEnabled = getGroupBlockingEnabled();
  const fuzzyBlockingEnabled = getFuzzyBlockingEnabled();
  const blockedGroupsData = groupBlockingEnabled ? (getBlockedGroups() ?? {}) : {};
  const blockedGroups = Object.keys(blockedGroupsData);
  const blockedUploaders = getBlockedUploaders();
  // Precompute queries once. The .length value doubles as the "feature off" check inside the loop.
  const blockedGroupQueries =
    groupBlockingEnabled && fuzzyBlockingEnabled
      ? blockedGroups
        .map((id) => blockedGroupsData[id]?.attributes?.name)
        .filter((name): name is string => !!name)
        .map((name) => precomputeQuery(name))
      : [];
  const groupBlockCache = new Map<string, boolean>();
  const collectedChapters: Set<string> | null = skipSameChapter ? new Set<string>() : null;
  const chapters: Chapter[] = [];

  let offset = 0;
  let hasResults = true;
  let prevChapNum = 0;
  // Synthetic suffix for unnumbered chapters. Avoids collisions with fractionals.
  let unnumberedIndex = 0;
  // Paperback sorts on volume when any chapter has one, so a single volume tagged chapter
  // floats above the volume-null rest. If any chapter is missing volume, flatten all to 0.
  let anyMissingVolume = false;

  // True when the title restarts chapter numbering each volume. Read from the inline
  // manga relationship so the dedup key can keep volume and not drop real chapters.
  let resetChapterNumbersOnVolume = false;
  // Only the first page includes "manga". The relationship is identical across pages.
  const baseIncludes = ['scanlation_group'];
  // "manga" rides along on page 1 for the chapterNumbersResetOnNewVolume flag
  // the dedup key needs when skip same chapter is on.
  const needsInlineManga = skipSameChapter;
  const firstPageIncludes = needsInlineManga ? [...baseIncludes, 'manga'] : baseIncludes;

  // Local filter is a backstop for chapters that come back without publishAt.
  const publishAtSince = formatPublishAtSince(sinceDate);

  while(hasResults) {
    const includes = offset === 0 ? firstPageIncludes : baseIncludes;
    const request = {
      url: buildMangaFeedUrl({
        mangaId,
        offset,
        includes,
        blockedGroups,
        blockedUploaders,
        ratings,
        languages,
        publishAtSince,
      }).toString(),
      method: 'GET',
    };

    const json = await fetchJSON<ChapterResponse>(request);

    offset += FEED_PAGE_LIMIT;

    assertDataArray(json, mangaId);

    // Read the inline manga relationship (no separate /manga call) for the
    // volume reset dedup flag.
    if(needsInlineManga && offset === FEED_PAGE_LIMIT) {
      const mangaItem = readInlinedMangaItem(
        findMangaRelationship<ChapterRelationship>(
          json.data.flatMap((c) => c?.relationships ?? []),
        ),
      );
      const idMatches = mangaItem?.id?.toLowerCase() === mangaId;
      const mangaAttrs = mangaItem?.attributes;
      // Guard against MangaDex inlining a different manga's relationship.
      if(idMatches && mangaAttrs) {
        resetChapterNumbersOnVolume = mangaAttrs.chapterNumbersResetOnNewVolume === true;
      }
    }

    for(const chapter of json.data) {
      if(!chapter || !chapter.attributes) { continue; }
      const chapterId = chapter.id;
      const chapterDetails = chapter.attributes;
      // undefined (not epoch 0) for missing dates so the sinceDate backstop keeps them.
      const time = parseDateOrUndefined(chapterDetails.publishAt);

      // Feed URL already filters, but verify in case one slips through.
      if(!languageSet.has(chapterDetails.translatedLanguage)) {
        continue;
      }

      const rawTitle = decodeHTML(chapterDetails.title ?? '');
      // MangaDex marks pure oneshots by returning volume, chapter, and title all empty.
      const isPureOneshot = !chapterDetails.volume && !chapterDetails.chapter && !rawTitle;
      const name = isPureOneshot ? 'Oneshot' : rawTitle;
      const { chapNum, isUnnumbered } = assignChapterNumber(chapterDetails.chapter, prevChapNum);
      if(isUnnumbered && skipSameChapter) {
        unnumberedIndex++;
      }
      prevChapNum = chapNum;

      const volume = Number(chapterDetails.volume) || 0;
      const langCode = MDLanguages.getFlagCode(chapterDetails.translatedLanguage);
      const groupNames = extractScanlationGroupNames(chapter);
      const group = groupNames.join(', ');
      const pages = normalizePagesCount(chapterDetails.pages);
      let identifier: string | undefined;
      if(skipSameChapter) {
        identifier = buildChapterIdentifier(
          chapNum,
          isUnnumbered,
          name,
          chapterDetails.translatedLanguage ?? '',
          unnumberedIndex,
          volume,
          resetChapterNumbersOnVolume,
        );
        if(collectedChapters!.has(identifier)) { continue; }
      }

      // Match per group. The joined string "Group A, Group B" never fuzzy matches "Group A".
      if(
        groupNames.length > 0 &&
        blockedGroupQueries.length > 0 &&
        groupNames.some((n) => isGroupNameBlocked(n, blockedGroupQueries, groupBlockCache))
      ) {
        continue;
      }

      const externalUrl = chapterDetails.externalUrl;
      const isUnavailable = pages === 0 || !!externalUrl || chapterDetails.isUnavailable === true;
      // Unavailable chapters are always hidden (like the 0.8 source and the
      // mdchecker server). Externally hosted chapters can have pages > 0
      // (a promo image), so check all three cases, not just pages=0.
      if(!isUnavailable) {
        // Count toward the volume flatten only once a chapter actually ships,
        // so a filtered entry can't drop every volume to 0.
        if(!chapterDetails.volume) { anyMissingVolume = true; }
        chapters.push({
          chapterId,
          sourceManga,
          title: name,
          chapNum,
          volume,
          langCode,
          version: group,
          publishDate: time,
          sortingIndex: 0,
        });
        if(identifier !== undefined) { collectedChapters!.add(identifier); }
      }
    }

    // MangaDex caps offset + limit at MAX_API_OFFSET, so stop before the next request would 400.
    if(
      json.data.length < FEED_PAGE_LIMIT ||
      typeof json.total !== 'number' ||
      json.total <= offset ||
      offset >= MAX_API_OFFSET
    ) {
      hasResults = false;
    }
  }

  const filteredChapters =
    sinceDate instanceof Date
      ? chapters.filter((chapter) => !chapter.publishDate || chapter.publishDate >= sinceDate)
      : chapters;
  if(anyMissingVolume) {
    // Use 0, not undefined. The host renders "TBA" when the volume property is missing,
    for(const chapter of filteredChapters) {
      chapter.volume = 0;
    }
  }
  filteredChapters.forEach((chapter, index) => {
    chapter.sortingIndex = filteredChapters.length - index;
  });
  // Tell paperback-mdchecker this manga now has current chapters (stamps
  // last_check and starts tracking it). No-op when the checker is off.
  await notifyMangaFetched(mangaId);
  return filteredChapters;
}

export async function getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
  const [chapterId, mangaId] = await Promise.all([
    resolveChapterId(chapter.chapterId),
    resolveMangaId(chapter.sourceManga.mangaId),
  ]);
  if(chapter.chapterId !== chapterId) { chapter.chapterId = chapterId; }
  if(chapter.sourceManga.mangaId !== mangaId) { chapter.sourceManga.mangaId = mangaId; }

  const dataSaver = getDataSaver();
  const forcePort = getForcePort443();

  const request = {
    url: buildAtHomeServerUrl(chapterId, forcePort),
    method: 'GET',
  };

  // Acknowledge any pending re-release of this chapter on paperback-mdchecker.
  // Runs alongside the page fetch and never throws.
  const checkerAck = notifyChapterDownload(chapterId);

  const json = await fetchJSON<ChapterDetailsResponse>(request);
  if(!json.baseUrl || !json.chapter || !json.chapter.hash) {
    throw new Error(`MangaDex returned malformed chapter response for ${chapterId}`);
  }
  const serverUrl = json.baseUrl;
  const chapterDetails = json.chapter;
  // Fall back to full quality if dataSaver is empty. New chapters often ship that way.
  const useDataSaver =
    dataSaver && Array.isArray(chapterDetails.dataSaver) && chapterDetails.dataSaver.length > 0;
  const sourceArray = useDataSaver ? chapterDetails.dataSaver : chapterDetails.data;
  if(!Array.isArray(sourceArray) || sourceArray.length === 0) {
    throw new Error(`MangaDex returned no pages for chapter ${chapterId}`);
  }

  const qualityPath = useDataSaver ? 'data-saver' : 'data';
  const pages = sourceArray.map(
    (x: string) => `${serverUrl}/${qualityPath}/${chapterDetails.hash}/${x}`,
  );

  await checkerAck;
  return { id: chapterId, mangaId: mangaId, pages };
}

export async function processTitlesForUpdates(
  updateManager: UpdateManager,
  lastUpdateDate?: Date,
): Promise<void> {
  const sourceManga = updateManager.getQueuedItems();

  // Unresolved ids = deleted (empty chapters). Network errors propagate to retry the pass.
  const idMap = await resolveMangaIds(sourceManga.map((m) => m.mangaId));

  const mangaIds: string[] = [];
  const skipped: string[] = [];
  for(const manga of sourceManga) {
    const resolved = idMap[manga.mangaId];
    if(!resolved) {
      skipped.push(manga.mangaId);
      continue;
    }
    if(manga.mangaId !== resolved) { manga.mangaId = resolved; }
    mangaIds.push(manga.mangaId);
  }
  if(skipped.length > 0) {
    await Promise.all(skipped.map((mangaId) => updateManager.setNewChapters(mangaId, [])));
  }

  // paperback-mdchecker pass: skip only the ids the server reports as current
  // whose metadata didn't change. Anything else (updated, unknown, missing, a
  // failed request, or a metadata change) gets a normal getChapters call from
  // the app, and metadata changes also get a full details refresh there.
  const checked = await checkMangaBatch(mangaIds, lastUpdateDate);
  for(const mangaId of checked.metadataUpdated) {
    pendingMetadataRefresh.add(mangaId);
  }
  const idsToSkip = mangaIds.filter(
    (mangaId) => checked.current.has(mangaId) && !checked.metadataUpdated.has(mangaId),
  );
  await Promise.all(idsToSkip.map((mangaId) => updateManager.setNewChapters(mangaId, [])));

  // The upstream "Optimized Updates" MangaDex probe is removed on purpose:
  // paperback-mdchecker already decides what needs fetching.
}
