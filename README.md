# Jellyfin More Like This (TMDB)

A userscript for the Jellyfin web UI that adds a collapsible **More Like This** section to movie and series detail pages. Suggestions come from TMDB (`recommendations`, `similar`, and `collections`) and are filtered so that **only titles already present in your Jellyfin library** are shown. Movies return movies only; series return series only.

This is a "similar titles" row attached to a specific film or show, not a personalized home-screen recommender.

Injected with the [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) plugin. No server plugin, no external database, nothing server-side.

## Features

- Merges TMDB `recommendations` (priority) and `similar` (complement), deduplicated, TMDB relevance order preserved
- For movies in a TMDB collection (saga), films from that collection present in your library are placed first: next film, then previous film, spiraling outward (configurable, on/off)
- Matches by **TMDB ID only**, never by title, so it works with any metadata language
- Shows up to 20 items available in your library; fetches additional TMDB pages when the first pass yields fewer matches
- Falls back to TMDB `/find` (IMDb, then TVDb) when an item has no TMDB ID in its metadata
- Renders Jellyfin-native card markup with Jellyfin posters and native hover behavior (title underlines on hover); clicking opens the item detail page; compatible with hover tooltip scripts such as HoverDetails
- Horizontal row with Jellyfin-style scroll arrows, always visible and greyed out at the ends (hidden on touch screens, where finger swiping works natively); the row always opens at the first item
- Collapsed by default; nothing runs (no API call, no library scan) until the section is expanded, and it stays collapsed when navigating to another item
- Library index and TMDB responses cached (24 h) with a cheap revalidation check and automatic self-repair of stale entries
- Runs per user with that user's library access rights

## Requirements

- Jellyfin 10.11.x (developed and tested on 10.11.11; built on stable REST endpoints with 12.0 in mind)
- [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) plugin
- A free TMDB API key (get a key by creating an account at https://www.themoviedb.org/settings/api)

## Transparency

- Heavily LLM-assisted
- Human involvement was required to optimize the process, despite JavaScript repeatedly trying to hurt the human.

## Installation

1. Create a TMDB API key at <https://www.themoviedb.org/settings/api>. Both formats work: the short v3 "API Key" or the long v4 "API Read Access Token" (starts with `eyJ`). The script detects which one you pasted.
2. In Jellyfin, open the JavaScript Injector plugin and add a new script.
3. Paste the full content of `jellyfin-tmdb-recommendations.js`.
4. At the top of the script, in the clearly marked `CONFIGURATION` block, replace the placeholder with your key:

   ```js
   const TMDB_API_KEY = 'your-key-here';
   ```

5. Save and reload the web UI. Open any movie or series detail page and expand the "More Like This" bar.

If the key is missing or left as the placeholder, the section displays an explicit message instead of failing silently.

Note: your API key lives only inside your injected script on your own server. If you share or publish a modified copy of the script, remove your key first.

## Configuration

All options sit in the `SETTINGS` object at the top of the script.

| Option | Default | Description |
| --- | --- | --- |
| `maxResults` | `20` | 1-40. Maximum number of cards displayed (items available in your library) |
| `maxTmdbPages` | `3` | 1-5. Maximum TMDB recommendation pages fetched when fewer matches are found |
| `collectionsFirst` | `true` | Movies only. Place available films from the same TMDB collection (saga) at the head of the row |
| `collectionMax` | `2` | 1-20. Maximum collection films placed first. Order spirals outward from the current movie: next, previous, next+1, previous-1 |
| `showRefresh` | `false` | Show a refresh icon in the open panel to clear caches and reload |
| `indexTtlHours` | `24` | 1-168. Lifetime of the local library index (localStorage) |
| `tmdbCacheHours` | `24` | 1-168. Lifetime of cached TMDB responses (sessionStorage) |
| `pageSize` | `1500` | 200-5000. Items per request while building the library index |
| `sectionTitle` | `More Like This` | Section title shown in the UI |
| `strings` | see script | All UI text, override for localization |

## Technical

The script is idle until the section is expanded. On activation it reads the current item's TMDB ID from Jellyfin `ProviderIds` (with a TMDB `/find` fallback through IMDb or TVDb when missing), then makes a single TMDB request using `append_to_response=recommendations,similar`. For movies that belong to a TMDB collection, the collection identity comes back for free in that same response, and one additional cached request to the collection endpoint fetches the saga's films so the available ones can be placed first (the current film is excluded, and duplicates against the regular suggestions are removed). Availability is resolved against a small local index of the library: paginated `/Items` requests limited to `Fields=ProviderIds` (images and user data disabled, episodes never fetched) build a `TMDB ID -> Jellyfin ID` map per media type, stored in localStorage for 24 hours, per server and per user. On later activations a one-row `TotalRecordCount` check revalidates the index in the background and rebuilds it silently if the library changed; Jellyfin IDs that no longer resolve are purged automatically. Matched candidates are fetched in one batched `/Items?ids=` request and rendered with Jellyfin's native card markup, so themes and hover scripts treat them like built-in cards. Because matching uses TMDB IDs exclusively, results are independent of the metadata language configured in Jellyfin.

## Performance

Reference numbers measured on Jellyfin 10.11.11 (QNAP NAS over LAN, 2 849 movies and 496 series): first index build takes about 1.2 s for movies and 0.25 s for series, both shown behind a loading state. Every later activation costs one TMDB request plus one batched Jellyfin request, around 200-300 ms in total (movies in a collection add one more cached request the first time). Zero background activity while the section is collapsed.

## Limitations

- Library items without a TMDB ID in their metadata cannot appear as suggestions (they are invisible to the ID matching)
- Items added to the library today appear after the background revalidation detects a count change, after the 24 h cache expiry, or after pressing Refresh in the panel
- The section intentionally does not reload automatically when navigating between items; expand it again on the new page

## Need Help?
- Don't hesitate to open an issue
- **DM me** https://forum.jellyfin.org/u-damocles
- GitHub [**Damocles-fr**](https://github.com/Damocles-fr)
