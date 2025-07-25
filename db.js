// db.js
import Database from 'better-sqlite3';
import path from 'path';

// 1) Open (or create) the DB file
const dbPath = process.env.DB_FILE || './wordle_stats.db';
console.log('DB file at:', path.resolve(dbPath));
const db = new Database(dbPath);

// 2) Create necessary tables
db.exec(`
  CREATE TABLE IF NOT EXISTS plays (
    puzzle    INTEGER,
    user_id   TEXT,
    guesses   INTEGER,     -- null = fail
    points    INTEGER,     -- from pointsMap
    PRIMARY KEY(puzzle, user_id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    user_id TEXT PRIMARY KEY,
    elo     REAL DEFAULT 1500
  );
`);

const pointsMap = {
  1: 25,
  2: 18,
  3: 15,
  4: 12,
  5: 10,
  6: 5,
  null: -5,
};

// 3) Main Elo + scoring function
export function recordDailyResults({ puzzle, results }) {
  // results = [{ userId, guesses (or null) }]

  const getElo = db.prepare(`SELECT elo FROM ratings WHERE user_id = ?`);
  const getPlayCount = db.prepare(`SELECT COUNT(*) AS count FROM plays WHERE user_id = ?`);

  const before = {};
  const after = {};
  const kFactors = {};

  // Load Elo and K-factor for each player
  for (const { userId } of results) {
    const eloRow = getElo.get(userId);
    const countRow = getPlayCount.get(userId);

    const elo = eloRow?.elo ?? 1500;
    const count = countRow?.count ?? 0;
    const K = Math.max(35 - count * 2, 10);

    before[userId] = elo;
    after[userId] = elo;
    kFactors[userId] = K;
  }

  // Pairwise Elo calculation (using only `before`)
  for (const A of results) {
    for (const B of results) {
      if (A.userId === B.userId) continue;

      let scoreA;
      if (A.guesses === null)         scoreA = 0;
      else if (B.guesses === null)    scoreA = 1;
      else if (A.guesses < B.guesses) scoreA = 1;
      else if (A.guesses > B.guesses) scoreA = 0;
      else                            scoreA = 0.5;

      const Ra = before[A.userId];
      const Rb = before[B.userId];
      const expectedA = 1 / (1 + 10 ** ((Rb - Ra) / 400));
      const K = kFactors[A.userId];

      after[A.userId] += K * (scoreA - expectedA);
    }
  }

  // Save all results + Elo in a single transaction
  const insertPlay = db.prepare(`
    INSERT OR REPLACE INTO plays (puzzle, user_id, guesses, points)
    VALUES (@puzzle, @userId, @guesses, @points)
  `);
  const upsertElo = db.prepare(`
    INSERT INTO ratings (user_id, elo)
    VALUES (@userId, @elo)
    ON CONFLICT(user_id) DO UPDATE SET elo = excluded.elo
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

// 4) Leaderboard stats
export function getStats() {
  return db.prepare(`
    SELECT
      r.user_id,
      r.elo,
      COUNT(p.puzzle) AS games,
      SUM(CASE WHEN p.guesses IS NOT NULL THEN 1 ELSE 0 END) AS wins,
      ROUND(AVG(p.guesses), 2) AS avg_guesses,
      SUM(p.points) AS total_points
    FROM ratings r
    LEFT JOIN plays p ON p.user_id = r.user_id
    GROUP BY r.user_id
    ORDER BY r.elo DESC
  `).all();
}

export function resetDatabase() {
    db.exec(`
      DELETE FROM plays;
      DELETE FROM ratings;
    `);
    console.log('🧼 Wordle DB wiped: all plays and ratings cleared.');
  }
  