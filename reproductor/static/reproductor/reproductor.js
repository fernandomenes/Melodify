/* ==========================================================================
   Reproductor central (cola + audio) con Discover Weekly, “Music that I Love”
   y playlist Historial
   ========================================================================== */

const COUNT_AT_SECONDS = 5;

// ---------------------------- Estado interno -------------------------------
let _state = {
  queue: [],
  index: -1,
  audio: null,
  boundItems: new Set(),
  guardHooked: false,
  moView: null,
  moList: null,
  countedForKey: null,
};


// ---------------------------- Helpers DOM / utils --------------------------
const q  = (s, r=document)=>r.querySelector(s);
const qa = (s, r=document)=>Array.from(r.querySelectorAll(s));
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

function slugify(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'').trim();
}
function ensureAbs(u){
  if(!u) return "";
  const s=String(u).trim(); if(!s) return "";
  if(/^https?:\/\//i.test(s)||s.startsWith("/")) return s;
  return "/"+s.replace(/^\/+/,"");
}
function absHref(u){ try{ return u?new URL(u,location.origin).href:""; }catch{ return ""; } }
function fmtTime(t){
  if(!Number.isFinite(t)) return "0:00";
  t=Math.max(0,Math.floor(t));
  const m=Math.floor(t/60), s=String(t%60).padStart(2,"0");
  return `${m}:${s}`;
}
function fire(name, detail){ document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true })); }
function _pad2(n){ return String(n).padStart(2,'0'); }
function fireBar(){ fire("melodify:bar:shouldShow", {}); }
const pickFirst = (...c) => c.find(v => typeof v === 'string' && v.trim().length) || "";

// --- Toast de plataforma (usa el global si existe) ---
function _toast(msg) {
  if (typeof window.__melodifyShowLikeToast === 'function') {
    window.__melodifyShowLikeToast(String(msg || ''));
    return;
  }
  let t = document.getElementById('mdf-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'mdf-toast';
    t.style.cssText = `
      position:fixed; left:50%; bottom:28px; transform:translateX(-50%);
      background:#222; color:#eee; border:1px solid #333; border-radius:10px;
      padding:10px 14px; z-index:99999; font-size:14px; opacity:0; transition:.18s;
    `;
    document.body.appendChild(t);
  }
  t.textContent = String(msg || '');
  t.style.opacity = '1';
  clearTimeout(_toast._t);
  _toast._t = setTimeout(() => { t.style.opacity = '0'; }, 1500);
}

function fmtHistoryLabel(ts){
  if (!ts) return '';
  let d;
  if (ts instanceof Date) d = ts;
  else {
    d = new Date(ts);
    if (isNaN(d.getTime())) return '';
  }
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate()-1);
  const isYesterday = d.toDateString() === y.toDateString();
  const hh = _pad2(d.getHours());
  const mm = _pad2(d.getMinutes());
  if (sameDay)    return `hoy a las ${hh}:${mm}`;
  if (isYesterday) return `ayer a las ${hh}:${mm}`;
  return `${_pad2(d.getDate())}/${_pad2(d.getMonth()+1)}/${d.getFullYear()} ${hh}:${mm}`;
}

// --- Helper: buscar canción por id en el modelo/UI ---
function _findSongByIdAnywhere(id) {
  const idStr = String(id || '');
  if (!idStr) return null;

  // 1) Modelo en memoria
  const P = Array.isArray(window._playlists) ? window._playlists : [];
  for (const pl of P) {
    for (const s of (pl?.songs || [])) {
      if (s?.id != null && String(s.id) === idStr) return s;
    }
  }
  // 2) DOM actual (columna izquierda)
  const row = document.querySelector(`.song-item[data-id="${CSS.escape(idStr)}"]`);
  if (row) {
    return normalizeSong({
      id: idStr,
      title: row.getAttribute('data-title'),
      artist_display_name: row.getAttribute('data-author'),
      audioUrl: row.getAttribute('data-audio-url'),
      coverUrl: row.querySelector('.song-cover')?.getAttribute('src') || '',
      genre: row.getAttribute('data-genre') || '',
    });
  }
  return null;
}

// --- Fallback directo al backend para agregar canción ---
async function _fallbackAddSongToPlaylist(backendId, songId) {
  const pid = String(backendId || '').trim();
  const sid = String(songId    || '').trim();
  if (!pid || !sid) throw new Error('Playlist o canción inválida.');

  // 1) Obtener posición (len+1)
  let position = 1;
  try {
    const r = await fetch(`/playlist/${encodeURIComponent(pid)}/songs/`, {
      credentials: 'same-origin', cache: 'no-store', headers: {'X-Requested-With':'fetch'}
    });
    if (r.ok) {
      const j = await r.json();
      const arr = Array.isArray(j?.songs) ? j.songs : [];
      position = (arr.length || 0) + 1;
    }
  } catch {}

  // 2) POST a /playlist/addsong/
  const csrftoken = getCookie('csrftoken') || '';
  const res = await fetch(`/playlist/addsong/`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
      ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}),
    },
    body: JSON.stringify({ playlist_id: Number(pid) || pid, song_id: Number(sid) || sid, position })
  });

  if (!res.ok) {
    let err = '';
    try { err = (await res.json())?.error || ''; } catch {}
    throw new Error(err || `HTTP ${res.status}`);
  }

  // 3) Actualizar modelo local + badge
  try {
    const song = _findSongByIdAnywhere(sid);
    const plistId = `pl:${pid}`;
    const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
    const idx = pls.findIndex(p => String(p.id) === plistId);
    if (idx >= 0) {
      const songs = Array.isArray(pls[idx].songs) ? pls[idx].songs.slice() : [];
      if (song) songs.push(song);
      pls[idx] = { ...pls[idx], songs };
      window._playlists = pls;

      // Badge en sidebar
      const li = document.querySelector(`#rep-playlists li[data-pl="${CSS.escape(plistId)}"]`);
      if (li) {
        const badge = li.querySelector('.rep-badge');
        if (badge) badge.textContent = String((songs || []).length);
      }
    }
  } catch {}

  document.dispatchEvent(new CustomEvent('melodify:playlists:changed'));
  _toast('Canción agregada a la playlist.');
}

// ---------------------------- Usuario y namespace --------------------------
function _detectUserKey(){
  const mc = document.getElementById('main-content');
  const fromData = mc?.dataset?.userId || mc?.dataset?.user || mc?.dataset?.username;
  const fromMeta = document.querySelector('meta[name="user-id"]')?.content
                || document.querySelector('meta[name="username"]')?.content;
  const raw = String(fromData || fromMeta || '').trim() || 'anon';
  return slugify(raw) || 'anon';
}
const _USER_KEY = _detectUserKey();
const _NS = (base)=> `mdf.${_USER_KEY}.${base}`;

// ---------------------------- Vistas / roles -------------------------------
function isTop10Active(){ return !!q('#rep-playlists li.active[data-pl="pl:top10"]'); }
function _currentSong(){ return _state.queue[_state.index] || null; }

function isArtistUser(){
  const main = document.getElementById('main-content');
  const norm = (s) => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const role = norm(main?.dataset.role || '');
  if (role.includes('artista')) return true;
  const v = (main?.dataset.isArtist ?? window.__IS_ARTIST__ ?? 
             document.querySelector('meta[name="is-artist"]')?.content) ?? '';
  const s = norm(v);
  return s === '1' || s === 'true';
}

function isPlayableView(){
  const PLAYABLE_VIEWS = new Set(["reproductor", "playlist", "home"]);
  const m=document.getElementById("main-content");
  const v=(m?.dataset.view||m?.dataset.initialView||"").trim();
  return PLAYABLE_VIEWS.has(v);
}
function getCurrentView(){
  const m=document.getElementById("main-content");
  return (m?.dataset.view||m?.dataset.initialView||"").trim();
}

// ---------------------------- Fecha / Día / Semana -------------------------
function todayStamp(){ const d=new Date(); return `${d.getFullYear()}${_pad2(d.getMonth()+1)}${_pad2(d.getDate())}`; }
function yesterdayStamp(){ const d=new Date(); d.setDate(d.getDate()-1); return `${d.getFullYear()}${_pad2(d.getMonth()+1)}${_pad2(d.getDate())}`; }
function _weekKey(d=new Date()){
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(),0,4));
  const week = 1 + Math.round(((date - firstThursday)/86400000 - 3 + ((firstThursday.getUTCDay()+6)%7)) / 7);
  const year = date.getUTCFullYear();
  return `${year}-W${String(week).padStart(2,'0')}`;
}

// ---------------------------- Storage JSON ---------------------------------
function _loadJSON(key, fallback){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; }catch{ return fallback; } }
function _saveJSON(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch{} }

// ---------------------------- Prefijos NAMESPACE ---------------------------
const PLAYS_PREFIX   = ()=> _NS(`plays.`);
const ORDER_PREFIX   = ()=> _NS(`top10.order.`);
const DISC_PREFIX    = ()=> _NS(`discover.`);
const HISTORY_KEY    = ()=> _NS('history');

// ---------------------------- Plays diarios --------------------------------
function _loadDailyPlays(stamp){ return _loadJSON(PLAYS_PREFIX()+stamp, {}); }
function _saveDailyPlays(stamp, obj){ _saveJSON(PLAYS_PREFIX()+stamp, obj||{}); }

function _recentStamps(nDays=7){
  const out=[]; const d=new Date();
  for(let i=1;i<=nDays;i++){ const x=new Date(d); x.setDate(d.getDate()-i);
    out.push(`${x.getFullYear()}${_pad2(x.getMonth()+1)}${_pad2(x.getDate())}`);
  }
  return out;
}
function _sumRecentPlaysByKey(nDays=7){
  const stamps=_recentStamps(nDays);
  const agg={};
  for(const s of stamps){
    const db=_loadDailyPlays(s);
    for(const k in db){ agg[k]=(agg[k]||0)+ (db[k]||0); }
  }
  return agg;
}

function _recentStampsInclToday(nDays=7){
  const out=[]; const d=new Date();
  for(let i=0;i<nDays;i++){
    const x=new Date(d); x.setDate(d.getDate()-i);
    out.push(`${x.getFullYear()}${_pad2(x.getMonth()+1)}${_pad2(x.getDate())}`);
  }
  return out;
}
function _sumRecentPlaysByKeyInclToday(nDays=7){
  const stamps=_recentStampsInclToday(nDays);
  const agg={};
  for(const s of stamps){
    const db=_loadDailyPlays(s);
    for(const k in db){ agg[k]=(agg[k]||0)+ (db[k]||0); }
  }
  return agg;
}

function getTodayCount(song){
  const k=_songKey(song); if(!k) return 0;
  const db=_loadDailyPlays(todayStamp());
  return Number(db[k]||0);
}
function getWeekCount(song, days=7, includeToday=true){
  const k=_songKey(song); if(!k) return 0;
  const stamps = includeToday ? _recentStampsInclToday(days) : _recentStamps(days);
  let sum=0;
  for(const s of stamps){ const db=_loadDailyPlays(s); if(db) sum+=(db[k]||0); }
  return sum;
}

