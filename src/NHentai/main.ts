import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  DiscoverSectionType,
  EndOfPageResults,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type UpdateManager,
} from '@paperback/types';

import { NHSortOrders } from './helpers';
import type { Gallery, QueryResponse } from './models';
import { NHENTAI_API, NHENTAI_URL, NHentaiInterceptor, fetchJSON } from './network';
import { parseChapter, parseChapterDetails, parseMangaDetails, parseSearch } from './parsers';
import type NHentaiConfig from './pbconfig';
import { NHentaiSettingsForm, getQuerySuffix, getSortOrder } from './settings';

// A type alias (not an interface) so it is assignable to JSONObject.
type PageMetadata = { page?: number };

const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: 'date', title: 'New Uploads', type: DiscoverSectionType.simpleCarousel },
  { id: 'popular-today', title: 'Popular Today', type: DiscoverSectionType.simpleCarousel },
  { id: 'popular-week', title: 'Popular Weekly', type: DiscoverSectionType.simpleCarousel },
];

function searchUrl(query: string, sort: string, page: number): string {
  return `${NHENTAI_API}/search?query=${encodeURIComponent(query)}&page=${page}&sort=${encodeURIComponent(sort)}`;
}

function nextPage(page: number, data: QueryResponse): PageMetadata | undefined {
  const hasMore = data.result.length > 0 && (typeof data.num_pages !== 'number' || page < data.num_pages);
  return hasMore ? { page: page + 1 } : undefined;
}

export class NHentaiExtension implements ExtensionImpl<typeof NHentaiConfig> {
  // Same pace as the 0.8 source (1 request per second, images excluded).
  rateLimiter = new BasicRateLimiter('rateLimiter', {
    numberOfRequests: 1,
    bufferInterval: 1,
    ignoreImages: true,
  });
  interceptor = new NHentaiInterceptor('main');
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: 'stateManager' });

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
  }

  // ===== Settings =====

  async getSettingsForm(): Promise<Form> {
    return new NHentaiSettingsForm();
  }

  // ===== Cloudflare =====

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for(const cookie of cookies) {
      if(/^_{0,2}cf/.test(cookie.name)) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  // ===== Manga and chapters =====

  getMangaShareUrl(mangaId: string): string {
    return `${NHENTAI_URL}/g/${mangaId}`;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await this.fetchGallery(mangaId));
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return [parseChapter(await this.fetchGallery(sourceManga.mangaId), sourceManga)];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    return parseChapterDetails(await this.fetchGallery(mangaId), mangaId);
  }

  // A gallery is a single chapter that never changes, so there is nothing to
  // update. This replaces the 0.8 "Skipping Bulk Update" throw.
  async processTitlesForUpdates(updateManager: UpdateManager, _lastUpdateDate?: Date): Promise<void> {
    await Promise.all(
      updateManager.getQueuedItems().map((manga) => updateManager.setNewChapters(manga.mangaId, [])),
    );
  }

  // ===== Discover =====

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const data = await fetchJSON<QueryResponse>(searchUrl(getQuerySuffix(), section.id, page));
    return {
      items: parseSearch(data).map((item) => ({
        type: 'simpleCarouselItem',
        mangaId: item.mangaId,
        title: item.title,
        subtitle: item.subtitle,
        imageUrl: item.imageUrl,
        contentRating: item.contentRating,
      })),
      metadata: nextPage(page, data),
    };
  }

  // ===== Search =====

  async getSortingOptions(_query: SearchQuery<PageMetadata>): Promise<SortingOption[]> {
    // The default sort order from settings goes first.
    const defaultSort = getSortOrder();
    return NHSortOrders.getNHCodeList()
      .map((id) => ({ id, label: NHSortOrders.getName(id) }))
      .sort((a, b) => (a.id === defaultSort ? -1 : b.id === defaultSort ? 1 : 0));
  }

  async getSearchResults(
    query: SearchQuery<PageMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = (query.title ?? '').trim();

    // A bare number is a gallery id.
    if(/^\d+$/.test(title)) {
      if(page > 1) { return EndOfPageResults; }
      const gallery = await fetchJSON<Gallery>(`${NHENTAI_API}/galleries/${title}`, true);
      if(!gallery) { return EndOfPageResults; }
      return { items: parseSearch({ result: [gallery], num_pages: 1, per_page: 1 }) };
    }

    const sort = sortingOption?.id ?? getSortOrder();
    const data = await fetchJSON<QueryResponse>(searchUrl(`${title} ${getQuerySuffix()}`.trim(), sort, page));
    return { items: parseSearch(data), metadata: nextPage(page, data) };
  }

  // ===== Utility =====

  private fetchGallery(mangaId: string): Promise<Gallery> {
    return fetchJSON<Gallery>(`${NHENTAI_API}/galleries/${mangaId}`);
  }
}

export const NHentai = new NHentaiExtension();
