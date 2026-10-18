import { assertEnv } from '../env.js';
import { closeDb, initDb } from './client.js';
import { dropAll, migrate } from './migrate.js';
import { seed } from './seed.js';
import { syncMoviesFromTmdb } from '../services/tmdb.service.js';
import { autoSchedule } from '../services/venue.service.js';

assertEnv();
const cmd = process.argv[2];

await initDb();
try {
  switch (cmd) {
    case 'migrate':
      await migrate();
      break;
    case 'seed':
      await migrate();
      await seed();
      break;
    case 'reset':
      await dropAll();
      await migrate();
      await seed();
      break;
    case 'sync': {
      await migrate();
      const r = await syncMoviesFromTmdb();
      console.log(`[tmdb] synced ${r.synced} movies (${r.nowShowing} now showing, ${r.upcoming} upcoming)`);
      const s = await autoSchedule(7);
      console.log(`[tmdb] scheduled ${s.created} new showtimes`);
      break;
    }
    default:
      console.error('Usage: cli.ts <migrate|seed|reset|sync>');
      process.exitCode = 1;
  }
} finally {
  await closeDb();
}
