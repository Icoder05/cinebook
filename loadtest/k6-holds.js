// k6 run loadtest/k6-holds.js -e BASE_URL=https://your-api.onrender.com
//
// Write-path load: each VU signs up once, then repeatedly holds 1–2 random seats and
// releases them. 201 and 409 (lost the race) are both correct outcomes; anything else
// is a failure. Target: p95 < 400 ms for POST /holds.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const BASE = (__ENV.BASE_URL || 'http://localhost:4000') + '/api/v1';
const json = { headers: { 'Content-Type': 'application/json' } };

export const options = {
  scenarios: { hold: { executor: 'constant-vus', vus: 50, duration: '60s' } },
  thresholds: {
    'http_req_duration{endpoint:hold}': ['p(95)<400'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  for (let i = 0; i < 10; i++) http.get(`${BASE}/health`);
  const city = http.get(`${BASE}/cities`).json('cities.0.id');
  const movie = http.get(`${BASE}/movies?status=now_showing&city=${city}`).json('movies.0.id');
  const st = http.get(`${BASE}/movies/${movie}/showtimes?city=${city}`).json();
  return { showtimeId: st.theatres[0].showtimes[0].id };
}

const tokens = {};

export default function (data) {
  const vu = exec.vu.idInTest;
  if (!tokens[vu]) {
    const r = http.post(
      `${BASE}/auth/signup`,
      JSON.stringify({
        name: 'Load Tester',
        email: `k6.${vu}.${Date.now()}@example.com`,
        phone: '9876543210',
        password: 'secret123',
      }),
      json,
    );
    tokens[vu] = r.json('accessToken');
  }
  const auth = { headers: { ...json.headers, Authorization: `Bearer ${tokens[vu]}` } };

  const seats = http.get(`${BASE}/showtimes/${data.showtimeId}/seats`).json('seats');
  const free = seats.filter((s) => s.state === 'AVAILABLE');
  if (!free.length) return;
  const want = [free[Math.floor(Math.random() * free.length)].id];

  const hold = http.post(`${BASE}/showtimes/${data.showtimeId}/holds`, JSON.stringify({ seatIds: want }), {
    ...auth,
    tags: { endpoint: 'hold' },
    responseCallback: http.expectedStatuses(201, 409),
  });
  check(hold, { 'held or lost race (201/409)': (r) => r.status === 201 || r.status === 409 });
  if (hold.status === 201) {
    http.del(`${BASE}/holds/${hold.json('bookingId')}`, null, auth);
  }
}
