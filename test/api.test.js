'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createDb } = require('../db');
const { createApp } = require('../server');

let server;
let db;
let base;

const valid = { name: 'Keyboard', category: 'Peripherals', price: 49.99, quantity: 5 };

function request(method, path, body, headers) {
  return fetch(base + path, {
    method,
    headers: headers || (body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

before(async () => {
  db = createDb(':memory:');
  server = createApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('list is empty on a fresh database', async () => {
  const res = await request('GET', '/api/products');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('create, read, update and delete a product', async () => {
  const created = await request('POST', '/api/products', valid);
  assert.equal(created.status, 201);
  const product = await created.json();
  assert.equal(product.name, 'Keyboard');
  assert.equal(product.price, 49.99);
  assert.ok(Number.isInteger(product.id));

  const fetched = await request('GET', `/api/products/${product.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), product);

  const updated = await request('PUT', `/api/products/${product.id}`, { ...valid, quantity: 0 });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).quantity, 0);

  const removed = await request('DELETE', `/api/products/${product.id}`);
  assert.equal(removed.status, 204);

  const missing = await request('GET', `/api/products/${product.id}`);
  assert.equal(missing.status, 404);
});

test('text fields are trimmed', async () => {
  const res = await request('POST', '/api/products', { ...valid, name: '  Mouse  ' });
  assert.equal((await res.json()).name, 'Mouse');
});

test('invalid payloads are rejected with 400', async () => {
  const cases = [
    { ...valid, name: '' },
    { ...valid, name: '   ' },
    { ...valid, name: 'x'.repeat(101) },
    { ...valid, category: undefined },
    { ...valid, price: -1 },
    { ...valid, price: '10' },
    { ...valid, quantity: 1.5 },
    { ...valid, quantity: -3 },
    [],
    null,
  ];
  for (const body of cases) {
    const res = await request('POST', '/api/products', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).error);
  }
});

test('malformed JSON is rejected with 400', async () => {
  const res = await request('POST', '/api/products', '{broken', {
    'Content-Type': 'application/json',
  });
  assert.equal(res.status, 400);
});

test('non-JSON content type is rejected with 415', async () => {
  const res = await request('POST', '/api/products', JSON.stringify(valid), {
    'Content-Type': 'text/plain',
  });
  assert.equal(res.status, 415);
});

test('oversized body is rejected with 413', async () => {
  const res = await request('POST', '/api/products', { ...valid, name: 'x'.repeat(20000) });
  assert.equal(res.status, 413);
});

test('SQL and HTML in input are stored as plain text', async () => {
  const name = "<script>alert(1)</script>'); DROP TABLE products;--";
  const res = await request('POST', '/api/products', { ...valid, name });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).name, name);

  const list = await request('GET', '/api/products');
  assert.equal(list.status, 200);
  assert.ok((await list.json()).some((p) => p.name === name));
});

test('invalid or unknown ids are handled', async () => {
  assert.equal((await request('GET', '/api/products/abc')).status, 400);
  assert.equal((await request('GET', '/api/products/0')).status, 400);
  assert.equal((await request('GET', '/api/products/999999')).status, 404);
  assert.equal((await request('PUT', '/api/products/999999', valid)).status, 404);
  assert.equal((await request('DELETE', '/api/products/999999')).status, 404);
});

test('unsupported methods and unknown routes', async () => {
  assert.equal((await request('PATCH', '/api/products')).status, 405);
  assert.equal((await request('GET', '/api/unknown')).status, 404);
  assert.equal((await request('GET', '/../server.js')).status, 404);
});

test('index page is served with security headers', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});
