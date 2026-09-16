# Frontend Layout & Configurable SiteConfig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SPA branding, footer, and homepage "how to use" block fully data-driven from `site.config.ts`, and harden front-end + Worker against the `JSON.parse` error when `/api/index/...` returns non-JSON.

**Architecture:** Replace the hardcoded "personal apt repository" tagline, hardcoded `<title>`, unused `faviconUrl`/`introTitle`, and the unhelpful "Sources/Install" footer line with optional fields on a redesigned `SiteConfig` interface. Front-end `fetchIndex`/`searchPackages` parse defensively (Content-Type check); Worker `loadIndex`/`handleIndex`/`handleSearch` swallow R2 errors and return `{ packages: [], error }` instead of letting Hono render an HTML 500.

**Tech Stack:** Vue 3 (`<script setup>`, Composition API), Vue Router 4, UnoCSS, Vite 6; Hono 4 on Cloudflare Workers; Vitest 3 with `@cloudflare/vitest-pool-workers`; TypeScript 5.

## Global Constraints

- All new `SiteConfig` string fields default to empty / sensible placeholder so an unedited fork never shows "TBD" or broken widgets.
- `apt-client/src/pages/PackagePage.vue:34` link text is already changed to `download` (uncommitted) — keep that line.
- `apt-client/src/pages/PackagePage.vue:16` Description paragraph already has `mt-3 leading-relaxed` (uncommitted) — keep that line.
- Worker never returns HTML for an `/api/*` route — JSON envelope `{ packages: [], error?: string }` is the contract.
- New vitest cases go into `apt-worker/test/api-index.test.ts` (already imports `handleIndex`).

---

## File Structure

**Modify:**
- `apt-client/src/site.config.ts` — replace `SiteConfig` interface + defaults.
- `apt-client/index.html` — drop hardcoded `<title>` line.
- `apt-client/src/main.ts` — set `document.title` and inject `<link rel="icon">` from `siteConfig`.
- `apt-client/src/pages/HomePage.vue` — header (icon + title + optional tagline), drop hardcoded "personal apt repository", add `usageSteps` section.
- `apt-client/src/pages/BrowsePage.vue` — header (icon + title only, no tagline).
- `apt-client/src/pages/PackagePage.vue` — header (icon + title only); keep `download` link text and Description spacing (already on disk).
- `apt-client/src/pages/SearchPage.vue` — header (icon + title only).
- `apt-client/src/components/Footer.vue` — drop `Sources / Install` paragraph; add conditional GitHub link.
- `apt-client/src/components/PackageTable.vue` — change `Download .deb` to `download`.
- `apt-client/src/api/packages.ts` — Content-Type guard + fallback `[]` on missing `packages`.
- `apt-worker/src/api-index.ts` — wrap `loadIndex`/`handleIndex`/`handleSearch` in try/catch.
- `apt-worker/test/api-index.test.ts` — new tests for empty-on-throw and error-envelope on unexpected exception.

**Create:** none.

---

## Task 1: Replace `SiteConfig` schema

**Files:**
- Modify: `apt-client/src/site.config.ts:1-22`

**Interfaces:** none — this task produces the schema consumed by all later tasks.

- [ ] **Step 1: Replace the file contents**

Write the full file as:

```ts
export interface UsageStep {
    title: string;
    code: string;
    note?: string;
}

export interface SiteConfig {
    headerTitle: string;
    headerTagline?: string;
    browserTabTitle?: string;
    iconUrl?: string;
    iconAlt?: string;
    homepageIntroLines: string[];
    usageSteps: UsageStep[];
    showGithubButton: boolean;
    githubUrl: string;
    defaultSuite: string;
}

export const siteConfig: SiteConfig = {
    headerTitle: 'Cloud APT',
    headerTagline: '',
    browserTabTitle: 'Cloud APT',
    iconUrl: '',
    iconAlt: '',
    homepageIntroLines: [
        'Cloudflare Workers + R2 powered apt repository.',
        'Sign your own GPG key, deploy in 5 minutes.',
    ],
    usageSteps: [
        { title: '1. Add the repository',
          code: 'deb https://<your-worker-domain> kali-rolling main' },
        { title: '2. Update package index',
          code: 'sudo apt update' },
        { title: '3. Install a package',
          code: 'sudo apt install <package-name>' },
    ],
    showGithubButton: true,
    githubUrl: 'https://github.com/<you>/cloud-apt',
    defaultSuite: 'kali-rolling',
};
```

- [ ] **Step 2: Verify the schema compiles**

