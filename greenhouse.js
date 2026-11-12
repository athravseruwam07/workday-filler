// Greenhouse application forms (job-boards.greenhouse.io, boards.greenhouse.io, and Greenhouse iframes
// embedded on company career sites). Uses the same markdown profile as the Workday filler.
// Never clicks Submit and never touches the resume / cover letter upload.
(function () {
  if (window.__wfGreenhouse) return;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const H = () => window.__wfHelpers;
  const { parseDate } = window.WorkdayFillerParser;
  // loose text for matching labels and questions: lowercase letters and digits only
  const loose = s => (s || '').toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  function detect() {
    if (!/greenhouse\.io$/.test(location.hostname)) return false;
    return !!document.querySelector('#first_name, input[name="first_name"], #application-form, #application_form, form[action*="applications"]');
  }

  // ---- labels and their controls ----
  function labelText(l) {
    const c = l.cloneNode(true);
    c.querySelectorAll('input,select,textarea,button').forEach(x => x.remove());
    return c.textContent;
  }
  function controlFor(l) {
    const id = l.getAttribute('for');
    let e = id ? document.getElementById(id) : null;
    if (!e) e = l.querySelector('input:not([type="hidden"]),select,textarea');
    if (!e && l.tagName === 'LEGEND') e = l.parentElement.querySelector('input:not([type="hidden"]),select,textarea');
    if (!e) {
      const box = l.closest('.field, .input-wrapper, .select, .text-input-wrapper, [class*="question"]') || l.parentElement;
      e = box && box.querySelector('input:not([type="hidden"]),select,textarea');
    }
    return e;
  }
  function allLabels(root = document) {
    return [...root.querySelectorAll('label, legend')].filter(l => H().isVisible(l) || l.tagName === 'LEGEND');
  }
  function findField(root, re, used) {
    for (const l of allLabels(root)) {
      if (!re.test(loose(labelText(l)))) continue;
      const c = controlFor(l);
      if (c && !(used && used.has(c))) return { label: l, el: c };
    }
    return null;
  }

  // ---- react-select dropdowns ----
  const isRS = el => el && el.tagName === 'INPUT' && (el.getAttribute('role') === 'combobox' || !!el.closest('.select__control, [class*="-control"]'));
  const rsControl = el => el.closest('.select__control, [class*="-control"]') || el.parentElement;
  const rsContainer = el => el.closest('.select__container, .select-shell') || rsControl(el).parentElement;
  function rsValue(el) {
    const c = rsContainer(el);
    const v = c && c.querySelectorAll('.select__single-value, .select__multi-value, [class*="singleValue"], [class*="multiValue"]');
    return v ? [...v].map(x => x.textContent).join(' | ') : '';
  }
  // multi-value react-select (e.g. a Skills question): one chip per item
  const rsChips = el => {
    const c = rsContainer(el);
    const a = c ? [...c.querySelectorAll('.select__multi-value, [class*="multiValue"], [class*="multi-value"]')] : [];
    return a.filter(x => !x.parentElement.closest('.select__multi-value, [class*="multiValue"], [class*="multi-value"]'));
  };
  const isMultiRS = el => { const c = rsContainer(el); return !!(c && c.querySelector('[class*="--is-multi"], .select__multi-value, [class*="multiValue"]')); };
  function rsOptions() {
    const a = [...document.querySelectorAll('.select__option, [role="option"], [id*="-option-"]')].filter(H().isVisible);
    return a.filter(o => !/^(loading|no options|no results)/i.test(o.textContent.trim()));
  }
  const rsLoading = () => [...document.querySelectorAll('.select__menu-notice--loading, [class*="loadingMessage"]')].some(H().isVisible);
  async function waitOpts(t = 3500) {
    return H().waitFor(() => { const o = rsOptions(); return o.length && !rsLoading() ? o : null; }, t, 120);
  }
  function pickAnswer(opts, text) {
    const t = loose(text), ot = o => loose(o.textContent);
    return opts.find(o => ot(o) === t) ||
      opts.find(o => ot(o).startsWith(t + ' ')) ||
      opts.find(o => ot(o).startsWith(t)) ||
      opts.find(o => (' ' + ot(o) + ' ').includes(' ' + t + ' ')) ||
      opts.find(o => ot(o).includes(t));
  }
  async function reactSelect(el, value) {
    const h = H();
    const done = () => { const v = rsValue(el); return !!v && (h.hasSkill(v, value) || loose(v).includes(loose(value)) || loose(value).includes(loose(v))); };
    if (done()) return true;
    const queries = [...new Set([value, value.split(',')[0].trim(), value.split(/\s+/)[0]])].filter(Boolean);
    // 1) script events: open the menu, look; if nothing matches, type to search
    el.focus();
    h.click(rsControl(el));
    let opts = await waitOpts(1200), pick = opts && pickAnswer(opts, value);
    for (const q of queries) {
      if (pick) break;
      await h.typeInto(el, q);
      opts = await waitOpts(4000);
      pick = opts && pickAnswer(opts, value);
    }
    if (pick) {
      h.click(pick);
      if (await h.waitFor(done, 1200)) return true;
      h.key(el, 'Enter', ['keydown']);
      if (await h.waitFor(done, 800)) return true;
    }
    h.key(el, 'Escape', ['keydown', 'keyup']);
    await h.sleep(150);
    // 2) real keystrokes through the debugger (keyboard only, so it also works inside iframes)
    if (!(await h.cdpStart())) return false;
    for (const q of queries) {
      el.focus();
      await h.tType(q);
      opts = await waitOpts(4500);
      pick = opts && pickAnswer(opts, value);
      if (!pick) continue;
      for (let i = 0; i < opts.indexOf(pick); i++) await h.tKey('ArrowDown');
      await h.tKey('Enter');
      if (await h.waitFor(done, 1500)) return true;
    }
    await h.tKey('Escape');
    return false;
  }

  // For a multi-select, pick exactly ONE option per item: the exact name, the same name with a plural
  // "s" dropped/added, or one starting with it; otherwise the first whole-word match. Never more.
  function pickOne(opts, text) {
    const t = loose(text), sing = x => x.replace(/s\b/g, ''), ot = o => loose(o.textContent);
    return opts.find(o => ot(o) === t) || opts.find(o => sing(ot(o)) === sing(t)) ||
      opts.find(o => ot(o).startsWith(t + ' ')) || opts.find(o => H().hasSkill(o.textContent, text)) || null;
  }
  async function reactMultiSelect(el, value, L) {
    const h = H();
    const items = [...new Set(value.split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean))];
    const got = [], missing = [];
    for (const item of items) {
      const has = () => rsChips(el).some(c => h.hasSkill(c.textContent, item) || loose(c.textContent) === loose(item));
      if (has()) { got.push(item); continue; }
      const before = new Set(rsChips(el));
      const grew = () => rsChips(el).some(c => !before.has(c));
      // 1) script typing + one click
      el.focus();
      await h.typeInto(el, item);
      let opts = await waitOpts(4000), pick = opts && pickOne(opts, item);
      if (pick) { h.click(pick); await h.waitFor(grew, 1500); }
      // 2) real keys, one Enter, only if nothing was added
      if (!grew() && await h.cdpStart()) {
        el.focus();
        await h.tType(item);
        opts = await waitOpts(4500); pick = opts && pickOne(opts, item);
        if (pick) {
          for (let i = 0; i < opts.indexOf(pick); i++) await h.tKey('ArrowDown');
          await h.tKey('Enter');
          await h.waitFor(grew, 1500);
        }
      }
      // close the menu and clear leftover search text without touching chips
      h.key(el, 'Escape', ['keydown', 'keyup']);
      if (el.value) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); }
      (grew() ? got : missing).push(item);
      await h.sleep(150);
    }
    if (L && missing.length) L('warn', `No matching option (add by hand): ${missing.join(', ')}`);
    return got.length > 0;
  }

  // ---- set any control from a text answer ----
  async function setControl(el, value, label, L) {
    const h = H();
    if (isRS(el)) return isMultiRS(el) ? reactMultiSelect(el, value, L) : reactSelect(el, value);
    if (el.tagName === 'SELECT') return h.chooseOption(el, value);
    if (el.type === 'checkbox' || el.type === 'radio') {
      // a group: tick the boxes whose own label matches the answer(s)
      const group = (label && label.tagName === 'LEGEND' ? label.parentElement : null) || el.closest('fieldset, [role="group"], [role="radiogroup"]') || el.parentElement.parentElement;
      const wants = value.split(/\s*;\s*/).map(loose);
      let any = false;
      for (const box of group.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
        const t = loose((box.labels && box.labels[0] && box.labels[0].textContent) || box.parentElement.textContent);
        const yes = /^(yes|true|y)$/i.test(value) && group.querySelectorAll('input').length === 1;
        if (yes || wants.some(w => t === w || t.startsWith(w))) { if (!box.checked) h.click(box); any = true; }
      }
      return any;
    }
    h.setValue(el, value);
    return true;
  }

  // ---- repeating blocks (Employment / Education) ----
  function sectionRoot(headRe, fieldRe) {
    for (const hd of document.querySelectorAll('h1,h2,h3,h4,h5,legend,[role="heading"], .section-header, div[class*="heading"]')) {
      if (!headRe.test(loose(hd.textContent))) continue;
      let p = hd.parentElement;
      for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
        if (allLabels(p).some(l => fieldRe.test(loose(labelText(l))))) return p;
      }
    }
    return null;
  }
  function entries(root, fieldRe) {
    return allLabels(root).filter(l => fieldRe.test(loose(labelText(l)))).map(l => {
      let p = l.parentElement;
      while (p.parentElement && p.parentElement !== root &&
             allLabels(p.parentElement).filter(x => fieldRe.test(loose(labelText(x)))).length === 1) p = p.parentElement;
      return p;
    });
  }
  async function ensureEntries(root, fieldRe, n) {
    let guard = n + 2;
    while (entries(root, fieldRe).length < n && guard-- > 0) {
      const add = [...root.querySelectorAll('button, a')].filter(H().isVisible).find(b => /^add another|^\+?\s*add/i.test(b.textContent.trim()));
      if (!add) break;
      const before = entries(root, fieldRe).length;
      H().click(add);
      await H().waitFor(() => entries(root, fieldRe).length > before, 3000);
      await H().sleep(200);
    }
    return entries(root, fieldRe);
  }

  async function fill(profile, L) {
    const used = new Set();
    const put = async (root, re, value, what) => {
      if (value == null || value === '') return;
      const f = findField(root, re, used);
      if (!f) return L('warn', `${what}: field not found`);
      used.add(f.el);
      const ok = await setControl(f.el, String(value), f.label);
      L(ok ? 'ok' : 'warn', `${what}: ${String(value).length > 40 ? String(value).slice(0, 40) + '...' : value}`);
    };
    const opt = async (root, re, value) => { const f = findField(root, re, used); if (f && value) { used.add(f.el); return setControl(f.el, String(value), f.label); } return null; };

    // Personal info
    const P = profile.personal || {};
    const g = k => P[k];
    let first = g('first name'), last = g('last name');
    if (!first && g('name')) { const parts = g('name').split(/\s+/); first = parts[0]; last = parts.slice(1).join(' '); }
    await put(document, /^first name/, first, 'First name');
    await put(document, /^last name/, last, 'Last name');
    if (g('preferred name')) await opt(document, /^preferred (first )?name/, g('preferred name'));
    await put(document, /^email/, g('email'), 'Email');
    await put(document, /^country\b/, g('country'), 'Country');
    await put(document, /^phone/, g('phone'), 'Phone');
    const loc = g('location') || g('city');
    if (loc) await put(document, /^location|^city|current location/, loc, 'Location');

    // Employment
    const work = profile.work || [];
    if (work.length) {
      const RE = /^company( name)?$|^company name|^employer/;
      const root = sectionRoot(/^employment|^work experience|^experience$/, RE);
      if (!root) L('info', 'No Employment section on this form');
      else {
        const ents = await ensureEntries(root, RE, work.length);
        for (let i = 0; i < work.length; i++) {
          const e = work[i], c = ents[i], tag = `Employment ${i + 1} (${e.company || e.title})`;
          if (!c) { L('warn', `${tag}: no block on the page ("Add another" not found)`); continue; }
          await put(c, RE, e.company, `${tag} company`);
          await put(c, /^title|^job title/, e.title, `${tag} title`);
          const cur = e.current ? /^(y|yes|true|current|present)/i.test(e.current) : !e.to;
          const s = parseDate(e.from), en = parseDate(e.to);
          if (s) {
            if (s.m) await put(c, /^start date month|^start month/, MONTHS[s.m - 1], `${tag} start month`);
            await put(c, /^start date year|^start year/, String(s.y), `${tag} start year`);
          }
          const cb = findField(c, /^current( role)?|currently work/, used);
          if (cb && cb.el.type === 'checkbox' && cb.el.checked !== cur) { H().click(cb.el); await H().sleep(250); }
          if (!cur && en) {
            if (en.m) await put(c, /^end date month|^end month/, MONTHS[en.m - 1], `${tag} end month`);
            await put(c, /^end date year|^end year/, String(en.y), `${tag} end year`);
          }
          if (cb) L('ok', `${tag} current role: ${cur ? 'yes' : 'no'}`);
        }
      }
    }

    // Education
    const edu = profile.education || [];
    if (edu.length) {
      const RE = /^school/;
      const root = sectionRoot(/^education/, RE);
      if (!root) L('info', 'No Education section on this form');
      else {
        const ents = await ensureEntries(root, RE, edu.length);
        for (let i = 0; i < edu.length; i++) {
          const e = edu[i], c = ents[i], tag = `Education ${i + 1}`;
          if (!c) { L('warn', `${tag}: no block on the page`); continue; }
          await put(c, RE, e.school, `${tag} school`);
          await put(c, /^degree/, e.degree, `${tag} degree`);
          // Discipline lists are short ("Engineering", "Computer Science"...). Try the exact field, then broader.
          const disc = findField(c, /^discipline|^field of study|^major/, used);
          if (disc) {
            used.add(disc.el);
            const tries = [...new Set([e.discipline, e.field, e.field && e.field.split(/\s+/).slice(-1)[0]].filter(Boolean))];
            let got = null;
            for (const t of tries) if (await setControl(disc.el, t, disc.label)) { got = t; break; }
            L(got ? 'ok' : 'warn', `${tag} discipline: ${got || tries[0]}${got && got !== tries[0] ? ` (no "${tries[0]}" option, used the closest)` : ''}`);
          }
          const s = parseDate(e.from), en = parseDate(e.to);
          if (s) { if (s.m) await opt(c, /^start date month/, MONTHS[s.m - 1]); if (await opt(c, /^start date year|^start year/, String(s.y))) L('ok', `${tag} start: ${e.from}`); }
          if (en) { if (en.m) await opt(c, /^end date month/, MONTHS[en.m - 1]); if (await opt(c, /^end date year|^end year|graduation/, String(en.y))) L('ok', `${tag} end: ${e.to}`); }
          if (e.gpa) await opt(c, /^gpa|grade/, e.gpa);
        }
      }
    }

    // Websites by label
    const site = re => (profile.websites || []).find(w => re.test(w.label + ' ' + w.url));
    const li = site(/linkedin/i), gh = site(/github/i), pf = site(/portfolio|personal|website/i) || (profile.websites || []).find(w => w !== li && w !== gh);
    if (li) await put(document, /linkedin/, li.url, 'LinkedIn');
    if (gh && findField(document, /github/, used)) await put(document, /github/, gh.url, 'GitHub');
    if (pf && findField(document, /portfolio|personal (web)?site|website/, used)) await put(document, /portfolio|personal (web)?site|website/, pf.url, 'Portfolio');

    // Application answers: "question text: answer", matched against each label
    for (const { q, a } of profile.answers || []) {
      const lq = loose(q);
      const f = allLabels().map(l => ({ label: l, el: controlFor(l) }))
        .find(x => x.el && !used.has(x.el) && loose(labelText(x.label)).includes(lq));
      const tag = q.length > 50 ? q.slice(0, 50) + '...' : q;
      if (!f) { L('warn', `Question not on this form: "${tag}"`); continue; }
      used.add(f.el);
      L(await setControl(f.el, a, f.label, L) ? 'ok' : 'warn', `${tag} -> ${a}`);
    }

    // Skills list from "## Skills", if the form has a skills question that no answer already filled
    const skills = (profile.skills || []).filter(Boolean);
    if (skills.length) {
      const f = findField(document, /^skills?\b|technical skills|programming languages/, used);
      if (f) {
        used.add(f.el);
        L(await setControl(f.el, skills.join(', '), f.label, L) ? 'ok' : 'warn', `Skills: ${skills.length} from your profile`);
      }
    }

    // What is still empty and required
    const empty = [];
    for (const l of allLabels()) {
      const t = labelText(l);
      if (!/\*/.test(t)) continue;
      const el = controlFor(l);
      if (!el || el.type === 'file' || /resume|cv\b|cover letter/i.test(t)) continue;
      const filled = isRS(el) ? !!rsValue(el) : (el.type === 'checkbox' || el.type === 'radio')
        ? [...(el.closest('fieldset') || el.parentElement.parentElement).querySelectorAll('input')].some(x => x.checked)
        : !!el.value;
      if (!filled) empty.push(t.replace(/\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 70));
    }
    if (empty.length) L('warn', `Still empty (answer by hand or add to "## Application Answers"):\n  - ${[...new Set(empty)].join('\n  - ')}`);
    L('info', 'Resume and cover letter: attach them yourself.');
  }

  window.__wfGreenhouse = { detect, fill };
})();
