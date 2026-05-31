import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';

const { API_BASE_URL } = process.env;

export const createApiInstance = (apiKey) =>
  axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

export async function fetchAccounts(api) {
  const { data } = await api.get('/accounts');
  return Array.isArray(data) ? data : data.accounts || [];
}

export async function fetchCategories(api) {
  const { data } = await api.get('/categories');
  return Array.isArray(data) ? data : data.categories || [];
}

export const parseAmount = (text) => {
  const normalized = String(text)
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};

export function isTheFuture(dateStr) {
  const [day, month, year] = dateStr.split('-');
  return new Date(year, month - 1, day) > new Date();
}

export function decreaseCurrency(currentStr, amount) {
  const numeric = parseFloat(
    currentStr.replace(/[Rp\s.]/g, '').replace(',', '.'),
  );
  return (numeric - amount).toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
  });
}

export function increaseCurrency(currentStr, amount) {
  const numeric = parseFloat(
    currentStr.replace(/[Rp\s.]/g, '').replace(',', '.'),
  );
  return (numeric + amount).toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
  });
}
