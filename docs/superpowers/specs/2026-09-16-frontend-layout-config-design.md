# Cloud APT 前端布局与可配置化设计

> 日期: 2026-09-16
> 状态: 已确认，待编写实现计划

## 1. 背景

当前 `apt-client` SPA 存在三处与 fork-友好理念冲突的问题：

1. `apt-client/src/pages/HomePage.vue:7` 硬编码副标题 `personal apt repository`，与"Cloud APT" 站点名重复且无法隐藏。
2. `apt-client/src/site.config.ts` 中 `title` 可配，但 `<title>` 标签 (`apt-client/index.html:6`) 与副标题都不可配；`faviconUrl` / `introTitle` 字段定义但从未使用。
3. `apt-client/src/components/Footer.vue:4-8` 的 `Sources: /pubkey.asc · Install: curl -fsSL /install.sh | sudo bash` 一行对浏览者意义不大，没有解释如何使用该仓库。

附加缺陷：`BrowsePage` 加载失败时显示 `Error: JSON.parse: unexpected character at line 1 column 1 of the JSON data`。该错误源自 `apt-client/src/api/packages.ts:8` 在 `await r.json()` 前不检查 `Content-Type`，当 Worker 返回 HTML 错误页时即爆。

## 2. 目标与非目标

### 2.1 目标

- `site.config.ts` 成为站点元数据唯一来源：站点名、浏览器标签名、副标题、图标、欢迎文案、使用说明、GitHub 链接、默认 Suite 全部可配。
- 副标题、图标、GitHub 按钮默认为空或关闭，对应元素不渲染（避免显示半成品内容）。
- 首页新增"如何使用本仓库"区块，默认三步：`sources.list` 一行 → `apt update` → `apt install <pkg>`。
- 底栏删除 `Sources: /pubkey.asc · Install: ...` 这一行；底栏保留以承载 GitHub 链接（可选）。
- 前端 `fetchIndex` / `searchPackages` 在响应非 JSON 时给出带状态码和 Content-Type 的清晰错误，而非把内部异常直接暴露给用户。
- Worker `handleIndex` / `handleSearch` 在 `loadIndex` 抛错时返回 `{ packages: [], error: '...' }` 而非 HTML 500。

### 2.2 非目标

- 不引入 i18n / 多语言框架；副标题只是单一字符串。
- 不在 Worker 端重新设计 SiteConfig 加载机制；服务端不返回站点元数据。
- 不调整路由结构（`/`、`/browse`、`/browse/:pkg`、`/search` 不变）。
- 不引入构建期变量注入；继续用 `site.config.ts` 这种运行时常量。
- 不改 README 中关于 Cloudflare 部署流程的部分。

## 3. SiteConfig schema

文件 `apt-client/src/site.config.ts`：

