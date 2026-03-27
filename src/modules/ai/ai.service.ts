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

function buildContextBlock(s: AiSettings): string {
  const lines: string[] = [];
  if (s.persona)             lines.push(`Brand/Creator: ${s.persona}`);
  if (s.brand_voice)         lines.push(`Voice & Tone: ${s.brand_voice}`);
  if (s.target_audience)     lines.push(`Target Audience: ${s.target_audience}`);
  if (s.content_pillars)     lines.push(`Content Pillars: ${s.content_pillars}`);
  if (s.hashtag_strategy)    lines.push(`Hashtag Strategy: ${s.hashtag_strategy}`);
  if (s.example_posts)       lines.push(`Style Reference Posts:\n${s.example_posts}`);
  if (s.avoid)               lines.push(`Avoid: ${s.avoid}`);
  if (s.custom_instructions) lines.push(`Extra Instructions: ${s.custom_instructions}`);
  return lines.join('\n');
}

export interface SuggestTimeOptions {
  caption:   string;
  platforms: string[];
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

  const { caption, platforms } = options;
  const platformNames = platforms.map(p => {
    const map: Record<string, string> = { meta: 'Instagram/Facebook', linkedin: 'LinkedIn', youtube: 'YouTube' };
    return map[p] ?? p;
  }).join(', ');

  const now     = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  const userPrompt = `Analyze this social media caption and suggest the single best time to post it.

Caption: "${caption || '(no caption yet — analyze based on platforms only)'}"
Target platforms: ${platformNames}
Current day: ${weekday}

Consider:
- Content category (educational, promotional, entertainment, inspirational, etc.)
- Platform-specific peak engagement windows
- Weekday vs weekend patterns
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

  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
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

  // Load saved AI settings context if available — enforces workspace ownership
  let contextBlock = '';
  if (workspaceId && userId) {
    const settings = await getByWorkspace(workspaceId, userId);
    if (settings) contextBlock = buildContextBlock(settings);
  }

  const systemPrompt = [
    `You are an expert social media copywriter specialized in ${platformCtx}.`,
    `You write engaging, authentic captions that stop the scroll, drive real interaction, and feel current.`,
    hasImages
      ? 'When images are provided, analyze their visual content, mood, colors, subjects, and story — let the images inspire the captions directly.'
      : '',
    contextBlock ? `\n## Brand Context\n${contextBlock}` : '',
  ].filter(Boolean).join('\n');

  const jsonInstruction = `Return a JSON object with exactly this shape — no other text, no markdown, no explanation:
{
  "captions": [
    "Caption 1 — inspirational tone",
    "Caption 2 — conversational / relatable",
    "Caption 3 — hook or bold opener"
  ],
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", ... up to 15 tags]
}

Caption rules:
- Each caption must be complete and ready to post (no placeholders)
- Include emojis naturally — not forced
- Do NOT put hashtags inside the captions — they go in the hashtags array
- Max 220 characters per caption
- Make them feel current and on-trend for ${platformCtx}

Hashtag rules:
- Mix of niche + broad hashtags relevant to the content
- Return as an array of strings, each starting with #
- 10 to 15 hashtags
- Order: specific niche tags first, broader ones last`;

  let userContent: string | Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>;

  if (hasImages) {
    const imageDescription = topic?.trim()
      ? `Additional context from the creator: "${topic.trim()}"`
      : 'No additional context — infer everything from the images.';

    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
      {
        type: 'text',
        text: `Analyze the attached image(s) and generate 3 social media captions for ${platformCtx}.\n\n${imageDescription}\n\n${jsonInstruction}`,
      },
      ...safeUrls.slice(0, 4).map(url => ({
        type:      'image_url',
        image_url: { url, detail: 'low' },
      })),
    ];
    userContent = contentParts;
  } else {
    userContent = `Generate content for a post about: "${topic ?? ''}"\n\n${jsonInstruction}`;
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

  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
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
    captions: result.captions.slice(0, 3),
    hashtags: result.hashtags.slice(0, 15),
  };
}
