import { FastifyRequest, FastifyReply } from 'fastify';
import { generateCaptionSuggestions, generateImage, editImage, suggestScheduleTime, analyzeImageForPost } from './ai.service';

interface GenerateImageBody {
  prompt: string;
  size?:  '1024x1024' | '1792x1024' | '1024x1792';
}

export async function generateImageHandler(
  request: FastifyRequest<{ Body: GenerateImageBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const result = await generateImage(request.body);
  reply.code(200).send({ success: true, data: result });
}

interface InspireBody {
  topic?:       string;
  platform?:    string;
  workspaceId?: string;
  imageUrls?:   string[];
}

export async function inspireHandler(
  request: FastifyRequest<{ Body: InspireBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { topic, platform, workspaceId, imageUrls } = request.body;

  if (!topic?.trim() && (!imageUrls || imageUrls.length === 0)) {
    return reply.code(400).send({ success: false, error: 'Provide a topic or at least one image.' });
  }

  const result = await generateCaptionSuggestions({
    topic, platform, workspaceId, imageUrls,
    userId: request.user.id,
  });

  reply.code(200).send({ success: true, data: result });
}

interface SuggestTimeBody {
  caption?:     string;
  platforms:    string[];
  currentHour?: number;
  weekday?:     string;
}

export async function suggestTimeHandler(
  request: FastifyRequest<{ Body: SuggestTimeBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { caption = '', platforms, currentHour, weekday } = request.body;
  const result = await suggestScheduleTime({ caption, platforms, currentHour, weekday });
  reply.code(200).send({ success: true, data: result });
}

interface EditImageBody {
  imageDataUrl: string;
  maskDataUrl:  string;
  instruction:  string;
}

export async function editImageHandler(
  request: FastifyRequest<{ Body: EditImageBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { imageDataUrl, maskDataUrl, instruction } = request.body;
  const result = await editImage({ imageDataUrl, maskDataUrl, instruction });
  reply.code(200).send({ success: true, data: result });
}

interface AnalyzeImageBody {
  imageUrls:    string[];
  platforms:    string[];
  workspaceId?: string;
  currentHour?: number;
  weekday?:     string;
}

export async function analyzeImageHandler(
  request: FastifyRequest<{ Body: AnalyzeImageBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { imageUrls, platforms, workspaceId, currentHour, weekday } = request.body;
  const result = await analyzeImageForPost({
    imageUrls, platforms, workspaceId,
    userId: request.user.id,
    currentHour, weekday,
  });
  reply.code(200).send({ success: true, data: result });
}