function _discoverKey(){ return DISC_PREFIX() + _weekKey(); }
function _saveDiscover(arr){ _saveJSON(_discoverKey(), arr||[]); }
function _loadDiscover(){ return _loadJSON(_discoverKey(), []); }

// ---------------------------- Normalización / keys -------------------------
function _songKey(song){
  if (song && song._k) return song._k;
  const byId = song?.id ? `id:${song.id}` : "";
  const byUrl = song?.audioUrl ? `u:${absHref(ensureAbs(song.audioUrl))}` : "";
  return byId || byUrl || "";
}
function _isSongLiked(song) {
  const key = _songKey(song);
  if (!key) return false;
  const likes = Array.isArray(window._likes) ? window._likes : [];
  return likes.some(s => _songKey(s) === key);
}

function normalizeSong(song){
  const audio = pickFirst(
    song.audioUrl, song.audio_url, song.audio,
    song.file, song.file_url, song.filePath, song.file_path,
    song.audioFile, song.audio_file, song.audioPath, song.audio_path,
    song.src, song.source, song.stream_url, song.streamUrl,
    song?.audio?.url, song?.file?.url, song?.media?.audio, song?.media?.url
  );
  if (!audio) return null;

  const cover  = pickFirst(
    song.coverUrl, song.cover_url, song.cover, song.thumbnail, song.thumb,
    song?.cover?.url, song?.image?.url, song?.media?.cover
  ) || "/static/inicio_sesion/img_song.png";

  const title  = pickFirst(song.title, song.name) || "—";
  const author = pickFirst(song.artist_display_name, song.artist, song.author, song.singer) || "—";
  const genre  = pickFirst(song.genre, song.genero, song.gen) || "";

  return { id: song.id ?? null, title, author, coverUrl: cover, audioUrl: audio, genre };
}
function _abs(u){ try{ return u? new URL(u, location.origin).href : ""; }catch{ return u||""; } }
function _dedup(arr, keyFn){
  const seen=new Set(), out=[];
  for(const it of (Array.isArray(arr)?arr:[])){
    const k=keyFn(it); if(!k||seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}
function _flattenUniqueSongs(playlists){
  const all=(Array.isArray(playlists)?playlists:[]).flatMap(pl=>Array.isArray(pl.songs)?pl.songs:[]);
  return _dedup(all, s => _songKey(s) || _abs(s.audioUrl) || `${(s.title||'').toLowerCase()}::${(s.author||'').toLowerCase()}`);
}

// ---------------------------- Historial de reproducción --------------------
function _loadHistoryEntries(){
  const arr = _loadJSON(HISTORY_KEY(), []);
  let entries = Array.isArray(arr) ? arr : [];
  let mutated = false;

  try {
    const pls = Array.isArray(window._playlists) ? window._playlists : [];
    if (pls.length) {
      entries = entries.map(e => {
        if (!e || !e.song) return e;

        const fixedSong = _relinkHistorySongWithId(e.song, e.key || _songKey(e.song));
        if (!fixedSong || fixedSong === e.song) return e;

        mutated = true;
        const newKey = _songKey(fixedSong) || e.key;
        return { ...e, song: fixedSong, key: newKey };
      });
    }
  } catch (e) {
    console.warn('No se pudo migrar historial:', e);
  }

  if (mutated) {
    _saveHistoryEntries(entries);
  }
  return entries;
}

function _saveHistoryEntries(entries){
  _saveJSON(HISTORY_KEY(), Array.isArray(entries) ? entries : []);
}

function _historyRegisterPlay(song){
  let norm = normalizeSong(song);
  if (!norm) return;

  if (norm.id == null) {
    norm = _relinkHistorySongWithId(norm, null);
  }

  const key = _songKey(norm);
  if (!key) return;

  let entries = _loadHistoryEntries();

  entries = entries.filter(e => e && e.key !== key);

  const ts = Date.now();
  entries.unshift({ key, ts, song: norm });

  if (entries.length > 200) {
    entries = entries.slice(0, 200);
  }

  _saveHistoryEntries(entries);

  try {
    let pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
    const histSongs = entries
      .map(e => e && e.song ? { ...e.song, _historyTs: e.ts } : null)
      .filter(Boolean);

    const idx = pls.findIndex(p => p.id === 'pl:history');
    if (idx >= 0) {
      pls[idx] = { ...pls[idx], songs: histSongs };
    } else {
      pls.splice(1, 0, { id: 'pl:history', name: 'Historial', songs: histSongs });
    }
    window._playlists = pls;

    const ul = document.getElementById('rep-playlists');
    if (ul) {
      const li = ul.querySelector('li[data-pl="pl:history"]');
      if (li) {
        const badge = li.querySelector('.rep-badge');
        if (badge) badge.textContent = String(histSongs.length);
      }
    }
  } catch {}
}

function _relinkHistorySongWithId(song, keyFromEntry) {
  if (!song) return song;
  if (song.id != null) return song;

  const key = keyFromEntry || _songKey(song);
  const songUrl = _abs(ensureAbs(song.audioUrl || song.audio_url || song.audio || ""));

  const pls = Array.isArray(window._playlists) ? window._playlists : [];
  for (const pl of pls) {
    const arr = Array.isArray(pl.songs) ? pl.songs : [];
    for (const s of arr) {
      if (!s) continue;
      if (s.id == null) continue;

      if (key && _songKey(s) === key) {
        return { ...song, id: s.id };
      }

      const sUrl = _abs(ensureAbs(s.audioUrl || s.audio_url || s.audio || ""));
      if (songUrl && sUrl && songUrl === sUrl) {
        return { ...song, id: s.id };
      }
    }
  }
  return song;
}

function _buildHistoryPlaylist(){
  const entries = _loadHistoryEntries();
  const songs = entries
    .map(e => e && e.song ? { ...e.song, _historyTs: e.ts } : null)
    .filter(Boolean);
  return {
    id: 'pl:history',
    name: 'Historial',
    songs,
  };
}

function _injectHistoryIntoPlaylists(basePlaylists){
  const P = Array.isArray(basePlaylists) ? basePlaylists.slice() : [];
  const histPL = _buildHistoryPlaylist();

  const existing = P.findIndex(p => p.id === 'pl:history');
  if (existing >= 0) P.splice(existing, 1);

  const idxLikes = P.findIndex(p => p.id === 'pl:likes');
  const insertAt = idxLikes >= 0 ? idxLikes + 1 : 1;
  P.splice(insertAt, 0, histPL);
  return P;
}

// ---------------------------- Top10 congelado ------------------------------
function _getFrozenOrder(stamp){ return _loadJSON(ORDER_PREFIX()+stamp, []); }
function _setFrozenOrder(stamp, arr){ _saveJSON(ORDER_PREFIX()+stamp, Array.isArray(arr)?arr.slice(0,10):[]); }

function _hasAnyPlays(stamp){
  const db = _loadDailyPlays(stamp);
  if (!db || typeof db !== 'object') return false;
  for (const k in db) if (db[k] > 0) return true;
  return false;
}
function _findLastFrozenOrderBefore(today){
  let best = null, bestStamp = null;
  for (let i = 0; i < localStorage.length; i++){
    const key = localStorage.key(i);
    if (key && key.startsWith(ORDER_PREFIX())){
      const stamp = key.slice(ORDER_PREFIX().length);
      if (/^\d{8}$/.test(stamp) && stamp < today){
        const arr = _loadJSON(key, []);
        if (Array.isArray(arr) && arr.length){
          if (!bestStamp || stamp > bestStamp){ best = arr; bestStamp = stamp; }
        }
      }
    }
  }
  return { order: best, stamp: bestStamp };
}
function _buildFrozenOrderFromPlays(playlists, stampForScores){
  const base=_flattenUniqueSongs(playlists);
  const plays=_loadDailyPlays(stampForScores);
  const scored=base.map(s=>({ key:_songKey(s), score:(plays[_songKey(s)]||0) })).filter(x=>!!x.key);
  scored.sort((a,b)=> b.score - a.score);
  const order=scored.map(x=>x.key).slice(0,10);
  if(order.length<10){
    for(const s of base){
      const k=_songKey(s); if(!k) continue;
      if(!order.includes(k)) order.push(k);
      if(order.length>=10) break;
    }
  }
  return order.slice(0,10);
}
function ensureDailyRoll(playlists){
  const today = todayStamp();
  const exists = _getFrozenOrder(today);
  if (Array.isArray(exists) && exists.length) return;

  const yday = yesterdayStamp();
  let order = [];

  if (_hasAnyPlays(yday)){
    order = _buildFrozenOrderFromPlays(playlists, yday);
  } else {
    const { order: prev } = _findLastFrozenOrderBefore(today);
    if (prev && prev.length){
      order = prev.slice(0, 10);
    } else {
      order = _buildFrozenOrderFromPlays(playlists, yday);
    }
  }
  _setFrozenOrder(today, order);
}
function _countsStampForToday(){
  const y = yesterdayStamp();
  if (_hasAnyPlays(y)) return y;
  const { stamp } = _findLastFrozenOrderBefore(todayStamp());
  return stamp || y;
}

// ---------------------------- Registro de plays ----------------------------
function registerPlay(song){
  const k=_songKey(song); if(!k) return;
  const stamp=todayStamp();
  const db=_loadDailyPlays(stamp);
  db[k]=(db[k]||0)+1;
  _saveDailyPlays(stamp, db);

  try { fire("melodify:playcount", { key: k }); } catch {}

  try { _historyRegisterPlay(song); } catch {}
}
function getPlayCountAtStamp(song, stamp){
  const k=_songKey(song); if(!k) return 0;
  const db=_loadDailyPlays(stamp);
  return db[k]||0;
}
function getWeeklyPlayCount(song, weeklyAgg=null, includeToday=true){
  const k=_songKey(song); if(!k) return 0;
  if(!includeToday && weeklyAgg){ return Number(weeklyAgg[k]||0); }
  return getWeekCount(song, 7, includeToday);
}

// ---------------------------- Discover Weekly ------------------------------
function _genreSlug(g){ return slugify(g||''); }
function _countBy(arr, fn){
  const c=new Map(); for(const x of arr){ const k=fn(x); if(!k) continue; c.set(k,(c.get(k)||0)+1); } return c;
}
function _genreWeightsFromLikes(likes){
  const cnt=_countBy(likes||[], s => _genreSlug(s.genre||s.genero||s.gen||''));
  if(!cnt.size) return new Map();
  let total=0; for(const v of cnt.values()) total+=v;
  const w=new Map();
  for(const [g,c] of cnt.entries()){
    const f=c/total; w.set(g, f>0.4?3 : f>0.2?2 : 1);
  }
  return w;
}
function _capByArtist(songs, maxPerArtist=2){
  const seen=new Map(); const out=[];
  for(const s of songs){
    const a=slugify(s.author||s.artist_display_name||'');
    const n=seen.get(a)||0;
    if(n<maxPerArtist){ out.push(s); seen.set(a,n+1); }
  }
  return out;
}
function _roundRobinByGenre(songs){
  const buckets=new Map();
  for(const s of songs){
    const g=_genreSlug(s.genre||s.genero||s.gen||'')||'__other__';
    if(!buckets.has(g)) buckets.set(g,[]);
    buckets.get(g).push(s);
  }
  for(const [g,arr] of buckets.entries()) buckets.set(g, arr.slice());
  const out=[]; let progressed=true;
  while(progressed){
    progressed=false;
    for(const [g,arr] of buckets.entries()){
      if(!arr.length) continue;
      out.push(arr.shift()); progressed=true;
    }
  }
  return out;
}

function buildDiscoverWeekly({playlists, likes=[], size=30}){
  const cachedKeys = (_loadDiscover()||[]).map(k=>String(k));
  const base = _flattenUniqueSongs(playlists);
  const byKey = new Map(base.map(s=>[_songKey(s), s]));
  const cachedSongs = cachedKeys.map(k=>byKey.get(k)).filter(Boolean);
  if(cachedSongs.length >= Math.min(12,size*0.4)){
    return { id:'pl:discover', name:'Discover Weekly', songs: cachedSongs.slice(0,size) };
  }

  const likeSet = new Set((likes||[]).map(s=>_songKey(s)).filter(Boolean));
  const universe = _dedup([...(base||[]), ...(likes||[])], s => _songKey(s));

  const recentPlays = _sumRecentPlaysByKey(7);
  const genreW = _genreWeightsFromLikes(likes||[]);
  const scored = universe.map(s=>{
    const k=_songKey(s); if(!k) return null;
    const g=_genreSlug(s.genre||s.genero||s.gen||'');
    const plays = Number(recentPlays[k]||0);
    const playsScore = Math.log(1+plays)*1.5;
    const likeBonus  = likeSet.has(k)? 2.0 : 0;
    const genreBonus = genreW.get(g)|| (g?0.5:0);
    const exploreBoost = likeBonus? 0 : 0.3;
    const jitter = Math.random()*0.4;
    const score = playsScore + likeBonus + genreBonus + exploreBoost + jitter;
    return { s, score, isLike: likeSet.has(k) };
  }).filter(Boolean);
  scored.sort((a,b)=> b.score - a.score);

  const targetLikes = Math.round(size*0.4);
  const targetHabits = Math.round(size*0.4);
  const targetExplore = size - targetLikes - targetHabits;

  const likesBucket   = scored.filter(x=>x.isLike).map(x=>x.s);
  const nonLikes      = scored.filter(x=>!x.isLike);
  const habitsBucket  = nonLikes.slice(0, size*2).map(x=>x.s);
  const exploreBucket = nonLikes.slice(size*2).map(x=>x.s);

  let pick = [];
  pick.push(...likesBucket.slice(0, targetLikes));
  pick.push(...habitsBucket.slice(0, targetHabits));
  pick.push(...exploreBucket.slice(0, targetExplore));

  pick = _capByArtist(pick, 2);
  pick = _roundRobinByGenre(pick);

  if(pick.length < size){
    const already = new Set(pick.map(x=>_songKey(x)));
    const filler = [];
    for(const x of scored.map(z=>z.s)){
      const k=_songKey(x); if(!k || already.has(k)) continue;
      filler.push(x);
      if(already.size+filler.length >= size*2) break;
    }
    pick = _capByArtist([...pick, ...filler], 2).slice(0,size);
  }else{
    pick = pick.slice(0,size);
  }

  _saveDiscover(pick.map(_songKey));
  return { id:'pl:discover', name:'Discover Weekly', songs: pick };
}

// ---------------------------- Métricas Discover (UI) -----------------------
function _flattenAllSongsFromPlaylists(playlists){
  return (Array.isArray(playlists)?playlists:[]).flatMap(pl=>Array.isArray(pl.songs)?pl.songs:[]);
}
function _buildKeyToSongMap(playlists){
  const all = _flattenAllSongsFromPlaylists(playlists);
  const m = new Map();
  for(const s of all){ const k=_songKey(s); if(k && !m.has(k)) m.set(k, s); }
  return m;
}
function _computeWeeklyStats({playlists, likes=[]}){
  const recent = _sumRecentPlaysByKeyInclToday(7);
  const byKey = _buildKeyToSongMap(playlists);
  let totalPlays = 0;
  const genreCounts = new Map();
  const artistCounts = new Map();
  for(const [k,plays] of Object.entries(recent)){
    const s = byKey.get(k); if(!s) continue;
    const p = Number(plays||0); if(!p) continue;
    totalPlays += p;
    const g = _genreSlug(s.genre||s.genero||s.gen||'otro');
    genreCounts.set(g, (genreCounts.get(g)||0)+p);
    const a = slugify(s.author||s.artist_display_name||'—');
    artistCounts.set(a, (artistCounts.get(a)||0)+p);
  }
  const topGenre = [...genreCounts.entries()].sort((a,b)=>b[1]-a[1])[0] || ['—',0];
  const topArtist = [...artistCounts.entries()].sort((a,b)=>b[1]-a[1])[0] || ['—',0];
  const likeSet = new Set((likes||[]).map(s=>_songKey(s)).filter(Boolean));
  return { totalPlays, topGenre, topArtist, likeSet };
}
function _renderDiscoverHeader({playlistDW, stats}){
  const left = q('.rep-left'); if(!left) return;
  const node = document.createElement('div');
  node.className = 'discover-header rep-stats';
  node.setAttribute('data-scope','week');
  node.style.cssText = 'background:#0f0f0f;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 12px 0';

  const songs = Array.isArray(playlistDW?.songs)?playlistDW.songs:[];

  let likedInDW=0;
  for(const s of songs){ if(stats.likeSet.has(_songKey(s))) likedInDW++; }

  const gLabel = (g)=>{
    const map = {pop:'Pop', rock:'Rock', electronica:'Electrónica', salsa:'Salsa', indie:'Indie', hiphop:'Hip-Hop', reggaeton:'Reguetón', regional:'Regional', balada:'Balada', jazz:'Jazz', clasica:'Clásica', otro:'Otro'};
    return map[g] || (g||'—');
  };

  node.innerHTML = `
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
        <div class="rep-total" style="min-width:180px"><strong>Reproducciones (7d):</strong> ${stats.totalPlays}</div>
        <div style="min-width:200px"><strong>Género top:</strong> ${gLabel(stats.topGenre[0])} <small style="opacity:.7">(${stats.topGenre[1]||0})</small></div>
        <div style="min-width:200px"><strong>Artista top:</strong> ${stats.topArtist[0]||'—'} <small style="opacity:.7">(${stats.topArtist[1]||0})</small></div>
      </div>
      <div style="min-width:180px"><strong>Canciones likeadas:</strong> ${likedInDW}</div>
    </div>`;
  left.prepend(node);
}

// -------- Top-10: métricas diarias (visual) + header con género/autor top --
function _computeDailyStats({playlists}){
  const byKey = _buildKeyToSongMap(playlists);
  let totalPlays = 0;
  const genreCounts = new Map();
  const artistCounts = new Map();

  const today = todayStamp();
  const db = _loadDailyPlays(today) || {};
  for(const [k,plays] of Object.entries(db)){
    const s = byKey.get(k); if(!s) continue;
    const p = Number(plays||0); if(!p) continue;
    totalPlays += p;

    const g = _genreSlug(s.genre||s.genero||s.gen||'otro');
    genreCounts.set(g, (genreCounts.get(g)||0)+p);

    const a = slugify(s.author||s.artist_display_name||'—');
    artistCounts.set(a, (artistCounts.get(a)||0)+p);
  }

  const topGenre = [...genreCounts.entries()].sort((a,b)=>b[1]-a[1])[0] || ['—',0];
  const topArtist = [...artistCounts.entries()].sort((a,b)=>b[1]-a[1])[0] || ['—',0];
  return { totalPlays, topGenre, topArtist };
}
function _renderTop10Header({songs}){
  const left = q('.rep-left'); if(!left) return;
  const node = document.createElement('div');
  node.className = 'top10-header rep-stats';
  node.setAttribute('data-scope','day');
  node.style.cssText = 'background:#0f0f0f;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 12px 0';

  let total=0;
  for(const s of (songs||[])){ total += getTodayCount(s); }

  const statsDay = _computeDailyStats({playlists: window._playlists||[]});
  const gLabel = (g)=>{
    const map = {pop:'Pop', rock:'Rock', electronica:'Electrónica', salsa:'Salsa', indie:'Indie', hiphop:'Hip-Hop', reggaeton:'Reguetón', regional:'Regional', balada:'Balada', jazz:'Jazz', clasica:'Clásica', otro:'Otro'};
    return map[g] || (g||'—');
  };

  node.innerHTML = `
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div class="rep-total" style="min-width:180px"><strong>Reproducciones (hoy):</strong> ${total}</div>
      <div style="min-width:200px"><strong>Género top (hoy):</strong> ${gLabel(statsDay.topGenre[0])} <small style="opacity:.7">(${statsDay.topGenre[1]||0})</small></div>
      <div style="min-width:200px"><strong>Artista top (hoy):</strong> ${statsDay.topArtist[0]||'—'} <small style="opacity:.7">(${statsDay.topArtist[1]||0})</small></div>
    </div>`;
  left.prepend(node);
}

// ---------------------------- Render filas (badges) ------------------------
function _esc(s){
  return String(s??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function _playlistSongRow(
  song,
  {
    countsMode = null,
    countsStamp = null,
    weeklyAgg = null,
    showLikeBtn = true,
    showHistoryTime = false,
  } = {}
) {
  const isStr = typeof song === 'string';
  const title = isStr ? song : (song?.title || '—');
  const author = isStr ? '—' : (song?.author || song?.artist_display_name || song?.artist || '—');
  const cover = isStr ? null : ensureAbs(song?.coverUrl || song?.cover_url || song?.cover || '');
  const audio = isStr ? '' : ensureAbs(song?.audioUrl || song?.audio_url || song?.audio || '');
  const genre = !isStr ? (song?.genre || song?.genero || '') : '';
  const skey  = _songKey(song);
  const idAttr = song && song.id != null ? String(song.id) : '';

  let playsBadge = '';
  if (countsMode === 'daily') {
    const plays = getTodayCount(song);
    playsBadge = `<span class="rep-badge" data-badge="plays" data-skey="${_esc(skey)}" data-scope="day">${plays}</span>`;
  } else if (countsMode === 'weekly') {
    const plays = getWeeklyPlayCount(song, null, true);
    playsBadge = `<span class="rep-badge" data-badge="plays" data-skey="${_esc(skey)}" data-scope="week">${plays}</span>`;
  }

  const coverHTML = cover
    ? `<img src="${_esc(cover)}" alt="${_esc(title)}" class="song-cover">`
    : `<div class="song-cover song-cover--placeholder"></div>`;

  const liked = showLikeBtn ? _isSongLiked(song) : false;

  let likeHTML = '';
  let addHTML  = '';

  if (showLikeBtn && idAttr) {
    likeHTML = `
      <button type="button"
              class="song-like-btn ${liked ? 'is-liked' : ''}"
              data-song-id="${_esc(idAttr)}"
              data-skey="${_esc(skey)}"
              onclick="window.MDFCore && window.MDFCore.toggleLikeFromReproductor && window.MDFCore.toggleLikeFromReproductor(event, '${_esc(idAttr)}')">
        ${liked ? '♥' : '♡'}
      </button>`;

    addHTML = `
      <button type="button"
              class="song-add-btn"
              data-song-id="${_esc(idAttr)}"
              data-skey="${_esc(skey)}"
              title="Añadir a playlist"
              onclick="window.MDFCore && window.MDFCore.openAddToPlaylistDialog && window.MDFCore.openAddToPlaylistDialog(event, '${_esc(idAttr)}')">
        +
      </button>`;
  }

  let historyHTML = '';
  if (showHistoryTime) {
    const ts =
      (!isStr && (song._historyTs || song.historyTs || song.ts || song.played_at)) || null;
    if (ts) {
      const label = fmtHistoryLabel(ts);
      if (label) {
        historyHTML = ` <span class="song-history-time">• ${_esc(label)}</span>`;
      }
    }
  }

  return `
    <div class="song-item" data-id="${_esc(idAttr)}" data-audio-url="${_esc(audio)}"
         data-title="${_esc(title)}" data-author="${_esc(author)}"
         data-genre="${_esc(genre)}" data-skey="${_esc(skey)}">
      ${coverHTML}
      <div class="song-info">
        <div class="song-title">
          ${_esc(title)} ${playsBadge}
          ${likeHTML}
          ${addHTML}
        </div>
        <div class="song-author">${_esc(author)}${historyHTML}</div>
      </div>
    </div>`;
}

export function renderLeftSongs(songs, titleForEmpty='Playlist', opts={}){
  const {
    countsMode = null,
    countsStamp = null,
    weeklyAgg = null,
    showLikeBtn = true,
    showHistoryTime = false,
  } = opts;

  const left=q('.rep-left'); if(!left) return;
  if(!songs||!songs.length){
    left.innerHTML=`<div class="rep-empty"><div><h3 style="margin:0">${_esc(titleForEmpty)}</h3><p>No hay canciones.</p></div></div>`;
  }else{
    const rows = songs.map(s => _playlistSongRow(s,{countsMode, countsStamp, weeklyAgg, showLikeBtn, showHistoryTime})).join('');
    left.innerHTML=`<div class="songs-wrap">${rows}</div>`;
  }
  try{ inicializarReproductor(); }catch{}
}

// ---------------------------- Audio core -----------------------------------
function setMetaFor(song){
  const meta = {
    title:  song?.title || "—",
    artist: song?.author || song?.artist_display_name || "—",
    cover:  ensureAbs(song?.coverUrl || song?.cover_url || song?.cover || ""),
    genre:  song?.genre || song?.genero || "",
  };
  fire("melodify:trackmeta", meta);
}
function ensureAudio(){
  if(_state.audio) return;
  const a = new Audio();
  a.preload = "metadata";

  a.addEventListener("timeupdate", ()=>{
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    const cur = Number.isFinite(a.currentTime) ? a.currentTime : 0;
    fire("melodify:time", { currentTime: cur, duration: dur, label: `${fmtTime(cur)} / ${fmtTime(dur)}` });

    const s = _currentSong();
    const k = s ? _songKey(s) : null;
    if (s && k && _state.countedForKey !== k && cur >= COUNT_AT_SECONDS){
      registerPlay(s);
      _state.countedForKey = k;
      if (isTop10Active()) _refreshTop10View();
    }
  });

  a.addEventListener("loadedmetadata", ()=>{
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    fire("melodify:loaded", { duration: dur });
  });
  a.addEventListener("play",  ()=>{ fire("melodify:state", { playing:true, paused:false }); });
  a.addEventListener("pause", ()=>{ fire("melodify:state", { playing:false, paused:true }); });
  a.addEventListener("ended", ()=>{ fire("melodify:ended", {}); next(); });

  _state.audio = a;
  fire("melodify:audioReady", { audio: a });
}
function load(idx, autoplay=true){
  ensureAudio();
  idx=Number(idx);
  if(!Number.isInteger(idx)||idx<0||idx>=_state.queue.length) return;
  _state.index = idx;

  const s=_state.queue[idx];
  const url=ensureAbs(s.audioUrl||s.audio_url||s.audio||"");
  if(!url) return;

  setMetaFor(s);
  _state.audio.src=url;
  _state.audio.currentTime=0;
  _state.countedForKey = null;
  highlightCurrent();

  fire("melodify:trackchange", { index: idx, song: s });
  if(autoplay) _state.audio.play().catch(()=>{});
  fireBar();
}
function toggle(){
  if(!_state.audio||!_state.audio.src) return;
  if(_state.audio.paused) _state.audio.play().catch(()=>{});
  else _state.audio.pause();
}
function prev(){
  if(_state.queue.length===0) return;
  const i=_state.index>0?_state.index-1:_state.queue.length-1;
  load(i,true);
}
function next(){
  if(_state.queue.length===0) return;
  const i=(_state.index+1)%_state.queue.length;
  load(i,true);
}

// ---------------------------- Queue / binding ------------------------------
function clearRowHighlight(){ qa(".song-item.is-playing").forEach(el=>el.classList.remove("is-playing")); }
function highlightCurrent(){ clearRowHighlight(); const n=q(`.song-item[data-_idx="${_state.index}"]`); if(n) n.classList.add("is-playing"); }

function collectQueueFromDOM({ retainIfEmpty = true } = {}){
  const items = qa(".song-item,[data-audio-url]");
  const curHref = absHref(_state.audio?.src || "");
  const nextQueue = [];
  let k = 0;

  items.forEach((el) => {
    const id = el.dataset.id || el.getAttribute("data-id") || null;
    const title = el.dataset.title || el.querySelector(".song-title")?.textContent || "—";
    const author = el.dataset.author || el.querySelector(".song-author")?.textContent || "—";
    const coverUrl = ensureAbs(
      el.dataset.coverUrl ||
      el.getAttribute("data-cover-url") ||
      el.querySelector(".song-cover")?.getAttribute("src") || ""
    );
    const audioUrl = ensureAbs(el.dataset.audioUrl || el.getAttribute("data-audio-url") || "");
    const genre = el.dataset.genre || el.getAttribute("data-genre") || "";
    if (audioUrl) {
      nextQueue.push({ id, title, author, coverUrl, audioUrl, genre });
      el.dataset._idx = String(k++);
      if (!el.classList.contains("song-item")) el.classList.add("song-item");
      const img = el.querySelector(".song-cover"); if (img && coverUrl) img.src = coverUrl;
    } else {
      el.removeAttribute("data-_idx");
    }
  });

  if (nextQueue.length === 0 && retainIfEmpty) return;

  const prevQueue = _state.queue;
  const prevIndex = _state.index;

  _state.queue = nextQueue;

  if (nextQueue.length > 0) {
    const want = curHref ? _state.queue.findIndex(s => absHref(ensureAbs(s.audioUrl)) === curHref) : -1;
    if (want !== -1) _state.index = want;
    else if (prevQueue === nextQueue && prevIndex >= 0 && prevIndex < nextQueue.length) _state.index = prevIndex;
    else if (_state.index < 0) _state.index = 0;
  }

  highlightCurrent();
}
function bindClicks(enable){
  _state.boundItems.forEach(el=>el.onclick=null);
  _state.boundItems.clear();
  if(!enable) return;
  qa(".song-item").forEach((el)=>{
    el.onclick=()=>{
      const idx=Number(el.dataset._idx??-1);
      if(idx<0) return;
      const wants=_state.queue[idx];
      const nextH=absHref(ensureAbs(wants?.audioUrl||""));
      const curH =absHref(_state.audio?.src||"");
      if(idx===_state.index && nextH && curH && nextH===curH){ toggle(); }
      else { load(idx,true); }
    };
    _state.boundItems.add(el);
  });
}
function observeListChanges(){
  const host=document.getElementById("content")||document.body;
  if(_state.moList){ _state.moList.disconnect(); _state.moList=null; }
  _state.moList=new MutationObserver((muts)=>{
    let touched=false;
    for(const m of muts){
      if(m.type==="childList" || (m.type==="attributes" && m.target instanceof HTMLElement && m.target.hasAttribute("data-audio-url"))){ touched=true; break; }
    }
    if(touched){
      if (!isPlayableView()) return;
      const hadSrc = !!_state.audio?.src;
      collectQueueFromDOM();
      bindClicks(isPlayableView());
      if (hadSrc) fireBar();
    }
  });
  _state.moList.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:["data-audio-url","data-id","data-title","data-author","data-genre","data-cover-url"]});
}
function playFromDomItem(card) {
  if (!card || !(card instanceof HTMLElement)) return;

  ensureAudio();

  const audioUrl = ensureAbs(
    card.dataset.audioUrl ||
    card.getAttribute("data-audio-url") ||
    ""
  );
  if (!audioUrl) return;

  const targetHref = absHref(audioUrl);

  collectQueueFromDOM({ retainIfEmpty: false });

  let idx = -1;

  if (Array.isArray(_state.queue) && _state.queue.length) {
    idx = _state.queue.findIndex((s) =>
      absHref(
        ensureAbs(s.audioUrl || s.audio_url || s.audio || "")
      ) === targetHref
    );
  }

  if (idx === -1) {
    const id = card.dataset.id || card.getAttribute("data-id") || null;
    const title =
      card.dataset.title ||
      card.getAttribute("data-title") ||
      card.querySelector(".song-title")?.textContent ||
      "—";
    const author =
      card.dataset.author ||
      card.getAttribute("data-author") ||
      card.dataset.artist ||
      card.getAttribute("data-artist") ||
      card.querySelector(".song-author")?.textContent ||
      "—";
    const coverUrl = ensureAbs(
      card.dataset.coverUrl ||
      card.getAttribute("data-cover-url") ||
      card.querySelector(".song-cover")?.getAttribute("src") ||
      ""
    );
    const genre =
      card.dataset.genre ||
      card.getAttribute("data-genre") ||
      "";

    const track = { id, title, author, coverUrl, audioUrl, genre };

    if (!Array.isArray(_state.queue)) {
      _state.queue = [];
    }
    _state.queue.push(track);
    idx = _state.queue.length - 1;

    card.dataset._idx = String(idx);
    card.classList.add("song-item");
  }

  load(idx, true);
}

// ---------------------------- Vistas / guards ------------------------------
function hookViewGuard(){
  if(_state.guardHooked) return; _state.guardHooked=true;
  const main=document.getElementById("main-content"); if(!main) return;

  const apply = ()=>{
    const playable = isPlayableView();
    if (playable) { collectQueueFromDOM({ retainIfEmpty: true }); bindClicks(true); observeListChanges(); }
    else { bindClicks(false); observeListChanges(); }
  };
  apply();
  if(_state.moView) _state.moView.disconnect();
  _state.moView=new MutationObserver(apply);
  _state.moView.observe(main,{attributes:true, attributeFilter:["data-view"]});
}
function playExternalSong(audioUrl, title, artist, coverUrl) {
  if (!audioUrl) return;

  try {
    const absTarget = new URL(audioUrl, window.location.origin).href;
    let idx = -1;

    for (let i = 0; i < _state.queue.length; i++) {
      const qUrl = _state.queue[i]?.audioUrl
        ? new URL(_state.queue[i].audioUrl, window.location.origin).href
        : '';
      if (qUrl === absTarget) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      const track = {
        id: null,
        title: title || 'Sin título',
        artist: artist || '',
        audioUrl: audioUrl,
        coverUrl: coverUrl || '',
        fromSearch: true,
      };
      _state.queue.push(track);
      idx = _state.queue.length - 1;

      try { renderQueue && renderQueue(); } catch (_) {}
    }

    if (typeof load === 'function') {
      load(idx, true);
    }
  } catch (err) {
    console.warn('playExternalSong falló:', err);
  }
}

function _syncLikeModelFromClient(idSong, liked, meta) {
  const idStr = idSong != null ? String(idSong) : "";
  let likes = Array.isArray(window._likes) ? window._likes.slice() : [];

  function fromMeta() {
    if (!meta) return null;
    return normalizeSong({
      id: idSong,
      title: meta.title,
      artist_display_name: meta.artist,
      audioUrl: meta.audioUrl,
      coverUrl: meta.coverUrl,
      genre: meta.genre,
    });
  }

  function fromPlaylists() {
    const pls = Array.isArray(window._playlists) ? window._playlists : [];
    for (const pl of pls) {
      const songs = Array.isArray(pl.songs) ? pl.songs : [];
      for (const s of songs) {
        if (s.id != null && String(s.id) === idStr) return s;
      }
    }
    return null;
  }

  let baseSong = fromMeta() || fromPlaylists() || fromMeta();
  if (!baseSong) return;

  const key = _songKey(baseSong);
  if (!key) return;

  if (liked) {
    const exists = likes.some(s => _songKey(s) === key);
    if (!exists) likes.push(baseSong);
  } else {
    likes = likes.filter(s => _songKey(s) !== key);
  }

  window._likes = likes;

  const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
  let likesIdx = pls.findIndex(p => p.id === 'pl:likes');

  if (likesIdx >= 0) {
    pls[likesIdx] = {
      ...pls[likesIdx],
      songs: likes.slice(),
    };
  } else if (likes.length) {
    const afterMine = pls.findIndex(p => p.id === 'pl:mine');
    const insertAt = afterMine >= 0 ? afterMine + 1 : 1;
    pls.splice(insertAt, 0, {
      id: 'pl:likes',
      name: 'Music that i love',
      songs: likes.slice(),
    });
  }

  window._playlists = pls;

  const ul = document.getElementById('rep-playlists');
  if (ul) {
    const li = ul.querySelector('li[data-pl="pl:likes"]');
    if (li) {
      const badge = li.querySelector('.rep-badge');
      if (badge) badge.textContent = String(likes.length);
    }
  }

  const main = document.getElementById('main-content');
  const isReproductor = (main?.dataset.view || '').trim() === 'reproductor';

  if (isReproductor) {
    const activeLikes = document.querySelector('#rep-playlists li.active[data-pl="pl:likes"]');
    if (activeLikes) {
      const plLikes = window._playlists.find(p => p.id === 'pl:likes') || {
        name: 'Music that i love',
        songs: likes,
      };
      renderLeftSongs(
        Array.isArray(plLikes.songs) ? plLikes.songs : [],
        plLikes.name || 'Music that i love',
        { countsMode: null, showLikeBtn: true }
      );
    }

    const activeDiscover = document.querySelector('#rep-playlists li.active[data-pl="pl:discover"]');
    if (activeDiscover) {
      try {
        const d = buildDiscoverWeekly({
          playlists: window._playlists || [],
          likes: window._likes || [],
          size: 30,
        });
        renderLeftSongs(d.songs, d.name, { countsMode: 'weekly', weeklyAgg: null });
        const stats = _computeWeeklyStats({
          playlists: window._playlists || [],
          likes: window._likes || [],
        });
        _renderDiscoverHeader({ playlistDW: d, stats });
      } catch (e) {
        console.warn('discover refresh after like failed', e);
      }
    }
  }
}

// ---------------------------- API global -----------------------------------
window.MDFCore = {
  getAudio() {
    ensureAudio();
    return _state.audio;
  },
  getQueue() {
    return _state.queue.slice();
  },
  getIndex() {
    return _state.index;
  },
  load: (idx, autoplay = true) => load(idx, autoplay),
  toggle: () => toggle(),
  prev: () => prev(),
  next: () => next(),
  playExternalSong,
  playFromDomItem: (card) => playFromDomItem(card),
  seekPercent: (p01) => {
    ensureAudio();
    const a = _state.audio;
    if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
    const pct = clamp(Number(p01) || 0, 0, 1);
    a.currentTime = Math.max(0, Math.min(a.duration * pct, a.duration - 0.25));
  },
  setVolume: (v) => {
    ensureAudio();
    _state.audio.volume = clamp(Number(v) || 0, 0, 1);
  },
  syncLikeModelFromClient: _syncLikeModelFromClient,
  toggleLikeFromReproductor: (evt, idSong) => _toggleLikeFromReproductor(evt, idSong),
  openAddToPlaylistDialog: (evt, idSong) => _openAddToPlaylistDialog(evt, idSong),
};

// ---------------------------- Sidebar / UI ---------------------------------
export const DEFAULT_GENRES = [
  {value:'pop',label:'Pop'},{value:'rock',label:'Rock'},{value:'electronica',label:'Electrónica'},
  {value:'salsa',label:'Salsa'},{value:'indie',label:'Indie'},{value:'hiphop',label:'Hip-Hop'},
  {value:'reggaeton',label:'Reguetón'},{value:'regional',label:'Regional Mexicano'},
  {value:'balada',label:'Balada'},{value:'jazz',label:'Jazz'},{value:'clasica',label:'Clásica'},{value:'otro',label:'Otro'},
];

function buildTop10FromPlaylistsFrozen(playlists){
  const base=_flattenUniqueSongs(playlists);
  const byKey=new Map(base.map(s=>[_songKey(s), s]));
  const frozen=_getFrozenOrder(todayStamp());
  const out=[];
  for(const k of frozen){ const s=byKey.get(k); if(s) out.push(s); }
  if(out.length<10){
    for(const s of base){
      const k=_songKey(s);
      if(!k || frozen.includes(k)) continue;
      out.push(s);
      if(out.length>=10) break;
    }
  }
  return { id:'pl:top10', name:'Top 10 personal', songs: out };
}

export function buildRightSidebarHTML({playlists, genres=DEFAULT_GENRES}){
  let P = Array.isArray(playlists) ? playlists.slice() : [];

  try{ ensureDailyRoll(P); }catch{}

  const top10 = buildTop10FromPlaylistsFrozen(P);
  const iTop = P.findIndex(p => p.id === 'pl:top10');
  if (iTop >= 0) P.splice(iTop,1);

  let discover=null;
  try{
    discover = buildDiscoverWeekly({
      playlists: P,
      likes: Array.isArray(window._likes) ? window._likes : [],
      size: 30,
    });
  }catch(e){ console.warn('Discover build failed', e); }

  let insertAfter = 0;
  for (const id of ['pl:all','pl:mine','pl:likes','pl:history']){
    const idx = P.findIndex(p => p.id===id);
    if (idx >= 0 && idx >= insertAfter) insertAfter = idx + 1;
  }
  P.splice(insertAfter, 0, top10);
  if(discover) P.splice(insertAfter+1, 0, discover);

  const liHTML = P.map(pl=>{
    const songs = Array.isArray(pl.songs) ? pl.songs : [];
    const label = pl.id==='pl:top10' ? 'Top 10 personal'
                 : pl.id==='pl:discover' ? 'Discover Weekly'
                 : pl.id==='pl:history' ? 'Historial'
                 : pl.id==='pl:likes' ? 'Music that i love'
                 : (pl.name || 'Playlist');
    return `
      <li data-pl="${_esc(pl.id)}"
          style="display:flex;align-items:center;gap:10px;background:#181818;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer">
        <span style="flex:1">${_esc(label)}</span>
        <span class="rep-badge">${songs.length}</span>
      </li>`;
  }).join('');

  const playlistsHTML = `
    <div class="rep-panel">
      <div class="rep-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h3 style="margin:0">Playlists</h3>
        <button id="rep-add-playlist-btn" type="button"
                style="padding:6px 10px;border:1px solid var(--line);background:#202020;border-radius:8px;cursor:pointer">
          + Nueva
        </button>
      </div>
      <ul id="rep-playlists" class="rep-list" style="list-style:none;margin:0;padding:0">
      ${liHTML || '<li class="muted" style="padding:8px 10px;">(sin playlists)</li>'}
        </ul>
      </div>`;

  const chipsHTML = (genres||[]).map(g=>`<span class="rep-chip" data-genre="${_esc(g.value)}">${_esc(g.label)}</span>`).join('');
  const genresHTML=`
    <div class="rep-panel">
      <div class="rep-head"><h3 style="margin:0">Géneros</h3></div>
      <div id="rep-genres">${chipsHTML}</div>
    </div>`;
  return playlistsHTML+'\n'+genresHTML;
}

export function attachSidebarHandlers(){
  const clearGenres=()=>{ const w=document.getElementById('rep-genres'); if(!w) return;
    w.querySelectorAll('.rep-chip.active,[aria-selected="true"],[aria-pressed="true"]').forEach(x=>{x.classList.remove('active');x.removeAttribute('aria-selected');x.removeAttribute('aria-pressed');});
  };
  const clearPlaylists=()=>{ const ul=document.getElementById('rep-playlists'); if(!ul) return; ul.querySelectorAll('li.active').forEach(x=>x.classList.remove('active')); };

  // Botón: crear playlist (abre el modal de nueva playlist)
  const addBtn = document.getElementById('rep-add-playlist-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      _openCreatePlaylistModal();
    });
  }

  const ul=document.getElementById('rep-playlists');
  if(ul){
    ul.querySelectorAll('li[data-pl]').forEach(li=>{
      li.addEventListener('click', ()=>{
        clearGenres(); clearPlaylists(); li.classList.add('active');
        const id=li.dataset.pl;

        const left=q('.rep-left');
        if(left){ const oldH = left.querySelector('.rep-stats'); if(oldH) oldH.remove(); }

        if(id==='pl:top10'){
          const plTop = buildTop10FromPlaylistsFrozen(window._playlists||[]);
          renderLeftSongs(plTop.songs, plTop.name, {countsMode:'daily', countsStamp:_countsStampForToday()});
          _renderTop10Header({songs: plTop.songs});
          return;
        }
        if(id==='pl:discover'){
          try{
            const d = buildDiscoverWeekly({
              playlists: window._playlists||[],
              likes: Array.isArray(window._likes)? window._likes : [],
              size: 30
            });
            renderLeftSongs(d.songs, d.name, {countsMode:'weekly', weeklyAgg:null});
            const stats = _computeWeeklyStats({playlists: window._playlists||[], likes: window._likes||[]});
            _renderDiscoverHeader({playlistDW: d, stats});
            return;
          }catch(e){ console.warn('discover click failed', e); }
        }

        if (id === 'pl:likes') {
          const plLikes = (window._playlists || []).find(p => p.id === 'pl:likes') || {
            name: 'Music that i love',
            songs: window._likes || []
          };
          renderLeftSongs(
            Array.isArray(plLikes.songs) ? plLikes.songs : [],
            plLikes.name || 'Music that i love',
            { countsMode: null, showLikeBtn: true }
          );
          return;
        }

        if (id === 'pl:history') {
          const entries = _loadHistoryEntries();
          const songs = Array.isArray(entries)
            ? entries
                .map(e => {
                  if (!e || !e.song) return null;
                  const base = { ...e.song, _historyTs: e.ts };
                  return _relinkHistorySongWithId(base, e.key || _songKey(e.song));
                })
                .filter(Boolean)
            : [];

          renderLeftSongs(
            songs,
            'Historial',
            { countsMode: null, showLikeBtn: true, showHistoryTime: true }
          );
          return;
        }

        const pl=(window._playlists||[]).find(p=>String(p.id)===String(id)) || {name:'—',songs:[]};
        renderLeftSongs(Array.isArray(pl.songs)?pl.songs:[], pl.name||'Playlist', {countsMode:null});

      });
    });
    const first = ul.querySelector('li[data-pl="pl:all"]') || ul.querySelector('li[data-pl]');
    if(first){ first.classList.add('active'); clearGenres(); }
  }

  const chipsWrap=document.getElementById('rep-genres');
  if(chipsWrap){
    const all=Array.from(chipsWrap.querySelectorAll('.rep-chip'));
    all.forEach(ch=>{
      ch.addEventListener('click', ()=>{
        clearPlaylists();
        all.forEach(x=>{x.classList.remove('active');x.removeAttribute('aria-selected');x.removeAttribute('aria-pressed');});
        ch.classList.add('active'); ch.setAttribute('aria-selected','true');

        const g=slugify(ch.dataset.genre||'');
        const allSongs=(window._playlists||[]).flatMap(p=>Array.isArray(p.songs)?p.songs:[]);
        const filtered=allSongs.filter(s=>{
          const sg=slugify(s.genre||s.genero||s.gen||'');
          if(!g||g==='otro') return true;
          return sg && sg===g;
        });
        renderLeftSongs(filtered, ch.textContent||'Género', {countsMode:null});
      });
    });
  }
}

