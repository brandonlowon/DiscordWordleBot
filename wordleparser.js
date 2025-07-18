// wordleParser.js
export function parseWordleMessage(message) {
  if (!message.embeds.length) return null;
  const e = message.embeds[0];

  // 1) Puzzle number from footer.text
  const footer = e.footer?.text || '';
  const numMatch = footer.match(/Wordle\s*No\.?\s*(\d+)/i);
  if (!numMatch) return null;
  const puzzle = Number(numMatch[1]);

  // 2) Collate all the “result” lines
  //    either in embed.description or in embed.fields
  let lines = [];
  if (e.description) {
    lines = e.description.split('\n');
  } else if (e.fields?.length) {
    // skip the first field if it's a “streak” or header
    lines = e.fields
      .filter(f => /^[1-6X]\/6:/.test(f.name) || /^[1-6X]\/6:/.test(f.value))
      .map(f => f.name.startsWith('1/') || f.name.startsWith('2/') 
                   ? f.name 
                   : f.value);
  }

  const results = [];
  for (const line of lines) {
    const m = line.match(/^([1-6X])\/6:\s*(.+)$/);
    if (!m) continue;
    const guesses = m[1] === 'X' ? null : Number(m[1]);
    // grab the mention IDs
    const users = message.mentions.users.size
      ? [...message.mentions.users.keys()]
      : m[2].split(/\s+/);

    for (const userId of users) {
      results.push({ userId, guesses });
    }
  }

  return results.length ? { puzzle, results } : null;
}
