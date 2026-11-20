'use strict';

const form = document.getElementById('product-form');
const idField = document.getElementById('product-id');
const fields = {
  name: document.getElementById('name'),
  category: document.getElementById('category'),
  price: document.getElementById('price'),
  quantity: document.getElementById('quantity'),
};
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const message = document.getElementById('message');

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function showError(text) {
  message.textContent = text;
  message.hidden = !text;
}

// Ячейки заполняются только через textContent — данные из базы не попадают в разметку.
function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function button(text, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.className = `small ${className}`;
  btn.addEventListener('click', onClick);
  return btn;
}

function resetForm() {
  form.reset();
  idField.value = '';
  submitBtn.textContent = 'Добавить';
  cancelBtn.hidden = true;
}

function startEdit(product) {
  idField.value = product.id;
  fields.name.value = product.name;
  fields.category.value = product.category;
  fields.price.value = product.price;
  fields.quantity.value = product.quantity;
  submitBtn.textContent = 'Сохранить';
  cancelBtn.hidden = false;
  fields.name.focus();
}

async function removeProduct(product) {
  showError('');
  try {
    await api('DELETE', `/api/products/${product.id}`);
    if (idField.value === String(product.id)) resetForm();
    await load();
  } catch (err) {
    showError(err.message);
  }
}

function render(products) {
  rows.replaceChildren();
  empty.hidden = products.length > 0;
  for (const product of products) {
    const tr = document.createElement('tr');
    const actions = document.createElement('td');
    actions.className = 'row-actions';
    actions.append(
      button('Изменить', 'secondary', () => startEdit(product)),
      button('Удалить', 'danger', () => removeProduct(product))
    );
    tr.append(
      cell(product.id),
      cell(product.name),
      cell(product.category),
      cell(product.price.toFixed(2), 'num'),
      cell(product.quantity, 'num'),
      cell(product.created_at),
      actions
    );
    rows.append(tr);
  }
}

async function load() {
  try {
    render(await api('GET', '/api/products'));
  } catch (err) {
    showError(err.message);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const payload = {
    name: fields.name.value,
    category: fields.category.value,
    price: Number(fields.price.value),
    quantity: Number(fields.quantity.value),
  };
  try {
    if (idField.value) {
      await api('PUT', `/api/products/${idField.value}`, payload);
    } else {
      await api('POST', '/api/products', payload);
    }
    resetForm();
    await load();
  } catch (err) {
    showError(err.message);
  }
});

cancelBtn.addEventListener('click', resetForm);

load();
