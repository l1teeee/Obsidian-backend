# obsidian-backend

REST API for the Vielinks social media management platform. Built with Fastify, MySQL, AWS S3, and OpenAI.

## Stack

- **Runtime** — Node.js + TypeScript (`tsx` for development, compiled to CommonJS for production)
- **Framework** — Fastify 5
- **Database** — MySQL 8 (via `mysql2` connection pool)
- **Storage** — AWS S3 (media uploads, lifecycle-managed temp files)
- **AI** — OpenAI API (DALL-E 3 for image generation, GPT-4o for vision/analysis, GPT-4o-mini for text tasks)
- **Auth** — JWT access tokens + httpOnly refresh token cookie, bcrypt password hashing, AES-256-GCM OAuth token encryption at rest

---

## Getting started

### Prerequisites

- Node.js 20+
- MySQL 8 instance (local or tunneled to production)
- AWS S3 bucket with a lifecycle rule on `temp/` prefix (7-day expiry)
- OpenAI API key

### Install

```bash
npm install
```

### Environment variables

Create a `.env` file in the project root:

```env
# Server
PORT=3000

# Database
DB_HOST=127.0.0.1
DB_PORT=3307          # 3307 if using SSH tunnel to production, 3306 for local
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name

# JWT — minimum 32 characters each
JWT_SECRET=your_jwt_secret_min_32_chars
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars

# Cookies
COOKIE_SECRET=your_cookie_secret_min_32_chars

# OAuth token encryption — exactly 64 hex chars (32 bytes)
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=your_64_hex_char_key

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini    # model used for text tasks; gpt-4o is used automatically for vision

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET=your-bucket-name
S3_PUBLIC_URL=https://your-bucket.s3.us-east-1.amazonaws.com
# Use CloudFront URL if CDN is configured:
# S3_PUBLIC_URL=https://cdn.yourdomain.com

# CORS — comma-separated list of allowed origins
CORS_ORIGINS=http://localhost:5173

# Facebook / Instagram OAuth
FACEBOOK_CLIENT_ID=your_fb_app_id
FACEBOOK_CLIENT_SECRET=your_fb_app_secret
FACEBOOK_REDIRECT_URL=http://localhost:3000/platforms/connect/facebook/callback
INSTAGRAM_REDIRECT_URL=http://localhost:3000/platforms/connect/instagram/oauth/callback

# Frontend URL (used in OAuth redirect after callback)
FRONTEND_URL=http://localhost:5173

# Cookie domain (leave empty for localhost; set to .yourdomain.com in production)
COOKIE_DOMAIN=
```

### Development

The dev server connects to the production database by default. If the database is on a remote server, open an SSH tunnel first:

```bash
ssh -i "path/to/key.pem" -N -L 3307:127.0.0.1:3306 ubuntu@your-server-ip
```

Then start the server:

```bash
npm run dev
```

### Production build

```bash
npm run build
npm start
```

---

## Project structure

```
src/
  config/
    db.ts              # MySQL connection pool
    env.ts             # Environment variable validation (fails fast on missing/invalid)
  modules/
    auth/              # Registration, login, JWT refresh, email verification, sessions
    ai/                # Image generation, caption inspiration, image analysis, carousel slides
    ai-settings/       # Per-workspace AI persona, voice, audience, hashtag strategy
    media/             # S3 upload (server-side) + presigned URL (direct client upload)
    posts/             # CRUD + publish to social networks + metrics
    platforms/         # OAuth connect/disconnect for Facebook, Instagram, LinkedIn
    workspaces/        # Multi-workspace management
    users/             # Profile, avatar, password change
    metrics/           # Analytics aggregation
  plugins/
    jwt.plugin.ts      # fastify.authenticate decorator
    sanitize.plugin.ts # Input sanitization (null bytes, path traversal, prototype pollution)
    audit.plugin.ts    # Structured per-request audit log
  server.ts            # Entry point
  app.ts               # Fastify app builder (plugins, middleware, routes)
```

---

## API reference

All routes return `{ success: true, data: ... }` on success and `{ success: false, error: { code, message } }` on error.

Authenticated routes require an `Authorization: Bearer <access_token>` header.

### Auth — `/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | - | Create account |
| POST | `/verify-email` | - | Verify email with token |
| POST | `/resend-verification` | - | Resend verification email |
| POST | `/login` | - | Login, returns access token + sets refresh cookie |
| POST | `/refresh` | - | Rotate access token using refresh cookie |
| POST | `/logout` | - | Clear refresh cookie |
| GET | `/ping` | yes | Validate token liveness |
| GET | `/sessions` | yes | List active sessions |
| POST | `/force-logout` | yes | Invalidate all sessions |