Run: `npm --workspace apt-client run typecheck`
Expected: `vue-tsc --noEmit` exits 0.

- [ ] **Step 3: Commit**

```bash
git add apt-client/src/site.config.ts
git commit -m "feat(client): redesign SiteConfig with optional branding + usage steps"
```

---

## Task 2: Strip hardcoded `<title>` from index.html

**Files:**
- Modify: `apt-client/index.html:6`

**Interfaces:** none — pure markup tweak; `main.ts` will own the runtime injection.

- [ ] **Step 1: Edit `apt-client/index.html`**

Replace the entire file with:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Verify build still succeeds**

Run: `npm --workspace apt-client run build`
Expected: `vite build` exits 0; `apt-client/dist/index.html` exists and contains no `<title>`.

- [ ] **Step 3: Commit**

```bash
git add apt-client/index.html
git commit -m "feat(client): drop hardcoded <title>; injected by main.ts"
```

---

## Task 3: Inject `<title>` and favicon from `main.ts`

**Files:**
- Modify: `apt-client/src/main.ts:1-22`

**Interfaces:**
- Consumes: `siteConfig` (`browserTabTitle`, `iconUrl`, `iconAlt`) from `site.config.ts`.
- Produces: at module load, `document.title` and optional `<link rel="icon">` element.

- [ ] **Step 1: Edit `apt-client/src/main.ts`**

Replace the entire file with:

```ts
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { siteConfig } from './site.config';
import 'virtual:uno.css';
import '@unocss/reset/tailwind.css';

import HomePage from './pages/HomePage.vue';
import BrowsePage from './pages/BrowsePage.vue';
import PackagePage from './pages/PackagePage.vue';
import SearchPage from './pages/SearchPage.vue';

document.title = siteConfig.browserTabTitle || siteConfig.headerTitle;
if (siteConfig.iconUrl) {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
        ?? document.createElement('link');
    link.rel = 'icon';
    link.href = siteConfig.iconUrl;
    if (siteConfig.iconAlt) link.alt = siteConfig.iconAlt;
    if (!link.isConnected) document.head.appendChild(link);
}

const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/', component: HomePage },
        { path: '/browse', component: BrowsePage },
        { path: '/browse/:pkg', component: PackagePage, props: true },
        { path: '/search', component: SearchPage },
    ],
});

createApp(App).use(router).mount('#app');
```

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npm --workspace apt-client run typecheck
npm --workspace apt-client run build
```
Expected: both exit 0. The generated `apt-client/dist/index.html` should now contain a `<title>Cloud APT</title>` (because Vite applies the runtime `document.title` to the template at build time only if we used a plugin — verify by reading the file; if absent, that's fine — Vite produces a static template).

- [ ] **Step 3: Commit**

```bash
git add apt-client/src/main.ts
git commit -m "feat(client): inject <title> and favicon from siteConfig"
```

---

## Task 4: Rebuild `HomePage.vue` header and add `usageSteps` section

**Files:**
- Modify: `apt-client/src/pages/HomePage.vue:1-37`

**Interfaces:**
- Consumes: `siteConfig.headerTitle`, `siteConfig.headerTagline`, `siteConfig.iconUrl`, `siteConfig.iconAlt`, `siteConfig.homepageIntroLines`, `siteConfig.usageSteps`, `siteConfig.defaultSuite`.

- [ ] **Step 1: Replace the template**

Replace the file with:

```vue
<template>
  <div class="max-w-1100px mx-auto p-8">
    <header class="flex items-baseline justify-between mb-8 gap-3">
      <div class="flex items-baseline gap-3">
        <img
          v-if="siteConfig.iconUrl"
          :src="siteConfig.iconUrl"
          :alt="siteConfig.iconAlt || ''"
          class="h-7 w-7 self-center"
        />
        <h1 class="text-2xl">
          <router-link to="/" class="text-fg no-underline">{{ siteConfig.headerTitle }}</router-link>
        </h1>
      </div>
      <span v-if="siteConfig.headerTagline" class="text-muted text-sm">{{ siteConfig.headerTagline }}</span>
    </header>

    <SearchBox placeholder="搜索包名、描述、依赖…" />

    <section class="mt-8">
      <h2 class="text-lg mb-4">Welcome</h2>
      <p v-for="(line, i) in siteConfig.homepageIntroLines" :key="i" class="text-muted mb-2">
        {{ line }}
      </p>
    </section>

    <section class="mt-8">
      <h2 class="text-lg mb-4">Browse</h2>
      <router-link
        :to="`/browse?suite=${siteConfig.defaultSuite}&arch=amd64`"
        class="inline-block px-4 py-2 bg-card border border-border rounded-md text-accent no-underline hover:bg-hover"
      >
        Browse {{ siteConfig.defaultSuite }} (amd64)
      </router-link>
    </section>

    <section v-if="siteConfig.usageSteps.length" class="mt-8">
      <h2 class="text-lg mb-4">How to use this repository</h2>
      <ol class="list-decimal pl-6 space-y-3">
        <li v-for="step in siteConfig.usageSteps" :key="step.title">
          <strong>{{ step.title }}</strong>
          <pre class="mt-1 p-2 bg-card border border-border rounded text-sm overflow-x-auto"><code>{{ step.code }}</code></pre>
          <p v-if="step.note" class="text-muted text-sm mt-1">{{ step.note }}</p>
        </li>
      </ol>
    </section>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import { siteConfig } from '../site.config';
