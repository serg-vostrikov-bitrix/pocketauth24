import { expect, it } from 'vitest';
import { sanitizeHar, type Har } from '../../scripts/sanitize-har.js';

const PORTAL = 'bx.corp.internal';

function buildHar(): Har {
  return {
    log: {
      entries: [
        {
          request: {
            url: `https://${PORTAL}/rest/profile?auth=abc&client_secret=s3cr3t&x=1`,
            headers: [
              { name: 'Cookie', value: 'PHPSESSID=live' },
              { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
            ],
            cookies: [{ name: 'PHPSESSID', value: 'live' }],
            queryString: [{ name: 'client_secret', value: 's3cr3t' }],
            postData: {
              mimeType: 'application/x-www-form-urlencoded',
              text: `auth[access_token]=AT&auth[domain]=${PORTAL}&client_secret=s3cr3t&grant_type=refresh_token`,
            },
          },
          response: {
            headers: [
              { name: 'Set-Cookie', value: 'a=b' },
              { name: 'Content-Type', value: 'application/json' },
            ],
            cookies: [],
            content: {
              mimeType: 'application/json',
              text: JSON.stringify({
                access_token: 'AT',
                refresh_token: 'RT',
                client_endpoint: `https://${PORTAL}/rest/`,
                expires_in: 3600,
              }),
            },
          },
        },
      ],
    },
  };
}

it('redacts secrets and replaces the portal host everywhere in a HAR', () => {
  const out = sanitizeHar(buildHar(), PORTAL);
  const serialized = JSON.stringify(out);
  for (const leaked of [PORTAL, 'AT"', 'RT', 's3cr3t', 'live', 'Set-Cookie']) {
    expect(serialized).not.toContain(leaked);
  }

  const { request, response } = out.log.entries[0];
  expect(request.url).toContain('portal.example');
  expect(request.headers).toEqual([
    { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
  ]);
  const form = new URLSearchParams(request.postData?.text);
  expect(form.get('auth[access_token]')).toBe('<redacted>');
  expect(form.get('auth[domain]')).toBe('portal.example');
  expect(form.get('grant_type')).toBe('refresh_token');

  const body = JSON.parse(response.content.text ?? '') as Record<string, unknown>;
  expect(body).toEqual({
    access_token: '<redacted>',
    refresh_token: '<redacted>',
    client_endpoint: 'https://portal.example/rest/',
    expires_in: 3600,
  });
});
