const $ = id => document.getElementById(id);
const { parseProfile } = window.WorkdayFillerParser;

function summarize() {
  const p = parseProfile($('md').value);
  const counts = `${p.work.length} work, ${p.education.length} education, ${p.skills.length} skills, ${p.websites.length} websites`;
  $('summary').textContent = $('md').value.trim() ? (p.title ? `${p.title}: ${counts}` : counts) : 'No profile yet.';
}
let t;
async function save(now) {
  clearTimeout(t);
  const go = async () => {
    await chrome.storage.local.set({ profileMd: $('md').value });
    $('status').textContent = 'Saved ✓';
  };
  $('status').textContent = 'Saving...';
  if (now) await go(); else t = setTimeout(go, 300);
}
async function load(text) { $('md').value = text; summarize(); await save(true); }

chrome.storage.local.get('profileMd').then(({ profileMd }) => {
  if (profileMd) { $('md').value = profileMd; $('status').textContent = 'Saved ✓'; }
  summarize();
  $('md').focus();
});

$('md').addEventListener('input', () => { summarize(); save(); });
$('paste').onclick = async () => {
  try { await load(await navigator.clipboard.readText()); }
  catch (e) { $('md').focus(); $('summary').textContent = 'Clipboard blocked: click in the box and press Cmd+V.'; }
};
$('upload').onclick = () => $('file').click();
$('file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) await load(await f.text()); });
$('clear').onclick = () => load('');
const drop = $('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async e => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) await load(await f.text());
});

$('fill').onclick = async () => {
  await save(true);
  const log = $('log');
  log.style.display = 'block';
  log.textContent = 'Filling... (progress also shows on the page, bottom right)';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'fill', md: $('md').value });
    log.textContent = res.log.map(x => (x.level === 'ok' ? '✓ ' : x.level === 'warn' ? '! ' : '') + x.msg).join('\n');
  } catch (e) {
    log.textContent = 'Could not reach the page. Open a Workday or Greenhouse application page, reload it once after installing or updating the extension, and try again.';
  }
};