// ======== Modal “Nueva playlist” ===========================================
let _createPlOverlay = null;
function _ensureCreatePlaylistOverlay() {
  if (_createPlOverlay) return _createPlOverlay;

  const overlay = document.createElement('div');
  overlay.id = 'mdf-create-playlist-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="cpl-backdrop">
      <div class="cpl-modal" role="dialog" aria-modal="true">
        <h3 class="cpl-title">Nueva playlist</h3>
        <label class="cpl-label">Nombre</label>
        <input id="cpl-name" class="cpl-input" type="text" maxlength="80" placeholder="Mi playlist"/>
        <div class="cpl-error" id="cpl-error" aria-live="polite"></div>
        <div class="cpl-footer">
          <button type="button" class="cpl-cancel">Cancelar</button>
          <button type="button" class="cpl-ok">Crear</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Cerrar clic afuera
  overlay.addEventListener('click', () => {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  });
  overlay.querySelector('.cpl-modal').addEventListener('click', (ev) => ev.stopPropagation());

  // Estilos
  if (!document.getElementById('mdf-create-playlist-styles')) {
    const style = document.createElement('style');
    style.id = 'mdf-create-playlist-styles';
    style.textContent = `
      #mdf-create-playlist-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:9999}
      #mdf-create-playlist-overlay.is-open{display:flex}
      #mdf-create-playlist-overlay .cpl-modal{background:#181818;color:#f5f5f5;border-radius:12px;padding:16px 18px;max-width:360px;width:min(360px,90vw);box-shadow:0 22px 45px rgba(0,0,0,.7);border:1px solid var(--line,#333)}
      .cpl-title{margin:0 0 8px;font-size:16px}
      .cpl-label{display:block;margin:6px 0 4px;font-size:12px;opacity:.9}
      .cpl-input{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--line,#333);background:#202020;color:#eee}
      .cpl-input:focus{outline:none;border-color:#4a3f8f}
      .cpl-error{min-height:16px;color:#f39; font-size:12px; margin:6px 0 0}
      .cpl-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
      .cpl-cancel{border:none;background:transparent;color:#9aa0a6;cursor:pointer}
      .cpl-ok{padding:6px 12px;border:1px solid var(--line,#333);background:#202020;color:#eee;border-radius:8px;cursor:pointer}
      .cpl-ok:hover{background:#292929}
    `;
    document.head.appendChild(style);
  }

  _createPlOverlay = overlay;
  return overlay;
}

