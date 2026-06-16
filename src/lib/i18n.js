import id from '../locales/id.js';
import en from '../locales/en.js';

const locales = { id, en };

function resolve(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

export function createI18n(locale = 'id') {
  const strings = locales[locale] || locales.id;

  return {
    locale,
    t(path, params = {}) {
      let value = resolve(strings, path);
      if (value === undefined) {
        value = resolve(locales.id, path) || path;
      }
      if (typeof value === 'string' && params) {
        return value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`);
      }
      return value;
    },
  };
}

export function getAvailableLocales() {
  return Object.keys(locales);
}
