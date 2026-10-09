// Valoraciones de libros: RSS de la estantería «read» de Goodreads.
import { fetchItems, htmlToText, tag } from './feed.js';
import { fitText, publishUnseen } from './post.js';

// https://www.goodreads.com/review/list_rss/<id de usuario>?shelf=read
const FEED_URL = process.env.GOODREADS_RSS_URL;
const STATE_FILE = new URL('../goodreads-posted.json', import.meta.url);
// Tope de páginas al registrar el punto de partida (100 libros por página).
const MAX_PAGES = 50;

function parseItems(items) {
  return items.map((item) => {
    const guid = tag(item, 'guid') || tag(item, 'link');
    const cover = tag(item, 'book_large_image_url');
    return {
      id: guid.match(/\/review\/show\/(\d+)/)?.[1] ?? guid,
      // Goodreads añade la saga o la edición al título: «Holly (Holly Gibney,
      // #3)», «Madrid DF (Spanish Edition)».
      title: tag(item, 'title').replace(/(?:\s*\([^()]*(?:#\d|Edition)[^()]*\))+\s*$/, '').replace(/\s+/g, ' '),
      author: tag(item, 'author_name').replace(/\s+/g, ' '),
      rating: '⭐'.repeat(Number(tag(item, 'user_rating')) || 0),
      review: htmlToText(tag(item, 'user_review')),
      image: /nophoto/.test(cover) ? '' : cover,
    };
  }).filter((book) => book.id && book.title && book.rating);
  // La estantería incluye libros leídos sin puntuar (`user_rating` 0): exigir
  // una valoración los deja fuera hasta que la reciben.
}

async function fetchPage(page) {
  const url = new URL(FEED_URL);
  url.searchParams.set('page', page);
  return fetchItems(url);
}

async function allRatedIds() {
  const ids = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = await fetchPage(page);
    if (!items.length) break;
    ids.push(...parseItems(items).map((book) => book.id));
  }
  return ids;
}

function composeText(book, review) {
  const header = `📚 He leído '${book.title}'${book.author ? `, de ${book.author}` : ''}`;
  return [header, book.rating, review].filter(Boolean).join('\n');
}

export async function run() {
  if (!FEED_URL) {
    console.log('Goodreads: sin GOODREADS_RSS_URL, no se consulta.');
    return;
  }

  // El RSS se ordena por «fecha de añadido», que cambia al editar una reseña
  // antigua y la devuelve arriba. Por eso no basta con recordar la última
  // entrada publicada: se guardan todas las valoraciones ya vistas.
  await publishUnseen({
    name: 'Goodreads',
    stateFile: STATE_FILE,
    seed: allRatedIds,
    latest: async () => {
      const items = await fetchPage(1);
      if (!items.length) throw new Error('El RSS no contiene libros: revisa GOODREADS_RSS_URL y que el perfil sea público');
      return parseItems(items);
    },
    toPost: (book) => ({
      title: book.title,
      text: fitText((review) => composeText(book, review), book.review),
      imageUrl: book.image,
    }),
  });
}
