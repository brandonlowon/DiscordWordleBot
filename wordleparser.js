import { usernameToId } from './usernameToIdMap.js';

function resolveUserId(nameOrMention) {
  const mentionMatch = nameOrMention.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];

  const cleaned = nameOrMention.trim().replace(/^@/, '');
  return usernameToId[cleaned] || null;
}

export function parseWordleMessage(message) {
  if (!message.embeds.length) return null;
  const e = message.embeds[0];

  // 1) Extract puzzle number
  const footer = e.footer?.text || '';
  const numMatch = footer.match(/Wordle\s*No\.?\s*(\d+)/i);
  if (!numMatch) return null;
  const puzzle = Number(numMatch[1]);

  // 2) Collect all lines
  let lines = [];
  if (e.description) {
    lines = e.description.split('\n');
  } else if (e.fields?.length) {
    lines = e.fields
      .filter(f => /^[1-6X]\/6:/.test(f.name) || /^[1-6X]\/6:/.test(f.value))
      .map(f => f.name.match(/^[1-6X]\/6:/) ? f.name : f.value);
  }

  // 3) Parse each line and extract users
  const results = [];
  for (const line of lines) {
    const m = line.match(/^([1-6X])\/6:\s*(.+)$/);
    if (!m) continue;

    const guesses = m[1] === 'X' ? null : Number(m[1]);
    const nameParts = m[2].split(/\s+/).filter(Boolean); // includes <@id> or @name or raw name

    for (const raw of nameParts) {
      const userId = resolveUserId(raw);
      if (userId) {
        results.push({ userId, guesses });
      } else {
        console.warn(`⚠️ Unrecognized user: "${raw}" in line "${line}"`);
      }
    }
  }

  return results.length ? { puzzle, results } : null;
}
