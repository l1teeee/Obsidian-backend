import { FastifyRequest, FastifyReply } from 'fastify';
import { generateCaptionSuggestions, generateImage, suggestScheduleTime } from './ai.service';

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
  caption?:  string;
  platforms: string[];
}

export async function suggestTimeHandler(
  request: FastifyRequest<{ Body: SuggestTimeBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { caption = '', platforms } = request.body;
  const result = await suggestScheduleTime({ caption, platforms });
  reply.code(200).send({ success: true, data: result });
}
