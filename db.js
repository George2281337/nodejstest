'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Открывает базу и возвращает набор операций над таблицей products.
// Все запросы параметризованные.
function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      category   TEXT    NOT NULL,
      price      REAL    NOT NULL CHECK (price >= 0),
      quantity   INTEGER NOT NULL CHECK (quantity >= 0),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const columns = 'id, name, category, price, quantity, created_at';
  const selectAll = db.prepare(`SELECT ${columns} FROM products ORDER BY id DESC`);
  const selectOne = db.prepare(`SELECT ${columns} FROM products WHERE id = ?`);
  const insert = db.prepare(
    'INSERT INTO products (name, category, price, quantity) VALUES (?, ?, ?, ?)'
  );
  const update = db.prepare(
    'UPDATE products SET name = ?, category = ?, price = ?, quantity = ? WHERE id = ?'
  );
  const remove = db.prepare('DELETE FROM products WHERE id = ?');

  return {
    list: () => selectAll.all().map((row) => ({ ...row })),
    get: (id) => {
      const row = selectOne.get(id);
      return row ? { ...row } : null;
    },
    create(p) {
      const result = insert.run(p.name, p.category, p.price, p.quantity);
      return this.get(Number(result.lastInsertRowid));
    },
    update(id, p) {
      const result = update.run(p.name, p.category, p.price, p.quantity, id);
      return result.changes > 0 ? this.get(id) : null;
    },
    remove: (id) => remove.run(id).changes > 0,
    close: () => db.close(),
  };
}

module.exports = { createDb };