```ts
export interface UsageStep {
    title: string;       // "1. Add the repository"
    code: string;        // "deb https://<your-worker-domain> kali-rolling main"
    note?: string;       // 可选说明小字
}

export interface SiteConfig {
    headerTitle: string;            // H1 站点名
    headerTagline?: string;         // 副标题（空字符串或不设置 = 不渲染）
    browserTabTitle?: string;       // <title>（默认 = headerTitle）
    iconUrl?: string;               // favicon URL（空 = 不渲染）
    iconAlt?: string;               // icon alt 文本
    homepageIntroLines: string[];   // Welcome 段落文案
    usageSteps: UsageStep[];        // 首页"使用说明"区块
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

### 3.1 字段语义

- `headerTagline`: 空串（包括 `''`）等于不渲染副标题元素；非空时在 H1 下方右侧小字显示。
- `browserTabTitle`: 未设置或为空时使用 `headerTitle`；否则覆盖。
- `iconUrl`: 空串等于不渲染 `<link rel="icon">` 与头部图标；非空时同时设置 `<link>` 与头部图标 `<img>`。
- `usageSteps`: 数组为空时整段不渲染；每步的 `note` 未设置或为空时不渲染说明行。
- `showGithubButton`: `false` 时 Footer 不显示 GitHub 链接。

## 4. 组件改动

### 4.1 `apt-client/index.html`

- 删除硬编码 `<title>Cloud APT</title>` 这一行；浏览器标签名由 `main.ts` 通过 `document.title` 注入。
- 删除默认 favicon `<link>`（`public/` 目录不存在，Vite 也不会生成默认 favicon）；运行时由 `main.ts` 根据 `iconUrl` 动态注入 `<link rel="icon">`。

### 4.2 `apt-client/src/main.ts`

- 顶部导入 `siteConfig`。
- 在 `createApp(App)` 前设置：
  ```ts
  document.title = siteConfig.browserTabTitle || siteConfig.headerTitle;
  if (siteConfig.iconUrl) {
      const link = document.querySelector("link[rel='icon']") ?? document.createElement('link');
      link.setAttribute('rel', 'icon');
      link.setAttribute('href', siteConfig.iconUrl);
      if (siteConfig.iconAlt) link.setAttribute('alt', siteConfig.iconAlt);
      if (!link.isConnected) document.head.appendChild(link);
  }
  ```
- 不阻塞应用启动；上述操作同步执行。

### 4.3 `apt-client/src/pages/HomePage.vue`

模板要点：
- `<header>` 中：
  - `<img v-if="siteConfig.iconUrl" :src="siteConfig.iconUrl" :alt="siteConfig.iconAlt" class="...">`
  - `<h1><router-link to="/">{{ siteConfig.headerTitle }}</router-link></h1>`
  - `<span v-if="siteConfig.headerTagline">{{ siteConfig.headerTagline }}</span>`
- 删除原硬编码 `personal apt repository`。
- 删除未使用的 `introTitle` 引用；保留 `homepageIntroLines` 渲染。
- 新增 `<section>` 渲染 `usageSteps`：
  ```html
  <section v-if="siteConfig.usageSteps.length" class="mt-8">
      <h2>How to use this repository</h2>
      <ol>
          <li v-for="step in siteConfig.usageSteps" :key="step.title">
              <strong>{{ step.title }}</strong>
              <pre><code>{{ step.code }}</code></pre>
              <p v-if="step.note" class="text-muted">{{ step.note }}</p>
          </li>
      </ol>
  </section>
  ```

### 4.4 `apt-client/src/pages/BrowsePage.vue`、`PackagePage.vue`、`SearchPage.vue`

- 头部只渲染 `[icon?] [headerTitle]`，不渲染副标题（避免列表/详情页头条拥挤）。
- `error` 展示：传入 `usePackages` 的 Error 已经有 `message` 字段；为了让用户看到 HTTP 状态和 Content-Type，由 `api/packages.ts` 抛出带 `status` 与 `contentType` 的 Error，格式见 §5.2。`usePackages` 不需要额外改动。

### 4.5 `apt-client/src/components/Footer.vue`

- 删除 `Sources: /pubkey.asc · Install: curl -fsSL /install.sh | sudo bash` 这一整段 `<p>`。
- 保留外层 `<footer>` 与边框。
- 新增可选 GitHub 链接（`v-if="siteConfig.showGithubButton"`），置于右上或右下，由样式决定。
- 不显示版权信息（避免给 forker 加负担）。

### 4.6 `apt-client/src/components/SearchBox.vue`

- 不变。

## 5. JSON.parse 错误修复

### 5.1 根因

`apt-client/src/api/packages.ts:8` 的 `r.json()` 不校验 `Content-Type`。当：
- Worker 抛未捕获异常，Hono 返回 HTML 500 页面；或
- dev 模式下 R2 binding 未就绪，`bucket.get` reject；或
- 反向代理或 ASSETS 兜底命中 `/api/*` 返回 HTML（理论上 `run_worker_first = true` 不会，但跨域/中间件异常下可能）

`r.json()` 解析 `<` 字符报错 `JSON.parse: unexpected character at line 1 column 1`。

### 5.2 修复：双层防御

**前端 (`apt-client/src/api/packages.ts`)**：
```ts
export async function fetchIndex(suite: string, arch: string): Promise<PackageEntry[]> {
    const r = await fetch(`${BASE}/api/index/${suite}/${arch}`);
    if (!r.ok) throw new Error(`fetchIndex failed: HTTP ${r.status}`);
    const ct = r.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
        throw new Error(`fetchIndex: expected JSON, got ${ct || 'no content-type'} (HTTP ${r.status})`);
    }
    const json = (await r.json()) as IndexResponse;
    return json.packages ?? [];
}
```
对 `searchPackages` 做同样处理，并在解析后兜底 `json.packages ?? []`。

**后端 (`apt-worker/src/api-index.ts`)**：
把 `loadIndex` 用 try/catch 包住，抛错时返回 `{ packages: [], error: '<message>' }` 而非让 Hono 渲染 HTML 500：
```ts
async function loadIndex(env, suite, arch) {
    try {
        // ... 现有逻辑
    } catch (e) {
        console.error(`loadIndex(${suite}, ${arch}) failed:`, e);
        return [] as PackageEntry[];
    }
}
```
并且 `handleIndex` / `handleSearch` 在顶层 try/catch 返回 `{ packages: [], error: '...' }` JSON。

### 5.3 新增单测 (`apt-worker/test/api-index.test.ts`)

- `loadIndex returns empty array when R2 throws`
- `handleIndex returns 200 with error field on unexpected exception`

这些用例使用 mock `R2Bucket` 或 stub `env.APT_BUCKET.get` 抛错来覆盖。

## 6. 验证

### 6.1 手工

```bash
npm --workspace apt-client run build
npm --workspace apt-worker run dev
# 打开 http://localhost:8787/
# 确认：
#  - 头部只剩 "Cloud APT"，没有 "personal apt repository"
#  - 新增"How to use this repository" 三步
#  - 底栏没有 Sources/Install 一行
#  - /browse?suite=kali-rolling&arch=amd64 加载时即便 API 异常也显示"HTTP 500 ... "而非 JSON.parse 错误
```

### 6.2 自动化

```bash
npm test                          # Worker vitest 56 + 新增 2 用例
npm --workspace apt-client run typecheck
npm --workspace apt-worker run typecheck
```

## 7. 风险

- `browserTabTitle` 与 `iconUrl` 通过运行时 DOM 操作注入，会在 SPA 加载完毕前出现短暂无 `<title>`/无 favicon 的窗口。生产中 SEO 影响忽略不计（forker 通常不公开搜索引擎索引）；dev 中无影响。
- `usageSteps.code` 是用户填入的字符串，前端只做纯文本渲染（`<pre><code>` 不解析 HTML），无 XSS。
- 后端 try/catch 改 `handleIndex` 会改变错误响应体格式；需同步更新 `api-index.test.ts` 已有用例的断言。

## 8. 后续可考虑（不在本次范围）

- README 增加 siteConfig 字段表，方便 forker 知道哪些字段可改。
- Worker 暴露 `/api/site-config` 端点返回 metadata，让 SPA 读取运行时配置（取代 build-time 常量）。
- i18n：用 vue-i18n 替换硬编码英文。