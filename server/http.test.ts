import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clientIp, fail, hashIp, isLocalRequest, ok, readBody, sameOrigin } from './http.js';

const request = (headers: Record<string, string>, url = 'https://plonk.example/api/account/login') =>
  new Request(url, { method: 'POST', headers });

describe('ok and fail', () => {
  it('wrap data in the success envelope and are never cached', async () => {
    const response = ok({ username: 'neel' }, 201);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ success: true, data: { username: 'neel' } });
    expect(ok(null).status).toBe(200);
  });

  it('wrap an error in the failure envelope with its status', async () => {
    const response = fail('Sign in first.', 401);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: false, error: 'Sign in first.' });
  });

  it('carry extra headers such as a cookie', () => {
    expect(ok({}, 200, { 'Set-Cookie': 'a=b' }).headers.getSetCookie()).toEqual(['a=b']);
    expect(fail('No.', 401, { 'Set-Cookie': 'a=' }).headers.getSetCookie()).toEqual(['a=']);
  });
});

describe('sameOrigin', () => {
  it('accepts a request from this site', () => {
    expect(sameOrigin(request({ origin: 'https://plonk.example', host: 'plonk.example' }))).toBe(true);
    expect(sameOrigin(request({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true);
  });

  it('refuses a request sent from another site', () => {
    expect(sameOrigin(request({ origin: 'https://evil.example', host: 'plonk.example' }))).toBe(false);
    expect(sameOrigin(request({ origin: 'https://plonk.example.evil.test', host: 'plonk.example' }))).toBe(false);
    expect(sameOrigin(request({ origin: 'https://plonk.example:8443', host: 'plonk.example' }))).toBe(false);
  });

  it('refuses an origin it cannot read, such as the "null" a sandboxed page sends', () => {
    expect(sameOrigin(request({ origin: 'null', host: 'plonk.example' }))).toBe(false);
  });

  it('accepts a request with no Origin header, which a browser page cannot send as a POST', () => {
    expect(sameOrigin(request({ host: 'plonk.example' }))).toBe(true);
  });

  it('compares against the host the visitor asked for when a proxy passes it on', () => {
    const forwarded = { 'x-forwarded-host': 'plonk.example', host: 'internal.vercel.test' };
    expect(sameOrigin(request({ ...forwarded, origin: 'https://plonk.example' }))).toBe(true);
    expect(sameOrigin(request({ ...forwarded, origin: 'https://internal.vercel.test' }))).toBe(false);
  });

  it('refuses the same host over another scheme, as the forwarding proxy or the address tells it', () => {
    const proxied = { host: 'plonk.example', 'x-forwarded-proto': 'https' };
    expect(sameOrigin(request({ ...proxied, origin: 'https://plonk.example' }, 'http://internal/api'))).toBe(true);
    expect(sameOrigin(request({ ...proxied, origin: 'http://plonk.example' }, 'http://internal/api'))).toBe(false);
    expect(sameOrigin(request({ host: 'plonk.example', 'x-forwarded-proto': 'https, http', origin: 'https://plonk.example' }))).toBe(true);
    expect(sameOrigin(request({ host: 'plonk.example', origin: 'http://plonk.example' }))).toBe(false);
  });

  it('does not ask a developer\u2019s own machine about the scheme, where the dev server may forward either', () => {
    const local = { host: 'localhost:3000', origin: 'http://localhost:3000', 'x-forwarded-proto': 'https' };
    expect(sameOrigin(request(local))).toBe(true);
    expect(sameOrigin(request({ ...local, origin: 'http://localhost:4000' }))).toBe(false);
  });

  it('falls back to the host in the request address', () => {
    expect(sameOrigin(request({ origin: 'https://plonk.example' }))).toBe(true);
    expect(sameOrigin(request({ origin: 'https://evil.example' }))).toBe(false);
  });
});

describe('isLocalRequest', () => {
  it.each(['localhost', 'localhost:3000', '127.0.0.1:5173', '[::1]:3000'])('is true for %s', (host) => {
    expect(isLocalRequest(request({ host }))).toBe(true);
  });

  it.each(['plonk.example', 'localhost.evil.example', 'notlocalhost:3000'])('is false for %s', (host) => {
    expect(isLocalRequest(request({ host }))).toBe(false);
  });

  it('is false for a host header that is not a host at all', () => {
    expect(isLocalRequest(request({ host: 'not a host' }))).toBe(false);
  });

  it('goes by the host the visitor asked for', () => {
    expect(isLocalRequest(request({ 'x-forwarded-host': 'plonk.example', host: 'localhost:3000' }))).toBe(false);
    expect(isLocalRequest(request({}, 'http://localhost:3000/api/account'))).toBe(true);
  });
});

describe('clientIp', () => {
  it('takes the first forwarded address', () => {
    expect(clientIp(request({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('counts an IPv6 address as its /64, which is what one customer is given, however it is written', () => {
    const from = (ip: string) => clientIp(request({ 'x-forwarded-for': ip }));
    expect(from('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3:8d3::/64');
    expect(from('2001:DB8:85A3:08D3::1')).toBe('2001:db8:85a3:8d3::/64');
    expect(from('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(from('::1')).toBe('0:0:0:0::/64');
    expect(from('2001:db8:85a3:8d3:ffff::')).toBe(from('2001:db8:85a3:8d3::2'));
    expect(from('2001:db8:85a3:8d4::2')).not.toBe(from('2001:db8:85a3:8d3::2'));
    // An IPv4 address carried inside an IPv6 one is still that IPv4 address.
    expect(from('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(from('not an address')).toBe('not an address');
  });

  it('falls back to x-real-ip, then to one shared bucket', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.8' }))).toBe('203.0.113.8');
    expect(clientIp(request({}))).toBe('unknown');
  });
});

describe('hashIp', () => {
  const secret = Buffer.alloc(32, 3);

  it('gives one address one hash, without the address in it', () => {
    expect(hashIp('203.0.113.7', secret)).toBe(hashIp('203.0.113.7', secret));
    expect(hashIp('203.0.113.7', secret)).not.toContain('203.0.113.7');
    expect(hashIp('203.0.113.7', secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs by address and by secret', () => {
    expect(hashIp('203.0.113.7', secret)).not.toBe(hashIp('203.0.113.8', secret));
    expect(hashIp('203.0.113.7', secret)).not.toBe(hashIp('203.0.113.7', Buffer.alloc(32, 4)));
  });
});

describe('readBody', () => {
  const schema = z.object({ name: z.string().min(1) });
  const post = (body: string, contentType = 'application/json') =>
    new Request('https://plonk.example/api', { method: 'POST', body, headers: { 'content-type': contentType } });

  it('returns the validated body', async () => {
    expect(await readBody(post('{"name":"neel","extra":1}'), schema)).toEqual({ name: 'neel' });
    expect(await readBody(post('{"name":"neel"}', 'Application/JSON; charset=utf-8'), schema)).toEqual({ name: 'neel' });
  });

  it('is null for a body of the wrong shape', async () => {
    expect(await readBody(post('{"name":""}'), schema)).toBeNull();
    expect(await readBody(post('[]'), schema)).toBeNull();
  });

  it('is null for a body with a NUL character anywhere in it, which the database cannot store', async () => {
    const loose = z.looseObject({ name: z.string() });
    expect(await readBody(post('{"name":"ne\\u0000el"}'), loose)).toBeNull();
    expect(await readBody(post('{"name":"neel","more":{"list":[1,["a\\u0000"]]}}'), loose)).toBeNull();
    expect(await readBody(post('{"name":"neel","ke\\u0000y":1}'), loose)).toBeNull();
    // The six characters a player might type are not the character itself.
    expect(await readBody(post('{"name":"\\\\u0000"}'), loose)).toEqual({ name: '\\u0000' });
  });

  it('is null for a body that is not JSON', async () => {
    expect(await readBody(post('{"name":'), schema)).toBeNull();
    expect(await readBody(post(''), schema)).toBeNull();
  });

  it('is null unless the body is declared as JSON, which a plain HTML form cannot do', async () => {
    expect(await readBody(post('{"name":"neel"}', 'text/plain'), schema)).toBeNull();
    expect(await readBody(new Request('https://plonk.example/api', { method: 'POST' }), schema)).toBeNull();
  });
});
