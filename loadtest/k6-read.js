// k6 run loadtest/k6-read.js -e BASE_URL=https://your-api.onrender.com
//
// PRD §8 target: p95 < 200 ms for GET /movies, /movies/:id, /movies/:id/showtimes and
// /showtimes/:id/seats at 100 virtual users for 60 s; p95 < 400 ms for POST /holds
// (see k6-holds.js). Warm Neon up first: the script hits /health in setup().
import http from 'k6/http';
import { check, fail } from 'k6';

const BASE = (__ENV.BASE_URL || 'http://localhost:4000') + '/api/v1';

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 100, duration: '60s' },
  },
  thresholds: {
    'http_req_duration{endpoint:movies}': ['p(95)<200'],
    'http_req_duration{endpoint:movie}': ['p(95)<200'],
    'http_req_duration{endpoint:showtimes}': ['p(95)<200'],
    'http_req_duration{endpoint:seats}': ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  // Neon free tier suspends when idle; the first queries are cold. Warm up and only
  // measure warm numbers (and say so in results.md).
  for (let i = 0; i < 10; i++) http.get(`${BASE}/health`);

  const city = http.get(`${BASE}/cities`).json('cities.0.id');
  const movies = http.get(`${BASE}/movies?status=now_showing&city=${city}`).json('movies');
  if (!movies || !movies.length) fail('no movies — seed the database first');
  const targets = [];
  for (const m of movies) {
    const st = http.get(`${BASE}/movies/${m.id}/showtimes?city=${city}`).json();
    const showtimeIds = st.theatres.flatMap((t) => t.showtimes.map((s) => s.id));
    if (showtimeIds.length) targets.push({ movieId: m.id, showtimeIds });
  }
  return { city, targets };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export default function (data) {
  const t = pick(data.targets);
  const res = [
    http.get(`${BASE}/movies?status=now_showing&city=${data.city}`, { tags: { endpoint: 'movies' } }),
    http.get(`${BASE}/movies/${t.movieId}`, { tags: { endpoint: 'movie' } }),
    http.get(`${BASE}/movies/${t.movieId}/showtimes?city=${data.city}`, { tags: { endpoint: 'showtimes' } }),
    http.get(`${BASE}/showtimes/${pick(t.showtimeIds)}/seats`, { tags: { endpoint: 'seats' } }),
  ];
  for (const r of res) check(r, { 'status 200': (x) => x.status === 200 });
}