### Posts — `/posts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List posts (filter by workspace, status, platform) |
| GET | `/:id` | Get post by ID |
| POST | `/` | Create draft or publish immediately |
| PUT | `/:id` | Update draft (detects and deletes orphaned S3 media) |
| DELETE | `/:id` | Soft-delete post + delete all S3 media |
| GET | `/:id/metrics` | Get engagement metrics for a published post |
| PATCH | `/:id/deactivate` | Deactivate a scheduled post |

### AI — `/ai`

Rate limit: 20 requests/minute per user.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/inspire` | `{ topic?, platform?, workspaceId?, imageUrls? }` | Generate 3 caption options + hashtags |
| POST | `/analyze-image` | `{ imageUrls[], platforms[], workspaceId?, currentHour?, weekday? }` | Analyze images, return captions + best posting time |
| POST | `/generate-image` | `{ prompt, size? }` | Generate image with DALL-E 3 (returns base64) |
| POST | `/edit-image` | `{ imageDataUrl, maskDataUrl, instruction }` | Edit image with DALL-E 2 |
| POST | `/suggest-time` | `{ caption?, platforms[], currentHour?, weekday? }` | Suggest best posting time |
| POST | `/carousel-slides` | `{ topic, count, style? }` | Generate N DALL-E prompts for a carousel series with consistent visual style |

`/carousel-slides` notes:
- `count` is 2-10
- `style` is an optional visual style descriptor (e.g. `"flat vector illustration, vibrant colors, white background"`). If omitted, the model chooses a style automatically.
- All returned prompts share the same style suffix so images generated from them look consistent.
- Scene descriptions are written in the same language as the `topic`.

### AI Settings — `/ai-settings`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/:workspaceId` | Get AI configuration for a workspace |
| PUT | `/:workspaceId` | Save AI configuration (persona, voice, audience, content pillars, hashtag strategy, avoid list) |

### Media — `/media`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Upload file to S3 via server (multipart). Returns public URL. Max 20 MB images, 50 MB video. |
| POST | `/presign` | Get a presigned S3 PUT URL for direct client upload (preferred for large videos) |

All uploads land in `temp/{userId}/` and are automatically deleted by S3 lifecycle after 7 days if not referenced by a published post.

### Platforms — `/platforms`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List connected platform accounts |
| DELETE | `/:id` | Disconnect a platform account |
| GET | `/connect/facebook` | Initiate Facebook OAuth flow |
| GET | `/connect/facebook/callback` | Facebook OAuth callback |
| GET | `/connect/instagram` | Connect Instagram from existing Facebook page tokens |
| GET | `/connect/instagram/oauth` | Initiate Instagram direct OAuth flow |
| GET | `/connect/instagram/oauth/callback` | Instagram OAuth callback |

### Workspaces — `/workspaces`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List workspaces for current user |
| POST | `/` | Create workspace |
| PUT | `/:id` | Update workspace |
| DELETE | `/:id` | Delete workspace |

### Users — `/users`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/me` | Get current user profile |
| PUT | `/me` | Update profile |
| POST | `/me/avatar` | Upload avatar (multipart) |
| PUT | `/me/password` | Change password |

### Metrics — `/metrics`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Aggregated engagement metrics by workspace/platform/date range |

### Health

```
GET /health
```

Returns `{ status: "ok", timestamp }` if the server and database are reachable, `503` otherwise. No auth required.

---

## Security model

- **JWT access tokens** — short-lived (15 min), sent in `Authorization` header
- **Refresh tokens** — long-lived, stored in httpOnly `Secure SameSite=Strict` cookie, rotated on every use
- **OAuth access tokens** — encrypted at rest with AES-256-GCM before storing in the database
- **Input sanitization** — runs on every request body: blocks null bytes, path traversal, prototype pollution; strips control characters; enforces 10 KB max per string value and 12 levels max nesting depth
- **SSRF protection** — image URLs sent to OpenAI are validated against a private IP blocklist
- **Rate limiting** — per-route limits on all endpoints; stricter limits on auth and AI routes
- **Content-Type enforcement** — POST/PUT/PATCH must be `application/json` or `multipart/form-data`
- **Audit logging** — structured log entry on every response with requestId, method, route, status, duration, IP, userId

---

## S3 media lifecycle

| Scenario | How it's handled |
|----------|-----------------|
| File uploaded, composer abandoned | `temp/` lifecycle rule deletes after 7 days |
| AI-generated image discarded | Same — `storeFile` always writes to `temp/` |
| Media replaced in a draft | `updatePost` detects orphaned URLs and calls `deleteS3Objects` |
| Post deleted | `deletePost` deletes all `media_urls` from S3 |
| External CDN URLs (social networks) | `deleteS3Objects` ignores them — checked by URL prefix |
