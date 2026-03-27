import { FastifyRequest, FastifyReply } from 'fastify';
import { generateCaptionSuggestions, generateImage } from './ai.service';

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
  topic:        string;
  platform?:    string;
  workspaceId?: string;
}

export async function inspireHandler(
  request: FastifyRequest<{ Body: InspireBody }>,
  reply:   FastifyReply,
): Promise<void> {
  const { topic, platform, workspaceId } = request.body;

  const result = await generateCaptionSuggestions({ topic, platform, workspaceId });

  reply.code(200).send({ success: true, data: result });
}
