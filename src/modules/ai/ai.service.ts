import { env } from '../../config/env';
import { getRawByWorkspace } from '../ai-settings/ai-settings.service';
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
  topic:        string;
  platform?:    string;
  workspaceId?: string;
}

export interface InspireResult {
  captions:  string[];
  hashtags:  string[];
}

function appError(errorCode: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { errorCode, statusCode });
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

export async function generateCaptionSuggestions(options: InspireOptions): Promise<InspireResult> {
  if (!env.OPENAI_API_KEY) {
    throw appError(
      'AI_NOT_CONFIGURED',
      'OpenAI API key not configured. Set OPENAI_API_KEY in the server environment.',
      503,
    );
  }

  const { topic, platform, workspaceId } = options;
  const platformCtx = platformLabel(platform);

  // Load saved AI settings context if available
  let contextBlock = '';
  if (workspaceId) {
    const settings = await getRawByWorkspace(workspaceId);
    if (settings) contextBlock = buildContextBlock(settings);
  }

  const systemPrompt = [
    `You are an expert social media copywriter specialized in ${platformCtx}.`,
    `You write engaging, authentic captions that stop the scroll, drive real interaction, and feel current.`,
    contextBlock ? `\n## Brand Context\n${contextBlock}` : '',
  ].filter(Boolean).join('\n');

  const userPrompt = `Generate content for a post about: "${topic}"

Return a JSON object with exactly this shape — no other text, no markdown, no explanation:
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
- Mix of niche + broad hashtags that are currently trending for this topic
- Return as an array of strings, each starting with #
- 10 to 15 hashtags
- Order: specific niche tags first, broader ones last`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:       env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
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
