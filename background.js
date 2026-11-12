// Sends real (trusted) mouse and keyboard input to the tab through the Chrome debugger.
// Used only as a fallback for Workday dropdowns that ignore script-generated events.
const attached = new Set();
chrome.debugger.onDetach.addListener(src => attached.delete(src.tabId));

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;
  if (msg.type === 'cdp') {
    (async () => {
      try {
        if (!attached.has(tabId)) { await chrome.debugger.attach({ tabId }, '1.3'); attached.add(tabId); }
        for (const [method, params] of msg.cmds) await chrome.debugger.sendCommand({ tabId }, method, params);
        send({ ok: true });
      } catch (e) { send({ ok: false, error: String(e && e.message || e) }); }
    })();
    return true;
  }
  if (msg.type === 'cdp-detach') {
    if (attached.has(tabId)) chrome.debugger.detach({ tabId }).catch(() => {}).finally(() => attached.delete(tabId));
    send({ ok: true });
  }
});
