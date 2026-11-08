// Valoraciones de libros: API GraphQL de Hardcover.app.
import { fitText, publishUnseen } from './post.js';

const API_KEY = process.env.HARDCOVER_API_KEY;
const GRAPHQL_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const STATE_FILE = new URL('../hardcover-posted.json', import.meta.url);

async function queryHardcover(query, variables = {}) {
  const token = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'User-Agent': 'letterboxd-to-x/1.0',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Hardcover respondió con estado ${response.status}`);
  }

  const result = await response.json();
  if (result.errors?.length) {
    const message = result.errors.map((e) => e.message).join('; ');
    throw new Error(`Hardcover GraphQL error: ${message}`);
  }

  return result.data;
}

const READ_BOOKS_QUERY = `
  query ReadBooks($limit: Int, $offset: Int) {
    me {
      user_books(
        where: { status_id: { _eq: 3 } }
        order_by: { updated_at: desc }
        limit: $limit
        offset: $offset
      ) {
        id
        rating
        review
        book {
          id
          title
          image {
            url
          }
          contributions {
            author {
              name
            }
          }
        }
      }
    }
  }
`;

function formatRating(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  return '⭐'.repeat(Math.floor(num)) + (num % 1 >= 0.5 ? '½' : '');
}

function parseUserBooks(userBooks = []) {
  return userBooks
    .map((ub) => {
      const book = ub.book ?? {};
      const authors = (book.contributions ?? []).map((c) => c.author?.name).filter(Boolean);
      return {
        id: String(ub.id),
        title: (book.title ?? '').trim(),
        author: authors.join(', '),
        rating: formatRating(ub.rating),
        review: typeof ub.review === 'string' ? ub.review.trim() : '',
        image: book.image?.url ?? '',
      };
    })
    .filter((entry) => entry.id && entry.title && entry.rating);
}

async function fetchReadBooks(limit = 20, offset = 0) {
  const data = await queryHardcover(READ_BOOKS_QUERY, { limit, offset });
  const me = Array.isArray(data?.me) ? data.me[0] : data?.me;
  return parseUserBooks(me?.user_books ?? []);
}

async function allRatedIds() {
  const ids = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const books = await fetchReadBooks(pageSize, offset);
    if (!books.length) break;
    ids.push(...books.map((b) => b.id));
    if (books.length < pageSize) break;
  }
  return ids;
}

function composeText(book, review) {
  const header = `📚 He leído '${book.title}'${book.author ? `, de ${book.author}` : ''}`;
  return [header, book.rating, review].filter(Boolean).join('\n');
}

export async function run() {
  if (!API_KEY) {
    console.log('Hardcover: sin HARDCOVER_API_KEY, no se consulta.');
    return;
  }

  await publishUnseen({
    name: 'Hardcover',
    stateFile: STATE_FILE,
    seed: allRatedIds,
    latest: () => fetchReadBooks(20),
    toPost: (book) => ({
      title: book.title,
      text: fitText((review) => composeText(book, review), book.review),
      imageUrl: book.image,
    }),
  });
}

