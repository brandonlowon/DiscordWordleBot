// index.js
import { Client, GatewayIntentBits, Events } from 'discord.js';
import dotenv from 'dotenv';
import { recordDailyResults, getStats } from './db.js';
import { resetDatabase } from './db.js';

dotenv.config();

if (process.env.RESET_WORDLE_DB === 'true') {
    resetDatabase();
  }

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------
const TOKEN      = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.WORDLE_CHANNEL_ID;
if (!TOKEN || !CHANNEL_ID) {
  console.error('❌ Please set DISCORD_TOKEN and WORDLE_CHANNEL_ID in your .env');
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Create Discord client
// ----------------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const userMap = new Map();

// ----------------------------------------------------------------------------
// Parser: detect and parse only messages whose content starts with "**Your group is on"
// ----------------------------------------------------------------------------
function parseWordleMessage(msg) {
  if (msg.channel.id !== CHANNEL_ID) return null;
  const content = msg.content ?? '';
  if (!content.startsWith('**Your group is on')) return null;

  // use message ID as puzzle identifier
  const puzzle = msg.id;

  // Parse each score line in the content
  const results = [];
  for (let line of content.split('\n')) {
    // strip crown emoji
    line = line.replace(/^👑\s*/, '');
    const m = line.match(/^([1-6X])\/6:\s*(.+)$/);
    if (!m) continue;
    const guesses = m[1] === 'X' ? null : Number(m[1]);

    // collect user IDs
    let users = [...msg.mentions.users.keys()];
    if (!users.length) {
      users = Array.from(m[2].matchAll(/<@!?(\d+)>/g), a => a[1]);
    }
    users.forEach(u => results.push({ userId: u, guesses }));
  }

  return results.length ? { puzzle, results } : null;
}

// ----------------------------------------------------------------------------
// On ready: backfill history, logging summaries & updating Elo
// ----------------------------------------------------------------------------
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log('🔍 Backfilling all Wordle summaries in channel…');

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (channel.isTextBased() && channel.guild) {
        const guild = channel.guild;
        await guild.members.fetch();                      // load everyone into cache
        guild.members.cache.forEach(m => 
        userMap.set(m.user.id, `${m.user.username}#${m.user.discriminator}`)
        );
    }

    let lastId = null;
    let count = 0;

    while (true) {
      const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
      if (!fetched.size) break;
      const batch = [...fetched.values()].reverse();
      for (const msg of batch) {
        const entry = parseWordleMessage(msg);
        if (entry) {
          count++;
          console.log(`\n🔹 [Backfill #${count}] Wordle #${entry.puzzle}`);
          console.log('Summary:', msg.content.replace(/\n/g, ' | '));
          recordDailyResults(entry);
        }
      }
      lastId = batch[0].id;
      if (fetched.size < 100) break;
    }


    console.log(`\n✅ Backfill complete. Parsed ${count} summaries.`);
    console.log('\n📊 Current Leaderboard Stats:');
    console.log(JSON.stringify(getStats(), null, 2));
    console.log('\n🚀 Now live—listening for new Wordles & !stats');
  } catch (err) {
    console.error('❌ Error during backfill:', err);
  }
});

// ----------------------------------------------------------------------------
// Live listener: parse new summaries & respond to !stats
// ----------------------------------------------------------------------------
client.on(Events.MessageCreate, async msg => {
  const entry = parseWordleMessage(msg);
  if (entry) {
    // record and optionally log live
    recordDailyResults(entry);
    const scored = entry.results.map(r => {
      const pts = pointsMap[r.guesses];
      return `${r.userId}:${r.guesses===null?'X':r.guesses} (${pts}pt)`;
    }).join(' | ');
    console.log(`\n🔹 [Live] Wordle #${entry.puzzle}`);
    console.log('Scores and Points:', scored);
    return;
  }

 if (msg.channel.id === CHANNEL_ID && msg.content.trim() === '!stats') {
  const stats = getStats();

  const header    = '| User      | Elo  | Points | Avg Guesses |';
  const separator = '|-----------|-----:|-------:|:-----------:|';

    const rows = stats.map(s => {
    const name = userMap.get(s.user_id) || s.user_id;
    const avg  = s.avg_guesses !== null ? s.avg_guesses.toFixed(2) : 'N/A';
    return `| ${name.padEnd(18)} | ${Math.round(s.elo).toString().padStart(4)} | ${s.total_points.toString().padStart(5)} | ${avg.padStart(11)} |`;
  });

  const table = [header, separator, ...rows].join('\n');
  await msg.channel.send('**Wordle Leaderboard**\n' + table);
}
});
// ----------------------------------------------------------------------------
// Login
// ----------------------------------------------------------------------------
client.login(TOKEN).catch(err => console.error('❌ Login failed:', err));


  