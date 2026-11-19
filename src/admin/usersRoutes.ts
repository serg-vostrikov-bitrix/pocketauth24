import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db.js';
import { currentUser } from './auth.js';
import { generatePassword, hashPassword } from './password.js';
import {
  createViewer,
  deleteViewer,
  listUsers,
  LOGIN_PATTERN,
  resetViewerPassword,
  type ViewerChange,
} from './users.js';

const idParams = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
  },
} as const;

const createSchema = {
  body: {
    type: 'object',
    required: ['login'],
    properties: { login: { type: 'string', maxLength: 256 } },
  },
} as const;

// Returns the reply for a refused change, or null when the change was made.
function refused(reply: FastifyReply, result: ViewerChange): FastifyReply | null {
  if (result === 'not_found') return reply.status(404).send({ error: 'not_found' });
  if (result === 'superuser') return reply.status(403).send({ error: 'forbidden' });
  return null;
}

// Passwords appear only in the create and reset responses; nothing logs them.
export async function usersRoutes(app: FastifyInstance, db: Db): Promise<void> {
  await app.register(async (scope) => {
    // onRequest: a viewer gets 403 before body parsing and validation.
    scope.addHook('onRequest', async (request, reply) => {
      if (currentUser(request).role !== 'superuser') {
        return reply.status(403).send({ error: 'forbidden' });
      }
    });

    scope.get('/users', async () => listUsers(db));

    scope.post<{ Body: { login: string } }>(
      '/users',
      { schema: createSchema },
      async (request, reply) => {
        const { login } = request.body;
        if (!LOGIN_PATTERN.test(login)) return reply.status(400).send({ error: 'invalid_login' });
        const password = generatePassword();
        const created = await createViewer(db, login, await hashPassword(password));
        if (!created) return reply.status(409).send({ error: 'login_taken' });
        return reply.status(201).send({ ...created, password });
      },
    );

    scope.post<{ Params: { id: number } }>(
      '/users/:id/password',
      { schema: idParams },
      async (request, reply) => {
        const password = generatePassword();
        const result = await resetViewerPassword(
          db,
          request.params.id,
          await hashPassword(password),
        );
        return refused(reply, result) ?? { password };
      },
    );

    scope.delete<{ Params: { id: number } }>(
      '/users/:id',
      { schema: idParams },
      async (request, reply) => {
        const result = await deleteViewer(db, request.params.id);
        return refused(reply, result) ?? reply.status(204).send();
      },
    );
  });
}