async function _openCreatePlaylistModal() {
  const ov = _ensureCreatePlaylistOverlay();
  const input = ov.querySelector('#cpl-name');
  const err   = ov.querySelector('#cpl-error');
  const btnOk = ov.querySelector('.cpl-ok');
  const btnCa = ov.querySelector('.cpl-cancel');

  err.textContent = '';
  input.value = '';

  function close() {
    ov.classList.remove('is-open');
    ov.setAttribute('aria-hidden', 'true');
    btnOk.onclick = btnCa.onclick = null;
    input.onkeydown = null;
  }

  async function submit() {
    const name = String(input.value || '').trim();
    if (!name) { err.textContent = 'Escribe un nombre.'; input.focus(); return; }
    try {
      const pid = await _createPlaylistFromPlayer(name, { isPrivate: false });
      _toast('Playlist creada.');
      // Refresca la vista del reproductor para que aparezca con su badge
      const mainContent = document.getElementById('main-content');
      const contentDiv  = document.getElementById('content');
      try {
        await renderMenuReproductor({
          mainContent,
          contentDiv,
          URL_MI_MUSICA_JSON: mainContent?.dataset?.urlMiMusicaJson
        });
      } catch {}
      // Seleccionar la nueva
      const ul = document.getElementById('rep-playlists');
      const li = ul?.querySelector(`li[data-pl="pl:${CSS.escape(String(pid))}"]`);
      if (li) li.click();
      close();
    } catch (e) {
      err.textContent = e?.message || 'No se pudo crear la playlist.';
    }
  }

  btnOk.onclick = submit;
  btnCa.onclick = close;
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') submit();
    if (ev.key === 'Escape') close();
  };

  ov.classList.add('is-open');
  ov.setAttribute('aria-hidden', 'false');
  setTimeout(() => input?.focus(), 50);
}

