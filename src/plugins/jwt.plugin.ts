import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { RowDataPacket } from 'mysql2';
import { pool } from '../config/db';

interface InvalidationRow extends RowDataPacket {
  sessions_invalidated_at: Date | null;
}

const authenticatePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      try {
        await request.jwtVerify();
      } catch (err: unknown) {
        const isExpired =
          err instanceof Error && err.message.toLowerCase().includes('expired');

        throw Object.assign(
          new Error(isExpired ? 'Access token has expired' : 'Authentication required'),
          { statusCode: 401, errorCode: isExpired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED' },
        );
      }

      // Check whether this token was issued before a force-logout event
      const userId = (request.user as { id: string }).id;
      const iat    = (request.user as { iat?: number }).iat;

      if (iat !== undefined) {
        const [rows] = await pool.query<InvalidationRow[]>(
          'SELECT sessions_invalidated_at FROM users WHERE id = ? LIMIT 1',
          [userId],
        );
        const invalidatedAt = rows[0]?.sessions_invalidated_at;

        if (invalidatedAt && iat * 1000 < invalidatedAt.getTime()) {
          throw Object.assign(
            new Error('Session has been revoked'),
            { statusCode: 401, errorCode: 'SESSION_REVOKED' },
          );
        }
      }
    }
  );
};

export default fp(authenticatePlugin);
