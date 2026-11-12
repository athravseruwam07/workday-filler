// Markdown profile parser, shared by the content script and the popup.
// Format (see README.md): "## Work Experience", "## Education", "## Skills", "## Websites",
// "### <title or school>" per entry, "- Key: value" lines, Description runs until the next key.
(function (g) {
  const KEYS = ['company', 'location', 'current', 'from', 'to', 'description',
                'school', 'degree', 'field', 'discipline', 'gpa'];
  const keyRe = new RegExp('^\\s*[-*]\\s*(' + KEYS.join('|') + ')\\s*:\\s*(.*)$', 'i');
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function parseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    if (!s || /^(present|current|now)$/i.test(s)) return null;
    let m;
    if ((m = s.match(/^(\d{1,2})\s*[\/-]\s*(\d{4})$/))) return { m: +m[1], y: +m[2] };
    if ((m = s.match(/^(\d{4})\s*[\/-]\s*(\d{1,2})$/))) return { m: +m[2], y: +m[1] };
    if ((m = s.match(/^([A-Za-z]{3})[a-z.]*\s+(\d{4})$/))) {
      const i = MONTHS.indexOf(m[1].toLowerCase());
      if (i >= 0) return { m: i + 1, y: +m[2] };
    }
    if ((m = s.match(/^(\d{4})$/))) return { m: null, y: +m[1] };
    return null;
  }

  function parseProfile(md) {
    const out = { title: '', work: [], education: [], skills: [], websites: [], personal: {}, answers: [] };
    let section = null, entry = null, desc = false;
    for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (/^###\s+/.test(line)) {
        entry = { name: line.replace(/^###\s+/, '').trim() };
        if (section === 'work') { entry.title = entry.name; out.work.push(entry); }
        else if (section === 'education') { entry.school = entry.name; out.education.push(entry); }
        desc = false;
        continue;
      }
      if (/^##\s+/.test(line)) {
        const s = line.replace(/^##\s+/, '').trim().toLowerCase();
        section = /work|experience/.test(s) ? 'work'
          : /educ/.test(s) ? 'education'
          : /skill/.test(s) ? 'skills'
          : /web|link/.test(s) ? 'websites'
          : /personal|contact/.test(s) ? 'personal'
          : /answer|question/.test(s) ? 'answers' : null;
        entry = null; desc = false;
        continue;
      }
      if (/^#\s+/.test(line)) { out.title = line.replace(/^#\s+/, '').trim(); continue; }

      if (section === 'work' || section === 'education') {
        if (!entry) continue;
        if ((m = line.match(keyRe))) {
          const key = m[1].toLowerCase(), val = m[2].trim();
          if (key === 'description') { entry.description = val; desc = true; }
          else { entry[key] = val; desc = false; }
        } else if (desc && line.trim()) {
          entry.description = (entry.description ? entry.description + '\n' : '') + line.trim();
        }
      } else if (section === 'skills') {
        const t = line.replace(/^\s*[-*]\s*/, '').trim();
        if ((m = t.match(/^remove[ -]suggested\s*:\s*(.*)$/i))) out.clearSuggested = /^(y|yes|true)/i.test(m[1].trim());
        else if (t) out.skills.push(...t.split(',').map(x => x.trim()).filter(Boolean));
      } else if (section === 'personal' || section === 'answers') {
        // "- Question or field name: answer" (split at the LAST ": " so questions may contain colons)
        const t = line.replace(/^\s*[-*]\s*/, '');
        const i = t.lastIndexOf(': ');
        if (!/^\s*[-*]\s/.test(line) || i < 0) continue;
        const k = t.slice(0, i).trim(), v = t.slice(i + 2).trim();
        if (!k || !v) continue;
        if (section === 'personal') out.personal[k.toLowerCase()] = v;
        else out.answers.push({ q: k, a: v });
      } else if (section === 'websites') {
        if ((m = line.match(/^\s*[-*]\s*([^:]+?)\s*:\s*(https?:\S+)/i))) out.websites.push({ label: m[1], url: m[2] });
      }
    }
    return out;
  }

  g.WorkdayFillerParser = { parseProfile, parseDate };
})(typeof window !== 'undefined' ? window : globalThis);
