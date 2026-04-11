import { FastifyInstance } from 'fastify';
import * as handlers from './workspaces.controller';
import { createWorkspaceSchema, updateWorkspaceSchema } from './workspaces.schema';

const READ_LIMIT  = { max: 60, timeWindow: '1 minute' };
const WRITE_LIMIT = { max: 20, timeWindow: '1 minute' };

export default async function workspacesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/',      {                              config: { rateLimit: READ_LIMIT  } }, handlers.listHandler);
  fastify.post('/',     { schema: createWorkspaceSchema, config: { rateLimit: WRITE_LIMIT } }, handlers.createHandler);
  fastify.patch('/:id', { schema: updateWorkspaceSchema, config: { rateLimit: WRITE_LIMIT } }, handlers.updateHandler);
  fastify.delete('/:id',{                              config: { rateLimit: WRITE_LIMIT } }, handlers.deleteHandler);
}