// ======== Crear playlist desde el reproductor y notificar a la app =========
function _getUsername() {
  const mc = document.getElementById('main-content');
  return mc?.dataset?.username
      || document.querySelector('meta[name="username"]')?.content
      || '';
}
async function _createPlaylistFromPlayer(name, { isPrivate = false } = {}) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Nombre vacío');

  const body = { user: _getUsername(), name: n };
  const res = await fetch('/playlist/create/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') || '' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.playlist_id) {
    throw new Error(j?.error || 'No se pudo crear la playlist');
  }

  const pid = j.playlist_id;

  if (isPrivate === true) {
    const r2 = await fetch(`/playlist/${pid}/update/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') || '' },
      credentials: 'same-origin',
      body: JSON.stringify({ isprivate: true }),
    });
    if (!r2.ok) console.warn('No se pudo marcar como privada (continúo)');
  }

  // Notifica cambios de playlists al resto de la aplicación
  document.dispatchEvent(new CustomEvent('melodify:playlists:changed'));
  return pid;
}


// ---------------------------- Modelo de playlists --------------------------
async function fetchAllPlaylistsWithSongs() {
  try {
    const res = await fetch('/playlist/getAllList', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    const lists =
      (Array.isArray(data) && data) ||
      (Array.isArray(data?.playlists) && data.playlists) ||
      (Array.isArray(data?.results) && data.results) ||
      [];

    if (!lists.length) return [];

    const byId = async (pl) => {
      const pid = pl.id ?? pl.pk ?? pl.id_playlist ?? pl.playlist_id;
      if (pid == null) {
        console.warn('Playlist sin id conocido en getAllList:', pl);
        return null;
      }

      const r = await fetch(`/playlist/${pid}/songs/`, {
        credentials:'same-origin',
        cache:'no-store'
      });

      if (!r.ok) {
        return {
          id: `pl:${pid}`,
          name: pl.name || pl.nombre || `Playlist ${pid}`,
          songs: []
        };
      }

      const dataSongs = await r.json();
      const raw = (Array.isArray(dataSongs?.songs) && dataSongs.songs) ||
                  (Array.isArray(dataSongs?.results) && dataSongs.results) ||
                  (Array.isArray(dataSongs?.playlist?.songs) && dataSongs.playlist.songs) ||
                  [];
      const norm = raw.map(normalizeSong).filter(Boolean);

      return {
        id: `pl:${pid}`,
        name: pl.name || pl.nombre || `Playlist ${pid}`,
        songs: norm
      };
    };

    const detailed = await Promise.all(lists.map(byId));
    return detailed.filter(Boolean);
  } catch (e) {
    console.warn('fetchAllPlaylistsWithSongs() falló:', e);
    return [];
  }
}

async function fetchMyMusic(URL_MI_MUSICA_JSON){
  try{
    if(!URL_MI_MUSICA_JSON) return [];
    const res = await fetch(URL_MI_MUSICA_JSON, {
      credentials:'same-origin', cache:'no-store', headers:{'X-Requested-With':'fetch'}
    });
    if(!res.ok) return [];
    const data  = await res.json();
    const raw   = (Array.isArray(data?.songs) && data.songs)
               || (Array.isArray(data?.results) && data.results)
               || (Array.isArray(data?.playlist?.songs) && data.playlist.songs)
               || [];
    return raw.map(normalizeSong).filter(Boolean);
  }catch(e){ console.warn('fetchMyMusic() falló:', e); return []; }
}
async function fetchMyLikes(URL_MIS_LIKES_JSON){
  try{
    if(!URL_MIS_LIKES_JSON) return [];
    const res = await fetch(URL_MIS_LIKES_JSON, { credentials:'same-origin', cache:'no-store' });
    if(!res.ok) return [];

    const data = await res.json();

    const raw =
      (Array.isArray(data?.songs) && data.songs) ||
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.playlist?.songs) && data.playlist.songs) ||
      [];

    return raw.map(normalizeSong).filter(Boolean);
  }catch(e){
    console.warn('fetchMyLikes() falló:', e);
    return [];
  }
}

function buildPlaylistsModel({ allPlaylists, mySongs, myLikes, isArtist = false }) {
  const abs = (u) => {
    try { return u ? new URL(u, location.origin).href : ""; }
    catch { return u || ""; }
  };
  const dedup = (arr, keyFn) => {
    const seen = new Set(); const out = [];
    for (const it of (Array.isArray(arr) ? arr : [])) {
      const k = keyFn(it);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  };
  const keyer = (s) =>
    _songKey(s) ||
    abs(s.audioUrl) ||
    `${(s.title || "").toLowerCase()}::${(s.author || "").toLowerCase()}`;

  const flattenAll = (Array.isArray(allPlaylists) ? allPlaylists : [])
    .flatMap(pl => Array.isArray(pl.songs) ? pl.songs : []);
  const allUnique  = dedup(flattenAll, keyer);
  const allPlaylist = {
    id: 'pl:all',
    name: 'Todas tus canciones',
    songs: allUnique,
  };

  const mineUnique  = dedup(mySongs || [], keyer);
  const likesUnique = dedup(myLikes || [], keyer);

  const out = [allPlaylist, ...(Array.isArray(allPlaylists) ? allPlaylists : [])];

  if (isArtist && mineUnique.length) {
    out.splice(1, 0, {
      id: 'pl:mine',
      name: 'Mi música',
      songs: mineUnique,
    });
  }

  const after    = out.findIndex(p => p.id === 'pl:mine');
  const insertAt = after >= 0 ? after + 1 : 1;
  out.splice(insertAt, 0, {
    id: 'pl:likes',
    name: 'Music that i love',
    songs: likesUnique,
  });

  return out;
}

// ---------------------------- SPA: render menú -----------------------------
export async function renderMenuReproductor({ mainContent, contentDiv, URL_MI_MUSICA_JSON }) {
  const u = new URL(location.href); u.searchParams.set('view','reproductor'); history.replaceState(null,'',u.toString());
  mainContent.dataset.view = 'reproductor';

  const IS_ARTIST = isArtistUser();

  const URL_MIS_LIKES_JSON =
    mainContent?.dataset?.urlMisLikesJson ||
    document.getElementById('main-content')?.dataset?.urlMisLikesJson ||
    '/mis-likes/json/';

  let [allPlaylists, mySongs, myLikes] = await Promise.all([
    fetchAllPlaylistsWithSongs(),
    IS_ARTIST ? fetchMyMusic(URL_MI_MUSICA_JSON) : Promise.resolve([]),
    fetchMyLikes(URL_MIS_LIKES_JSON)
  ]);

  if (!mySongs || mySongs.length === 0) {
    try {
      const el = document.getElementById('playlists-data-json');
      const injected = JSON.parse(el?.textContent || '[]');
      const norm = (s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
      let candidates = [];
      if (Array.isArray(injected)) {
        const byName = injected.find(p => norm(p?.name).includes('mi musica'));
        if (byName && Array.isArray(byName.songs)) candidates = byName.songs;
        if ((!candidates.length) && injected.length === 1 && Array.isArray(injected[0]?.songs)) {
          candidates = injected[0].songs;
        }
      } else if (Array.isArray(injected?.songs)) {
        candidates = injected.songs;
      }
      if (candidates.length) mySongs = candidates.map(normalizeSong).filter(Boolean);
    } catch(e) { console.warn('Fallback Mi música (injected) falló:', e); }
  }

  window._likes = Array.isArray(myLikes) ? myLikes : [];
  let basePlaylists = buildPlaylistsModel({ allPlaylists, mySongs, myLikes, isArtist: IS_ARTIST });
  basePlaylists = _injectHistoryIntoPlaylists(basePlaylists);
  window._playlists = basePlaylists;

  try { ensureDailyRoll(window._playlists); } catch {}

  const P = Array.isArray(window._playlists) ? window._playlists : [];
  const rightHTML = buildRightSidebarHTML({ playlists: P, genres: DEFAULT_GENRES || [] }) || '';
  contentDiv.innerHTML = `<div class="rep-grid"><div class="rep-left"></div><div class="rep-right">${rightHTML}</div></div>`;

  const all = P.find(p => p.id === 'pl:all') || P[0] || { id: 'pl:tmp', name: '(sin playlists)', songs: [] };
  renderLeftSongs(Array.isArray(all.songs) ? all.songs : [], all.name || 'Playlist', { countsMode: null });

  inicializarReproductor();
  attachSidebarHandlers();
}

// ---------------------------- Refresco dinámico Top10 ----------------------
function _refreshTop10View(){
  const ul=document.getElementById('rep-playlists');
  if(!ul || !isTop10Active()) return;
  const left=q('.rep-left'); if(left){ const oldH = left.querySelector('.rep-stats'); if(oldH) oldH.remove(); }
  const freshTop10 = buildTop10FromPlaylistsFrozen(window._playlists || []);
  renderLeftSongs(freshTop10.songs, freshTop10.name, {countsMode:'daily', countsStamp:_countsStampForToday()});
  _renderTop10Header({songs: freshTop10.songs});
  try { window.MDFCore?.rebindReproductor?.(); } catch {}
}

// ---------------------------- Ciclo de vida --------------------------------
export function inicializarReproductor(){
  ensureAudio(); hookViewGuard();
  if(isPlayableView()){
    collectQueueFromDOM(); bindClicks(true);
    if(_state.audio?.src) fireBar();
    observeListChanges();
  } else {
    bindClicks(false); observeListChanges();
  }
}
export function stopReproductor(){
  bindClicks(false);
  if(_state.audio) _state.audio.pause();
  clearRowHighlight();
  if(_state.moList){ _state.moList.disconnect(); _state.moList=null; }
}
export function rebindReproductor(){
  ensureAudio(); collectQueueFromDOM(); bindClicks(isPlayableView());
  if(_state.audio?.src) fireBar();
}
export async function stopReproductorIfLoaded(){ try{ stopReproductor(); }catch{} }

export function wireReproductorPlaylistEvents({ mainContent }){
  window.addEventListener('melodify:playlists:changed', async ()=>{
    if((mainContent?.dataset.view||'')==='reproductor'){
      try{ await renderMenuReproductor({ mainContent, contentDiv:document.getElementById('content'), URL_MI_MUSICA_JSON: mainContent?.dataset?.urlMiMusicaJson }); }catch{}
    }
  });
}

function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

function _toggleLikeFromReproductor(evt, idSongRaw) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }

  const idSong = String(idSongRaw || '').trim();
  if (!idSong) return;

  const csrftoken = getCookie('csrftoken') || '';

  fetch(`/api/like/song/${encodeURIComponent(idSong)}/`, {
    method: 'POST',
    headers: {
      'X-CSRFToken': csrftoken,
      'X-Requested-With': 'XMLHttpRequest',
    },
  })
    .then((res) => res.json())
    .then((data) => {
      const liked = !!data.liked;

      const selector = [
        `.song-like-btn[data-song-id="${CSS.escape(idSong)}"]`,
        `.search-btn-like[data-song-id="${CSS.escape(idSong)}"]`,
        `.cat-like-btn[data-song-id="${CSS.escape(idSong)}"]`,
        `[data-like-song-id="${CSS.escape(idSong)}"]`,
      ].join(', ');

      const buttons = document.querySelectorAll(selector);
      let rowForMeta = null;

      buttons.forEach((btn) => {
        const scope = btn.dataset.likeScope || '';

        // Botón en Home: estilo básico sin cambios de color permanentes
        btn.dataset.liked = liked ? '1' : '0';
        btn.setAttribute('data-liked', liked ? '1' : '0');
        btn.setAttribute('aria-pressed', liked ? 'true' : 'false');

        if (scope === 'home') {
          const txt = (btn.textContent || '').trim();
          if (txt === '♥' || txt === '♡' || txt === '') {
            btn.textContent = '♡';
          }
          btn.classList.remove('is-liked', 'liked', 'active');
        } else {
          // Vistas de reproductor / otras secciones
          btn.classList.toggle('is-liked', liked);
          const txt = (btn.textContent || '').trim();
          if (txt === '♥' || txt === '♡') {
            btn.textContent = liked ? '♥' : '♡';
          }
        }

        if (!rowForMeta) {
          const cand = btn.closest(
            '.song-item, .search-item-song, article.song, article.cat-song, .muro-song-row, .gestion-song-row'
          );
          if (cand) rowForMeta = cand;
        }
      });

      let meta = null;
      if (rowForMeta) {
        meta = {
          title: rowForMeta.getAttribute('data-title') || '',
          artist: rowForMeta.getAttribute('data-author') || '',
          audioUrl: rowForMeta.getAttribute('data-audio-url') || '',
          coverUrl:
            rowForMeta.querySelector('.song-cover')?.getAttribute('src') || '',
          genre: rowForMeta.getAttribute('data-genre') || '',
        };
      }

      if (
        window.MDFCore &&
        typeof window.MDFCore.syncLikeModelFromClient === 'function'
      ) {
        window.MDFCore.syncLikeModelFromClient(idSong, liked, meta);
      }

      // Mensaje de feedback
      _toast(liked ? 'Añadido a tus me gusta' : 'Quitado de tus me gusta');
    })
    .catch((err) => {
      console.error('Error en like desde reproductor:', err);
    });
}

function _performAddSongToPlaylist(plId, idSong) {
  const backendId = String(plId || '').replace(/^pl:/, '').trim();
  const songId    = String(idSong || '').trim();
  if (!backendId || !songId) {
    console.warn('Playlist o canción inválida en _performAddSongToPlaylist:', plId, idSong);
    _toast('No se pudo agregar la canción.');
    return;
  }

  // Se intenta usar helpers específicos de la vista y, si no existen, se recurre al backend
  if (typeof window.addSongToPlaylistFromSearch === 'function') {
    try {
      window.addSongToPlaylistFromSearch(Number(songId) || songId,
                                         Number(backendId) || backendId);
      return;
    } catch (e) {
      console.warn('addSongToPlaylistFromSearch falló, aplico fallback:', e);
    }
  } else if (typeof window.addSongToPlaylist === 'function') {
    try {
      window.addSongToPlaylist(Number(backendId) || backendId,
                               Number(songId)    || songId);
      return;
    } catch (e) {
      console.warn('addSongToPlaylist falló, aplico fallback:', e);
    }
  }

  // Fallback universal
  _fallbackAddSongToPlaylist(backendId, songId)
    .catch(err => {
      console.error('Fallback agregar canción falló:', err);
      _toast('No se pudo agregar la canción.');
    });
}
function _performRemoveSongFromPlaylist(plId, idSong) {
  const backendId = String(plId || '').replace(/^pl:/, '').trim();
  const songId    = String(idSong || '').trim();
  if (!backendId || !songId) {
    console.warn(
      'Playlist o canción inválida en _performRemoveSongFromPlaylist:',
      plId,
      idSong
    );
    _toast('No se pudo quitar la canción de la playlist.');
    return;
  }

  // Se intentan helpers específicos de la vista antes del acceso directo al backend
  if (typeof window.removeSongFromPlaylistFromSearch === 'function') {
    try {
      window.removeSongFromPlaylistFromSearch(
        Number(songId)    || songId,
        Number(backendId) || backendId
      );
      return;
    } catch (e) {
      console.warn('removeSongFromPlaylistFromSearch falló, aplico fallback:', e);
    }
  } else if (typeof window.removeSongFromPlaylist === 'function') {
    try {
      window.removeSongFromPlaylist(
        Number(backendId) || backendId,
        Number(songId)    || songId
      );
      return;
    } catch (e) {
      console.warn('removeSongFromPlaylist falló, aplico fallback:', e);
    }
  }

  // Fallback universal (usa /playlist/removesong/)
  _fallbackRemoveSongFromPlaylist(backendId, songId).catch(err => {
    console.error('Fallback quitar canción falló:', err);
    _toast('No se pudo quitar la canción de la playlist.');
  });
}

async function _bulkAddSongsToPlaylist(plId, songIds) {
  const ids = Array.from(
    new Set((songIds || []).map(x => String(x || '').trim()).filter(Boolean))
  );
  for (const sid of ids) {
    // Usa la misma lógica que el modal "Agregar a playlist"
    await _performAddSongToPlaylist(plId, sid);
  }
}

async function _bulkRemoveSongsFromPlaylist(plId, songIds) {
  const ids = Array.from(
    new Set((songIds || []).map(x => String(x || '').trim()).filter(Boolean))
  );
  for (const sid of ids) {
    await _performRemoveSongFromPlaylist(plId, sid);
  }
}

// --- Fallback directo al backend para quitar canción de una playlist ---
async function _fallbackRemoveSongFromPlaylist(backendId, songId) {
  const pid = String(backendId || '').trim();
  const sid = String(songId || '').trim();
  if (!pid || !sid) throw new Error('Playlist o canción inválida.');

  const csrftoken = getCookie('csrftoken') || '';

  const res = await fetch(`/playlist/removesong/`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
      ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}),
    },
    body: JSON.stringify({
      playlist_id: Number(pid) || pid,
      song_id:    Number(sid) || sid,
    }),
  });

  if (!res.ok) {
    let err = '';
    try { err = (await res.json())?.error || ''; } catch {}
    throw new Error(err || `HTTP ${res.status}`);
  }

  // Actualizar modelo local + badge + vista activa
  try {
    const plistId = `pl:${pid}`;
    const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
    const idx = pls.findIndex(p => String(p.id) === plistId);
    if (idx >= 0) {
      const songs = Array.isArray(pls[idx].songs) ? pls[idx].songs.slice() : [];
      const nextSongs = songs.filter(s => String(s.id) !== sid);
      pls[idx] = { ...pls[idx], songs: nextSongs };
      window._playlists = pls;

      const li = document.querySelector(
        `#rep-playlists li[data-pl="${CSS.escape(plistId)}"]`
      );
      if (li) {
        const badge = li.querySelector('.rep-badge');
        if (badge) badge.textContent = String(nextSongs.length);
      }

      const main = document.getElementById('main-content');
      const isReproductor = (main?.dataset.view || '').trim() === 'reproductor';
      if (isReproductor) {
        const active = document.querySelector(
          `#rep-playlists li.active[data-pl="${CSS.escape(plistId)}"]`
        );
        if (active) {
          renderLeftSongs(
            nextSongs,
            pls[idx].name || 'Playlist',
            { countsMode: null }
          );
        }
      }
    }
  } catch (e) {
    console.warn('No se pudo actualizar modelo local tras removesong:', e);
  }

  document.dispatchEvent(new CustomEvent('melodify:playlists:changed'));
  _toast('Canción eliminada de la playlist.');
}

