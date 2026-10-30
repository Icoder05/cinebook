// E12: offline simulation of discovery efficiency under four ranking policies.
//   npx tsx experiments/harness/recsim.mjs [--run name]
// SIMULATION, not user data: seeded synthetic personas browse CineBook's real now-showing
// catalogue (catalog-snapshot.ts). Each persona has a hidden utility over films; the film
// it would book is the argmax. Policies only see what a real app could see (the persona's
// chosen language and two noisy genre "likes"), never the hidden utility.
import { readFileSync } from 'node:fs';
import { SNAPSHOT_MOVIES } from '../../apps/api/src/db/catalog-snapshot.ts';
import { createLogger } from './log.mjs';
import { CONFIG } from './paths.mjs';
import { mulberry32 } from './stats.mjs';

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const E = config.offline.E12;
const args = process.argv.slice(2);
const RUN_ID = args.includes('--run') ? args[args.indexOf('--run') + 1] : 'recsim';
const log = createLogger(RUN_ID);
const CARDS_PER_ROW = 2; // mobile grid: rows a user scrolls past before seeing the film

const films = SNAPSHOT_MOVIES.filter((m) => m.status === 'now_showing');
// App's default order: rating DESC NULLS LAST (all null in the snapshot), release DESC, title ASC.
const defaultOrder = [...films].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title));
const GENRES = [...new Set(films.flatMap((m) => m.genres))];
// Audience mix by primary language (approximate share of Indian box-office footfall; assumption).
const LANG_MIX = [['Hindi', 0.35], ['Telugu', 0.17], ['Tamil', 0.15], ['English', 0.13], ['Malayalam', 0.1], ['Kannada', 0.1]];

function pick(rnd, weighted) {
  let x = rnd() * weighted.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weighted) if ((x -= w) <= 0) return v;
  return weighted[weighted.length - 1][0];
}
const gumbel = (rnd) => -Math.log(-Math.log(Math.max(1e-12, rnd())));

function makePersona(rnd, noise) {
  const primary = pick(rnd, LANG_MIX);
  const understands = new Set([primary]);
  if (primary !== 'English' && rnd() < 0.5) understands.add('English');
  if (primary !== 'Hindi' && rnd() < 0.4) understands.add('Hindi');
  const favs = new Map();
  while (favs.size < 2) favs.set(GENRES[Math.floor(rnd() * GENRES.length)], 0.6 + rnd());
  const utility = new Map();
  for (const m of films) {
    if (!m.languages.some((l) => understands.has(l))) continue; // cannot watch it
    const lang = m.languages[0] === primary ? 2 : m.languages.includes(primary) ? 1.2 : 0.4;
    const genre = m.genres.reduce((s, g) => s + (favs.get(g) ?? 0), 0);
    utility.set(m.tmdbId, lang + genre + noise * gumbel(rnd));
  }
  // What an app can observe: the chosen language and two genre "likes", one of which is
  // a true favourite and the other a true favourite with p = 0.7, otherwise random.
  const favList = [...favs.keys()];
  const likes = [favList[0], rnd() < 0.7 ? favList[1] : GENRES[Math.floor(rnd() * GENRES.length)]];
  return { primary, understands, utility, likes };
}

function rankings(p, popularity) {
  const watchable = (list) => list.filter((m) => p.utility.has(m.tmdbId));
  const byScore = (score) => [...films].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title));
  return {
    default: defaultOrder,
    language_filter: [...defaultOrder.filter((m) => m.languages.includes(p.primary)), ...defaultOrder.filter((m) => !m.languages.includes(p.primary))],
    popularity: byScore((m) => popularity.get(m.tmdbId) ?? 0),
    content_based: byScore((m) =>
      (m.languages[0] === p.primary ? 2 : m.languages.includes(p.primary) ? 1.2 : m.languages.some((l) => p.understands.has(l)) ? 0.4 : -5)
      + m.genres.filter((g) => p.likes.includes(g)).length + 0.01 * (popularity.get(m.tmdbId) ?? 0)),
    watchable,
  };
}

function metrics(order, p) {
  const ranked = [...p.utility.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const target = ranked[0];
  const grade = new Map(ranked.slice(0, 3).map((id, i) => [id, 3 - i]));
  const rank = order.findIndex((m) => m.tmdbId === target) + 1;
  const dcg = order.slice(0, 5).reduce((s, m, i) => s + ((2 ** (grade.get(m.tmdbId) ?? 0)) - 1) / Math.log2(i + 2), 0);
  const idcg = [3, 2, 1].slice(0, Math.min(3, ranked.length)).reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
  return { rank, hr3: rank <= 3 ? 1 : 0, mrr: 1 / rank, ndcg5: idcg ? dcg / idcg : 0, rowsScrolled: Math.ceil(rank / CARDS_PER_ROW) - 1 };
}

const manifest = { runId: RUN_ID, startedAt: new Date().toISOString(), design: E, films: films.length, genres: GENRES, langMix: LANG_MIX, cardsPerRow: CARDS_PER_ROW, nature: 'simulation (synthetic personas)' };
log.manifest(manifest);
log.event({ type: 'run_start', runId: RUN_ID, totalCells: 3 });

for (const [ni, noise] of [0.25, 0.5, 1.0].entries()) {
  // Popularity is learned on a separate training cohort so it cannot peek at test personas.
  const train = mulberry32(config.seed + 100 + ni);
  const popularity = new Map();
  for (let i = 0; i < E.personas; i++) {
    const p = makePersona(train, noise);
    const top = [...p.utility.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) popularity.set(top, (popularity.get(top) ?? 0) + 1 / E.personas);
  }
  const rnd = mulberry32(config.seed + 200 + ni);
  log.event({ type: 'cell_start', exp: 'E12', strategy: `noise=${noise}`, c: E.personas });
  for (let i = 0; i < E.personas; i++) {
    const p = makePersona(rnd, noise);
    if (!p.utility.size) continue;
    const R = rankings(p, popularity);
    for (const policy of ['default', 'language_filter', 'popularity', 'content_based']) {
      log.trial({ exp: 'E12', strategy: policy, c: 1, trial: i, noise, primary: p.primary, watchable: p.utility.size, ...metrics(R[policy], p) });
    }
  }
  log.event({ type: 'progress', done: ni + 1, total: 3 });
  console.log(`noise ${noise}: done`);
}
log.event({ type: 'run_end', finishedAt: new Date().toISOString() });
manifest.finishedAt = new Date().toISOString();
log.manifest(manifest);
await log.close();
