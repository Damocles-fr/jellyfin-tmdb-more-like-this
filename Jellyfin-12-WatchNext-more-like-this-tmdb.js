(function () {
  'use strict';

  /* ==========================================================================
   * CONFIGURATION - JELLYFIN More Like This
   * ==========================================================================
   * TMDB_API_KEY  (REQUIRED)
   *   Get a key by creating an account at https://www.themoviedb.org/settings/api
   *   Paste it between the quotes.
   *   Example:  const TMDB_API_KEY = 'a1b2c3d4e5f6hd8876Dfg';
   */
  const TMDB_API_KEY = 'PASTE_YOUR_TMDB_API_KEY_HERE';

  const SETTINGS = {

    /* maxResults - default 20, min 1, max 40
     * Maximum number of cards displayed in the row (if available in your
     * library). Higher = longer row and slightly larger display batch. */
    maxResults: 40,

    /* maxTmdbPages - default 3, min 1, max 5
     * When fewer than maxResults matches are found, up to this many TMDB
     * recommendation pages are fetched (20 candidates per page). Higher =
     * more chances to fill the row for obscure titles, at the cost of one
     * extra TMDB request per page. 1 = never fetch extra pages. */
    maxTmdbPages: 5,

    /* collectionsFirst - default true (true/false)
     * Movies only. If the movie belongs to a TMDB collection (saga), films
     * from that collection which exist in your library are placed at the
     * head of the row, before regular recommendations. Costs one extra
     * cached TMDB request, only for movies that belong to a collection. */
    collectionsFirst: true,

    /* collectionMax - default 2, min 1, max 20
     * Maximum number of collection films placed at the head of the row.
     * Order spirals outward from the current movie in the collection's
     * chronological order: next film, previous film, next+1, previous-1...
     * Default 2 = the next film then the previous film. Other films of the
     * saga may still appear later through normal recommendations; duplicates
     * are always removed. */
    collectionMax: 2,

    /* indexTtlHours - default 24, min 1, max 168
     * Lifetime of the local library index (TMDB ID -> Jellyfin ID map,
     * stored in localStorage). Lower = rebuilt more often (more Jellyfin
     * requests), higher = new library items can take longer to appear.
     * A cheap background check also rebuilds it early when the library
     * item count changes. */
    indexTtlHours: 84,

    /* tmdbCacheHours - default 24, min 1, max 168
     * Lifetime of cached TMDB responses (sessionStorage). Reopening the
     * same title within this window costs zero TMDB requests. */
    tmdbCacheHours: 84,

    /* pageSize - default 1500, min 200, max 5000
     * Items fetched per request while building the library index. Higher =
     * fewer, heavier requests; lower = more, lighter requests. Does not
     * change the result, only how the one-time index build is split. */
    pageSize: 1500,

    /* showRefresh - default false (true/false)
     * Show a small refresh icon inside the open panel that clears this
     * script's caches and reloads the recommendations. Hidden by default. */
    showRefresh: false,

    /* hideNativeSimilar - default false (true/false)
     * Hide Jellyfin's own built-in "More Like This" row (#similarCollapsible)
     * at the bottom of detail pages. Kept visible by default: this script's
     * row is placed just above it, after the native Collections row when
     * there is one. Set to true to hide it. Only hides that specific native
     * row, nothing else. */
    hideNativeSimilar: false,

    /* sectionTitle
     * Text shown on the collapsed bar. */
    sectionTitle: 'Watch Next',

    /* strings
     * All UI texts. Safe to translate. */
    strings: {
      loadingIndex: 'Building library index',
      loadingRecs: 'Loading recommendations',
      noKey: 'TMDB API key missing. Open the script and set TMDB_API_KEY at the top.',
      noTmdbId: 'No TMDB ID found for this item.',
      noResults: 'No TMDB recommendation is available in your library.',
      error: 'Failed to load recommendations.',
      refresh: 'Refresh'
    }
  };
  /* ======================= END OF CONFIGURATION =========================== */

  if (window.__jfTmdbRecsLoaded) return;
  window.__jfTmdbRecsLoaded = true;

  const KEY = String(TMDB_API_KEY || '').trim();
  const keyOk = !!KEY && KEY !== 'PASTE_YOUR_TMDB_API_KEY_HERE';
  const isBearer = KEY.indexOf('eyJ') === 0;
  const S = SETTINGS.strings;
  const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
  const MAXRES = clamp(SETTINGS.maxResults, 1, 40, 20);
  const MAXPAGES = clamp(SETTINGS.maxTmdbPages, 1, 5, 3);
  const COLMAX = Math.min(clamp(SETTINGS.collectionMax, 1, 20, 2), MAXRES);
  const IDXTTL = clamp(SETTINGS.indexTtlHours, 1, 168, 24) * 3600000;
  const TMDBTTL = clamp(SETTINGS.tmdbCacheHours, 1, 168, 24) * 3600000;
  const PAGE = clamp(SETTINGS.pageSize, 200, 5000, 1500);

  const CFG = { styleId: 'jf-tr-style-v3', root: '[data-jf-tr-root="1"]', watchDogMs: 800, maxWaitMs: 6000, reapplyDelayMs: 250, activeMs: 5000, moThrottleMs: 150, batchChunk: 20 };
  let scheduled = null, burst = [], runSeq = 0, lastItemId = '';

  /* Inline icons: the modern interface does not load the Material Icons font. */
  const ICON = {
    expand: 'M7 10l5 5 5-5z',
    left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
    movie: 'm18 4 2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4z',
    tv: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2m0 14H3V5h18z'
  };
  const svgMarkup = (d, cls) => '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + d + '"></path></svg>';
  const svgEl = (d, cls) => { const w = document.createElement('span'); w.innerHTML = svgMarkup(d, cls); return w.firstChild; };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (t, c) => { const d = document.createElement(t); if (c) d.className = c; return d; };

  const sGet = k => { try { const o = JSON.parse(sessionStorage.getItem(k) || 'null'); if (!o || Date.now() > o.e) return null; return o.v; } catch { return null; } };
  const sSet = (k, v, ttl) => { try { sessionStorage.setItem(k, JSON.stringify({ v, e: Date.now() + (ttl || TMDBTTL) })); } catch {} };

  const token = () => {
    try { if (window.ApiClient && ApiClient.accessToken) { const t = ApiClient.accessToken(); if (t) return t; } } catch {}
    try { const o = JSON.parse(localStorage.getItem('jellyfin_credentials') || 'null'); const ss = (o && o.Servers) || []; for (const s of ss) if (s && s.AccessToken) return s.AccessToken; } catch {}
    return null;
  };
  const userId = () => {
    try { if (window.ApiClient && ApiClient.getCurrentUserId) { const u = ApiClient.getCurrentUserId(); if (u) return u; } } catch {}
    try { const o = JSON.parse(localStorage.getItem('jellyfin_credentials') || 'null'); const ss = (o && o.Servers) || []; for (const s of ss) if (s && s.UserId) return s.UserId; } catch {}
    return 'u';
  };
  /* Jellyfin 12 disables the legacy auth mechanisms (X-Emby-Token, ?api_key=)
   * by default; only the MediaBrowser Authorization scheme is accepted, which
   * older servers have always understood too. */
  const authHeader = t => 'MediaBrowser Client="Jellyfin Web", Device="Browser", DeviceId="jf-tmdb-recs", Version="1.0.0", Token="' + t + '"';
  const base = () => {
    try { if (window.ApiClient && ApiClient.serverAddress) { const a = ApiClient.serverAddress(); if (a) return a; } } catch {}
    const i = location.pathname.indexOf('/web/');
    return location.origin + (i > 0 ? location.pathname.slice(0, i) : '');
  };
  const api = async path => {
    const t = token(); if (!t) throw new Error('no token');
    const r = await fetch(base() + path, { headers: { Authorization: authHeader(t) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };

  const itemIdFromUrl = () => { const u = new URL(location.href); const d = u.searchParams.get('id'); if (d) return d; const m = (u.hash || '').match(/[?&]id=([^&]+)/); return m ? decodeURIComponent(m[1]) : null; };
  const serverIdFromUrl = () => { const u = new URL(location.href); const d = u.searchParams.get('serverId'); if (d) return d; const m = (u.hash || '').match(/[?&]serverId=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  const currentServerId = () => {
    const u = serverIdFromUrl(); if (u) return u;
    try { if (window.ApiClient && ApiClient.serverId) { const s = ApiClient.serverId(); if (s) return s; } } catch {}
    try { const o = JSON.parse(localStorage.getItem('jellyfin_credentials') || 'null'); const ss = (o && o.Servers) || []; for (const s of ss) if (s && s.Id) return s.Id; } catch {}
    return '';
  };
  const webRoot = () => { const m = String(location.pathname || '').match(/^(.*\/web\/)(?:index\.html)?$/i); return m ? m[1] : '/web/'; };
  const detailsHash = (id, sid) => '/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(sid);
  const detailsUrl = (id, sid) => location.origin + webRoot() + '#' + detailsHash(id, sid);

  const visible = e => { if (!e || !e.isConnected) return false; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 2 && r.height > 2; };
  const best = els => { let b = null, a = 0; for (const e of els) { if (!visible(e)) continue; const r = e.getBoundingClientRect(), x = r.width * r.height; if (x > a) { a = x; b = e; } } return b || els[els.length - 1] || null; };
  const isDetails = () => { const h = String(location.hash || ''); return h.includes('/details') && (h.includes('id=') || new URL(location.href).searchParams.get('id')); };

  const getPid = (pids, name) => {
    if (!pids) return null;
    const low = name.toLowerCase();
    for (const k of Object.keys(pids)) if (k.toLowerCase() === low) { const v = pids[k]; return (v === null || v === undefined || v === '') ? null : String(v); }
    return null;
  };

  const scheduleRun = d => { if (scheduled) clearTimeout(scheduled); scheduled = setTimeout(() => { scheduled = null; run(); }, typeof d === 'number' ? d : 0); };
  const scheduleBurst = arr => { burst.forEach(clearTimeout); burst = []; (arr || [0]).forEach(d => burst.push(setTimeout(run, d || 0))); };

  async function fetchItem(id) {
    const k = 'jftr-item|' + id, c = sGet(k); if (c) return c;
    const r = await api('/Items?ids=' + encodeURIComponent(id) + '&userId=' + encodeURIComponent(userId()) + '&Fields=ProviderIds&EnableImages=false&EnableTotalRecordCount=false');
    const v = (r.Items && r.Items[0]) || null;
    if (!v) throw new Error('item not found');
    sSet(k, v); return v;
  }

  const indexKey = type => ['jftr-idx-v1', location.host, userId(), type].join('|');
  function readIndex(type) {
    try { const o = JSON.parse(localStorage.getItem(indexKey(type)) || 'null'); if (!o || !o.m || typeof o.c !== 'number' || !o.t) return null; if (Date.now() - o.t > IDXTTL) return null; return o; } catch { return null; }
  }
  const writeIndex = (type, val) => { try { localStorage.setItem(indexKey(type), JSON.stringify(val)); } catch {} };

  const buildLocks = {};
  async function buildIndex(type, onPage) {
    if (buildLocks[type]) return buildLocks[type];
    buildLocks[type] = (async () => {
      const map = {}; let count = 0;
      for (let p = 0; p < 60; p++) {
        const res = await api('/Items?userId=' + encodeURIComponent(userId()) + '&IncludeItemTypes=' + type + '&Recursive=true&Fields=ProviderIds&EnableImages=false&EnableUserData=false&EnableTotalRecordCount=false&CollapseBoxSetItems=false&SortBy=SortName&SortOrder=Ascending&StartIndex=' + (p * PAGE) + '&Limit=' + PAGE);
        const items = res.Items || [];
        count += items.length;
        for (const it of items) { const t = getPid(it.ProviderIds, 'tmdb'); if (t !== null && !(t in map)) map[t] = it.Id; }
        if (onPage) { try { onPage(count); } catch {} }
        if (items.length < PAGE) break;
      }
      const val = { m: map, c: count, t: Date.now() };
      writeIndex(type, val);
      return val;
    })();
    try { return await buildLocks[type]; } finally { delete buildLocks[type]; }
  }

  async function getCount(type) {
    try { const r = await api('/Items?userId=' + encodeURIComponent(userId()) + '&IncludeItemTypes=' + type + '&Recursive=true&Limit=1&EnableTotalRecordCount=true&EnableImages=false&EnableUserData=false'); return typeof r.TotalRecordCount === 'number' ? r.TotalRecordCount : null; } catch { return null; }
  }

  function purgeIndex(type, dead) {
    const idx = readIndex(type); if (!idx) return;
    let changed = false;
    for (const k of Object.keys(idx.m)) if (dead.has(idx.m[k])) { delete idx.m[k]; changed = true; }
    if (changed) writeIndex(type, idx);
  }

  async function batchFetch(ids, type) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += CFG.batchChunk) chunks.push(ids.slice(i, i + CFG.batchChunk));
    const parts = await Promise.all(chunks.map(c => api('/Items?ids=' + c.map(encodeURIComponent).join(',') + '&userId=' + encodeURIComponent(userId()) + '&Fields=PrimaryImageAspectRatio&EnableTotalRecordCount=false').catch(() => null)));
    const by = {};
    for (const res of parts) if (res) for (const it of (res.Items || [])) by[it.Id] = it;
    const ordered = ids.map(i => by[i]).filter(Boolean);
    if (!ordered.length && parts.some(p => !p)) throw new Error('batch failed');
    if (ordered.length < ids.length && !parts.some(p => !p)) { const got = new Set(ordered.map(i => i.Id)); purgeIndex(type, new Set(ids.filter(i => !got.has(i)))); }
    return ordered;
  }

  async function tmdb(path) {
    const url = 'https://api.themoviedb.org/3' + path + (isBearer ? '' : (path.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(KEY));
    const r = await fetch(url, isBearer ? { headers: { Authorization: 'Bearer ' + KEY } } : undefined);
    if (!r.ok) throw new Error('TMDB HTTP ' + r.status);
    return r.json();
  }
  const slimMain = d => ({
    rec: (((d.recommendations || {}).results) || []).map(r => r && r.id).filter(i => i != null),
    sim: (((d.similar || {}).results) || []).map(r => r && r.id).filter(i => i != null),
    tp: ((d.recommendations || {}).total_pages) || 1,
    col: (d.belongs_to_collection && d.belongs_to_collection.id != null) ? d.belongs_to_collection.id : null
  });
  const slimPage = d => ((d.results) || []).map(r => r && r.id).filter(i => i != null);
  const slimCol = d => ((d.parts) || []).map(p => ({ i: p.id, d: p.release_date || '' })).filter(p => p.i != null);

  async function tmdbCached(key, path, slim) {
    const c = sGet(key); if (c) return c;
    const v = slim(await tmdb(path)); sSet(key, v); return v;
  }
  const tmdbMain = (kind, id) => tmdbCached('jftr-t2|' + kind + '|' + id + '|0', '/' + kind + '/' + id + '?append_to_response=recommendations,similar', slimMain);
  const tmdbRecPage = (kind, id, p) => tmdbCached('jftr-t2|' + kind + '|' + id + '|' + p, '/' + kind + '/' + id + '/recommendations?page=' + p, slimPage);
  const tmdbCol = cid => tmdbCached('jftr-t2|col|' + cid, '/collection/' + cid, slimCol);

  async function tmdbFind(source, extId, kind) {
    const k = 'jftr-find|' + source + '|' + extId;
    const c = sGet(k); if (c !== null) return c || null;
    let out = null;
    try { const d = await tmdb('/find/' + encodeURIComponent(extId) + '?external_source=' + source); const arr = kind === 'movie' ? d.movie_results : d.tv_results; if (arr && arr[0] && arr[0].id != null) out = arr[0].id; } catch {}
    sSet(k, out || 0);
    return out;
  }
  async function resolveTmdbId(item, kind) {
    const direct = getPid(item.ProviderIds, 'tmdb');
    if (direct && /^\d+$/.test(direct)) return Number(direct);
    const imdb = getPid(item.ProviderIds, 'imdb');
    if (imdb) { const f = await tmdbFind('imdb_id', imdb, kind); if (f) return f; }
    if (kind === 'tv') { const tvdb = getPid(item.ProviderIds, 'tvdb'); if (tvdb) { const f = await tmdbFind('tvdb_id', tvdb, kind); if (f) return f; } }
    return null;
  }

  function newCands() { return { list: [], seen: new Set() }; }
  function pushCands(c, ids) { for (const id of (ids || [])) { if (id != null && !c.seen.has(id)) { c.seen.add(id); c.list.push(id); } } }
  function matchRecs(c, map, baseSeen) {
    const s = new Set(baseSeen), out = [];
    for (const id of c.list) { const jf = map[String(id)]; if (jf && !s.has(jf)) { s.add(jf); out.push(jf); } }
    return out;
  }
  function collectionOrder(parts, tmdbId) {
    const arr = (parts || []).slice().sort((a, b) => { const x = a.d || '', y = b.d || ''; if (!x && !y) return 0; if (!x) return 1; if (!y) return -1; return x < y ? -1 : x > y ? 1 : 0; });
    const i = arr.findIndex(p => p && p.i === tmdbId);
    const out = [];
    if (i >= 0) { for (let d = 1; d < arr.length; d++) { if (i + d < arr.length) out.push(arr[i + d].i); if (i - d >= 0) out.push(arr[i - d].i); } }
    else for (const p of arr) if (p && p.i != null && p.i !== tmdbId) out.push(p.i);
    return out;
  }

  function injectStyle() {
    if (document.getElementById(CFG.styleId)) return;
    const s = document.createElement('style'); s.id = CFG.styleId;
    s.textContent = `
${CFG.root}{margin:.85em 0 1.1em;position:relative;z-index:3;clear:both;width:100%;max-width:calc(100% - 3.15rem)}
.jf-tr-box{border-radius:12px;overflow:hidden;background:rgba(127,127,127,.1);border:1px solid rgba(127,127,127,.18)}
.jf-tr-toggle{width:100%;display:flex;align-items:center;gap:.42rem;border:0;margin:0;padding:.72rem .95rem;cursor:pointer;color:inherit;background:rgba(127,127,127,.06);text-align:left;font:inherit;outline:none !important;box-shadow:none !important;-webkit-tap-highlight-color:transparent}
.jf-tr-toggle:hover{background:rgba(127,127,127,.14)}
.jf-tr-toggle-label{font-size:1.05rem;font-weight:700;line-height:1.2;flex:0 0 auto}
.jf-tr-toggle-icon{width:1.35rem;height:1.35rem;transition:transform .16s ease;opacity:.92;flex:0 0 auto}
.jf-tr-toggle[aria-expanded="true"] .jf-tr-toggle-icon{transform:rotate(180deg)}
.jf-tr-panel{border-top:1px solid rgba(127,127,127,.18);background:rgba(0,0,0,.06);overflow:hidden}
.jf-tr-panel[hidden]{display:none !important}
.jf-tr-body{padding:.72rem .82rem .82rem;overflow:hidden}
.jf-tr-status{font-size:.92rem;opacity:.9;padding:.15rem .05rem}
.jf-tr-head{display:flex;align-items:center;justify-content:flex-end;gap:.15rem;min-height:1.9rem;margin:0 0 .12rem}
.jf-tr-iconbtn{background:transparent;border:0;color:inherit;cursor:pointer;padding:.3rem;border-radius:50%;line-height:0;flex:0 0 auto}
.jf-tr-iconbtn svg{width:1.3rem;height:1.3rem;display:block}
.jf-tr-iconbtn:hover{background:rgba(127,127,127,.18)}
.jf-tr-refresh{opacity:.55;margin-right:.15rem}
.jf-tr-refresh:hover{opacity:1}
.jf-tr-btn[disabled]{opacity:.28;cursor:default;pointer-events:none}
.jf-tr-scroller{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;overscroll-behavior-x:contain;overflow-anchor:none;padding:.1rem 0 .2rem;max-width:100%}
.jf-tr-scroller::-webkit-scrollbar{display:none}
.jf-tr-items{display:flex;flex-wrap:nowrap;align-items:flex-start}
.jf-tr-items>.card{flex:0 0 auto}
:where(.jf-tr-items>.card){width:148px}
.jf-tr-scroller .cardBox{margin:0 .3em}
.jf-tr-scroller .cardScalable{position:relative}
.jf-tr-scroller .cardPadder{display:flex;align-items:center;justify-content:center}
:where(.jf-tr-scroller) .cardPadder-overflowPortrait{padding-bottom:150%}
.jf-tr-scroller .cardImageContainer{position:absolute;top:0;left:0;right:0;bottom:0;background-size:cover;background-position:center;background-repeat:no-repeat}
:where(.jf-tr-scroller .cardImageContainer){border-radius:.28em}
.jf-tr-scroller .cardOverlayContainer{position:absolute;top:0;left:0;right:0;bottom:0;cursor:pointer}
.jf-tr-noimg .cardImageIcon{width:3em;height:3em;opacity:.35}
.jf-tr-scroller .cardText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 .15em}
:where(.jf-tr-scroller) .cardText-first{margin-top:.35em}
:where(.jf-tr-scroller) .cardText-secondary{opacity:.65;font-size:.86em}
.jf-tr-scroller a{color:inherit !important;text-decoration:none !important}
.jf-tr-scroller .textActionButton:hover{text-decoration:underline !important}
@media (max-width:900px){${CFG.root}{max-width:calc(100% - .4rem)}.jf-tr-body{padding:.72rem .42rem .82rem}:where(.jf-tr-items>.card){width:124px}}
@media (hover:none),(pointer:coarse){.jf-tr-arrows{display:none}}
${SETTINGS.hideNativeSimilar ? '#similarCollapsible{display:none !important}' : ''}
`;
    document.head.appendChild(s);
  }

  function bindNav(root, sid) {
    root.addEventListener('click', e => {
      const a = e.target.closest('[data-jf-internal-id]');
      if (!a || !root.contains(a)) return;
      if (a.tagName === 'A' && (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return;
      const id = a.dataset.jfInternalId || ''; if (!id) return;
      e.preventDefault(); e.stopPropagation();
      location.hash = detailsHash(id, sid);
    }, true);
  }

  function buildCard(item, sid) {
    const type = item.Type === 'Series' ? 'Series' : 'Movie';
    const isFolder = type === 'Series';
    const card = el('div', 'card overflowPortraitCard card-hoverable');
    card.dataset.id = item.Id; card.dataset.serverid = sid; card.dataset.type = type;
    card.dataset.isfolder = isFolder ? 'true' : 'false';
    if (type === 'Movie') card.dataset.mediatype = 'Video';

    const box = el('div', 'cardBox cardBox-bottompadded');
    const scal = el('div', 'cardScalable');
    const padder = el('div', 'cardPadder cardPadder-overflowPortrait');
    scal.appendChild(padder);

    const a = el('a', 'cardImageContainer coveredImage cardContent itemAction');
    a.href = detailsUrl(item.Id, sid);
    a.dataset.action = 'link'; a.dataset.jfInternalId = item.Id;
    a.setAttribute('aria-label', item.Name || '');
    const tag = item.ImageTags && item.ImageTags.Primary;
    if (tag) a.style.backgroundImage = 'url("' + base() + '/Items/' + item.Id + '/Images/Primary?fillHeight=456&fillWidth=304&quality=96&tag=' + encodeURIComponent(tag) + '")';
    else {
      card.classList.add('jf-tr-noimg');
      padder.appendChild(svgEl(isFolder ? ICON.tv : ICON.movie, 'cardImageIcon'));
    }
    scal.appendChild(a);

    const ov = el('div', 'cardOverlayContainer itemAction');
    ov.dataset.action = 'link'; ov.dataset.jfInternalId = item.Id;
    ov.appendChild(el('div', 'cardOverlayButton-br flex'));
    scal.appendChild(ov);

    const t1 = el('div', 'cardText cardTextCentered cardText-first');
    const b1 = document.createElement('bdi');
    const na = el('a', 'itemAction textActionButton');
    na.href = detailsUrl(item.Id, sid);
    na.dataset.id = item.Id; na.dataset.serverid = sid; na.dataset.type = type;
    na.dataset.isfolder = card.dataset.isfolder; na.dataset.action = 'link'; na.dataset.jfInternalId = item.Id;
    na.textContent = item.Name || ''; na.title = item.Name || '';
    b1.appendChild(na); t1.appendChild(b1);

    const t2 = el('div', 'cardText cardTextCentered cardText-secondary');
    const b2 = document.createElement('bdi');
    const sp = document.createElement('span');
    sp.textContent = item.ProductionYear ? String(item.ProductionYear) : '\u00A0';
    b2.appendChild(sp); t2.appendChild(b2);

    box.appendChild(scal); box.appendChild(t1); box.appendChild(t2);
    card.appendChild(box);
    return card;
  }

  function setStatus(body, text) {
    body.innerHTML = '';
    const d = el('div', 'jf-tr-status'); d.textContent = text;
    body.appendChild(d);
  }

  function clearCaches(root) {
    const type = root.dataset.type || '';
    try { if (type) localStorage.removeItem(indexKey(type)); } catch {}
    try {
      const rm = [];
      for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.indexOf('jftr-') === 0) rm.push(k); }
      rm.forEach(k => sessionStorage.removeItem(k));
    } catch {}
  }

  function renderRow(root, body, items, sid) {
    if (!root.isConnected) return;
    body.innerHTML = '';

    const head = el('div', 'jf-tr-head');
    if (SETTINGS.showRefresh) {
      const rf = el('button', 'jf-tr-iconbtn jf-tr-refresh'); rf.type = 'button';
      rf.appendChild(svgEl(ICON.refresh));
      rf.setAttribute('aria-label', S.refresh); rf.title = S.refresh;
      rf.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearCaches(root); root.dataset.loaded = '0'; loadPanel(root, { force: true }); });
      head.appendChild(rf);
    }
    const arrows = el('div', 'jf-tr-arrows'); arrows.style.cssText = 'display:flex;align-items:center;gap:.05rem';
    const mkBtn = dir => {
      const b = el('button', 'jf-tr-iconbtn jf-tr-btn'); b.type = 'button';
      b.appendChild(svgEl(dir < 0 ? ICON.left : ICON.right));
      b.setAttribute('aria-label', dir < 0 ? 'Scroll left' : 'Scroll right');
      return b;
    };
    const bl = mkBtn(-1), br = mkBtn(1);
    arrows.appendChild(bl); arrows.appendChild(br);
    head.appendChild(arrows);
    body.appendChild(head);

    const scroller = el('div', 'jf-tr-scroller');
    const row = el('div', 'itemsContainer scrollSlider jf-tr-items');
    for (const it of items) row.appendChild(buildCard(it, sid));
    scroller.appendChild(row);
    body.appendChild(scroller);
    bindNav(scroller, sid);

    const upd = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      bl.disabled = scroller.scrollLeft <= 2;
      br.disabled = max <= 2 || scroller.scrollLeft >= max - 2;
    };
    scroller.addEventListener('scroll', upd, { passive: true });
    bl.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); scroller.scrollBy({ left: -Math.round(scroller.clientWidth * 0.9), behavior: 'smooth' }); });
    br.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); scroller.scrollBy({ left: Math.round(scroller.clientWidth * 0.9), behavior: 'smooth' }); });
    root._jfTrScroller = scroller;
    requestAnimationFrame(() => { scroller.scrollLeft = 0; upd(); });
  }

  async function loadPanel(root, opts) {
    opts = opts || {};
    if (root.dataset.loading === '1') return;
    if (root.dataset.loaded === '1' && !opts.force) return;
    root.dataset.loading = '1';
    const body = q('.jf-tr-body', root);
    if (!body) { root.dataset.loading = '0'; return; }
    try {
      if (!keyOk) { setStatus(body, S.noKey); root.dataset.loaded = '1'; return; }
      const itemId = root.dataset.itemId, sid = root.dataset.serverId || '';
      setStatus(body, S.loadingRecs + '\u2026');

      const item = await fetchItem(itemId);
      if (!root.isConnected) return;
      const type = item.Type === 'Series' ? 'Series' : 'Movie';
      const kind = type === 'Series' ? 'tv' : 'movie';
      root.dataset.type = type;

      const tmdbId = await resolveTmdbId(item, kind);
      if (!tmdbId) { setStatus(body, S.noTmdbId); root.dataset.loaded = '1'; return; }

      let idx = opts.index || readIndex(type);
      const fromCache = !opts.index && !!idx;
      if (!idx) {
        setStatus(body, S.loadingIndex + '\u2026');
        idx = await buildIndex(type, n => { if (root.isConnected) setStatus(body, S.loadingIndex + '\u2026 (' + n + ')'); });
      }
      if (!root.isConnected) return;

      setStatus(body, S.loadingRecs + '\u2026');
      const main = await tmdbMain(kind, tmdbId);
      const cands = newCands();
      pushCands(cands, main.rec);
      pushCands(cands, main.sim);

      const colJf = [];
      if (kind === 'movie' && SETTINGS.collectionsFirst && main.col != null) {
        try {
          const col = await tmdbCol(main.col);
          const order = collectionOrder(col, tmdbId);
          const seen = new Set([itemId]);
          for (const cid of order) {
            const jf = idx.m[String(cid)];
            if (jf && !seen.has(jf)) { seen.add(jf); cands.seen.add(cid); colJf.push(jf); if (colJf.length >= COLMAX) break; }
          }
        } catch {}
      }

      const baseSeen = [itemId].concat(colJf);
      let rec = matchRecs(cands, idx.m, baseSeen);
      const totalPages = main.tp || 1;
      for (let p = 2; colJf.length + rec.length < MAXRES && p <= Math.min(totalPages, MAXPAGES); p++) {
        let extra = null;
        try { extra = await tmdbRecPage(kind, tmdbId, p); } catch { break; }
        pushCands(cands, extra);
        rec = matchRecs(cands, idx.m, baseSeen);
      }
      const matched = colJf.concat(rec).slice(0, MAXRES);

      if (!root.isConnected) return;
      if (!matched.length) setStatus(body, S.noResults);
      else {
        const items = await batchFetch(matched, type);
        if (!root.isConnected) return;
        if (!items.length) setStatus(body, S.noResults);
        else renderRow(root, body, items, sid);
      }
      root.dataset.loaded = '1';

      if (fromCache && !opts.noRevalidate) {
        (async () => {
          try {
            const cnt = await getCount(type);
            if (cnt === null || cnt === idx.c) return;
            const fresh = await buildIndex(type, null);
            if (!root.isConnected) return;
            root.dataset.loaded = '0';
            loadPanel(root, { force: true, index: fresh, noRevalidate: true });
          } catch {}
        })();
      }
    } catch (e) {
      console.warn('[JF-TR] load failed', e);
      if (root.isConnected) setStatus(body, S.error + (e && e.message ? ' (' + e.message + ')' : ''));
      root.dataset.loaded = '0';
    } finally {
      root.dataset.loading = '0';
    }
  }

  function createBlock(itemId, sid) {
    const root = document.createElement('section');
    root.setAttribute('data-jf-tr-root', '1');
    root.dataset.itemId = itemId; root.dataset.serverId = sid || '';
    root.dataset.loaded = '0'; root.dataset.loading = '0';
    root.innerHTML =
      '<div class="jf-tr-box">' +
        '<button type="button" class="jf-tr-toggle" aria-expanded="false">' +
          '<span class="jf-tr-toggle-label"></span>' +
          svgMarkup(ICON.expand, 'jf-tr-toggle-icon') +
        '</button>' +
        '<div class="jf-tr-panel" hidden><div class="jf-tr-body"></div></div>' +
      '</div>';
    q('.jf-tr-toggle-label', root).textContent = SETTINGS.sectionTitle;
    const t = q('.jf-tr-toggle', root), p = q('.jf-tr-panel', root);
    t.addEventListener('click', () => {
      const ex = t.getAttribute('aria-expanded') === 'true', nx = !ex;
      t.setAttribute('aria-expanded', nx ? 'true' : 'false');
      p.hidden = !nx;
      if (nx) {
        const sc = root._jfTrScroller;
        if (sc && sc.isConnected) requestAnimationFrame(() => { sc.scrollLeft = 0; sc.dispatchEvent(new Event('scroll')); });
        loadPanel(root);
      }
    });
    return root;
  }

  const currentBlock = id => qa(CFG.root).find(e => e.dataset.itemId === id) || null;
  const cleanup = id => qa(CFG.root).forEach(e => { if (e.dataset.itemId !== id) e.remove(); });
  const removeAll = () => qa(CFG.root).forEach(e => e.remove());

  const sectionOf = node => node && (node.closest('.verticalSection, .detailVerticalSection, .emby-scroller-container') || node);

  /* Preferred spot: just above the native "More Like This" row, which places
   * the block under the native Collections row when there is one. */
  function findInsertTarget() {
    const sim = best(qa('#similarCollapsible'));
    if (sim && sim.parentNode) return { parent: sim.parentNode, anchor: sim, mode: 'before' };

    const col = q('#collectionsContent');
    const colSec = sectionOf(col);
    if (colSec && colSec.parentNode && visible(colSec)) return { parent: colSec.parentNode, anchor: colSec, mode: 'after' };

    const cast = best(qa('#castCollapsible'));
    if (cast && cast.parentNode) {
      let anchor = cast;
      const scenes = cast.parentNode.querySelector('#scenesCollapsible');
      if (scenes && visible(scenes)) anchor = scenes;
      return { parent: cast.parentNode, anchor: anchor, mode: 'after' };
    }

    const ph = best(qa('#peopleHeader'));
    const sec = sectionOf(ph);
    if (sec && sec.parentNode && visible(sec)) return { parent: sec.parentNode, anchor: sec, mode: 'after' };
    return null;
  }

  const wellPlaced = block => {
    const t = findInsertTarget();
    if (!t) return true;
    if (block.parentNode !== t.parent) return false;
    return t.mode === 'before' ? block.nextSibling === t.anchor : block.previousSibling === t.anchor;
  };

  function ensureMounted(itemId, sid, target) {
    cleanup(itemId);
    let block = currentBlock(itemId);
    if (block && block.dataset.serverId !== sid) { block.remove(); block = null; }
    if (!block) block = createBlock(itemId, sid);
    const ref = target.mode === 'before' ? target.anchor : target.anchor.nextSibling;
    if (ref !== block) target.parent.insertBefore(block, ref);
  }

  async function run() {
    const seq = ++runSeq;
    injectStyle();
    if (!isDetails()) { burst.forEach(clearTimeout); burst = []; removeAll(); return; }
    const itemId = itemIdFromUrl(); if (!itemId) return;
    let item;
    try { item = await fetchItem(itemId); } catch { return; }
    if (seq !== runSeq || !item) return;
    if (item.Type !== 'Movie' && item.Type !== 'Series') { removeAll(); return; }
    const sid = currentServerId(); if (!sid) return;
    const existing = currentBlock(itemId);
    if (existing && existing.dataset.serverId === sid && existing.isConnected && visible(existing) && wellPlaced(existing)) return;
    const started = Date.now(); let target = null;
    while (Date.now() - started < CFG.maxWaitMs) {
      if (seq !== runSeq) return;
      if (itemIdFromUrl() !== itemId) return;
      target = findInsertTarget();
      if (target) break;
      await sleep(100);
    }
    if (seq !== runSeq || !target) return;
    ensureMounted(itemId, sid, target);
  }

  let wdTimer = null, wdDeadline = 0, moTimer = null, moArmed = false;

  const healthCheck = () => {
    const id = itemIdFromUrl(); if (!id) return;
    if (id !== lastItemId) { lastItemId = id; wdDeadline = Date.now() + CFG.activeMs; scheduleBurst([0, 350, 900]); return; }
    const b = currentBlock(id);
    if (!b || !b.isConnected || !visible(b) || !wellPlaced(b)) scheduleRun(CFG.reapplyDelayMs);
  };

  const mo = new MutationObserver(() => {
    if (moTimer) return;
    moTimer = setTimeout(() => { moTimer = null; if (isDetails()) healthCheck(); }, CFG.moThrottleMs);
  });

  function disarm() {
    if (wdTimer) { clearInterval(wdTimer); wdTimer = null; }
    if (moArmed) { mo.disconnect(); moArmed = false; }
    if (moTimer) { clearTimeout(moTimer); moTimer = null; }
  }

  function arm() {
    wdDeadline = Date.now() + CFG.activeMs;
    if (!wdTimer) wdTimer = setInterval(() => {
      if (!isDetails() || Date.now() > wdDeadline) { disarm(); return; }
      healthCheck();
    }, CFG.watchDogMs);
    if (!moArmed && document.body) { mo.observe(document.body, { childList: true, subtree: true }); moArmed = true; }
  }

  function onNav() {
    if (isDetails()) { arm(); scheduleBurst([0, 350, 900]); }
    else { disarm(); scheduleRun(0); }
  }

  window.addEventListener('hashchange', onNav, true);
  window.addEventListener('popstate', onNav, true);
  document.addEventListener('viewshow', onNav, true);
  document.addEventListener('viewbeforeshow', onNav, true);

  onNav();
})();