// ---------------------------- UI overlay "Agregar a playlist" --------------
let _addToPlaylistOverlay = null;
const _ADD_TO_PLAYLIST_FORBIDDEN = new Set([
  'pl:all',
  'pl:mine',
  'pl:likes',
  'pl:top10',
  'pl:discover',
  'pl:history',
]);

function _ensureAddToPlaylistOverlay() {
  if (_addToPlaylistOverlay) return _addToPlaylistOverlay;

  const overlay = document.createElement('div');
  overlay.id = 'mdf-add-to-playlist-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="atp-backdrop">
      <div class="atp-modal" role="dialog" aria-modal="true">
        <h3 class="atp-title">Agregar a playlist</h3>
        <p class="atp-subtitle">Elige una playlist para añadir esta canción.</p>
        <ul class="atp-list"></ul>
        <div class="atp-footer">
          <button type="button" class="atp-cancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', () => {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  });

  const modal = overlay.querySelector('.atp-modal');
  if (modal) {
    modal.addEventListener('click', (ev) => ev.stopPropagation());
  }

  const btnCancel = overlay.querySelector('.atp-cancel');
  if (btnCancel) {
    btnCancel.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    });
  }

  if (!document.getElementById('mdf-add-to-playlist-styles')) {
    const style = document.createElement('style');
    style.id = 'mdf-add-to-playlist-styles';
    style.textContent = `
      #mdf-add-to-playlist-overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.55);
        z-index: 9999;
      }
      #mdf-add-to-playlist-overlay.is-open {
        display: flex;
      }
      #mdf-add-to-playlist-overlay .atp-modal {
        background: #181818;
        color: #f5f5f5;
        border-radius: 12px;
        padding: 16px 18px 14px;
        max-width: 360px;
        width: min(360px, 90vw);
        box-shadow: 0 22px 45px rgba(0,0,0,.7);
        border: 1px solid var(--line, #333);
        font-size: 14px;
      }
      #mdf-add-to-playlist-overlay .atp-title {
        margin: 0 0 4px;
        font-size: 15px;
      }
      #mdf-add-to-playlist-overlay .atp-subtitle {
        margin: 0 0 10px;
        font-size: 12px;
        opacity: .8;
      }
      #mdf-add-to-playlist-overlay .atp-list {
        list-style: none;
        margin: 0 0 10px;
        padding: 0;
        max-height: 230px;
        overflow: auto;
      }
      #mdf-add-to-playlist-overlay .atp-item {
        margin: 3px 0;
      }
      #mdf-add-to-playlist-overlay .atp-btn {
        width: 100%;
        text-align: left;
        padding: 6px 9px;
        border-radius: 8px;
        border: 1px solid var(--line, #333);
        background: #202020;
        color: inherit;
        cursor: pointer;
        font-size: 13px;
      }
      #mdf-add-to-playlist-overlay .atp-btn:hover {
        background: #292929;
      }
      #mdf-add-to-playlist-overlay .atp-footer {
        display: flex;
        justify-content: flex-end;
      }
      #mdf-add-to-playlist-overlay .atp-cancel {
        border: none;
        background: transparent;
        color: #9aa0a6;
        cursor: pointer;
        font-size: 12px;
        padding: 4px 6px;
      }
      #mdf-add-to-playlist-overlay .atp-cancel:hover {
        color: #e0e0e0;
      }
    `;
    document.head.appendChild(style);
  }

  _addToPlaylistOverlay = overlay;
  return overlay;
}

