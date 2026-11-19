import '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import type { LoginLimiter } from './rateLimit.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import {
  createSession,
  deleteSession,
  findSession,
  SESSION_TTL_SECONDS,
  type AdminUser,
} from './sessions.js';
import { findUserByLogin, hasSuperuser } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminUser: AdminUser | null;
  }
}

export const SESSION_COOKIE = 'b24a_session';
const NO_SUPERUSER_HINT = 'docker compose exec app node dist/cli.js superuser set-password';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
  secure: true,
} as const;

// A browser cannot send a cross-site JSON request without a CORS preflight, and the server
// enables no CORS. Together with SameSite=Strict this blocks CSRF.
export async function jsonGuard(request: FastifyRequest, reply: FastifyReply) {
  const type = request.headers['content-type'] ?? '';
  if (WRITE_METHODS.has(request.method) && !type.toLowerCase().startsWith('application/json')) {
    return reply.status(415).send({ error: 'unsupported_media_type' });
  }
}

export function sessionGuard(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    const user = sessionId ? await findSession(db, sessionId) : null;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    request.adminUser = user;
  };
}

export function currentUser(request: FastifyRequest): AdminUser {
  if (!request.adminUser) throw new Error('sessionGuard did not run');
  return request.adminUser;
}

const loginSchema = {
  body: {
    type: 'object',
    required: ['login', 'password'],
    properties: {
      login: { type: 'string', maxLength: 256 },
      password: { type: 'string', maxLength: 256 },
    },
  },
} as const;

export function loginRoute(app: FastifyInstance, db: Db, limiter: LoginLimiter): void {
  app.post<{ Body: { login: string; password: string } }>(
    '/login',
    { schema: loginSchema },
    async (request, reply) => {
      const ip = request.ip;
      // The reservation happens before any await, so a parallel burst cannot pass the limit.
      // A failed password keeps it; every other outcome gives it back.
      if (!limiter.tryAttempt(ip)) return reply.status(429).send({ error: 'too_many_attempts' });
      let keep = false;
      try {
        if (!(await hasSuperuser(db))) {
          return reply.status(503).send({ error: 'no_superuser', hint: NO_SUPERUSER_HINT });
        }
        const { login, password } = request.body;
        const user = await findUserByLogin(db, login);
        const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) {
          keep = true;
          request.log.info({ login, ip }, 'admin_login_failed');
          return reply.status(401).send({ error: 'invalid_credentials' });
        }
        const sessionId = await createSession(db, user.id);
        reply.setCookie(SESSION_COOKIE, sessionId, {
          ...COOKIE_ATTRIBUTES,
          maxAge: SESSION_TTL_SECONDS,
        });
        request.log.info({ login: user.login, ip }, 'admin_login_succeeded');
        return { login: user.login, role: user.role };
      } finally {
        if (!keep) limiter.refund(ip);
      }
    },
  );
}

export function sessionRoutes(app: FastifyInstance, db: Db): void {
  app.post('/logout', async (request, reply) => {
    const user = currentUser(request);
    await deleteSession(db, request.cookies[SESSION_COOKIE] ?? '');
    reply.clearCookie(SESSION_COOKIE, COOKIE_ATTRIBUTES);
    request.log.info({ login: user.login, ip: request.ip }, 'admin_logout');
    return reply.status(204).send();
  });
  app.get('/me', async (request) => {
    const { login, role } = currentUser(request);
    return { login, role };
  });
}
