import { env } from '../../config/env';
import { getByWorkspace } from '../ai-settings/ai-settings.service';
import type { AiSettings } from '../ai-settings/ai-settings.service';

export interface GenerateImageOptions {
  prompt: string;
  size?:  '1024x1024' | '1792x1024' | '1024x1792';
}

export interface GenerateImageResult {
  dataUrl:        string;   // data:image/png;base64,... — ready to use in <img>
  revised_prompt: string;
}

export interface EditImageOptions {
  imageDataUrl: string;   // base64 data URL of the original image (JPEG or PNG)
  instruction:  string;   // what the user wants to change
}

export interface EditImageResult {
  dataUrl: string;        // data:image/png;base64,...
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  if (!env.OPENAI_API_KEY) {
    throw appError(
      'AI_NOT_CONFIGURED',
      'OpenAI API key not configured. Set OPENAI_API_KEY in the server environment.',
      503,
    );
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:           'dall-e-3',
      prompt:          options.prompt,
      n:               1,
      size:            options.size ?? '1024x1024',
      quality:         'standard',
      response_format: 'b64_json',   // ← base64 directly, no Azure URL needed
    }),
  });

  if (!res.ok) {
    interface OpenAIError { error?: { message: string } }
    const body = await res.json() as OpenAIError;
    throw appError('AI_ERROR', body.error?.message ?? 'DALL-E request failed', 502);
  }

  interface DalleResponse {
    data: Array<{ b64_json: string; revised_prompt: string }>;
  }
  const data  = await res.json() as DalleResponse;
  const image = data.data[0];

  if (!image?.b64_json) throw appError('AI_ERROR', 'Empty response from DALL-E', 502);

  return {
    dataUrl:        `data:image/png;base64,${image.b64_json}`,
    revised_prompt: image.revised_prompt ?? options.prompt,
  };
}

export async function editImage(options: EditImageOptions): Promise<EditImageResult> {
  if (!env.OPENAI_API_KEY) {
    throw appError('AI_NOT_CONFIGURED', 'OpenAI API key not configured.', 503);
  }

  // Step 1: GPT-4o Vision — describe the image in detail for faithful reproduction
  const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image in precise detail for exact DALL-E 3 reproduction. Cover: every visible subject and object, their positions, colors, textures, clothing/details, background elements, lighting direction and quality, overall mood, art style or photographic style, color palette. Be exhaustive and specific. Output only the description, no preamble.',
          },
          {
            type:      'image_url',
            image_url: { url: options.imageDataUrl, detail: 'high' },
          },
        ],
      }],
      max_tokens:  500,
      temperature: 0.2,
    }),
  });

  if (!visionRes.ok) {
    interface OpenAIError { error?: { message: string } }
    const body = await visionRes.json() as OpenAIError;
    throw appError('AI_ERROR', body.error?.message ?? 'GPT-4o vision failed', 502);
  }

  interface VisionResponse { choices: Array<{ message: { content: string | null } }> }
  const visionData  = await visionRes.json() as VisionResponse;
  const description = visionData.choices[0]?.message.content?.trim() ?? '';

  if (!description) throw appError('AI_ERROR', 'Could not read the image', 502);

  // Step 2: DALL-E 3 — generate with the description + the requested modification
  const editPrompt =
    `${description}\n\n` +
    `Apply ONLY this specific change: ${options.instruction}. ` +
    `Keep every other element exactly as described above — ` +
    `same subjects, composition, colors, lighting, background, and style.`;

  const result = await generateImage({ prompt: editPrompt, size: '1024x1024' });
  return { dataUrl: result.dataUrl };
}

export interface InspireOptions {
  topic?:       string;
  platform?:    string;
  workspaceId?: string;
  userId?:      string;     // required when workspaceId is provided — enforces ownership
  imageUrls?:   string[];   // data: base64 URIs only; http(s) URLs are SSRF-validated
}

export interface InspireResult {
  captions:  string[];
  hashtags:  string[];
}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
}

// ── SSRF guard ───────────────────────────────────────────────────────────────
// Private/loopback IP patterns that must never be fetched.
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|fd[0-9a-f]{2}:)/i;

