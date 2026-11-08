import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from '@paperback/types';

import { NHLanguages } from './helpers';
import type {
  Gallery,
  GalleryListItem,
  ImagePageObject,
  QueryResponse,
  TagObject,
} from './models';
import { NHENTAI_URL } from './network';

const IMAGE_SERVER = 'https://i4.nhentai.net';
const THUMB_SERVER = 'https://t3.nhentai.net';

export function parseMangaDetails(data: Gallery): SourceManga {
  const artist = getArtist(data);

  const tags: Tag[] = data.tags
    .filter((tag) => tag.type === 'tag')
    .map((tag) => ({ id: tagId(tag), title: capitalizeTags(tag.name) }));

  // pretty, english, japanese first, then anything else the API returns.
  const titles: string[] = [data.title.pretty, data.title.english, data.title.japanese]
    .filter((title): title is string => !!title && title !== '');
  for(const title of Object.values(data.title)) {
    if(typeof title === 'string' && title !== '' && !titles.includes(title)) {
      titles.push(title);
    }
  }

  const mangaId = data.id.toString();
  return {
    mangaId,
    mangaInfo: {
      primaryTitle: titles[0] ?? `Gallery ${mangaId}`,
      secondaryTitles: titles.slice(1),
      artist,
      author: artist,
      thumbnailUrl: getCoverImage(data),
      status: 'Completed',
      contentRating: ContentRating.ADULT,
      tagGroups: [{ id: 'tags', title: 'Tags', tags }],
      synopsis: `Pages: ${data.num_pages}`,
      shareUrl: `${NHENTAI_URL}/g/${mangaId}`,
    },
  };
}

export function parseChapter(data: Gallery, sourceManga: SourceManga): Chapter {
  return {
    chapterId: sourceManga.mangaId,
    sourceManga,
    chapNum: 1,
    // Left unset, the app shows "Vol. TBD". 0 means no volume.
    volume: 0,
    title: data.title.english,
    langCode: NHLanguages.getLangCode(getLanguage(data)),
    publishDate: new Date(data.upload_date * 1000),
    sortingIndex: 1,
  };
}

export function parseChapterDetails(data: Gallery, mangaId: string): ChapterDetails {
  return {
    id: mangaId,
    mangaId,
    pages: getPages(data),
  };
}

export function parseSearch(data: QueryResponse): SearchResultItem[] {
  if(!Array.isArray(data?.result)) {
    throw new Error('JSON NO RESULT ERROR!\n\nThe API returned an unexpected response. Please try again in a moment.');
  }

  const items: SearchResultItem[] = [];
  const collectedIds = new Set<string>();
  for(const gallery of data.result) {
    const mangaId = gallery.id.toString();
    if(collectedIds.has(mangaId)) { continue; }
    collectedIds.add(mangaId);
    items.push({
      mangaId,
      title: getSearchTitle(gallery),
      subtitle: getSearchSubtitle(gallery),
      imageUrl: getSearchImage(gallery),
      contentRating: ContentRating.ADULT,
    });
  }
  return items;
}

// ===== Utility =====

// Paperback rejects ids with spaces or other symbols outside `._-@()[]%?#+=/&:`
// (e.g. "rough translation"), so use the slug and strip anything left over.
function tagId(tag: TagObject): string {
  const base = tag.slug && tag.slug !== '' ? tag.slug : tag.name.trim().replace(/\s+/g, '-');
  return base.replace(/[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g, '-');
}

function capitalizeTags(str: string): string {
  return str.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

const typeMap: Record<string, string> = { j: 'jpg', p: 'png', g: 'gif', w: 'webp' };

function typeOfImage(image: ImagePageObject): string {
  return typeMap[image.t] ?? '';
}

function withBase(base: string, path: string): string {
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function isGalleryListItem(gallery: Gallery | GalleryListItem): gallery is GalleryListItem {
  return 'english_title' in gallery;
}

function getCoverImage(gallery: Gallery): string {
  if(gallery.cover?.path) {
    return withBase(THUMB_SERVER, gallery.cover.path);
  }
  if(gallery.images?.cover) {
    return `${THUMB_SERVER}/galleries/${gallery.media_id}/cover.${typeOfImage(gallery.images.cover)}`;
  }
  return '';
}

function getPages(gallery: Gallery): string[] {
  if(gallery.pages?.length) {
    return gallery.pages.map((page) => withBase(IMAGE_SERVER, page.path));
  }
  if(gallery.images?.pages?.length) {
    return gallery.images.pages.map(
      (image, i) => `${IMAGE_SERVER}/galleries/${gallery.media_id}/${i + 1}.${typeOfImage(image)}`,
    );
  }
  return [];
}

function getSearchImage(gallery: Gallery | GalleryListItem): string {
  return isGalleryListItem(gallery) ? withBase(THUMB_SERVER, gallery.thumbnail) : getCoverImage(gallery);
}

function getSearchTitle(gallery: Gallery | GalleryListItem): string {
  if(isGalleryListItem(gallery)) {
    return gallery.english_title || gallery.japanese_title || `Gallery ${gallery.id}`;
  }
  return gallery.title.pretty || gallery.title.english || `Gallery ${gallery.id}`;
}

function getSearchSubtitle(gallery: Gallery | GalleryListItem): string {
  if(isGalleryListItem(gallery)) { return ''; }
  return `${NHLanguages.getName(getLanguage(gallery)).substring(0, 3)} | Pgs: ${gallery.num_pages}`;
}

function getArtist(gallery: Gallery): string {
  return gallery.tags.find((tag: TagObject) => tag.type === 'artist')?.name ?? '';
}

function getLanguage(gallery: Gallery): string {
  return gallery.tags.find((tag: TagObject) => tag.type === 'language' && tag.name !== 'translated')?.name ?? '';
}
