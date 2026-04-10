import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

// ── Constants ────────────────────────────────────────────────────────────────

/** Max chars per individual string value (10 KB). */
const MAX_STRING_LEN = 10_000;

/** Max nesting depth for JSON objects/arrays. Prevents stack overflows. */
const MAX_DEPTH = 12;

/** Keys that enable prototype pollution — always stripped. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Control chars except \t (9), \n (10), \r (13) — those are valid in content.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// Null byte — always malicious (can bypass C-level string parsing, DB drivers, log parsers).
const NULL_BYTE = /\0/;

// Path traversal sequences and their URL-encoded variants.
const PATH_TRAVERSAL = /(\.\.[/\\])|(\.\.%2f)|(\.\.%5c)|(%2e%2e[/\\%])/i;

// ── Core sanitizer ───────────────────────────────────────────────────────────

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    throw httpError(400, 'Request payload too deeply nested', 'INVALID_INPUT');
  }

  if (typeof value === 'string') {
    // data: URIs (base64 images/video frames) — binary content encoded as base64.
    // Base64 alphabet (A-Za-z0-9+/=) cannot contain null bytes, control chars, or
    // path traversal sequences, so text checks are irrelevant. Only enforce a
    // generous upper bound (10 MB) to prevent absurdly large payloads.
    if (value.startsWith('data:')) {
      if (value.length > 10_000_000) {
        throw httpError(400, 'Request value exceeds maximum allowed length', 'PAYLOAD_TOO_LARGE');
      }
      return value;
    }

    // Null bytes — always an attack signal.
    if (NULL_BYTE.test(value)) {
      throw httpError(400, 'Invalid characters in request', 'INVALID_INPUT');
    }

    // Path traversal — no legitimate content should contain these sequences.
    if (PATH_TRAVERSAL.test(value)) {
      throw httpError(400, 'Invalid characters in request', 'INVALID_INPUT');
    }

    // Enforce per-value string length for regular text fields.
    if (value.length > MAX_STRING_LEN) {
      throw httpError(400, 'Request value exceeds maximum allowed length', 'PAYLOAD_TOO_LARGE');
    }

    // Strip non-printable control characters silently.
    return value.replace(CONTROL_CHARS, '');
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitize(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // Prototype pollution prevention.
      if (DANGEROUS_KEYS.has(key)) continue;
      out[key] = sanitize(val, depth + 1);
    }
    return out;
  }

  // number, boolean, null → untouched.
  return value;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const sanitizePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', async (request) => {
    // Skip multipart and form-encoded (file uploads, OAuth callbacks).
    const ct = request.headers['content-type'] ?? '';
    if (ct.includes('multipart/') || ct.includes('application/x-www-form-urlencoded')) {
      return;
    }

    if (request.body   != null) request.body   = sanitize(request.body)   as typeof request.body;
    if (request.query  != null) request.query  = sanitize(request.query)  as typeof request.query;
    if (request.params != null) request.params = sanitize(request.params) as typeof request.params;
  });
};

export default fp(sanitizePlugin, { name: 'sanitize' });

// ── Helpers ──────────────────────────────────────────────────────────────────

function httpError(statusCode: number, message: string, errorCode: string): Error {
  return Object.assign(new Error(message), { statusCode, errorCode });
}
