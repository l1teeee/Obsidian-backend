# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Obsidian Lens** — A social media content management and curation platform. The repo contains two separate projects:

- **Backend** (this repo root): Fastify REST API — scaffolded but not yet implemented
- **Frontend** (`.claude/worktrees/agent-a6986c8a/`): React dashboard — fully implemented with mocked data

## Commands

### Backend (repo root)
No scripts are configured yet. Dev runner uses `tsx`:
```bash
npx tsx src/index.ts        # Run backend (once index.ts is created)
npx tsc --noEmit            # Type-check only
```

### Frontend (`.claude/worktrees/agent-a6986c8a/`)
```bash
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # tsc -b && vite build
npm run lint      # ESLint
npm run preview   # Preview production build
```

## Architecture

### Backend Stack
- **Fastify 5.x** — HTTP framework
- **TypeScript 6.x** — CommonJS (`"type": "commonjs"` in package.json), strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **mysql2/promise** — MySQL database
- **@fastify/jwt** — JWT authentication
- **bcrypt 6.x** — Password hashing
- **dotenv** — Environment config

Backend `src/` is scaffolded empty with intended structure: `config/`, `modules/auth/`, `modules/posts/`, `plugins/`, `types/`. No entry point (`index.ts`) exists yet.

### Frontend Stack
- **React 19** + **React Router 7** — ESM module type
- **TypeScript 5.9** — Strict mode
- **Vite 8** with `@vitejs/plugin-react`
- **Tailwind CSS 4** via `@tailwindcss/vite` plugin
- **GSAP 3** + **Lenis 1.3** — Animation and smooth scrolling

### Frontend Architecture

**Routing:**
- `/login`, `/register` — Auth pages (currently no real auth, mock only)
- `/dashboard`, `/analytics`, `/calendar`, `/composer`, `/platforms`, `/settings` — All nested under `DashboardLayout`

**State:**
- `LayoutContext` / `useLayout()` — Sidebar open/collapsed state (desktop defaults open, mobile defaults closed)
- All page data is hardcoded mock data — no API calls exist yet

**Animation pattern:**
- `useGSAP<T>(callback, deps)` hook in `src/hooks/useGSAP.ts` — wraps GSAP context for cleanup, waits for Lenis initialization via `lenis:ready` window event before running
- Lenis smooth scroll is initialized in `App.tsx` and synced with GSAP ScrollTrigger
- Page entrance animations use staggered GSAP timelines with `fromTo()`

**Component structure:**
```
App (Lenis + Router + GSAP plugin registration)
└── DashboardLayout (LayoutProvider + sidebar + topbar)
    └── Outlet → Dashboard | Analytics | Calendar | PostComposer | Platforms | Settings
```

### Key Design Decisions

- **Multi-platform post composer** (`PostComposer.tsx`): Real-time platform-specific previews (Instagram/LinkedIn/Facebook) with per-platform character limits enforced in UI. No backend integration yet.
- **All frontend data is mocked** — implementing backend requires adding API fetch calls to each page.
- **tsconfig.json** at repo root has `rootDir`/`outDir` commented out — these need to be uncommented when backend source is added.
- Frontend tsconfig uses project references (`tsconfig.app.json` + `tsconfig.node.json`).