'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createDb } = require('./db');

const MAX_BODY_BYTES = 10 * 1024;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Белый список статики: путь из запроса никогда не попадает в файловую систему.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      req.resume();
      reject(new HttpError(415, 'Content-Type must be application/json'));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (tooLarge) {
        reject(new HttpError(413, 'Request body is too large'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
  });
}

// Серверная валидация: возвращает очищенный объект или бросает 400.
function validateProduct(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  const errors = [];

  const text = (field, max) => {
    const value = input[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${field} is required`);
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length > max) errors.push(`${field} must be at most ${max} characters`);
    return trimmed;
  };

  const name = text('name', 100);
  const category = text('category', 50);

  const { price, quantity } = input;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e9) {
    errors.push('price must be a number from 0 to 1000000000');
  }
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1e9) {
    errors.push('quantity must be an integer from 0 to 1000000000');
  }

  if (errors.length > 0) throw new HttpError(400, errors.join('; '));
  return { name, category, price: Math.round(price * 100) / 100, quantity };
}

function parseId(raw) {
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw new HttpError(400, 'Invalid id');
  return Number(raw);
}

async function handleApi(req, res, db, pathname) {
  const match = /^\/api\/products(?:\/([^/]+))?$/.exec(pathname);
  if (!match) throw new HttpError(404, 'Not found');
  const rawId = match[1];

  if (rawId === undefined) {
    if (req.method === 'GET') return sendJson(res, 200, db.list());
    if (req.method === 'POST') {
      const product = validateProduct(await readJsonBody(req));
      return sendJson(res, 201, db.create(product));
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const id = parseId(rawId);
  if (req.method === 'GET') {
    const row = db.get(id);
    if (!row) throw new HttpError(404, 'Product not found');
    return sendJson(res, 200, row);
  }
  if (req.method === 'PUT') {
    const product = validateProduct(await readJsonBody(req));
    const row = db.update(id, product);
    if (!row) throw new HttpError(404, 'Product not found');
    return sendJson(res, 200, row);
  }
  if (req.method === 'DELETE') {
    if (!db.remove(id)) throw new HttpError(404, 'Product not found');
    res.writeHead(204, SECURITY_HEADERS);
    return res.end();
  }
  throw new HttpError(405, 'Method not allowed');
}

function serveStatic(req, res, pathname) {
  const entry = STATIC_FILES[pathname];
  if (!entry) throw new HttpError(404, 'Not found');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed');
  }
  const [file, contentType] = entry;
  const content = fs.readFileSync(path.join(PUBLIC_DIR, file));
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentType });
  res.end(req.method === 'HEAD' ? undefined : content);
}

function createApp(db) {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, db, pathname);
      } else {
        serveStatic(req, res, pathname);
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Internal server error';
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.end();
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const db = createDb(process.env.DB_PATH || path.join(__dirname, 'data', 'app.db'));
  createApp(db).listen(port, host, () => {
    console.log(`Server is running at http://${host}:${port}`);
  });
}

module.exports = { createApp };
