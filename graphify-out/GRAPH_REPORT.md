# Graph Report - C:\MES PROJET CODE\Mybestconsultant\mybestconsultant  (2026-06-28)

## Corpus Check
- Corpus is ~26,372 words - fits in a single context window. You may not need a graph.

## Summary
- 407 nodes · 763 edges · 20 communities (15 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Candidate & Recruiter Dashboards|Candidate & Recruiter Dashboards]]
- [[_COMMUNITY_Public Pages & Routing|Public Pages & Routing]]
- [[_COMMUNITY_Admin Layout & Auth|Admin Layout & Auth]]
- [[_COMMUNITY_Dependencies & Package Config|Dependencies & Package Config]]
- [[_COMMUNITY_Root Layout & Content Editor|Root Layout & Content Editor]]
- [[_COMMUNITY_Page Builder Preview|Page Builder Preview]]
- [[_COMMUNITY_Architecture Guidelines & Docker|Architecture Guidelines & Docker]]
- [[_COMMUNITY_UI Components & Aliases|UI Components & Aliases]]
- [[_COMMUNITY_AI  LLM Router|AI / LLM Router]]
- [[_COMMUNITY_Homepage Editor|Homepage Editor]]
- [[_COMMUNITY_Site Config & Templates|Site Config & Templates]]
- [[_COMMUNITY_Design System & Themes|Design System & Themes]]
- [[_COMMUNITY_Appwrite Storage & Upload|Appwrite Storage & Upload]]
- [[_COMMUNITY_Page Builder Types & Sections|Page Builder Types & Sections]]
- [[_COMMUNITY_Section Renderer|Section Renderer]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Public Assets & SVGs|Public Assets & SVGs]]
- [[_COMMUNITY_API Routes|API Routes]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 52 edges
2. `createAdminClient()` - 29 edges
3. `compilerOptions` - 16 edges
4. `getSiteConfig` - 15 edges
5. `Button()` - 13 edges
6. `getCurrentUser()` - 10 edges
7. `Input()` - 9 edges
8. `Label()` - 9 edges
9. `buildCssVars()` - 9 edges
10. `Next.js Project` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Next.js Project` --CONTAINS--> `File Icon SVG`  [EXTRACTED]
  README.md → public/file.svg
- `Next.js Project` --CONTAINS--> `Globe Icon SVG`  [EXTRACTED]
  README.md → public/globe.svg
- `Next.js Project` --CONTAINS--> `MyBestConsultant Logo SVG`  [EXTRACTED]
  README.md → public/logo.svg
- `Next.js Project` --CONTAINS--> `Next.js Wordmark SVG`  [EXTRACTED]
  README.md → public/next.svg
- `Next.js Project` --CONTAINS--> `Vercel Logo SVG`  [EXTRACTED]
  README.md → public/vercel.svg

## Import Cycles
- None detected.

## Communities (20 total, 5 thin omitted)

### Community 0 - "Candidate & Recruiter Dashboards"
Cohesion: 0.06
Nodes (47): cn(), FormValues, schema, FormValues, schema, Badge(), badgeVariants, Button() (+39 more)

### Community 1 - "Public Pages & Routing"
Cohesion: 0.05
Nodes (46): COMPANIES, HomePage(), JOBS, SECTORS, BUCKETS, AdminPageEditorPage(), BG_PALETTE, CATALOG (+38 more)

### Community 2 - "Admin Layout & Auth"
Cohesion: 0.11
Nodes (31): AdminLayout(), NAV, createSession(), deleteSession(), getCurrentUser(), getSessionToken(), registerUser(), setSessionCookies() (+23 more)

### Community 3 - "Dependencies & Package Config"
Cohesion: 0.06
Nodes (35): dependencies, @anthropic-ai/sdk, @base-ui/react, class-variance-authority, clsx, @hookform/resolvers, lucide-react, next (+27 more)

### Community 4 - "Root Layout & Content Editor"
Cohesion: 0.11
Nodes (26): metadata, RootLayout(), ContentEditor(), AdminContentPage(), COLOR_GROUPS, DesignManager(), FONT_SIZE_PRESETS, FONT_WEIGHT_OPTIONS (+18 more)

### Community 5 - "Page Builder Preview"
Cohesion: 0.12
Nodes (25): bg(), PreviewCards(), PreviewCta(), PreviewDivider(), PreviewGallery(), PreviewImageText(), PreviewStats(), PreviewText() (+17 more)

### Community 6 - "Architecture Guidelines & Docker"
Cohesion: 0.12
Nodes (26): Appwrite Integration Rules, CSS Variables over Tailwind Tokens, MyBestConsultant Design System, Docker Compose Stack, Forms via Server Actions, Frontend Architect Principles, Geist Font, mbc-session Cookie (+18 more)

### Community 7 - "UI Components & Aliases"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 8 - "AI / LLM Router"
Cohesion: 0.14
Nodes (18): callClaude(), callGPT4o(), callLLM(), callTeckiA(), getActiveProvider(), AIConfig, AIRecommendation, Application (+10 more)

### Community 9 - "Homepage Editor"
Cohesion: 0.14
Nodes (8): Props, Cfg, Device, Props, SiteConfig, ImageUpload(), Props, Input()

### Community 10 - "Site Config & Templates"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 11 - "Design System & Themes"
Cohesion: 0.33
Nodes (4): MODULES, QUICK_ACTIONS, STATS, STATUS_STYLE

### Community 12 - "Appwrite Storage & Upload"
Cohesion: 0.40
Nodes (5): Goal-Driven Execution, Karpathy Coding Guidelines, Simplicity First, Surgical Changes, Think Before Coding

## Knowledge Gaps
- **149 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+144 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Candidate & Recruiter Dashboards` to `Homepage Editor`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `createAdminClient()` connect `Admin Layout & Auth` to `AI / LLM Router`, `Public Pages & Routing`, `Root Layout & Content Editor`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `Button()` connect `Candidate & Recruiter Dashboards` to `Homepage Editor`, `Admin Layout & Auth`, `Root Layout & Content Editor`, `Public Pages & Routing`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _149 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Candidate & Recruiter Dashboards` be split into smaller, more focused modules?**
  _Cohesion score 0.06376811594202898 - nodes in this community are weakly interconnected._
- **Should `Public Pages & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.05009920634920635 - nodes in this community are weakly interconnected._
- **Should `Admin Layout & Auth` be split into smaller, more focused modules?**
  _Cohesion score 0.1141025641025641 - nodes in this community are weakly interconnected._