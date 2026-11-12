// Workday Filler content script. Fills the "My Experience" page from a parsed markdown profile.
// It never clicks Save/Continue and never touches the resume upload.
(function () {
  if (window.__workdayFillerLoaded) return;
  window.__workdayFillerLoaded = true;

  const { parseProfile, parseDate } = window.WorkdayFillerParser;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim().toLowerCase();
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // true if `skill` appears in `text` as a whole word ("C" must not match "Artificial Intelligence")
  const hasSkill = (text, skill) =>
    new RegExp('(^|[^a-z0-9+#])' + esc(norm(skill)) + '([^a-z0-9+#]|$)').test(norm(text).replace(/\(suggested\)/g, ' '));
  const isVisible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  async function waitFor(fn, timeout = 4000, step = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  // ---- low-level input helpers (React-safe) ----
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }
  // Types like a person (per-key events, no blur) so typeahead dropdowns open and stay open.
  async function typeInto(el, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    el.select && el.select();
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of text) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      setter.call(el, el.value + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await sleep(25);
    }
  }
  function click(el) {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }
  const KEYS = { Enter: 13, Escape: 27, ArrowDown: 40, Backspace: 8 };
  function key(el, name, types = ['keydown', 'keypress', 'keyup']) {
    for (const t of types) {
      if (t === 'keypress' && name !== 'Enter') continue;
      const ev = new KeyboardEvent(t, { key: name, code: name, bubbles: true, cancelable: true });
      // Chrome ignores keyCode/which in the constructor; Workday reads them, so force them.
      for (const k of ['keyCode', 'which']) Object.defineProperty(ev, k, { get: () => KEYS[name] });
      el.dispatchEvent(ev);
    }
  }
  const pressEnter = el => key(el, 'Enter');

  // ---- trusted input through the Chrome debugger (fallback for dropdowns that ignore script events) ----
  const IS_MAC = /Mac/.test(navigator.platform);
  let cdpOn = false;
  function cdp(cmds) {
    return new Promise(res => {
      try { chrome.runtime.sendMessage({ type: 'cdp', cmds }, r => { void chrome.runtime.lastError; res(r || { ok: false }); }); }
      catch (e) { res({ ok: false, error: String(e) }); }
    });
  }
  async function cdpStart() {
    if (cdpOn) return true;
    const r = await cdp([]);
    if (!r.ok) return false;
    cdpOn = true;
    await sleep(700);   // Chrome shows a "started debugging" bar that shifts the page; let it settle
    return true;
  }
  function cdpStop() {
    if (!cdpOn) return;
    cdpOn = false;
    try { chrome.runtime.sendMessage({ type: 'cdp-detach' }, () => void chrome.runtime.lastError); } catch (e) {}
  }
  async function tClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    await sleep(150);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 40), y = r.top + r.height / 2;
    const base = { x, y, button: 'left', clickCount: 1 };
    return (await cdp([
      ['Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }],
      ['Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }],
      ['Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }]
    ])).ok;
  }
  const tKey = (name, extra = {}) => {
    const vk = KEYS[name];
    const down = { type: 'rawKeyDown', key: name, code: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...extra };
    if (name === 'Enter') { down.type = 'keyDown'; down.text = '\r'; down.unmodifiedText = '\r'; }
    return cdp([['Input.dispatchKeyEvent', down], ['Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }]]);
  };
  async function tType(text) {
    const a = document.activeElement;
    if (a && 'value' in a && a.value) await cdp([['Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: IS_MAC ? 4 : 2, commands: ['selectAll'] }],
               ['Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: IS_MAC ? 4 : 2 }]]);
    if (a && 'value' in a && a.value) await tKey('Backspace');
    for (const ch of text) {
      await cdp([['Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch }],
                 ['Input.dispatchKeyEvent', { type: 'keyUp', key: ch }]]);
      await sleep(20);
    }
  }

  // ---- field lookup: data-automation-id first, then label text ----
  const SEL = {
    jobTitle: ['input[data-automation-id="jobTitle"]', '[data-automation-id="formField-jobTitle"] input', 'input[id$="jobTitle"]', 'input[name="jobTitle"]'],
    company: ['input[data-automation-id="company"]', '[data-automation-id="formField-companyName"] input', 'input[id$="companyName"]', 'input[name="companyName"]'],
    location: ['input[data-automation-id="location"]', '[data-automation-id="formField-location"] input', 'input[id$="location"]'],
    current: ['input[data-automation-id="currentlyWorkHere"]', '[data-automation-id="formField-currentlyWorkHere"] input[type="checkbox"]', 'input[type="checkbox"]'],
    description: ['textarea[data-automation-id="description"]', '[data-automation-id="formField-roleDescription"] textarea', 'textarea'],
    school: ['input[data-automation-id="schoolName"]', '[data-automation-id="formField-schoolName"] input', 'input[id$="schoolName"]'],
    degree: ['[data-automation-id="degree"]', '[data-automation-id="formField-degree"] button', '[data-automation-id="formField-degree"] select'],
    field: ['[data-automation-id="formField-fieldOfStudy"]', '[data-automation-id="fieldOfStudy"]'],
    gpa: ['input[data-automation-id="gpa"]', '[data-automation-id="formField-gradeAverage"] input', 'input[id$="gradeAverage"]'],
    url: ['input[data-automation-id="url"]', '[data-automation-id="formField-url"] input', 'input[type="url"]']
  };
  const LABEL = {
    jobTitle: /job title|position title/, company: /company|employer/, location: /^location/,
    current: /currently work here/, description: /role description|description|responsibilities/,
    school: /school|university/, degree: /^degree/, field: /field of study/, gpa: /overall result|gpa|grade/, url: /^url|website/
  };
  function byLabel(container, re) {
    for (const l of container.querySelectorAll('label')) {
      if (!re.test(norm(l.textContent))) continue;
      const id = l.getAttribute('for');
      let e = id ? document.getElementById(id) : null;
      if (!e) {
        const ff = l.closest('[data-automation-id^="formField"]') || l.parentElement;
        e = ff && ff.querySelector('input,textarea,button,select');
      }
      if (e) return e;
    }
    return null;
  }
  function find(container, key) {
    for (const s of SEL[key] || []) {
      const e = container.querySelector(s);
      if (e) return e;
    }
    return LABEL[key] ? byLabel(container, LABEL[key]) : null;
  }
  function labelRoot(container, re) {
    for (const l of container.querySelectorAll('label, legend')) {
      if (re.test(norm(l.textContent))) return l.closest('[data-automation-id^="formField"]') || l.parentElement;
    }
    return null;
  }

  // ---- dates ----
  function setDate(root, d) {
    if (!root || !d) return false;
    const mo = root.querySelector('[data-automation-id="dateSectionMonth-input"]');
    const yr = root.querySelector('[data-automation-id="dateSectionYear-input"]');
    const inputs = [...root.querySelectorAll('input')];
    const mm = d.m ? String(d.m).padStart(2, '0') : '';
    if (mo && yr) { if (mm) setValue(mo, mm); setValue(yr, String(d.y)); return true; }
    if (yr) { setValue(yr, String(d.y)); return true; }
    if (inputs.length === 2 && mm) { setValue(inputs[0], mm); setValue(inputs[1], String(d.y)); return true; }
    if (inputs.length === 1) { setValue(inputs[0], mm ? mm + '/' + d.y : String(d.y)); return true; }
    return false;
  }
  function dateRoot(c, id, labelRe) {
    return c.querySelector(`[data-automation-id="formField-${id}"]`) ||
           c.querySelector(`[data-automation-id="${id}"]`) || labelRoot(c, labelRe);
  }

  // ---- dropdowns / typeahead multiselects ----
  const OPT = '[data-automation-id="promptOption"], [role="option"], [data-automation-id="menuItem"], [data-automation-id="activeListContainer"] li, [data-automation-id="activeListContainer"] [role="button"]';
  const visibleOptions = () => {
    const p = [...document.querySelectorAll('[data-automation-id="promptOption"]')].filter(isVisible);
    if (p.length) return p;
    const a = [...document.querySelectorAll(OPT)].filter(isVisible)
      .filter(o => !o.closest('[data-automation-id="selectedItemList"], [data-automation-id="selectedItem"]'));
    return a.length ? a : null;
  };
  function pickMatch(opts, text) {
    const t = norm(text);
    const txt = o => norm(o.getAttribute('data-automation-label') || o.getAttribute('aria-label') || o.textContent).replace(/\(suggested\)/g, '').trim();
    return opts.find(o => txt(o) === t) ||
           opts.find(o => txt(o).startsWith(t + ' ') || txt(o).startsWith(t + '(')) ||
           opts.find(o => hasSkill(txt(o), t)) ||
           opts.find(o => txt(o).includes(t));
  }
  async function chooseOption(el, text) {
    if (el.tagName === 'SELECT') {
      const o = [...el.options].find(o => norm(o.text).includes(norm(text)));
      if (!o) return false;
      el.value = o.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const trig = el.matches('button,input') ? el : (el.querySelector('button,select,input') || el);
    if (trig.tagName === 'SELECT') return chooseOption(trig, text);
    const done = () => hasSkill(trig.textContent + ' ' + (trig.value || ''), text) ||
                       hasSkill(norm(trig.textContent + ' ' + (trig.value || '')), norm(text).split(' ')[0]);
    if (done()) return true;
    // 1) script clicks
    click(trig);
    let opts = await waitFor(visibleOptions, 2500);
    let pick = opts && pickMatch(opts, text);
    if (pick) { click(pick); await waitFor(done, 1200); if (done()) return true; }
    key(document.activeElement || document.body, 'Escape');
    await sleep(200);
    // 2) real clicks through the debugger
    if (!(await cdpStart())) return false;
    await tClick(trig);
    opts = await waitFor(visibleOptions, 3000);
    pick = opts && pickMatch(opts, text);
    if (!pick) { await tKey('Escape'); return false; }
    pick.scrollIntoView({ block: 'nearest' });
    await tClick(pick);
    await waitFor(done, 1500);
    return done();
  }
  let debugNote = null;
  function describeOptions() {
    const ids = new Set();
    document.querySelectorAll('[data-automation-id]').forEach(e => {
      const id = e.getAttribute('data-automation-id');
      if (isVisible(e) && /prompt|option|list|menu|popup|search|result|multiselect/i.test(id)) ids.add(id);
    });
    return [...ids].slice(0, 12).join(', ') || 'none';
  }
  // Type-ahead multiselect (Skills, Field of Study): type, Enter, wait for the list, click the match,
  // then confirm a chip appeared. Tries script events first, then real input via the debugger.
  async function multiAdd(root, text, inputEl, isDone) {
    const input = inputEl || (root.matches('input') ? root : root.querySelector('input[data-automation-id="searchBox"], input[type="text"], input:not([type])'));
    if (!input) return false;
    // Done as soon as ONE new chip appears. Matching the chip text alone ("REST APIs" vs a chip called
    // "REST API Design") made it retry and add option after option, flooding the box.
    const before = new Set(chipsIn(root));
    const added = () => chipsIn(root).some(c => !before.has(c));
    const done = isDone ? (() => isDone() || added()) : (() => added() || chipsIn(root).some(c => hasSkill(c.textContent, text)));
    const clear = () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); };
    const ready = () => done() ? 'done' : visibleOptions();

    // 1) script events
    await typeInto(input, text);
    pressEnter(input);
    let r = await waitFor(ready, 4000, 150);
    if (!r) { key(input, 'ArrowDown', ['keydown', 'keyup']); r = await waitFor(ready, 1500, 150); }
    if (r === 'done') return true;
    let pick = r && pickMatch(r, text);
    if (pick) {
      click(pick);
      if (await waitFor(done, 1200)) return true;
      const cb = (pick.closest('[data-automation-id="promptLeafNode"]') || pick.parentElement).querySelector('[data-automation-id="checkboxPanel"], input[type="checkbox"]');
      if (cb && !cb.checked && !done()) { click(cb); if (await waitFor(done, 1000)) return true; }
      if (done()) return true;
    }
    const firstTry = r ? `${r.length} options (${r.slice(0, 4).map(o => norm(o.textContent).slice(0, 30)).join(' | ')})` : 'no dropdown';
    key(input, 'Escape', ['keydown', 'keyup']);
    clear();
    await sleep(200);

    // 2) real typing and clicking through the debugger (only if nothing was added above)
    if (done()) return true;
    if (await cdpStart()) {
      await tClick(input);
      await tType(text);
      await tKey('Enter');
      r = await waitFor(ready, 5000, 150);
      if (r === 'done') return true;
      pick = r && pickMatch(r, text);
      if (pick) {
        pick.scrollIntoView({ block: 'nearest' });
        await tClick(pick);
        if (await waitFor(done, 1500)) { await sleep(150); return true; }
      }
      await tKey('Escape');
      clear();
      if (!debugNote) debugNote = `debug: "${text}": script try saw ${firstTry}; real-input try saw ${r ? r.length + ' options (' + r.slice(0, 4).map(o => norm(o.textContent).slice(0, 30)).join(' | ') + ')' : 'no dropdown'}; visible ids: ${describeOptions()}`;
    } else if (!debugNote) {
      debugNote = `debug: "${text}": saw ${firstTry}; debugger fallback unavailable; visible ids: ${describeOptions()}; input: ${input.outerHTML.slice(0, 160)}`;
    }
    return false;
  }
  // Selected items ("chips") inside a multiselect, excluding any open option list.
  function chipsIn(root) {
    let a = [...root.querySelectorAll('[data-automation-id="selectedItem"]')];
    if (!a.length) a = [...root.querySelectorAll('[data-automation-id="menuItem"], li')].filter(c => !c.querySelector('li'));
    return a.filter(isVisible).filter(c => !c.closest('[role="listbox"], [data-automation-id="activeListContainer"]') && !c.matches('[data-automation-id="promptOption"]'));
  }

  // ---- repeating sections (Work Experience 1, 2, ...) ----
  function sections(idRe, headingRe) {
    const byId = [...document.querySelectorAll('[data-automation-id]')]
      .filter(e => idRe.test(e.getAttribute('data-automation-id')))
      .sort((a, b) => parseInt(a.getAttribute('data-automation-id').match(/\d+$/)[0]) -
                      parseInt(b.getAttribute('data-automation-id').match(/\d+$/)[0]));
    if (byId.length) return byId;
    const out = [];
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"]')) {
      if (!headingRe.test(norm(h.textContent))) continue;
      let p = h.parentElement;
      while (p && p !== document.body && p.querySelectorAll('input,textarea,select,button').length < 3) p = p.parentElement;
      if (p && p !== document.body) out.push(p);
    }
    return out;
  }
  const ADD_RE = /^add( another)?$/i;
  function findAdd(groupId, headingRe) {
    const group = document.querySelector(`[data-automation-id="${groupId}"]`);
    const isAdd = b => b.getAttribute('data-automation-id') === 'add-button' || ADD_RE.test(norm(b.textContent));
    const inGroup = (c, after) => c && [...c.querySelectorAll('button')].filter(isVisible)
      .filter(isAdd)
      .find(b => !after || (after.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    let b = inGroup(group);
    if (b) return b;
    // Fallback: the first "Add"/"Add Another" button that comes after the group's heading.
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
      if (!headingRe.test(norm(h.textContent))) continue;
      let p = h.parentElement;
      for (let i = 0; i < 6 && p; i++, p = p.parentElement) { b = inGroup(p, h); if (b) return b; }
    }
    return null;
  }
  async function ensureCount(getSections, groupId, headingRe, n) {
    let guard = n + 2;
    while (getSections().length < n && guard-- > 0) {
      const btn = findAdd(groupId, headingRe);
      if (!btn) break;
      const before = getSections().length;
      click(btn);
      await waitFor(() => getSections().length > before, 4000);
      await sleep(250);
    }
    return getSections();
  }

  // ---- the fill ----
  async function fillAll(profile, onLog) {
    try { return await fillAllInner(profile, onLog); } finally { cdpStop(); }
  }
  async function fillAllInner(profile, onLog) {
    const log = [];
    debugNote = null;
    const L = (level, msg) => { log.push({ level, msg }); if (onLog) onLog(level, msg); };
    const gh = window.__wfGreenhouse;
    if (gh && gh.detect()) {
      L('info', 'Greenhouse application form detected');
      await gh.fill(profile, L);
      const w = log.filter(x => x.level === 'warn').length;
      L('info', `Done: ${log.filter(x => x.level === 'ok').length} filled, ${w} need a look. Attach your resume, review everything, then submit yourself.`);
      return log;
    }
    const put = (c, key, val, what) => {
      if (val == null || val === '') return;
      const el = find(c, key);
      if (!el) return L('warn', `${what}: field not found`);
      setValue(el, val);
      L('ok', `${what}: ${val.length > 40 ? val.slice(0, 40) + '...' : val}`);
    };

    // Work experience
    const workSecs = () => sections(/^workExperience-\d+$/, /^work experience \d+$/);
    if (profile.work.length) {
      const secs = await ensureCount(workSecs, 'workExperienceSection', /^work experience$/, profile.work.length);
      for (let i = 0; i < profile.work.length; i++) {
        const e = profile.work[i], c = secs[i], tag = `Work ${i + 1} (${e.company || e.title})`;
        if (!c) { L('warn', `${tag}: no section on the page (Add button not found)`); continue; }
        put(c, 'jobTitle', e.title, `${tag} title`);
        put(c, 'company', e.company, `${tag} company`);
        put(c, 'location', e.location, `${tag} location`);
        const cur = e.current ? /^(y|yes|true|current|present)/i.test(e.current) : !e.to;
        const cb = find(c, 'current');
        if (cb && cb.type === 'checkbox') {
          if (cb.checked !== cur) click(cb);
          await sleep(250);
        }
        if (e.from) L(setDate(dateRoot(c, 'startDate', /^from\b/), parseDate(e.from)) ? 'ok' : 'warn', `${tag} start date: ${e.from}`);
        if (!cur && e.to) L(setDate(dateRoot(c, 'endDate', /^to\b/), parseDate(e.to)) ? 'ok' : 'warn', `${tag} end date: ${e.to}`);
        put(c, 'description', e.description, `${tag} description`);
        await sleep(150);
      }
    }

    // Education
    const eduSecs = () => sections(/^education-\d+$/, /^education \d+$/);
    if (profile.education.length) {
      const secs = await ensureCount(eduSecs, 'educationSection', /^education$/, profile.education.length);
      for (let i = 0; i < profile.education.length; i++) {
        const e = profile.education[i], c = secs[i], tag = `Education ${i + 1}`;
        if (!c) { L('warn', `${tag}: no section on the page (Add button not found)`); continue; }
        put(c, 'school', e.school, `${tag} school`);
        if (e.degree) {
          const el = find(c, 'degree');
          L(el && await chooseOption(el, e.degree) ? 'ok' : 'warn', `${tag} degree: ${e.degree}`);
        }
        if (e.field) {
          const root = find(c, 'field');
          L(root && await multiAdd(root, e.field) ? 'ok' : 'warn', `${tag} field of study: ${e.field}`);
        }
        put(c, 'gpa', e.gpa, `${tag} GPA`);
        if (e.from) L(setDate(dateRoot(c, 'firstYearAttended', /^from\b/), parseDate(e.from)) ? 'ok' : 'warn', `${tag} from: ${e.from}`);
        if (e.to) L(setDate(dateRoot(c, 'lastYearAttended', /^to\b/), parseDate(e.to)) ? 'ok' : 'warn', `${tag} to: ${e.to}`);
      }
    }

    // Skills (typeahead multiselect)
    if (profile.skills.length) {
      const skillInput = (() => {
        const sec = document.querySelector('[data-automation-id="skillsSection"], [data-automation-id="formField-skills"]');
        const inSec = sec && sec.querySelector('input[data-automation-id="searchBox"], input[type="text"], input:not([type])');
        if (inSec) return inSec;
        for (const i of document.querySelectorAll('input')) {
          if (!['text', 'search', ''].includes(i.type)) continue;
          if (/add skills/.test(norm((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')))) return i;
          let p = i.parentElement;
          for (let k = 0; k < 4 && p; k++, p = p.parentElement) {
            if (p.textContent.length < 600 && /type to add skills/i.test(p.textContent)) return i;
          }
        }
        return null;
      })();
      const root = skillInput && (skillInput.closest('[data-automation-id="skillsSection"], [data-automation-id="formField-skills"]') ||
        skillInput.parentElement.parentElement.parentElement);
      if (!root) L('warn', 'Skills: the "Type to Add Skills" box was not found');
      else {
        const chips = () => chipsIn(root);
        // Optionally drop Workday's auto-suggested skills that are not in the profile.
        if (profile.clearSuggested) {
          let removed = 0;
          for (const c of chips()) {
            const t = norm(c.textContent);
            if (!t.includes('(suggested)')) continue;
            if (profile.skills.some(s => hasSkill(t, s))) continue;
            const x = c.querySelector('[data-automation-id="DELETE_charm"], button, [role="button"], svg');
            if (x) { click(x.closest('button,[role="button"]') || x); removed++; await sleep(150); }
          }
          L(removed ? 'ok' : 'info', `Skills: removed ${removed} suggested skills not in your profile`);
        }
        let added = 0, already = 0, skipped = [];
        for (const s of profile.skills) {
          if (chips().some(c => hasSkill(c.textContent, s))) { already++; continue; }
          (await multiAdd(root, s, skillInput)) ? added++ : skipped.push(s);
          await sleep(200);
        }
        L(added || already ? 'ok' : 'warn', `Skills: ${added} added, ${already} already present, of ${profile.skills.length}`);
        if (skipped.length) L('warn', `Skills with no matching option (add manually): ${skipped.join(', ')}`);
        if (debugNote) L('warn', debugNote);
      }
    }

    // Websites
    const webSecs = () => sections(/^(website|websitePanelSet)-\d+$/, /^website \d+$/);
    if (profile.websites.length) {
      // LinkedIn is also copied to the separate "Social Network URLs" field when the page has one.
      // Order: Website 1 = LinkedIn, 2 = GitHub, 3 = Portfolio, then anything else in profile order.
      const rank = w => /linkedin/i.test(w.label + w.url) ? 0 : /github/i.test(w.label + w.url) ? 1 : /portfolio|personal|website/i.test(w.label) ? 2 : 3;
      profile.websites = profile.websites.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).map(x => x.w);
      const linkedin = profile.websites.find(w => /linkedin/i.test(w.label + w.url));
      const secs = await ensureCount(webSecs, 'websiteSection', /^websites?$/, profile.websites.length);
      for (let i = 0; i < profile.websites.length; i++) {
        const w = profile.websites[i], c = secs[i];
        if (!c) { L('warn', `Website ${i + 1} (${w.label}): no section on the page`); continue; }
        put(c, 'url', w.url, `Website ${i + 1} (${w.label})`);
      }
      if (linkedin) {
        const el = document.querySelector('input[data-automation-id="linkedinQuestion"]') ||
          [...document.querySelectorAll('input')].find(i => {
            const ff = i.closest('[data-automation-id^="formField"]') || i.parentElement.parentElement;
            return ff && /linkedin/i.test(ff.textContent) && !/^url/i.test(norm(ff.textContent));
          });
        if (el) { setValue(el, linkedin.url); L('ok', `LinkedIn field: ${linkedin.url}`); }
      }
    }

    cdpStop();
    const warn = log.filter(x => x.level === 'warn').length;
    L('info', `Done: ${log.filter(x => x.level === 'ok').length} filled, ${warn} need a look. Review everything, then click Save and Continue yourself.`);
    return log;
  }

  window.__wfHelpers = { sleep, norm, hasSkill, isVisible, waitFor, setValue, typeInto, click, key, pickMatch,
    cdpStart, tType, tKey, chooseOption };
  window.__workdayFiller = { fillAll: md => fillAll(parseProfile(md)), parseProfile };

  // ---- wiring: popup message + floating button ----
  let runWithPanel = md => fillAll(parseProfile(md));
  const hasChrome = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage;
  if (hasChrome) {
    chrome.runtime.onMessage.addListener((msg, _s, send) => {
      if (msg && msg.type === 'fill') {
        if (window !== window.top && !(window.__wfGreenhouse && window.__wfGreenhouse.detect())) return;
        runWithPanel(msg.md).then(log => send({ ok: true, log }));
        return true;
      }
    });

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;font:13px system-ui,sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:6px';
    const out = document.createElement('div');
    out.style.cssText = 'display:none;max-width:340px;max-height:260px;overflow:auto;background:#111;color:#eee;padding:8px 10px;border-radius:8px;white-space:pre-wrap';
    const btn = document.createElement('button');
    btn.textContent = 'Workday Filler';
    btn.style.cssText = 'background:#0b6bcb;color:#fff;border:0;border-radius:20px;padding:8px 14px;cursor:pointer;box-shadow:0 2px 8px #0005';
    let running = false;
    runWithPanel = async md => {
      out.style.display = 'block';
      if (running) { out.textContent += '\n(already filling)'; return []; }
      running = true;
      out.textContent = 'Filling...';
      const lines = [];
      try {
        return await fillAll(parseProfile(md), (lvl, m) => { lines.push((lvl === 'ok' ? '✓ ' : lvl === 'warn' ? '! ' : '') + m); out.textContent = lines.join('\n'); out.scrollTop = out.scrollHeight; });
      } finally { running = false; }
    };
    btn.onclick = async () => {
      const { profileMd } = await chrome.storage.local.get('profileMd');
      if (!profileMd) { out.style.display = 'block'; out.textContent = 'No profile saved. Open the extension popup and paste or upload your .md first.'; return; }
      runWithPanel(profileMd);
    };
    box.append(out, btn);
    // In iframes (embedded Greenhouse forms) only show the button when there is a form to fill.
    const showBox = () => { if (!box.isConnected) document.body.appendChild(box); };
    if (window === window.top) showBox();
    else {
      const chk = () => window.__wfGreenhouse && window.__wfGreenhouse.detect() && showBox();
      chk(); setTimeout(chk, 1500); setTimeout(chk, 4000);
    }
  }
})();