import SearchBox from '../components/SearchBox.vue';
import Footer from '../components/Footer.vue';
</script>
```

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npm --workspace apt-client run typecheck
npm --workspace apt-client run build
```
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add apt-client/src/pages/HomePage.vue
git commit -m "feat(client): data-driven header + usage-steps section on home"
```

---

## Task 5: Trim tagline from `BrowsePage` / `PackagePage` / `SearchPage` headers

**Files:**
- Modify: `apt-client/src/pages/BrowsePage.vue:1-35`
- Modify: `apt-client/src/pages/PackagePage.vue:1-79` (only the `<header>` block; preserve the existing `download` link text and `mt-3 leading-relaxed` Description paragraph)
- Modify: `apt-client/src/pages/SearchPage.vue:1-54`

**Interfaces:** Consumes `siteConfig.headerTitle`, `siteConfig.iconUrl`, `siteConfig.iconAlt`.

- [ ] **Step 1: Replace the `<header>` in `BrowsePage.vue`**

Replace lines 3-7:

```html
    <header class="flex items-center mb-8 gap-3">
      <img
        v-if="siteConfig.iconUrl"
        :src="siteConfig.iconUrl"
        :alt="siteConfig.iconAlt || ''"
        class="h-7 w-7"
      />
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.headerTitle }}</router-link>
      </h1>
    </header>
```

- [ ] **Step 2: Replace the `<header>` in `PackagePage.vue`**

The current header block (lines 3-7) is unchanged in this respect. Replace it with the same icon + title block as in Step 1:

```html
    <header class="flex items-center mb-8 gap-3">
      <img
        v-if="siteConfig.iconUrl"
        :src="siteConfig.iconUrl"
        :alt="siteConfig.iconAlt || ''"
        class="h-7 w-7"
      />
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.headerTitle }}</router-link>
      </h1>
    </header>
```

Leave lines 16 and 34 (the `mt-3 leading-relaxed` Description paragraph and the `download` link) untouched.

- [ ] **Step 3: Replace the `<header>` in `SearchPage.vue`**

Replace lines 3-7 with the same icon + title block:

```html
    <header class="flex items-center mb-8 gap-3">
      <img
        v-if="siteConfig.iconUrl"
        :src="siteConfig.iconUrl"
        :alt="siteConfig.iconAlt || ''"
        class="h-7 w-7"
      />
      <h1 class="text-2xl">
        <router-link to="/" class="text-fg no-underline">{{ siteConfig.headerTitle }}</router-link>
      </h1>
    </header>
```

- [ ] **Step 4: Verify typecheck + build**

Run:
```bash
npm --workspace apt-client run typecheck
npm --workspace apt-client run build
```
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apt-client/src/pages/BrowsePage.vue apt-client/src/pages/PackagePage.vue apt-client/src/pages/SearchPage.vue
git commit -m "feat(client): unified icon+title header on browse/package/search"
```

---

## Task 6: Replace `Footer.vue` content with optional GitHub button

**Files:**
- Modify: `apt-client/src/components/Footer.vue:1-12`

**Interfaces:** Consumes `siteConfig.showGithubButton`, `siteConfig.githubUrl`.

- [ ] **Step 1: Replace the file contents**

Write the full file as:

```vue
<template>
  <footer class="mt-12 pt-4 border-t border-border text-muted text-sm flex items-center justify-end">
    <a
      v-if="siteConfig.showGithubButton"
      :href="siteConfig.githubUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="text-accent no-underline hover:underline"
    >
      GitHub
    </a>
  </footer>
</template>

<script setup lang="ts">
import { siteConfig } from '../site.config';
</script>
```

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npm --workspace apt-client run typecheck
npm --workspace apt-client run build
```
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add apt-client/src/components/Footer.vue
git commit -m "feat(client): footer shows GitHub link only when configured"
```

