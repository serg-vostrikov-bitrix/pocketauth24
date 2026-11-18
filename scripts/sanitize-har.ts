// Usage: npx tsx scripts/sanitize-har.ts <input.raw.har> <output.har> <portal-host>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import qs from 'qs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Header = { name: string; value: string };
type HarEntry = {
  request: {
    url: string;
    headers: Header[];
    cookies: unknown[];
    queryString: unknown[];
    postData?: { mimeType: string; text?: string; params?: unknown[] };
  };
  response: {
    headers: Header[];
    cookies: unknown[];
    content: { mimeType: string; text?: string; encoding?: string };
  };
};
export type Har = { log: { entries: HarEntry[] } };

const SECRET_KEY = /token|secret|client_id|member_id|^auth$|^bx_|hash|licen|password|^code$/i;
const KEPT_HEADERS = new Set(['content-type']);

function scrub(value: Json, portalHost: string, key = ''): Json {
  if (Array.isArray(value)) return value.map((item) => scrub(item, portalHost, key));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, portalHost, k)]));
  }
  if (typeof value === 'string') {
    return SECRET_KEY.test(key) ? '<redacted>' : value.replaceAll(portalHost, 'portal.example');
  }
  return value;
}

function scrubText(
  text: string | undefined,
  mimeType: string,
  portalHost: string,
): string | undefined {
  if (!text) return text;
  if (mimeType.includes('json')) {
    return JSON.stringify(scrub(JSON.parse(text) as Json, portalHost));
  }
  if (mimeType.includes('x-www-form-urlencoded')) {
    return qs.stringify(scrub(qs.parse(text, { depth: 20, arrayLimit: 1000 }) as Json, portalHost));
  }
  return '<redacted body>';
}

function scrubUrl(raw: string, portalHost: string): string {
  const url = new URL(raw.replaceAll(portalHost, 'portal.example'));
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_KEY.test(key)) url.searchParams.set(key, '<redacted>');
  }
  return url.toString();
}

export function sanitizeHar(har: Har, portalHost: string): Har {
  for (const entry of har.log.entries) {
    const { request, response } = entry;
    request.url = scrubUrl(request.url, portalHost);
    request.headers = request.headers.filter((h) => KEPT_HEADERS.has(h.name.toLowerCase()));
    request.cookies = [];
    request.queryString = [];
    if (request.postData) {
      request.postData.text = scrubText(
        request.postData.text,
        request.postData.mimeType,
        portalHost,
      );
      request.postData.params = [];
    }
    response.headers = response.headers.filter((h) => KEPT_HEADERS.has(h.name.toLowerCase()));
    response.cookies = [];
    if (response.content.encoding === 'base64' && response.content.text) {
      response.content.text = Buffer.from(response.content.text, 'base64').toString('utf8');
      delete response.content.encoding;
    }
    response.content.text = scrubText(response.content.text, response.content.mimeType, portalHost);
  }
  return har;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, portalHost] = process.argv.slice(2);
  if (!input || !output || !portalHost) {
    throw new Error('Usage: sanitize-har.ts <input.raw.har> <output.har> <portal-host>');
  }
  const har = JSON.parse(readFileSync(input, 'utf8')) as Har;
  writeFileSync(output, JSON.stringify(sanitizeHar(har, portalHost), null, 2));
}
