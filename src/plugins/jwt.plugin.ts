import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

const authenticatePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      try {
        await request.jwtVerify();
      } catch (err: unknown) {
        const isExpired =
          err instanceof Error && err.message.toLowerCase().includes('expired');

        const error = Object.assign(
          new Error(isExpired ? 'Access token has expired' : 'Authentication required'),
          {
            statusCode: 401,
            errorCode: isExpired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
          }
        );
        throw error;
      }
    }
  );
};

export default fp(authenticatePlugin);