window.openAddToPlaylistForSong = function(idSongRaw) {
  const idSong = String(idSongRaw || '').trim();
  if (!idSong) return;

  (async () => {
    try {
      const getCandidates = (list) => {
        const arr = Array.isArray(list) ? list : [];
        return arr.filter((p) => {
          const pid = String(p.id || '').trim();
          if (!pid || _ADD_TO_PLAYLIST_FORBIDDEN.has(pid)) return false;
          return true;
        });
      };

      let pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
      let candidates = getCandidates(pls);

      if (!candidates.length) {
        const serverPlaylists = await fetchAllPlaylistsWithSongs().catch(() => []);
        const merged = pls.slice();
        const seen = new Set(merged.map((p) => String(p.id || '')));

        for (const pl of serverPlaylists || []) {
          if (!pl || pl.id == null) continue;
          const pid = String(pl.id);
          if (seen.has(pid)) continue;
          seen.add(pid);
          merged.push(pl);
        }

        window._playlists = merged;
        pls = merged;
        candidates = getCandidates(pls);
      }

      if (!candidates.length) {
        return;
      }

      const overlay = _ensureAddToPlaylistOverlay();
      const listEl = overlay.querySelector('.atp-list');
      if (!listEl) return;

      listEl.innerHTML = '';
      candidates.forEach((pl, idx) => {
        const li = document.createElement('li');
        li.className = 'atp-item';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'atp-btn';
        btn.textContent = pl.name || `Playlist ${idx + 1}`;
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          overlay.classList.remove('is-open');
          overlay.setAttribute('aria-hidden', 'true');
          _performAddSongToPlaylist(pl.id, idSong);
        });

        li.appendChild(btn);
        listEl.appendChild(li);
      });

      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
    } catch (e) {
      console.error('openAddToPlaylistForSong falló:', e);
      alert('No se pudieron cargar tus playlists. Intenta de nuevo.');
    }
  })();
};

