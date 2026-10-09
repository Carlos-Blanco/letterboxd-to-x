// Lectura de RSS y del estado guardado, común a todas las fuentes.
import { readFile, writeFile } from 'node:fs/promises';

function decode(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim();
}

export function tag(xml, name) {
  return decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);
}

export function htmlToText(html) {
  return decode(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim());
}

export async function fetchItems(url) {
  // Solo el dominio en el error: la dirección puede llevar una clave privada.
  const { hostname } = new URL(url);
  const response = await fetch(url, { headers: { 'User-Agent': 'letterboxd-to-x/1.0' } });
  if (!response.ok) throw new Error(`No se pudo leer el RSS de ${hostname} (${response.status})`);
  const xml = await response.text();
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([, item]) => item);
}

export async function readState(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export async function writeState(file, state) {
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}
