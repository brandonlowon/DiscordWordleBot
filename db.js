// db.js
import Database from 'better-sqlite3';
import path from 'path';
console.log('DB file at:', path.resolve(process.env.DB_FILE || './wordle_stats.db'));

// 1) Open (or create) the DB file
const db = new Database(process.env.DB_FILE || 'wordle_stats.db');

// 2) Ensure tables exist, now including points
const pointsMap = {
  1: 25,
  2: 18,
  3: 15,
  4: 12,
  5: 10,
  6: 5,
  null: -5,
};

db.exec(`
  CREATE TABLE IF NOT EXISTS plays (
    puzzle    INTEGER,
    user_id   TEXT,
    guesses   INTEGER,     -- null for failures
    points    INTEGER,     -- points awarded per play
    PRIMARY KEY(puzzle, user_id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    user_id TEXT PRIMARY KEY,
    elo     REAL DEFAULT 1500
  );
`);


// 3) Record one day’s results and update Elo + store points
export function recordDailyResults({ puzzle, results }) {
  // results = [ { userId, guesses|null }, … ]

  // 3a) Load “before” ratings (default 1500)
  const getElo = db.prepare(`SELECT elo FROM ratings WHERE user_id = ?`);
  const before = {};
  for (const { userId } of results) {
    const row = getElo.get(userId);
    before[userId] = row ? row.elo : 1500;
  }

  // 3b) Compute new ratings pairwise
  const after = { ...before };
  for (const A of results) {
    for (const B of results) {
      const rows = connection.execute('SELECT COUNT(puzzle) AS count FROM plays WHERE user_id = ?');
      const K_FACTOR = Math.max(35-rows[0].count*2,10);
      if (A.userId === B.userId) continue;
      let scoreA;
      if (A.guesses === null)         scoreA = 0;
      else if (B.guesses === null)    scoreA = 1;
      else if (A.guesses < B.guesses) scoreA = 1;
      else if (A.guesses > B.guesses) scoreA = 0;
      else                             scoreA = 0.5;

      const Ra = before[A.userId];
      const Rb = before[B.userId];
      const expectedA = 1 / (1 + 10 ** ((Rb - Ra) / 400));
      after[A.userId] = Ra + K_FACTOR * (scoreA - expectedA);
    }
  }

  // 3c) Persist in one transaction
  const insertPlay = db.prepare(`
    INSERT OR REPLACE INTO plays (puzzle, user_id, guesses, points)
    VALUES (@puzzle, @userId, @guesses, @points)
  `);
  const upsertElo = db.prepare(`
    INSERT INTO ratings (user_id, elo)
    VALUES (@userId, @elo)
    ON CONFLICT(user_id) DO UPDATE SET elo=excluded.elo
  `);

  const txn = db.transaction(() => {
    for (const row of results) {
      const pts = pointsMap[row.guesses];
      insertPlay.run({
        puzzle,
        userId: row.userId,
        guesses: row.guesses,
        points: pts
      });
      upsertElo.run({
        userId: row.userId,
        elo: after[row.userId]
      });
    }
  });
  txn();
}

// 4) Fetch stats for leaderboard, including total points
export function getStats() {
  return db.prepare(`
    SELECT
      r.user_id,
      r.elo,
      COUNT(p.puzzle)      AS games,
      SUM(CASE WHEN p.guesses IS NOT NULL THEN 1 ELSE 0 END) AS wins,
      ROUND(AVG(p.guesses),2)         AS avg_guesses,
      SUM(p.points)                   AS total_points
    FROM ratings r
    LEFT JOIN plays p ON p.user_id = r.user_id
    GROUP BY r.user_id
    ORDER BY r.elo DESC
  `).all();
}