function _openAddToPlaylistDialog(evt, idSongRaw) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }

  const idSong = String(idSongRaw || '').trim();
  if (!idSong) return;

  if (typeof window.openAddToPlaylistForSong === 'function') {
    window.openAddToPlaylistForSong(idSong);
  } else {
    alert('No se encontró la UI para agregar a playlist.');
  }
}

// ---------------------------- Listeners en vivo (badges / stats) -----------
window.addEventListener("melodify:playcount", (ev)=>{
  const k = ev?.detail?.key; if(!k) return;

  const nodes = document.querySelectorAll(`.rep-badge[data-badge="plays"][data-skey="${CSS.escape(k)}"]`);
  nodes.forEach((n)=>{
    const scope = n.getAttribute('data-scope');
    if (scope === 'day') n.textContent = String(getTodayCount({ _k:k }) || 0);
    else if (scope === 'week') n.textContent = String(getWeekCount({ _k:k }, 7, true) || 0);
  });

  const header = q('.rep-left .rep-stats'); if(!header) return;
  const scope = header.getAttribute('data-scope');
  let total = 0;
  qa('.rep-left .song-item').forEach((row)=>{
    const sk = row.getAttribute('data-skey');
    if(!sk) return;
    if(scope==='day') total += getTodayCount({ _k:sk });
    else total += getWeekCount({ _k:sk }, 7, true);
  });
  const totalNode = header.querySelector('.rep-total');
  if(totalNode){
    if(scope==='day') totalNode.innerHTML = `<strong>Reproducciones (hoy):</strong> ${total}`;
    else totalNode.innerHTML = `<strong>Reproducciones (7d):</strong> ${total}`;
  }

  const hdrTop10 = q('.rep-left .top10-header');
  if(hdrTop10 && scope==='day'){
    const statsDay = _computeDailyStats({playlists: window._playlists||[]});
    const gLabel = (g)=>({pop:'Pop',rock:'Rock',electronica:'Electrónica',salsa:'Salsa',indie:'Indie',hiphop:'Hip-Hop',reggaeton:'Reguetón',regional:'Regional',balada:'Balada',jazz:'Jazz',clasica:'Clásica',otro:'Otro'})[g] || (g||'—');
    const blocks = hdrTop10.querySelectorAll('div');
    blocks.forEach(div=>{
      if(div.textContent.includes('Género top')){
        div.innerHTML = `<strong>Género top (hoy):</strong> ${gLabel(statsDay.topGenre[0])} <small style="opacity:.7">(${statsDay.topGenre[1]||0})</small>`;
      }else if(div.textContent.includes('Artista top')){
        div.innerHTML = `<strong>Artista top (hoy):</strong> ${statsDay.topArtist[0]||'—'} <small style="opacity:.7">(${statsDay.topArtist[1]||0})</small>`;
      }
    });
  }
});

// ---------------------------- SPA playlists (ganchos) ----------------------
let currentViewPlaylist  = "allPlayList";
export function crearPlaylist(){ console.log('crearPlaylist no implementado'); }
export function likePlaylist(id){ console.log('likePlaylist no implementado:', id); }
export function editarPlaylist(id){ console.log('editarPlaylist no implementado:', id); }
export function eliminarPlaylist(id){ console.log('eliminarPlaylist no implementado:', id); }
export function showPlaylists(){}
export function verSongs(playlistId){}
export function playSong(id){ console.log('Reproduciendo canción con ID:', id); }
export function likeSong(){}

// ---------------------------- Auto-init ------------------------------------
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ()=>inicializarReproductor());
} else {
  try { inicializarReproductor(); } catch {}
}