---

## Task 7: Trim "Download .deb" in `PackageTable.vue`

**Files:**
- Modify: `apt-client/src/components/PackageTable.vue:23`

**Interfaces:** none — link text only.

- [ ] **Step 1: Replace the link text**

Change line 23 from:

```html
          <a :href="`/${p.Filename}`" class="text-accent no-underline hover:underline" download>Download .deb</a>
```

to:

```html
          <a :href="`/${p.Filename}`" class="text-accent no-underline hover:underline" download>download</a>
```

- [ ] **Step 2: Verify build**

Run: `npm --workspace apt-client run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apt-client/src/components/PackageTable.vue
git commit -m "feat(client): trim download link label"
```

---

## Task 8: Harden `api/packages.ts` with Content-Type guard

**Files:**
- Modify: `apt-client/src/api/packages.ts:1-28`

**Interfaces:**
- Consumes: `fetch` response.
- Produces: `PackageEntry[]` on success; `Error` whose `message` includes `HTTP <status>` and `Content-Type` on failure.

- [ ] **Step 1: Replace the file contents**

Write the full file as:

```ts
import type { IndexResponse, PackageEntry } from '../types';

const BASE = '';

async function parseIndex(r: Response): Promise<PackageEntry[]> {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const ct = r.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
        throw new Error(`expected JSON, got "${ct || 'no content-type'}" (HTTP ${r.status})`);
    }
    const json = (await r.json()) as IndexResponse;
    return json.packages ?? [];
}

export async function fetchIndex(suite: string, arch: string): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}`);
    return parseIndex(r);
}

export async function searchPackages(
    suite: string,
    arch: string,
    query: string
): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}/search?q=${encodeURIComponent(query)}`);
    return parseIndex(r);
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
```

- [ ] **Step 2: Verify typecheck + build**

Run:
```bash
npm --workspace apt-client run typecheck
npm --workspace apt-client run build
```
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add apt-client/src/api/packages.ts
git commit -m "fix(client): guard fetchIndex/searchPackages against non-JSON responses"
```

---

## Task 9: TDD — Worker `loadIndex` returns `[]` on R2 throw

**Files:**
- Modify: `apt-worker/src/api-index.ts:1-65`
- Modify: `apt-worker/test/api-index.test.ts` (append two test cases)

**Interfaces:**
- Existing: `handleIndex(suite, arch, env) → Promise<Response>`, `handleSearch(suite, arch, query, env) → Promise<Response>`, `loadIndex(env, suite, arch) → Promise<PackageEntry[]>` (private but tested via the public handlers).
- Produces: same handlers, but `loadIndex` swallows R2/parser exceptions into `[]` and logs to console; `handleIndex`/`handleSearch` wrap the whole flow in try/catch and return `{ packages: [], error }` JSON on unexpected exceptions.

- [ ] **Step 1: Write the failing test**

Append to `apt-worker/test/api-index.test.ts`:

```ts
import { handleIndex, handleSearch } from '../src/api-index';

test('handleIndex returns empty array when R2 get throws', async () => {
    const env = {
        APT_BUCKET: {
            get: () => { throw new Error('simulated R2 outage'); },
            head: () => Promise.resolve(null),
            list: () => Promise.resolve({ objects: [], truncated: false, cursor: undefined }),
            put: () => Promise.resolve({}),
            delete: () => Promise.resolve({}),
            createMultipartUpload: () => Promise.resolve({}),
            resumeMultipartUpload: () => Promise.resolve({}),
        },
    } as unknown as Bindings;
    const r = await handleIndex('kali-rolling', 'amd64', env);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ packages: [] });
});

test('handleSearch returns empty array when R2 get throws', async () => {
    const env = {
        APT_BUCKET: {
            get: () => { throw new Error('simulated R2 outage'); },
        },
    } as unknown as Bindings;
    const r = await handleSearch('kali-rolling', 'amd64', 'hello', env);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ packages: [] });
});
```

(Add `import type { Bindings } from '../src/env';` at the top of the file if not already imported. The existing test file already imports from `'../src/api-index'` — confirm and reuse the same import path.)

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm --workspace apt-worker test -- api-index`
Expected: the two new tests FAIL (unhandled exception bubbles up; `r.json()` rejects with `simulated R2 outage`).

