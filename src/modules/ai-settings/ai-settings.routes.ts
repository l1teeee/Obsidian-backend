import { FastifyInstance } from 'fastify';
import { getHandler, upsertHandler } from './ai-settings.controller';
import { getAiSettingsSchema, upsertAiSettingsSchema } from './ai-settings.schema';

export default async function aiSettingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get( '/:workspaceId', { schema: getAiSettingsSchema    }, getHandler    );
  fastify.put( '/:workspaceId', { schema: upsertAiSettingsSchema }, upsertHandler );
}