function isSafeImageUrl(url: string): boolean {
  // Always allow data: URIs (base64 — already on server)
  if (url.startsWith('data:image/')) return true;

  try {
    const parsed = new URL(url);
    // Only HTTPS external URLs
    if (parsed.protocol !== 'https:') return false;
    // Block private/loopback IPs
    if (PRIVATE_IP.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function platformLabel(platform?: string): string {
  const map: Record<string, string> = {
    meta:     'Instagram / Facebook',
    linkedin: 'LinkedIn',
    youtube:  'YouTube',
  };
  return platform ? (map[platform] ?? platform) : 'social media';
}

/**
 * Builds the system prompt entirely from the user's AI Settings.
 * Hardcoded content is kept to the absolute minimum (only what the model
 * technically needs: role fallback, image instruction, output format hint).
 * Everything stylistic — tone, persona, hashtags, avoid list — comes from settings.
 */
function buildSystemPrompt(
  settings:  AiSettings | null,
  platform:  string,
  hasImages: boolean,
): string {
  const parts: string[] = [];

  // ── 1. Role / Persona ─────────────────────────────────────────────────────
  // Use the user's persona as the role definition. Only fall back to a
  // minimal generic description when no settings exist at all.
  if (settings?.persona?.trim()) {
    parts.push(`You are creating social media content for the following brand:\n${settings.persona.trim()}`);
  } else {
    parts.push(`You are a social media content creator for ${platform}.`);
  }

  // ── 2. Voice & Tone ───────────────────────────────────────────────────────
  if (settings?.brand_voice?.trim()) {
    parts.push(`\n## Voice & Tone\n${settings.brand_voice.trim()}`);
  }

  // ── 3. Target Audience ────────────────────────────────────────────────────
  if (settings?.target_audience?.trim()) {
    parts.push(`\n## Target Audience\n${settings.target_audience.trim()}`);
  }

  // ── 4. Content Pillars ────────────────────────────────────────────────────
  if (settings?.content_pillars?.trim()) {
    parts.push(`\n## Content Pillars\n${settings.content_pillars.trim()}`);
  }

  // ── 5. Style Reference ────────────────────────────────────────────────────
  // This is the highest-signal section: show the model exactly what the
  // brand's published content looks and sounds like.
  if (settings?.example_posts?.trim()) {
    parts.push(`\n## Style Reference\nMatch the style, structure, and voice of these example posts exactly:\n${settings.example_posts.trim()}`);
  }

  // ── 6. Hashtag Strategy ───────────────────────────────────────────────────
  if (settings?.hashtag_strategy?.trim()) {
    parts.push(`\n## Hashtag Strategy\n${settings.hashtag_strategy.trim()}`);
  }

  // ── 7. Avoid ─────────────────────────────────────────────────────────────
  if (settings?.avoid?.trim()) {
    parts.push(`\n## STRICTLY AVOID — treat these as hard rules, never break them:\n${settings.avoid.trim()}`);
  }

  // ── 8. Custom Instructions ────────────────────────────────────────────────
  if (settings?.custom_instructions?.trim()) {
    parts.push(`\n## Additional Instructions\n${settings.custom_instructions.trim()}`);
  }

  // ── 9. Image analysis (technical, only when images are attached) ──────────
  if (hasImages) {
    parts.push(`\n## Image Analysis\nImages are attached. Analyze their visual content, mood, colors, subjects, and story. Let the images inspire and shape the captions directly.`);
  }

  return parts.join('\n');
}

export interface SuggestTimeOptions {
  caption:      string;
  platforms:    string[];
  currentHour?: number;   // client's local hour (0-23) — use instead of server time
  weekday?:     string;   // client's local weekday name
}

export interface SuggestTimeResult {
  hour:      number;   // 0-23
  minute:    number;   // 0 or 30
  dayOffset: number;   // 0 = today, 1 = tomorrow, etc.
  reason:    string;
}

export async function suggestScheduleTime(options: SuggestTimeOptions): Promise<SuggestTimeResult> {
  if (!env.OPENAI_API_KEY) {
    throw appError(
      'AI_NOT_CONFIGURED',
      'OpenAI API key not configured. Set OPENAI_API_KEY in the server environment.',
      503,
    );
  }

  const { caption, platforms, currentHour, weekday: clientWeekday } = options;
  const platformNames = platforms.map(p => {
    const map: Record<string, string> = { meta: 'Instagram/Facebook', linkedin: 'LinkedIn', youtube: 'YouTube' };
    return map[p] ?? p;
  }).join(', ');

  // Use client-provided time if available; fall back to server time
  const now            = new Date();
  const weekday        = clientWeekday ?? now.toLocaleDateString('en-US', { weekday: 'long' });
  const hourNow        = currentHour   ?? now.getHours();
  const hourNowFmt     = `${String(hourNow).padStart(2, '0')}:00`;

  const userPrompt = `Analyze this social media caption and suggest the single best time to post it.

Caption: "${caption || '(no caption yet — analyze based on platforms only)'}"
Target platforms: ${platformNames}
Current day: ${weekday}
Current local time of the user: ${hourNowFmt} (use this to decide if today still makes sense or if tomorrow is better)

Consider:
- Content category (educational, promotional, entertainment, inspirational, etc.)
- Platform-specific peak engagement windows
- Weekday vs weekend patterns
- If the suggested hour has already passed today, use dayOffset >= 1
- Whether same-day posting makes sense or a future day is better

Return ONLY a JSON object (no markdown, no explanation):
{
  "hour": <0-23>,
  "minute": <0 or 30>,
  "dayOffset": <0=today, 1=tomorrow, 2=day-after, up to 6>,
  "reason": "<one concise sentence explaining why>"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:       env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a social media scheduling expert. Return only valid JSON.' },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens:  200,
    }),
  });

  if (!res.ok) {
    interface OpenAIError { error?: { message: string } }
    const body = await res.json() as OpenAIError;
    throw appError('AI_ERROR', body.error?.message ?? 'OpenAI request failed', 502);
  }

  interface OpenAIResponse {
    choices: Array<{ message: { content: string | null } }>;
  }
  const data    = await res.json() as OpenAIResponse;
  const content = data.choices[0]?.message.content?.trim();

  if (!content) throw appError('AI_ERROR', 'Empty response from OpenAI', 502);

  const stJsonStart = content.indexOf('{');
  const stJsonEnd   = content.lastIndexOf('}');
  const stCleaned   = stJsonStart !== -1 && stJsonEnd > stJsonStart
    ? content.slice(stJsonStart, stJsonEnd + 1)
    : content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: unknown;
  try { parsed = JSON.parse(stCleaned); }
  catch { throw appError('AI_ERROR', 'Could not parse AI response as JSON', 502); }

  const r = parsed as { hour?: unknown; minute?: unknown; dayOffset?: unknown; reason?: unknown };
  if (typeof r.hour !== 'number' || typeof r.dayOffset !== 'number') {
    throw appError('AI_ERROR', 'Unexpected AI response format', 502);
  }

  return {
    hour:      Math.min(23, Math.max(0, Math.round(r.hour))),
    minute:    r.minute === 30 ? 30 : 0,
    dayOffset: Math.min(6, Math.max(0, Math.round(Number(r.dayOffset)))),
    reason:    typeof r.reason === 'string' ? r.reason : '',
  };
}

// ── analyzeImageForPost ───────────────────────────────────────────────────────

export interface AnalyzeImageOptions {
  imageUrls:    string[];   // base64 data: URIs or validated HTTPS URLs (up to 4)
  platforms:    string[];   // e.g. ['meta', 'linkedin']
  workspaceId?: string;
  userId?:      string;
  currentHour?: number;     // client local hour 0-23
  weekday?:     string;     // 'Thursday'
}

export interface AnalyzeImageResult {
  captions: string[];
  hashtags: string[];
  bestTime: {
    hour:      number;    // 0-23
    minute:    number;    // 0 or 30
    dayOffset: number;    // 0 = today, 1 = tomorrow …
    reason:    string;
  };
}

export async function analyzeImageForPost(options: AnalyzeImageOptions): Promise<AnalyzeImageResult> {
  if (!env.OPENAI_API_KEY) {
    throw appError('AI_NOT_CONFIGURED', 'OpenAI API key not configured.', 503);
  }

  const { imageUrls, platforms, workspaceId, userId, currentHour, weekday } = options;

  const platform = platforms[0] ?? 'meta';

  // Step 1: reuse the proven inspire/caption flow (supports vision, already works)
  const inspire = await generateCaptionSuggestions({
    platform,
    workspaceId,
    userId,
    imageUrls,
  });

  // Step 2: suggest best posting time based on the generated caption
  const time = await suggestScheduleTime({
    caption:     inspire.captions[0] ?? '',
    platforms,
    currentHour,
    weekday,
  });

  return {
    captions: inspire.captions,
    hashtags: inspire.hashtags,
    bestTime: time,
  };
}

// ── generateCarouselSlides ────────────────────────────────────────────────────

export interface CarouselSlidesOptions {
  topic:  string;
  count:  number;   // 2-10
  style?: string;   // visual style descriptor chosen by the user
}

export interface CarouselSlidesResult {
  slides: string[];   // one DALL-E prompt per slide
}

export async function generateCarouselSlides(options: CarouselSlidesOptions): Promise<CarouselSlidesResult> {
  if (!env.OPENAI_API_KEY) {
    throw appError('AI_NOT_CONFIGURED', 'OpenAI API key not configured.', 503);
  }

  const { topic, count, style } = options;
  const n = Math.min(Math.max(2, count), 10);

  const styleInstruction = style?.trim()
    ? `Visual style (FIXED — append this EXACT string to every prompt, word for word): "${style.trim()}"`
    : `STEP 1 — Choose ONE visual style that fits the topic. Then append that EXACT style string to every prompt below.`;

  const userPrompt = `You are an expert DALL-E prompt writer for social media carousel posts.

Topic: "${topic}"
Number of slides: ${n}
${styleInstruction}

Write exactly ${n} image prompts — one per slide:
- Each describes ONE single scene/step only. No collages, grids, multi-panel images.
- Every prompt MUST end with the same style string — identical across all slides.
- Logical narrative order (first step → last step).
- No slide numbers, labels, or text overlays.
- IMPORTANT: Detect the language of the topic and write the scene descriptions in that same language. The style string stays in English.

Return ONLY valid JSON (no markdown, no explanation):
{
  "slides": ["<scene>, <style>", "<scene>, <style>", ...]
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:       env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a DALL-E prompt expert. Return only valid JSON.' },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens:  1200,
    }),
  });

  if (!res.ok) {
    interface OpenAIError { error?: { message: string } }
    const body = await res.json() as OpenAIError;
    throw appError('AI_ERROR', body.error?.message ?? 'OpenAI request failed', 502);
  }

  interface OpenAIResponse {
    choices: Array<{ message: { content: string | null } }>;
  }
  const data    = await res.json() as OpenAIResponse;
  const content = data.choices[0]?.message.content?.trim();
  if (!content) throw appError('AI_ERROR', 'Empty response from OpenAI', 502);

  const start   = content.indexOf('{');
  const end     = content.lastIndexOf('}');
  const cleaned = start !== -1 && end > start
    ? content.slice(start, end + 1)
    : content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { throw appError('AI_ERROR', 'Could not parse AI response as JSON', 502); }

  const r = parsed as { slides?: unknown };
  if (!Array.isArray(r.slides) || r.slides.length === 0) {
    throw appError('AI_ERROR', 'Unexpected AI response format', 502);
  }

  return { slides: (r.slides as string[]).slice(0, n) };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function generateCaptionSuggestions(options: InspireOptions): Promise<InspireResult> {
  if (!env.OPENAI_API_KEY) {
    throw appError(
      'AI_NOT_CONFIGURED',
      'OpenAI API key not configured. Set OPENAI_API_KEY in the server environment.',
      503,
    );
  }

  const { topic, platform, workspaceId, userId, imageUrls = [] } = options;

  // Validate all image URLs against SSRF before sending to OpenAI
  const safeUrls = imageUrls.filter(isSafeImageUrl);

  const hasImages   = safeUrls.length > 0;
  const platformCtx = platformLabel(platform);

  // Load AI settings — the user's configuration is the primary prompt source.
  // Both workspaceId and userId are required to enforce ownership.
  let settings: AiSettings | null = null;
  if (workspaceId && userId) {
    settings = await getByWorkspace(workspaceId, userId);
  }

  // Build the system prompt entirely from AI Settings.
  // The only hardcoded parts are: role fallback (when no persona set),
  // image analysis instruction, and the JSON output format requirement.
  const systemPrompt = buildSystemPrompt(settings, platformCtx, hasImages);

  // ── JSON output instruction ───────────────────────────────────────────────
  // Kept minimal: only structural rules the parser needs.
  // Style, tone, hashtag count, emoji use, length — all come from AI Settings.
  const jsonInstruction = `Respond with ONLY a valid JSON object — no markdown fences, no explanation, no text outside the JSON:
{
  "captions": ["<caption 1>", "<caption 2>", "<caption 3>"],
  "hashtags": ["#tag1", "#tag2", ...]
}

Output rules (structural only — style and tone follow your system instructions above):
- Generate exactly 3 caption options
- Do NOT put hashtags inside the captions — hashtags go only in the "hashtags" array
- Each caption must be complete and ready to post as-is`;

  let userContent: string | Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>;

  if (hasImages) {
    const imageDescription = topic?.trim()
      ? `Additional context from the creator: "${topic.trim()}"`
      : 'No additional context provided — infer everything from the images.';

    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
      {
        type: 'text',
        text: `Generate 3 social media captions for ${platformCtx} based on the attached image(s).\n\n${imageDescription}\n\n${jsonInstruction}`,
      },
      ...safeUrls.slice(0, 4).map(url => ({
        type:      'image_url',
        image_url: { url, detail: 'low' },
      })),
    ];
    userContent = contentParts;
  } else {
    userContent = `Generate 3 social media captions for ${platformCtx} about: "${topic ?? ''}"\n\n${jsonInstruction}`;
  }

  // Use gpt-4o for vision (supports images); fall back to configured model for text-only
  const model = hasImages ? 'gpt-4o' : env.OPENAI_MODEL;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
      temperature: 0.85,
      max_tokens:  900,
    }),
  });

  if (!res.ok) {
    interface OpenAIError { error?: { message: string } }
    const body = await res.json() as OpenAIError;
    throw appError('AI_ERROR', body.error?.message ?? 'OpenAI request failed', 502);
  }

  interface OpenAIResponse {
    choices: Array<{ message: { content: string | null } }>;
  }
  const data    = await res.json() as OpenAIResponse;
  const content = data.choices[0]?.message.content?.trim();

  if (!content) throw appError('AI_ERROR', 'Empty response from OpenAI', 502);

  const gcJsonStart = content.indexOf('{');
  const gcJsonEnd   = content.lastIndexOf('}');
  const gcCleaned   = gcJsonStart !== -1 && gcJsonEnd > gcJsonStart
    ? content.slice(gcJsonStart, gcJsonEnd + 1)
    : content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(gcCleaned);
  } catch {
    throw appError('AI_ERROR', 'Could not parse AI response as JSON', 502);
  }

  if (
    typeof parsed !== 'object' || parsed === null ||
    !Array.isArray((parsed as { captions?: unknown }).captions) ||
    !Array.isArray((parsed as { hashtags?: unknown }).hashtags)
  ) {
    throw appError('AI_ERROR', 'Unexpected AI response format', 502);
  }

  const result = parsed as { captions: string[]; hashtags: string[] };
  return {
    captions: result.captions.slice(0, 3),   // always 3 — structural requirement
    hashtags: result.hashtags.slice(0, 30),  // generous cap (30) — lets hashtag_strategy drive count
  };
}
