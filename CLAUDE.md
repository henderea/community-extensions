# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Paperback extension repository (sources for the Paperback iOS manga reader) targeting the **0.9 extension API** (`@paperback/types` / `@paperback/toolchain` `1.0.0-alpha.92`). It has two sources: `src/MangaDex` and `src/NHentai`.

Branches are tied to the Paperback API version: `0.8` (default branch, `App.create*` API) and `0.9` (this branch, `Application.*` API). Code does not transfer between branches as-is.

## Commands

Package manager is pnpm. The toolchain needs Node 24 or newer.

- `pnpm lint` / `pnpm lint:fix`: ESLint on `src` (flat config from `eslint-config-henderea`, plus `block-spacing`/`object-curly-spacing` in `eslint.config.mjs`). Single-line blocks are written `if(x) { return y; }`.
- `pnpm tsc`: typecheck only (`noEmit`).
- `pnpm bundle`: builds every source into `bundles/` (gitignored), including `versioning.json` and `index.html`.
- `pnpm serve` / `pnpm dev`: serve the bundles locally (`dev` watches) so a Paperback device can add the repo.
- `pnpm test <SourceId>`: runs `src/tests/<SourceId>.ts` (via `src/tests/suite.ts`) against the live site, e.g. `pnpm test MangaDex`. Results go to `bundles/tests.json`.
- `./my-deploy.sh [name]`: bundles, then copies `bundles/` to the owner's personal server path (`/home/henderea/domains/paperback/<branch>`), served at `baseURL` in `package.json`. It uses `sudo`, so only run it when asked.

CI (`.github/workflows`) bundles each pushed branch into a same-named folder on `gh-pages`, and removes that folder when the branch is deleted.

## Architecture

The toolchain finds each source as a directory under `src/` that has both `main.ts` and `pbconfig.ts`; the directory name is the source id.

- `pbconfig.ts`: default-exports the `ExtensionInfo` (`version`, `capabilities` as `SourceIntents.*`). **Bump `version` when you change a source**, because the app uses it to detect updates.
- `main.ts`: exports an `ExtensionImpl` instance. Interceptors (`PaperbackInterceptor`, `BasicRateLimiter`, `CookieStorageInterceptor`) are registered in `initialise()` and see **every** request the source makes.
- `static/icon.png` is bundled with the source.
- Runtime APIs come from the global `Application` (`scheduleRequest` returns `[Response, ArrayBuffer]`, `getState`/`setState(value, key)`, `Selector`, …). Do not assume Node APIs are available.
- Settings UI is `Form` subclasses built from `Section`, `InputRow`, `SelectRow`, `ToggleRow`, `ButtonRow`, … with handlers bound via `Application.Selector(this, 'method')`.

### MangaDex specifics

- Based on the general-extensions MangaDex source (`~/projects/general-extensions/src/MangaDex`, 1.0.0-alpha.27), reformatted with this repo's ESLint. Local changes on top of it:
  - **paperback-mdchecker** (`services/checker.ts`, settings in `settings-form/forms/checker-settings.ts`, state keys `checker_base_url` / `checker_user`, kept out of "Reset All Settings"). Enabled only when both are set.
    - `processTitlesForUpdates` posts the queue to `/manga-check-batch` and calls `setNewChapters(id, [])` only for ids in `current` and not in `metadataUpdated`; everything else gets a normal `getChapters`. Ids in `metadataUpdated` are remembered in memory (`pendingMetadataRefresh`) so `getChapters` does a full details refresh for them. All checker update calls fail open. Server side of `metadataUpdated`: `claude_output_files/paperback-0.9-metadata-updates.md`.
    - The upstream "Optimized Updates" probe (and its skip-by-count/status filters, batch size, and inline metadata refresh) is removed on purpose; the server is the only update optimization.
    - `getChapters` calls `/manga-fetched` after a successful fetch; `getChapterDetails` calls `/chapter-download`. Neither ever throws.
    - Managed collections come from the server (`/collections*`, ids prefixed `mdchecker:`) when the checker is enabled, otherwise MangaDex reading statuses (needs login).
    - "Potential Manga" home section (`potential_manga`) shows the server's admin potential-manga list (`/potential-manga`), and is available only to admins. "Test Connection" stores `isAdmin` from `/user-info` in `checker_is_admin`, which is cleared when the base URL or user changes. Sections can set `isAvailable` in `SECTION_DEFINITIONS`, and the discover settings form hides unavailable ones without dropping them from the saved order. Server side: `claude_output_files/paperback-0.9-potential-manga.md`.
    - `MangaDexRateLimiter` and the interceptor skip checker URLs.
    - Server contract: `claude_input_files/paperback-0.9-mangadex-migration.md` and `~/projects/paperback-mdchecker/lib/app/user/routes/paperback-09.tsx`.
  - Letter-suffix chapter numbers (`12a` → 12.1) in `chapter-providing/parsers.ts`.
  - Content rating (including Safe) shown as a "Content Rating" tag group in manga details, prefixed with the rating icon from `RATINGS` (tags have no color field).
  - Search does not filter by `availableTranslatedLanguage`, and "Has Available Chapters" defaults off.
  - Unavailable chapters (DMCA, empty, externally hosted) are always hidden; the upstream "Show Unavailable Chapters" toggle is removed (matches 0.8 and the mdchecker server).
  - The synopsis has no "Tracking available for" list, and the "Final: Vol./Ch." line goes at the top.

### NHentai specifics

- Port of the 0.8 source (nhentai API v2), not the much larger KakarotExtension NHentai. `network.ts` retries on 429 and throws `CloudflareError` on 403/503 or a `cf-mitigated` challenge; bypass cookies are stored by a `CookieStorageInterceptor`.
- `processTitlesForUpdates` marks every queued gallery as having no new chapters without making any requests (galleries never change), so update checks never fetch.

## Misc

- `claude_input_files/` and `claude_output_files/` are gitignored scratch folders for hand-off notes.
- TypeScript is strict with `noUnusedLocals` and `noImplicitOverride`; `noUncheckedIndexedAccess` is off because the upstream MangaDex code doesn't pass it.
