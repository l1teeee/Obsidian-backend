import { FastifyInstance } from 'fastify';
import * as handlers from './workspaces.controller';
import { createWorkspaceSchema, updateWorkspaceSchema } from './workspaces.schema';

export default async function workspacesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/',     handlers.listHandler);
  fastify.post('/',    { schema: createWorkspaceSchema }, handlers.createHandler);
  fastify.patch('/:id', { schema: updateWorkspaceSchema }, handlers.updateHandler);
  fastify.delete('/:id', handlers.deleteHandler);
}
