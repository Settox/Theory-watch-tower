// Right-click: "Clip to The Forbidden Library" sends the selection (or the page / link) to the destination you used last.
import { load, target } from './clip.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'clip', title: 'Clip to The Forbidden Library', contexts: ['selection', 'page', 'link'] });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'clip') return;
  const s = await load();
  const clip = { t: info.linkUrl ? info.selectionText || info.linkUrl : (tab && tab.title) || '', u: info.linkUrl || info.pageUrl || (tab && tab.url) || '', q: (info.selectionText || '').slice(0, 6000), d: '' };
  chrome.tabs.create({ url: target(s.app, s.last, clip) });
});
