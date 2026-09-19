(function () {
  'use strict';

  /* ==========================================================================
   * CONFIGURATION - Jellyfin More Like This (TMDB) - Jellyfin 12
   * ==========================================================================
   * TMDB_API_KEY  (REQUIRED)
   *   Get a key by creating an account at https://www.themoviedb.org/settings/api
   *   Paste it between the quotes (v3 "API Key" or v4 "API Read Access Token").
   *   Example:  const TMDB_API_KEY = 'a1b2c3d4e5f6hd8876Dfg';
   */
  const TMDB_API_KEY = 'PASTE_YOUR_TMDB_API_KEY_HERE';

  const SETTINGS = {

    /* maxResults - 1 to 40
     * Maximum number of cards in the row (titles available in your library). */
    maxResults: 40,

    /* maxTmdbPages - 1 to 5
     * Extra TMDB recommendation pages fetched when fewer than maxResults
     * matches are found (20 candidates per page, one request per page). */
    maxTmdbPages: 5,

    /* collectionsFirst - true / false
     * Movies only: films of the same TMDB collection (saga) that are in your
     * library are placed first. One extra cached TMDB request per saga. */
    collectionsFirst: true,

    /* collectionMax - 1 to 20
     * How many saga films go first: next film, previous film, then outward. */
    collectionMax: 2,

    /* indexTtlHours - 1 to 168
     * Lifetime of the local library index (localStorage). A cheap count check
     * also rebuilds it early when the library changes. */
    indexTtlHours: 84,

    /* tmdbCacheHours - 1 to 168
     * Lifetime of cached TMDB answers (sessionStorage). */
    tmdbCacheHours: 84,

    /* pageSize - 200 to 5000
     * Items per request while building the library index. */
    pageSize: 1500,

    /* showRefresh - true / false
     * Refresh icon next to the title when open (clears this script's caches). */
    showRefresh: false,

    /* hideNativeSimilar - true / false
     * Hide Jellyfin's built-in "More Like This" row. */
    hideNativeSimilar: false,

    /* sectionTitle
     * Title of the row. */
    sectionTitle: 'Watch Next',

    /* strings
     * All texts, any language.
     * yearToPresent: series still running, {0} is the first year.
     * play / more: button tooltips, only used when they cannot be read from
     * Jellyfin's own cards on the page. */
    strings: {
      loadingIndex: 'Building library index',
      loadingRecs: 'Loading recommendations',
      noKey: 'TMDB API key missing. Open the script and set TMDB_API_KEY at the top.',
      noTmdbId: 'No TMDB ID found for this item.',
      noResults: 'No TMDB recommendation is available in your library.',
      error: 'Failed to load recommendations.',
      refresh: 'Refresh',
      yearToPresent: '{0} - Present',
      play: 'Play',
      more: 'More'
    }
  };
  /* ======================= END OF CONFIGURATION =========================== */

  if (window.__jfTmdbRecsLoaded) return;
  window.__jfTmdbRecsLoaded = true;

  const KEY = String(TMDB_API_KEY || '').trim();
  const keyOk = !!KEY && !/_HERE$/.test(KEY);
  const isBearer = KEY.indexOf('eyJ') === 0;
  const S = SETTINGS.strings;
  const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
  const MAXRES = clamp(SETTINGS.maxResults, 1, 40, 20);
  const MAXPAGES = clamp(SETTINGS.maxTmdbPages, 1, 5, 3);
  const COLMAX = Math.min(clamp(SETTINGS.collectionMax, 1, 20, 2), MAXRES);
  const IDXTTL = clamp(SETTINGS.indexTtlHours, 1, 168, 24) * 3600000;
  const TMDBTTL = clamp(SETTINGS.tmdbCacheHours, 1, 168, 24) * 3600000;
  const PAGE = clamp(SETTINGS.pageSize, 200, 5000, 1500);
  const ROOT = '[data-jf-tr-root="1"]';
  const STYLE_ID = 'jf-tr-style-v4';
  const BATCH = 20;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const sGet = k => { try { const o = JSON.parse(sessionStorage.getItem(k) || 'null'); if (!o || Date.now() > o.e) return null; return o.v; } catch { return null; } };
  const sSet = (k, v, ttl) => { try { sessionStorage.setItem(k, JSON.stringify({ v, e: Date.now() + (ttl || TMDBTTL) })); } catch {} };

  const creds = () => { try { const o = JSON.parse(localStorage.getItem('jellyfin_credentials') || 'null'); return (o && o.Servers) || []; } catch { return []; } };
  const token = () => {
    try { if (window.ApiClient && ApiClient.accessToken) { const t = ApiClient.accessToken(); if (t) return t; } } catch {}
    for (const s of creds()) if (s && s.AccessToken) return s.AccessToken;
    return null;
  };
  const userId = () => {
    try { if (window.ApiClient && ApiClient.getCurrentUserId) { const u = ApiClient.getCurrentUserId(); if (u) return u; } } catch {}
    for (const s of creds()) if (s && s.UserId) return s.UserId;
    return 'u';
  };
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

  const hashParam = name => { const u = new URL(location.href); const d = u.searchParams.get(name); if (d) return d; const m = (u.hash || '').match(new RegExp('[?&]' + name + '=([^&]+)')); return m ? decodeURIComponent(m[1]) : ''; };
  const currentServerId = () => {
    const u = hashParam('serverId'); if (u) return u;
    try { if (window.ApiClient && ApiClient.serverId) { const s = ApiClient.serverId(); if (s) return s; } } catch {}
    for (const s of creds()) if (s && s.Id) return s.Id;
    return '';
  };
  const isDetails = () => String(location.hash || '').includes('/details') && !!hashParam('id');

  const getPid = (pids, name) => {
    if (!pids) return null;
    const low = name.toLowerCase();
    for (const k of Object.keys(pids)) if (k.toLowerCase() === low) { const v = pids[k]; return (v === null || v === undefined || v === '') ? null : String(v); }
    return null;
  };

  async function fetchItem(id) {
    const k = 'jftr-item|' + id, c = sGet(k); if (c) return c;
    const r = await api('/Items?ids=' + encodeURIComponent(id) + '&userId=' + encodeURIComponent(userId()) + '&Fields=ProviderIds&EnableImages=false&EnableUserData=false&EnableTotalRecordCount=false');
    const v = (r.Items && r.Items[0]) || null;
    if (!v) throw new Error('item not found');
    sSet(k, v); return v;
  }

  const indexKey = type => ['jftr-idx-v1', location.host, userId(), type].join('|');
  const memIdx = {}, countChecked = {};
  function readIndex(type) {
    const k = indexKey(type);
    let o = memIdx[k];
    if (!o) {
      try { o = JSON.parse(localStorage.getItem(k) || 'null'); } catch { o = null; }
      if (!o || !o.m || typeof o.c !== 'number' || !o.t) return null;
      memIdx[k] = o;
    }
    return Date.now() - o.t > IDXTTL ? null : o;
  }
  const writeIndex = (type, val) => { const k = indexKey(type); memIdx[k] = val; try { localStorage.setItem(k, JSON.stringify(val)); } catch {} };

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
    for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
    const parts = await Promise.all(chunks.map(c => api('/Items?ids=' + c.map(encodeURIComponent).join(',') + '&userId=' + encodeURIComponent(userId()) + '&Fields=PrimaryImageAspectRatio&EnableImageTypes=Primary&ImageTypeLimit=1&EnableTotalRecordCount=false').catch(() => null)));
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
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = `
${ROOT}{--jf-tr-d:var(--ef12-ratingsGridOpen,.24s);display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 0fr;transition:grid-template-rows var(--jf-tr-d) ease}
${ROOT}.jf-tr-open{grid-template-rows:auto 1fr}
${ROOT}>.jf-tr-body{min-height:0;opacity:0;visibility:hidden;transition:opacity calc(var(--jf-tr-d)*.7) ease,visibility 0s linear var(--jf-tr-d)}
${ROOT}.jf-tr-open>.jf-tr-body{opacity:1;visibility:visible;transition:opacity calc(var(--jf-tr-d)*.7) ease,visibility 0s}
@starting-style{${ROOT}.jf-tr-open>.jf-tr-body{opacity:0}}
${ROOT}:not(.jf-tr-settled)>.jf-tr-body{overflow:hidden}
${ROOT}.jf-tr-settled>.jf-tr-body:not(.scrollX){overflow:visible}
${ROOT}>.emby-scrollbuttons{opacity:0;visibility:hidden;transition:opacity calc(var(--jf-tr-d)*.7) ease,visibility 0s linear var(--jf-tr-d)}
${ROOT}.jf-tr-open>.emby-scrollbuttons{opacity:1;visibility:visible;transition:opacity calc(var(--jf-tr-d)*.7) ease,visibility 0s}
${ROOT} .jf-tr-toggle{display:inline-flex;align-items:center;gap:.2em;max-width:100%;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
${ROOT} .jf-tr-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${ROOT} .jf-tr-chevron{font-size:1em;color:var(--dimTextColor,inherit);transition:transform var(--jf-tr-d) ease,color .15s ease}
${ROOT} .jf-tr-toggle:hover .jf-tr-chevron{color:var(--textColor,inherit)}
${ROOT}.jf-tr-open .jf-tr-chevron{transform:rotate(180deg)}
${ROOT} .jf-tr-refresh{font-size:.6em;margin:0 0 0 .4em;vertical-align:middle}
${ROOT}:not(.jf-tr-open) .jf-tr-refresh{display:none}
${ROOT}>.jf-tr-status{padding:.35em 0 .6em}
@media (prefers-reduced-motion:reduce){${ROOT},${ROOT}>.jf-tr-body,${ROOT}>.emby-scrollbuttons,${ROOT} .jf-tr-chevron{transition:none!important}}
${SETTINGS.hideNativeSimilar ? '#similarCollapsible{display:none!important}' : ''}
`;
    document.head.appendChild(s);
  }

  const layout = () => { const c = document.documentElement.classList; return c.contains('layout-mobile') ? 'mobile' : c.contains('layout-tv') ? 'tv' : 'desktop'; };

  function imageWidth() {
    let sw = window.innerWidth;
    const sh = window.innerHeight;
    if (window.screen && window.screen.availWidth - sw > 20) sw = Math.floor(sw / 100) * 100;
    const land = sw > sh * 1.3;
    const pct = land && sw >= 1700 ? 11.6 : land ? 15.5 : sw >= 1400 ? 15 : sw >= 1200 ? 18 : sw >= 760 ? 23 : sw >= 400 ? 31.5 : 42;
    return Math.round(sw / (100 / pct));
  }

  const nativeTitle = (sel, fallback) => { const e = document.querySelector(sel); return (e && e.getAttribute('title')) || fallback; };

  function colorIndex(str) {
    if (!str) return 1 + Math.floor(Math.random() * 5);
    const ci = Math.floor(str.length / 2);
    const ch = String(str.slice(ci, ci + 1).charCodeAt(0));
    let sum = 0;
    for (const c of ch) sum += parseInt(c, 10);
    return (parseInt(String(sum).slice(-1), 10) % 5) + 1;
  }

  function yearText(it) {
    const y = it.ProductionYear ? String(it.ProductionYear) : '';
    if (it.Type !== 'Series') return y;
    if (it.Status === 'Continuing') return String(S.yearToPresent || '{0}').replace('{0}', y);
    if (it.EndDate && it.ProductionYear) {
      const ey = String(new Date(it.EndDate).getFullYear());
      return y + (ey === y ? '' : ' - ' + ey);
    }
    return y;
  }

  function cardHtml(it, idx, sid, ctx) {
    const sidI = it.ServerId || sid;
    const ud = it.UserData || {};
    const url = '#/details?id=' + it.Id + '&serverId=' + sidI;
    const name = esc(it.Name || '');
    const icon = '<span class="cardImageIcon material-icons ' + (it.Type === 'Series' ? 'tv' : 'movie') + '" aria-hidden="true"></span>';
    const tag = it.ImageTags && it.ImageTags.Primary;
    const ar = it.PrimaryImageAspectRatio;
    let img = '', cover = false;
    if (tag) {
      const h = ar ? ctx.w / ar : ctx.w * 1.5;
      img = base() + '/Items/' + it.Id + '/Images/Primary?fillHeight=' + Math.ceil(h * ctx.dpr) + '&fillWidth=' + Math.ceil(ctx.w * ctx.dpr) + '&quality=96&tag=' + tag;
      cover = !!ar && Math.abs(ar - 2 / 3) / (2 / 3) <= 0.2;
    }
    const canPlay = !it.IsPlaceHolder && it.LocationType !== 'Virtual';

    let ind = '';
    if (ud.UnplayedItemCount) ind = '<div class="countIndicator indicator">' + (ud.UnplayedItemCount >= 100 ? '99+' : ud.UnplayedItemCount) + '</div>';
    else if ((ud.PlayedPercentage && ud.PlayedPercentage >= 100) || ud.Played) ind = '<div class="playedIndicator indicator"><span class="material-icons indicatorIcon check" aria-hidden="true"></span></div>';

    let prog = '';
    const pct = ud.PlayedPercentage;
    if (it.MediaType === 'Video' && pct && pct < 100) prog = '<div class="innerCardFooter fullInnerCardFooter innerCardFooterClear"><div class="itemProgressBar"><div class="itemProgressBarForeground" style="width:' + pct + '%;"></div></div></div>';

    const cic = 'cardImageContainer' + (cover ? ' coveredImage' : '') + (img ? '' : ' defaultCardBackground defaultCardBackground' + colorIndex(it.Name)) + ' cardContent itemAction';
    let h = '<div class="cardBox cardBox-bottompadded"><div class="cardScalable"><div class="cardPadder cardPadder-overflowPortrait">' + (img ? icon : '') + '</div>';
    h += img
      ? '<a href="' + url + '" data-action="link" class="' + cic + ' lazy non-blurhashable" data-src="' + esc(img) + '" aria-label="' + name + '" role="img">'
      : '<a href="' + url + '" data-action="link" class="' + cic + '" aria-label="' + name + '" role="img">';
    if (ind) h += '<div class="cardIndicators">' + ind + '</div>';
    if (!img) h += icon;
    h += prog + '</a>';

    if (ctx.layout === 'mobile') {
      if (canPlay) h += '<button is="paper-icon-button-light" class="cardOverlayButton cardOverlayButton-br itemAction" data-action="play" title="' + esc(ctx.play) + '"><span class="material-icons cardOverlayButtonIcon play_arrow" aria-hidden="true"></span></button>';
    } else if (ctx.layout === 'desktop') {
      const bc = 'cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light';
      h += '<div class="cardOverlayContainer itemAction" data-action="link">';
      if (canPlay) h += '<button is="paper-icon-button-light" class="' + bc + ' cardOverlayFab-primary" data-action="resume" title="' + esc(ctx.play) + '"><span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover play_arrow" aria-hidden="true"></span></button>';
      h += '<div class="cardOverlayButton-br flex">';
      h += '<button is="emby-playstatebutton" type="button" data-action="none" class="' + bc + '" data-id="' + it.Id + '" data-serverid="' + sidI + '" data-itemtype="' + it.Type + '" data-played="' + ud.Played + '"><span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover check" aria-hidden="true"></span></button>';
      if (it.UserData) h += '<button is="emby-ratingbutton" type="button" data-action="none" class="' + bc + '" data-id="' + it.Id + '" data-serverid="' + sidI + '" data-itemtype="' + it.Type + '" data-likes="' + (ud.Likes == null ? '' : ud.Likes) + '" data-isfavorite="' + ud.IsFavorite + '"><span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover favorite" aria-hidden="true"></span></button>';
      h += '<button is="paper-icon-button-light" class="' + bc + '" data-action="menu" title="' + esc(ctx.more) + '"><span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover more_vert" aria-hidden="true"></span></button>';
      h += '</div></div>';
    }
    h += '</div>';

    const lines = [
      ctx.layout === 'tv' ? name : '<a href="' + url + '" data-id="' + it.Id + '" data-serverid="' + sidI + '" data-type="' + it.Type + '" data-mediatype="undefined" data-channelid="undefined" data-isfolder="' + it.IsFolder + '" class="itemAction textActionButton" title="' + name + '" data-action="link">' + name + '</a>',
      esc(yearText(it))
    ];
    let valid = 0;
    for (const t of lines) {
      if (!t) continue;
      h += '<div class="cardText cardTextCentered ' + (valid ? 'cardText-secondary' : 'cardText-first') + '"><bdi>' + t + '</bdi></div>';
      valid++;
    }
    while (valid < lines.length) { h += '<div class="cardText cardTextCentered">&nbsp;</div>'; valid++; }
    h += '</div>';

    const prefix = (it.SortName || it.Name || '').substring(0, 3).toUpperCase();
    const attrs = ' data-index="' + idx + '" data-isfolder="' + (it.IsFolder || false) + '" data-serverid="' + sidI + '" data-id="' + it.Id + '" data-type="' + it.Type + '"' +
      (it.MediaType ? ' data-mediatype="' + it.MediaType + '"' : '') +
      (it.ChannelId ? ' data-channelid="' + it.ChannelId + '"' : '') +
      (ud.PlaybackPositionTicks ? ' data-positionticks="' + ud.PlaybackPositionTicks + '"' : '') +
      (it.EndDate ? ' data-enddate="' + it.EndDate + '"' : '') +
      ' data-prefix="' + esc(prefix) + '"';
    return '<div' + attrs + ' class="card overflowPortraitCard' + (ctx.layout === 'desktop' ? ' card-hoverable' : '') + ' card-withuserdata">' + h + '</div>';
  }

  function cardsHtml(items, sid) {
    const ctx = {
      layout: layout(),
      w: imageWidth(),
      dpr: window.devicePixelRatio || 1,
      play: nativeTitle('.cardOverlayFab-primary[title], .cardOverlayButton[data-action="play"][title]', S.play),
      more: nativeTitle('.cardOverlayButton[data-action="menu"][title]', S.more)
    };
    return items.map((it, i) => cardHtml(it, i, sid, ctx)).join('');
  }

  function fillImage(el) {
    const url = el.getAttribute('data-src'); if (!url) return;
    const pre = new Image();
    el.classList.add('lazy-hidden');
    const onEnd = () => {
      el.removeEventListener('animationend', onEnd);
      requestAnimationFrame(() => { const p = el.parentNode && el.parentNode.querySelector('.cardPadder'); if (p) p.classList.add('lazy-hidden-children'); });
    };
    el.addEventListener('animationend', onEnd);
    pre.addEventListener('load', () => requestAnimationFrame(() => {
      el.style.backgroundImage = "url('" + url + "')";
      el.removeAttribute('data-src');
      el.classList.add('lazy-image-fadein-fast');
      el.classList.remove('lazy-hidden');
    }));
    pre.src = url;
  }

  function lazyLoad(root) {
    if (root._jfTrIo) { root._jfTrIo.disconnect(); root._jfTrIo = null; }
    const els = qa('.cardImageContainer.lazy[data-src]', root);
    if (!els.length) return;
    let left = els.length;
    const io = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        fillImage(en.target);
        if (--left <= 0) { io.disconnect(); if (root._jfTrIo === io) root._jfTrIo = null; }
      }
    }, { rootMargin: '50%', threshold: 0 });
    root._jfTrIo = io;
    els.forEach(e => io.observe(e));
  }

  function clearBody(root) {
    if (root._jfTrIo) { root._jfTrIo.disconnect(); root._jfTrIo = null; }
    qa(':scope > .jf-tr-body, :scope > .emby-scrollbuttons', root).forEach(e => e.remove());
  }

  function setStatus(root, text) {
    const cur = root.querySelector(':scope > .jf-tr-status');
    if (cur) { cur.textContent = text; root.dataset.ids = ''; return; }
    clearBody(root);
    const d = document.createElement('div');
    d.className = 'jf-tr-body jf-tr-status secondaryText';
    d.textContent = text;
    root.appendChild(d);
    root.dataset.ids = '';
  }

  function renderRow(root, items, sid) {
    clearBody(root);
    root.insertAdjacentHTML('beforeend',
      '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding jf-tr-body" data-centerfocus="true">' +
        '<div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer jf-tr-items">' + cardsHtml(items, sid) + '</div>' +
      '</div>');
    lazyLoad(root);
  }

  async function nativeSimilarIds(root) {
    if (SETTINGS.hideNativeSimilar) return [];
    const page = root.closest('.itemDetailPage') || document;
    const sim = page.querySelector('#similarCollapsible');
    for (let t = 0; t < 15 && sim && !sim.classList.contains('hide') && !sim.querySelector('.card[data-id]'); t++) await sleep(100);
    if (!sim || sim.classList.contains('hide')) return [];
    return qa('.card[data-id]', sim).map(c => c.getAttribute('data-id'));
  }

  function clearCaches(root) {
    const type = root.dataset.type || '';
    if (type) { delete memIdx[indexKey(type)]; delete countChecked[indexKey(type)]; }
    try { if (type) localStorage.removeItem(indexKey(type)); } catch {}
    try {
      const rm = [];
      for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.indexOf('jftr-') === 0) rm.push(k); }
      rm.forEach(k => sessionStorage.removeItem(k));
    } catch {}
  }

  async function loadPanel(root, opts) {
    opts = opts || {};
    if (root.dataset.loading === '1') return;
    if (root.dataset.loaded === '1' && !opts.force) return;
    root.dataset.loading = '1';
    const quiet = !!opts.quiet;
    const ELL = '\u2026';
    try {
      if (!keyOk) { setStatus(root, S.noKey); root.dataset.loaded = '1'; return; }
      const itemId = root.dataset.itemId, sid = root.dataset.serverId || '';
      if (!quiet) setStatus(root, S.loadingRecs + ELL);

      const item = await fetchItem(itemId);
      if (!root.isConnected) return;
      const type = item.Type === 'Series' ? 'Series' : 'Movie';
      const kind = type === 'Series' ? 'tv' : 'movie';
      root.dataset.type = type;

      const tmdbId = await resolveTmdbId(item, kind);
      if (!tmdbId) { setStatus(root, S.noTmdbId); root.dataset.loaded = '1'; return; }

      const cached = opts.index || readIndex(type);
      const fromCache = !opts.index && !!cached;
      if (!cached) setStatus(root, S.loadingIndex + ELL);
      const idxP = cached ? Promise.resolve(cached) : buildIndex(type, n => { if (root.isConnected) setStatus(root, S.loadingIndex + ELL + ' (' + n + ')'); });
      const mainP = tmdbMain(kind, tmdbId);
      const nativeP = nativeSimilarIds(root);
      idxP.catch(() => {}); mainP.catch(() => {});

      const main = await mainP;
      const colP = kind === 'movie' && SETTINGS.collectionsFirst && main.col != null ? tmdbCol(main.col).catch(() => null) : null;
      const idx = await idxP;
      if (!root.isConnected) return;
      if (!quiet && !cached) setStatus(root, S.loadingRecs + ELL);

      const cands = newCands();
      pushCands(cands, main.rec);
      pushCands(cands, main.sim);

      const colJf = [];
      const col = colP ? await colP : null;
      if (col) {
        const seen = new Set([itemId]);
        for (const cid of collectionOrder(col, tmdbId)) {
          const jf = idx.m[String(cid)];
          if (jf && !seen.has(jf)) { seen.add(jf); cands.seen.add(cid); colJf.push(jf); if (colJf.length >= COLMAX) break; }
        }
      }

      const baseSeen = [itemId].concat(colJf, await nativeP);
      let rec = matchRecs(cands, idx.m, baseSeen);
      const lastPage = Math.min(main.tp || 1, MAXPAGES);
      for (let p = 2; colJf.length + rec.length < MAXRES && p <= lastPage; p++) {
        let extra = null;
        try { extra = await tmdbRecPage(kind, tmdbId, p); } catch { break; }
        pushCands(cands, extra);
        rec = matchRecs(cands, idx.m, baseSeen);
      }
      const matched = colJf.concat(rec).slice(0, MAXRES);
      const key = matched.join(',');

      if (!root.isConnected) return;
      if (quiet && key === root.dataset.ids) { root.dataset.loaded = '1'; return; }
      if (!matched.length) setStatus(root, S.noResults);
      else {
        const items = await batchFetch(matched, type);
        if (!root.isConnected) return;
        if (!items.length) setStatus(root, S.noResults);
        else { renderRow(root, items, sid); root.dataset.ids = key; }
      }
      root.dataset.loaded = '1';

      const ck = indexKey(type);
      if (fromCache && !opts.noRevalidate && Date.now() - (countChecked[ck] || 0) > 600000) {
        countChecked[ck] = Date.now();
        (async () => {
          try {
            const cnt = await getCount(type);
            if (cnt === null || cnt === idx.c) return;
            const fresh = await buildIndex(type, null);
            if (!root.isConnected) return;
            root.dataset.loaded = '0';
            loadPanel(root, { force: true, index: fresh, noRevalidate: true, quiet: true });
          } catch {}
        })();
      }
    } catch (e) {
      console.warn('[JF-TR] load failed', e);
      if (root.isConnected) setStatus(root, S.error + (e && e.message ? ' (' + e.message + ')' : ''));
      root.dataset.loaded = '0';
    } finally {
      root.dataset.loading = '0';
    }
  }

  function setOpen(root, open) {
    const t = root.querySelector('.jf-tr-toggle');
    if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
    clearTimeout(root._jfTrT);
    if (!open) { root.classList.remove('jf-tr-settled', 'jf-tr-open'); return; }
    root.classList.add('jf-tr-open');
    const sc = root.querySelector(':scope > .emby-scroller');
    if (sc && sc.scrollToPosition) { try { sc.scrollToPosition(0, true); } catch {} }
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    root._jfTrT = setTimeout(() => { if (root.classList.contains('jf-tr-open')) root.classList.add('jf-tr-settled'); }, reduce ? 0 : 320);
    loadPanel(root);
  }

  function createBlock(itemId, sid) {
    const root = document.createElement('div');
    root.className = 'verticalSection detailVerticalSection verticalSection-extrabottompadding';
    root.setAttribute('data-jf-tr-root', '1');
    root.dataset.itemId = itemId; root.dataset.serverId = sid || '';
    root.dataset.loaded = '0'; root.dataset.loading = '0';
    root.innerHTML =
      '<h2 class="sectionTitle sectionTitle-cards padded-right">' +
        '<button type="button" class="jf-tr-toggle" aria-expanded="false">' +
          '<span class="jf-tr-label"></span>' +
          '<span class="material-icons expand_more jf-tr-chevron" aria-hidden="true"></span>' +
        '</button>' +
        (SETTINGS.showRefresh ? '<button type="button" is="paper-icon-button-light" class="paper-icon-button-light jf-tr-refresh"><span class="material-icons refresh" aria-hidden="true"></span></button>' : '') +
      '</h2>';
    root.querySelector('.jf-tr-label').textContent = SETTINGS.sectionTitle;
    root.querySelector('.jf-tr-toggle').addEventListener('click', () => setOpen(root, !root.classList.contains('jf-tr-open')));
    const rf = root.querySelector('.jf-tr-refresh');
    if (rf) {
      rf.title = S.refresh; rf.setAttribute('aria-label', S.refresh);
      rf.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearCaches(root); root.dataset.loaded = '0'; loadPanel(root, { force: true }); });
    }
    return root;
  }

  const pending = new WeakMap();

  async function mount(page, id) {
    if (!page || !page.isConnected || !id) return;
    const existing = page.querySelector(ROOT);
    if (existing && existing.dataset.itemId === id) return;
    if (pending.get(page) === id) return;
    pending.set(page, id);
    try {
      const item = await fetchItem(id);
      if (!item || (item.Type !== 'Movie' && item.Type !== 'Series') || !page.isConnected) return;
      const again = page.querySelector(ROOT);
      if (again && again.dataset.itemId === id) return;
      if (again) again.remove();
      const sim = page.querySelector('#similarCollapsible');
      const parent = sim ? sim.parentNode : page.querySelector('.detailPageSecondaryContainer');
      if (!parent) return;
      injectStyle();
      parent.insertBefore(createBlock(id, currentServerId()), sim || null);
    } catch {} finally {
      if (pending.get(page) === id) pending.delete(page);
    }
  }

  const activePage = () => qa('.itemDetailPage').find(p => !p.classList.contains('hide') && p.getClientRects().length) || null;

  document.addEventListener('viewshow', e => {
    const p = e.target;
    if (!p || !p.classList || !p.classList.contains('itemDetailPage')) return;
    const params = (e.detail && e.detail.params) || {};
    mount(p, params.id || hashParam('id'));
  }, true);

  (async () => {
    for (let t = 0; t < 50 && isDetails(); t++) {
      const p = activePage();
      if (p && p.querySelector('.detailPageSecondaryContainer')) { mount(p, hashParam('id')); return; }
      await sleep(100);
    }
  })();
})();
