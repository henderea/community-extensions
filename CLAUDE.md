# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Paperback extension repository (sources for the Paperback iOS manga reader) targeting the **0.8 extension API** (`@paperback/types` / `@paperback/toolchain` `0.8.0-alpha.47`). It currently has two sources: `src/MangaDex` and `src/NHentai`.

Branches are tied to the Paperback API version: `0.8` (this branch, default) and `0.9`. 0.9 uses a completely different API (no `App.create*`, `Application.*` instead), so code does not transfer between branches as-is.

## Commands

Package manager is pnpm.

- `pnpm lint` / `pnpm lint:fix`: ESLint on `src` (flat config from `eslint-config-henderea`). VS Code fixes on save via ESLint, with no separate formatter.
- `pnpm bundle`: builds every source into `bundles/` (gitignored), including `versioning.json` and `index.html`.
- `pnpm serve`: serves the bundles locally so a Paperback device can add the repo.
- `pnpm test <SourceId>`: runs the Paperback toolchain test harness against one source, e.g. `pnpm test MangaDex`. There are no unit tests.
- `./my-deploy.sh [name]`: bundles, then copies `bundles/` to the owner's personal server path (`/home/henderea/domains/paperback/<branch>`), served at `baseURL` in `package.json`. It uses `sudo`, so only run it when asked.

CI (`.github/workflows`) bundles each pushed branch into a same-named folder on `gh-pages`, and removes that folder when the branch is deleted.

## Architecture

The toolchain finds each source by its directory name under `src/`. Each source directory contains:

- `<Name>.ts`: exports `<Name>Info: SourceInfo` (metadata, `version`, `intents`) and `class <Name>`, which implements the 0.8 provider interfaces (`ChapterProviding`, `SearchResultsProviding`, `HomePageSectionsProviding`, …). **Bump `version` in `SourceInfo` when you change a source**, because the app uses it to detect updates.
- `<Name>Settings.ts`: DUI settings forms (`App.createDUIForm/Section/Switch/Select/InputField`) bound to `stateManager.store/retrieve`, plus the `get*` accessors the source calls. Secrets go in `stateManager.keychain`.
- `<Name>Helper.ts`, `<Name>Parser.ts`, `<Name>Interfaces.ts`: URL building and constants, response-to-Paperback-object parsing, and API response types.
- `includes/icon.png` is bundled with the source. JSON data (`external/tag.json`, `tags.json`) is imported directly (`resolveJsonModule`).

Runtime objects come from the global `App` (`App.createRequestManager`, `App.createSourceStateManager`, `App.createSourceManga`, …). Do not assume Node APIs are available.

### MangaDex specifics

- Uses the MangaDex JSON API (`api.mangadex.org`). The request interceptor adds the referer and an OAuth bearer token, and refreshes the token through `authEndpointRequest` when it is near expiry.
- **mdchecker integration**: when the `checker_base_url` and `checker_user` settings are set, `getChapters` first calls `tryChecker`. That calls the external paperback-mdchecker server (`GET <base>/manga-check?userId&mangaId&lastCheckEpoch`) through a separate `checkerRequestManager`, and stores a per-manga epoch in state (`${mangaId}-check-epoch`). If the server reports the manga is current, it **throws `'Already up to date'`** on purpose to skip the chapter fetch during update checks. This is a deliberate 0.8-only hack.
- Legacy numeric manga IDs are rejected with an "OLD ID" error.

### NHentai specifics

- Scrapes HTML/JSON from nhentai.net, needs Cloudflare bypass (`CLOUDFLARE_BYPASS_REQUIRED`), and retries on rate limiting (`MAX_RATE_LIMIT_RETRIES`).

## Misc

- `claude_input_files/` and `claude_output_files/` are gitignored scratch folders for hand-off notes, such as `paperback-0.9-mangadex-migration.md`, which describes porting MangaDex to the 0.9 branch.
- TypeScript is strict, with `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noImplicitOverride`.