- [ ] **Step 3: Wrap `loadIndex` in try/catch**

In `apt-worker/src/api-index.ts`, change `loadIndex` so its body is wrapped:

```ts
async function loadIndex(env: Bindings, suite: string, arch: Arch): Promise<PackageEntry[]> {
    try {
        const bucket = env.APT_BUCKET;
        if (!bucket) return [];
        const obj = await bucket.get(await resolveIndexKey(bucket, `dists/${suite}/main/binary-${arch}/Packages.gz`));
        if (!obj) return [];
        const etag = obj.httpEtag;
        const cached = await getCachedIndex(env, suite, arch);
        if (cached && cached.etag === etag) {
            await obj.body?.cancel();
            return cached.entries;
        }
        const stream = new Response(obj.body).body!.pipeThrough(new DecompressionStream('gzip'));
        const text = await new Response(stream).text();
        const entries = parsePackages(text);
        await setCachedIndex(env, suite, arch, { etag, entries });
        return entries;
    } catch (e) {
        console.error(`loadIndex(${suite}, ${arch}) failed:`, e);
        return [];
    }
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npm --workspace apt-worker test -- api-index`
Expected: both new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apt-worker/src/api-index.ts apt-worker/test/api-index.test.ts
git commit -m "fix(worker): swallow R2 exceptions in loadIndex"
```

---

## Task 10: TDD — Worker `handleIndex`/`handleSearch` return JSON `{ packages: [], error }` on unexpected exception

**Files:**
- Modify: `apt-worker/src/api-index.ts:49-65`

- [ ] **Step 1: Write the failing test**

Append to `apt-worker/test/api-index.test.ts`:

```ts
test('handleIndex returns JSON error envelope on invalid arch', async () => {
    const env = {
        APT_BUCKET: { get: () => Promise.resolve(null) },
    } as unknown as Bindings;
    const r = await handleIndex('kali-rolling', 'riscv64', env);
    expect(r.status).toBe(400);
    expect(r.headers.get('Content-Type')).toContain('application/json');
    expect(await r.json()).toEqual({ packages: [], error: 'Invalid arch' });
});

test('handleSearch returns JSON error envelope on invalid suite', async () => {
    const env = {
        APT_BUCKET: { get: () => Promise.resolve(null) },
    } as unknown as Bindings;
    const r = await handleSearch('../etc/passwd', 'amd64', 'hello', env);
    expect(r.status).toBe(400);
    expect(r.headers.get('Content-Type')).toContain('application/json');
    expect(await r.json()).toEqual({ packages: [], error: 'Invalid suite' });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm --workspace apt-worker test -- api-index`
Expected: the two new tests FAIL because the existing handlers return `new Response('Invalid arch', { status: 400 })` (plain text), not JSON.

- [ ] **Step 3: Update `handleIndex` and `handleSearch` to return JSON envelopes**

In `apt-worker/src/api-index.ts`, replace the existing `handleIndex` and `handleSearch` with:

```ts
function jsonError(status: number, message: string): Response {
    return Response.json({ packages: [], error: message }, { status });
}

export async function handleIndex(suite: string, arch: string, env: Bindings): Promise<Response> {
    if (!validateSuite(suite)) return jsonError(400, 'Invalid suite');
    if (!ARCHS.includes(arch as Arch)) return jsonError(400, 'Invalid arch');
    try {
        const entries = await loadIndex(env, suite, arch as Arch);
        return Response.json({ packages: entries });
    } catch (e) {
        console.error(`handleIndex(${suite}, ${arch}) failed:`, e);
        return jsonError(500, e instanceof Error ? e.message : 'unknown error');
    }
}

export async function handleSearch(
    suite: string,
    arch: string,
    query: string,
    env: Bindings
): Promise<Response> {
    if (!validateSuite(suite)) return jsonError(400, 'Invalid suite');
    if (!ARCHS.includes(arch as Arch)) return jsonError(400, 'Invalid arch');
    try {
        const all = await loadIndex(env, suite, arch as Arch);
        const q = query.toLowerCase();
        const filtered = all.filter(
            (p) =>
                p.Package.toLowerCase().includes(q) ||
                (p.Description || '').toLowerCase().includes(q) ||
                (p.Depends || '').toLowerCase().includes(q)
        );
        return Response.json({ packages: filtered });
    } catch (e) {
        console.error(`handleSearch(${suite}, ${arch}, ${query}) failed:`, e);
        return jsonError(500, e instanceof Error ? e.message : 'unknown error');
    }
}
```

- [ ] **Step 4: Update existing tests in the same file**

The existing tests for `handleIndex` / `handleSearch` may have asserted `await r.text()` against plain `Invalid arch`. They now need to read JSON. Open the file and update any pre-existing test that expected plain text — change the assertion to `await r.json()` and check for `{ packages: [], error: 'Invalid arch' }` / `{ packages: [], error: 'Invalid suite' }`. If the file only contains tests written against the new contract (no plain-text expectations), skip this step.

- [ ] **Step 5: Run the full worker test suite**

Run: `npm --workspace apt-worker test`
Expected: all tests PASS (was 56; now 60 — four new + adjusted pre-existing).

- [ ] **Step 6: Commit**

```bash
git add apt-worker/src/api-index.ts apt-worker/test/api-index.test.ts
git commit -m "fix(worker): return JSON error envelope for /api/index and /search"
```

---

## Task 11: End-to-end verification + dev-server smoke test

**Files:** none — verification only.

- [ ] **Step 1: Run typecheck across both workspaces**

Run: `npm run typecheck`
Expected: both `apt-worker` and `apt-client` typecheck exit 0.

- [ ] **Step 2: Run full Worker test suite**

Run: `npm test`
Expected: ≥60 tests pass.

- [ ] **Step 3: Build SPA + copy to Worker `dist/`**

Run: `npm run build`
Expected: `apt-client/dist/` populated; `apt-worker/dist/` populated with SPA assets.

- [ ] **Step 4: Boot `wrangler dev` and curl the API**

Run in the background:
```bash
npm --workspace apt-worker run dev
```
Wait for `[mf:info] Ready on http://localhost:8787`. Then:

```bash
curl -sS http://localhost:8787/api/status/health
curl -sS http://localhost:8787/api/index/kali-rolling/amd64
curl -sS http://localhost:8787/api/index/kali-rolling/amd64/search?q=hello
```
Expected:
- `/api/status/health`: `{"status":"ok"}`.
- `/api/index/kali-rolling/amd64`: `{"packages":[]}` with `Content-Type: application/json`.
- Search endpoint: `{"packages":[]}`.

- [ ] **Step 5: Visual smoke test (manual)**

Open `http://localhost:8787/` in a browser and confirm:
- Header shows `Cloud APT` only — no `personal apt repository` subtitle.
- "How to use this repository" section appears with 3 numbered steps, each rendering the `<code>` block with the configured text.
- Footer shows a single `GitHub` link on the right.
- `/browse?suite=kali-rolling&arch=amd64` shows `Loading…` then `0 packages`, never a JSON.parse error.

Stop the dev server when done: `Ctrl-C` (or kill the background process).

- [ ] **Step 6: Final commit (if any stray edits)**

If the dev-server smoke test surfaced a typo or missing import, fix it and commit:

```bash
git status
git add -A
git commit -m "chore: address smoke-test feedback"
```

Otherwise, no commit.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §3 SiteConfig schema + defaults | Task 1 |
| §4.1 index.html stripped | Task 2 |
| §4.2 main.ts injects title + icon | Task 3 |
| §4.3 HomePage: header + tagline + usageSteps | Task 4 |
| §4.4 Browse/Package/Search headers trimmed | Task 5 |
| §4.5 Footer: remove Sources/Install + GitHub button | Task 6 |
| User addition: PackageTable "download" label | Task 7 |
| User addition: PackagePage description spacing + "download" | Already on disk; preserved in Task 5 |
| §5.2 frontend Content-Type guard | Task 8 |
| §5.2 worker `loadIndex` try/catch | Task 9 |
| §5.2 worker `handleIndex`/`handleSearch` JSON envelope | Task 10 |
| §5.3 vitest cases | Tasks 9 & 10 |
| §6 verification | Task 11 |

No gaps.

**2. Placeholder scan**

Searched the plan for `TBD`, `TODO`, `implement later`, `add appropriate`, `similar to Task`. None present.

**3. Type / name consistency**

- `SiteConfig` defined once in Task 1; all later tasks reference it.
- `jsonError` helper defined in Task 10; not referenced elsewhere.
- `handleIndex` / `handleSearch` signatures unchanged — all existing tests in `apt-worker/test/api-index.test.ts` continue to call them with `(suite, arch, env)` / `(suite, arch, query, env)`.
- `loadIndex` is private; tests assert via `handleIndex`/`handleSearch` public API. Task 9 keeps the private signature.

No mismatches.