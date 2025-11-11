/* ==========================================================================
   Reproductor central (cola + audio) — SIN control de la barra
   - Emite eventos para que barra_reproduccion.js pinte/controle la UI
   - Expone 'window.MDFCore' para la barra
   - Exporta funciones para la SPA (render, hooks, etc.)
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

const q  = (s, r=document)=>r.querySelector(s);
const qa = (s, r=document)=>Array.from(r.querySelectorAll(s));
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

// ---------------------------- Utilidades -----------------------------------
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
function absHref(u){
  try{ return u?new URL(u,location.origin).href:""; }catch{ return ""; }
}
function fmtTime(t){
  if(!Number.isFinite(t)) return "0:00";
  t=Math.max(0,Math.floor(t));
  const m=Math.floor(t/60), s=String(t%60).padStart(2,"0");
  return `${m}:${s}`;
}
function fire(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
}
function isTop10Active(){
  return !!q('#rep-playlists li.active[data-pl="pl:top10"]');
}
function _currentSong(){ return _state.queue[_state.index] || null; }

function isArtistUser(){
  const main = document.getElementById('main-content');

  const role = (main?.dataset.role || '').trim().toLowerCase();
  if (role.includes('artista')) return true;

  const v =
    (main?.dataset.isArtist ??                       // data-is-artist="1|0"
     window.__IS_ARTIST__ ??                         // bandera global
     document.querySelector('meta[name="is-artist"]')?.content // <meta ...>
    ) ?? '';
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true';
}

// ---------------------------- Fecha / Día ----------------------------------
function _pad2(n){ return String(n).padStart(2,'0'); }
function todayStamp(){
  const d=new Date();
  return `${d.getFullYear()}${_pad2(d.getMonth()+1)}${_pad2(d.getDate())}`;
}
function yesterdayStamp(){
  const d=new Date(); d.setDate(d.getDate()-1);
  return `${d.getFullYear()}${_pad2(d.getMonth()+1)}${_pad2(d.getDate())}`;
}

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
    if (key && key.startsWith(ORDER_PREFIX)){
      const stamp = key.slice(ORDER_PREFIX.length);
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

function _countsStampForToday(){
  const y = yesterdayStamp();
  if (_hasAnyPlays(y)) return y;
  const { stamp } = _findLastFrozenOrderBefore(todayStamp());
  return stamp || y;
}

// ---------------------------- Plays (Top 10) -------------------------------
const PLAYS_PREFIX  = "mdf.plays.";
const ORDER_PREFIX  = "mdf.top10.order.";

function _songKey(song){
  const byId = song?.id ? `id:${song.id}` : "";
  const byUrl = song?.audioUrl ? `u:${absHref(ensureAbs(song.audioUrl))}` : "";
  return byId || byUrl || "";
}
function _loadJSON(key, fallback){
  try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; }catch{ return fallback; }
}
function _saveJSON(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }catch{}
}

function _loadDailyPlays(stamp){ return _loadJSON(PLAYS_PREFIX+stamp, {}); }
function _saveDailyPlays(stamp, obj){ _saveJSON(PLAYS_PREFIX+stamp, obj||{}); }

function registerPlay(song){
  const k=_songKey(song); if(!k) return;
  const stamp=todayStamp();
  const db=_loadDailyPlays(stamp);
  db[k]=(db[k]||0)+1;
  _saveDailyPlays(stamp, db);
}
function getPlayCountAtStamp(song, stamp){
  const k=_songKey(song); if(!k) return 0;
  const db=_loadDailyPlays(stamp);
  return db[k]||0;
}
function getYesterdayPlayCount(song){
  return getPlayCountAtStamp(song, yesterdayStamp());
}
function _getFrozenOrder(stamp){ return _loadJSON(ORDER_PREFIX+stamp, []); }
function _setFrozenOrder(stamp, arr){ _saveJSON(ORDER_PREFIX+stamp, Array.isArray(arr)?arr.slice(0,10):[]); }

// ------------------------- Helpers de normalización ------------------------
const pickFirst = (...c) => c.find(v => typeof v === 'string' && v.trim().length) || "";

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

// ------------------ Carga playlists reales (devuelve array) ----------------
async function fetchAllPlaylistsWithSongs() {
  try {
    const res = await fetch('/playlist/getAllList', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lists = await res.json();

    if (!Array.isArray(lists) || !lists.length) return [];

    const byId = async (pl) => {
      const r = await fetch(`/playlist/${pl.id}/songs/`, { credentials:'same-origin', cache:'no-store' });
      if (!r.ok) return { id: `pl:${pl.id}`, name: pl.name || `Playlist ${pl.id}`, songs: [] };
      const data  = await r.json();
      const raw   = Array.isArray(data?.songs) ? data.songs : [];
      const norm  = raw.map(normalizeSong).filter(Boolean);
      return { id: `pl:${pl.id}`, name: pl.name || `Playlist ${pl.id}`, songs: norm };
    };

    const all = await Promise.all(lists.map(byId));
    return all;
  } catch (e) {
    console.warn('fetchAllPlaylistsWithSongs() falló:', e);
    return [];
  }
}

// --------------------- “Mi música” (del artista actual) --------------------
async function fetchMyMusic(URL_MI_MUSICA_JSON){
  try{
    if(!URL_MI_MUSICA_JSON) return [];
    const res = await fetch(URL_MI_MUSICA_JSON, {
      credentials:'same-origin',
      cache:'no-store',
      headers:{'X-Requested-With':'fetch'}
    });
    if(!res.ok) return [];
    const data  = await res.json();
    const raw   = (Array.isArray(data?.songs) && data.songs)
               || (Array.isArray(data?.results) && data.results)
               || (Array.isArray(data?.playlist?.songs) && data.playlist.songs)
               || [];
    return raw.map(normalizeSong).filter(Boolean);
  }catch(e){
    console.warn('fetchMyMusic() falló:', e);
    return [];
  }
}

// ------------------------- Universo y Top10 congelado ----------------------
function _abs(u){ try{ return u? new URL(u, location.origin).href : ""; }catch{ return u||""; } }
function _dedup(arr, keyFn){
  const seen=new Set(), out=[];
  for(const it of arr){
    const k=keyFn(it); if(!k||seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}
function _flattenUniqueSongs(playlists){
  const all=(Array.isArray(playlists)?playlists:[]).flatMap(pl=>Array.isArray(pl.songs)?pl.songs:[]);
  return _dedup(all, s => _songKey(s) || _abs(s.audioUrl) || `${(s.title||'').toLowerCase()}::${(s.author||'').toLowerCase()}`);
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

function buildTop10FromPlaylistsFrozen(playlists){
  const base=_flattenUniqueSongs(playlists);
  const byKey=new Map(base.map(s=>[_songKey(s), s]));
  const frozen=_getFrozenOrder(todayStamp());
  const out=[];
  for(const k of frozen){
    const s=byKey.get(k);
    if(s) out.push(s);
  }
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


// ------- Construye modelo final: Todas + Mi música + reales ----------------
function buildPlaylistsModel({ allPlaylists, mySongs, isArtist = false }) {
  const abs = (u) => { try { return u ? new URL(u, location.origin).href : ""; } catch { return u || ""; } };
  const dedup = (arr, keyFn) => {
    const seen = new Set(); const out = [];
    for (const it of (Array.isArray(arr) ? arr : [])) {
      const k = keyFn(it);
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(it);
    }
    return out;
  };

  const flattenAll = (Array.isArray(allPlaylists) ? allPlaylists : [])
    .flatMap(pl => Array.isArray(pl.songs) ? pl.songs : []);

  const allUnique = dedup(
    flattenAll,
    s => _songKey(s) || abs(s.audioUrl) || `${(s.title||'').toLowerCase()}::${(s.author||'').toLowerCase()}`
  );
  const allPlaylist = { id: 'pl:all', name: 'Todas las canciones', songs: allUnique };

  const mineUnique = dedup(
    mySongs || [],
    s => _songKey(s) || abs(s.audioUrl) || `${(s.title||'').toLowerCase()}::${(s.author||'').toLowerCase()}`
  );

  // Orden: Todas → (Mi música si aplica) → Playlists reales
  const out = [allPlaylist, ...(Array.isArray(allPlaylists) ? allPlaylists : [])];
if (mineUnique.length) {
  out.splice(1, 0, { id: 'pl:mine', name: 'Mi música', songs: mineUnique });
}
return out;
}


// -------------------- Gestión de selección / cola --------------------------
function clearRowHighlight(){
  qa(".song-item.is-playing").forEach(el=>el.classList.remove("is-playing"));
}
function highlightCurrent(){
  clearRowHighlight();
  const n=q(`.song-item[data-_idx="${_state.index}"]`);
  if(n) n.classList.add("is-playing");
}

function collectQueueFromDOM({ retainIfEmpty = true } = {}) {
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

  if (nextQueue.length === 0 && retainIfEmpty) {
    return;
  }

  const prevQueue = _state.queue;
  const prevIndex = _state.index;

  _state.queue = nextQueue;

  if (nextQueue.length > 0) {
    const want = curHref ? _state.queue.findIndex(s => absHref(ensureAbs(s.audioUrl)) === curHref) : -1;
    if (want !== -1) {
      _state.index = want;
    } else if (prevQueue === nextQueue && prevIndex >= 0 && prevIndex < nextQueue.length) {
      _state.index = prevIndex;
    } else if (_state.index < 0) {
      _state.index = 0; 
    }
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
    if (hadSrc) fire("melodify:bar:shouldShow", {});
  }
  });
  _state.moList.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:["data-audio-url","data-id","data-title","data-author","data-genre","data-cover-url"]});
}

// ------------------------------- Audio -------------------------------------
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
    if (s && k && _state.countedForKey !== k && cur >= COUNT_AT_SECONDS) {
      registerPlay(s);
      _state.countedForKey = k;
      if (isTop10Active()) _refreshTop10View();
    }
  });

  a.addEventListener("loadedmetadata", ()=>{
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    fire("melodify:loaded", { duration: dur });
  });
  a.addEventListener("play", ()=>{ fire("melodify:state", { playing:true, paused:false }); });
  a.addEventListener("pause", ()=>{ fire("melodify:state", { playing:false, paused:true }); });
  a.addEventListener("ended", ()=>{ fire("melodify:ended", {}); next(); });

  _state.audio = a;
  fire("melodify:audioReady", { audio: a });
}

function setMetaFor(song){
  const meta = {
    title:  song?.title || "—",
    artist: song?.author || song?.artist_display_name || "—",
    cover:  ensureAbs(song?.coverUrl || song?.cover_url || song?.cover || ""),
    genre:  song?.genre || song?.genero || "",
  };
  fire("melodify:trackmeta", meta);
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
  fire("melodify:bar:shouldShow", {});
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

// ------------------------------- Vistas ------------------------------------
const PLAYABLE_VIEWS = new Set(["reproductor", "playlist", "home"]);
function getCurrentView(){
  const m=document.getElementById("main-content");
  return (m?.dataset.view||m?.dataset.initialView||"").trim();
}
function isPlayableView(){ return PLAYABLE_VIEWS.has(getCurrentView()); }

function hookViewGuard(){
  if(_state.guardHooked) return; _state.guardHooked=true;
  const main=document.getElementById("main-content"); if(!main) return;

  const apply = ()=>{
  const playable = isPlayableView();
  if (playable) {
collectQueueFromDOM({ retainIfEmpty: true }); // ⬅️ retiene cola si no hay items
    bindClicks(true);
    observeListChanges();
  } else {
    bindClicks(false);
    observeListChanges();
  }
};


  apply();
  if(_state.moView) _state.moView.disconnect();
  _state.moView=new MutationObserver(apply);
  _state.moView.observe(main,{attributes:true, attributeFilter:["data-view"]});
}

// --------------- API global (para la barra y consola) ----------------------
window.MDFCore = {
  getAudio(){ ensureAudio(); return _state.audio; },
  getQueue(){ return _state.queue.slice(); },
  getIndex(){ return _state.index; },
  load: (idx, autoplay=true)=> load(idx, autoplay),
  toggle: ()=> toggle(),
  prev: ()=> prev(),
  next: ()=> next(),
  seekPercent: (p01)=>{
    ensureAudio();
    const a=_state.audio; if(!a||!Number.isFinite(a.duration)||a.duration<=0) return;
    const pct=clamp(Number(p01)||0,0,1);
    a.currentTime = Math.max(0, Math.min(a.duration*pct, a.duration-0.25));
  },
  setVolume: (v)=>{ ensureAudio(); _state.audio.volume = clamp(Number(v)||0,0,1); },
};

// -------------------- Exports para la SPA / menú ---------------------------
export const DEFAULT_GENRES = [
  {value:'pop',label:'Pop'},{value:'rock',label:'Rock'},{value:'electronica',label:'Electrónica'},
  {value:'salsa',label:'Salsa'},{value:'indie',label:'Indie'},{value:'hiphop',label:'Hip-Hop'},
  {value:'reggaeton',label:'Reguetón'},{value:'regional',label:'Regional Mexicano'},
  {value:'balada',label:'Balada'},{value:'jazz',label:'Jazz'},{value:'clasica',label:'Clásica'},{value:'otro',label:'Otro'},
];

function _esc(s){
  return String(s??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function _playlistSongRow(song, {showCounts=false, countsStamp=null}={}){
  const isStr=typeof song==='string';
  const title=isStr?song:(song?.title||'—');
  const author=isStr?'—':(song?.author||song?.artist_display_name||song?.artist||'—');
  const cover=isStr?null:ensureAbs(song?.coverUrl||song?.cover_url||song?.cover||'');
  const audio=isStr?'':ensureAbs(song?.audioUrl||song?.audio_url||song?.audio||'');
  const genre=!isStr?(song?.genre||song?.genero||''):'';
  let plays = 0;
  if(showCounts && countsStamp){
    plays = getPlayCountAtStamp(song, countsStamp);
  }
  const coverHTML = cover
    ? `<img src="${_esc(cover)}" alt="${_esc(title)}" class="song-cover">`
    : `<div class="song-cover song-cover--placeholder"></div>`;
  const badge = showCounts && countsStamp ? ` <span class="rep-badge" data-badge="plays">${plays} reproducciones</span>` : "";
  return `
    <div class="song-item" data-id="${_esc(song?.id ?? '')}" data-audio-url="${_esc(audio)}"
         data-title="${_esc(title)}" data-author="${_esc(author)}" data-genre="${_esc(genre)}">
      ${coverHTML}
      <div class="song-info">
        <div class="song-title">${_esc(title)}${badge}</div>
        <div class="song-author">${_esc(author)}</div>
      </div>
    </div>`;
}

export function renderLeftSongs(songs, titleForEmpty='Playlist', {showCounts=false, countsStamp=null}={}){
  const left=q('.rep-left'); if(!left) return;
  if(!songs||!songs.length){
    left.innerHTML=`<div class="rep-empty"><div><h3 style="margin:0">${_esc(titleForEmpty)}</h3><p>No hay canciones.</p></div></div>`;
  }else{
    left.innerHTML=`<div class="songs-wrap">${songs.map(s => _playlistSongRow(s,{showCounts, countsStamp})).join('')}</div>`;
  }
  try{ inicializarReproductor(); }catch{}
}

// ---------- Sidebar: Playlists (todas) + Géneros ---------------------------
export function buildRightSidebarHTML({playlists, genres=DEFAULT_GENRES}){
  const P = Array.isArray(playlists) ? playlists.slice() : [];

  try{ ensureDailyRoll(P); }catch{}

  const top10 = buildTop10FromPlaylistsFrozen(P);
  const i = P.findIndex(p => p.id === 'pl:top10');
  if (i >= 0) P.splice(i,1);

  let insertAt = 0;
  for (const id of ['pl:all','pl:mine']){
    const idx = P.findIndex(p => p.id===id);
    if (idx >= 0 && idx >= insertAt) insertAt = idx + 1;
  }
  P.splice(insertAt, 0, top10);

  const liHTML = P.map(pl=>{
    const songs = Array.isArray(pl.songs) ? pl.songs : [];
    return `
      <li data-pl="${_esc(pl.id)}"
          style="display:flex;align-items:center;gap:10px;background:#181818;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer">
        <span style="flex:1">${_esc(pl.name || 'Playlist')}</span>
        <span class="rep-badge">${songs.length}</span>
      </li>`;
  }).join('');

  const playlistsHTML = `
    <div class="rep-panel">
      <div class="rep-head"><h3 style="margin:0">Playlists</h3></div>
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

  const ul=document.getElementById('rep-playlists');
  if(ul){
    ul.querySelectorAll('li[data-pl]').forEach(li=>{
      li.addEventListener('click', ()=>{
        clearGenres(); clearPlaylists(); li.classList.add('active');
        const id=li.dataset.pl;
        const pl=(window._playlists||[]).find(p=>String(p.id)===String(id))
              || (id==='pl:top10' ? buildTop10FromPlaylistsFrozen(window._playlists||[]) : {name:'—',songs:[]});
        const showCounts = (id==='pl:top10');
        const countsStamp = showCounts ? _countsStampForToday() : null;
        renderLeftSongs(Array.isArray(pl.songs)?pl.songs:[], pl.name||'Playlist', {showCounts, countsStamp});
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
        renderLeftSongs(filtered, ch.textContent||'Género', {showCounts:false, countsStamp:null});
      });
    });
  }
}

// --------- Refresco dinámico de la vista Top10 (si está seleccionada) ------
function _refreshTop10View(){
  const ul=document.getElementById('rep-playlists');
  if(!ul || !isTop10Active()) return;
  const freshTop10 = buildTop10FromPlaylistsFrozen(window._playlists || []);
  renderLeftSongs(freshTop10.songs, freshTop10.name, {showCounts:true, countsStamp:_countsStampForToday()});
  try { window.MDFCore?.rebindReproductor?.(); } catch {}
}

// -------------------- Integración con la SPA -------------------------------
export async function renderMenuReproductor({ mainContent, contentDiv, URL_MI_MUSICA_JSON }) {
  // fija la vista y la URL
  const u = new URL(location.href);
  u.searchParams.set('view','reproductor');
  history.replaceState(null,'',u.toString());
  mainContent.dataset.view = 'reproductor';

  // 1) detectar artista
  const IS_ARTIST = isArtistUser();

  // 2) cargar playlists reales + mi música (si artista)
  let [allPlaylists, mySongs] = await Promise.all([
    fetchAllPlaylistsWithSongs(),
    IS_ARTIST ? fetchMyMusic(URL_MI_MUSICA_JSON) : Promise.resolve([])
  ]);

  // 3) Fallback: si "mi música" vino vacío, intenta leer #playlists-data-json
  if (!mySongs || mySongs.length === 0) {
    try {
      const jsonEl   = document.getElementById('playlists-data-json');
      const injected = JSON.parse(jsonEl?.textContent || '[]');
      const injectedMine = Array.isArray(injected)
        ? injected.find(p => String(p.name || '').toLowerCase().includes('mi música'))
        : null;
      if (injectedMine && Array.isArray(injectedMine.songs)) {
        mySongs = injectedMine.songs.map(normalizeSong).filter(Boolean);
      }
    } catch {}
  }

  // 4) construir el modelo y pintar
  window._playlists = buildPlaylistsModel({ allPlaylists, mySongs, isArtist: IS_ARTIST });

  try { ensureDailyRoll(window._playlists); } catch {}

  const P = Array.isArray(window._playlists) ? window._playlists : [];
  const rightHTML = buildRightSidebarHTML({ playlists: P, genres: DEFAULT_GENRES || [] }) || '';
  contentDiv.innerHTML = `<div class="rep-grid"><div class="rep-left"></div><div class="rep-right">${rightHTML}</div></div>`;

  const all = P.find(p => p.id === 'pl:all') || P[0] || { id: 'pl:tmp', name: '(sin playlists)', songs: [] };
  renderLeftSongs(Array.isArray(all.songs) ? all.songs : [], all.name || 'Playlist', { showCounts: false, countsStamp: null });

  inicializarReproductor();
  attachSidebarHandlers();
}

export async function stopReproductorIfLoaded(){ try{ stopReproductor(); }catch{} }

export function wireReproductorPlaylistEvents({ mainContent }){
  window.addEventListener('melodify:playlistChanged', async ()=>{
    if((mainContent?.dataset.view||'')==='reproductor'){
      try{ await renderMenuReproductor({ mainContent, contentDiv:document.getElementById('content') }); }catch{}
    }
  });
}

// --------------- Ciclo de vida público (para SPA) --------------------------
export function inicializarReproductor(){
  ensureAudio(); hookViewGuard();
  if(isPlayableView()){
    collectQueueFromDOM(); bindClicks(true);
    if(_state.audio?.src) fire("melodify:bar:shouldShow", {});
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
  if(_state.audio?.src) fire("melodify:bar:shouldShow", {});
}

// --------------- Auto-init suave al importar el módulo ---------------------
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ()=>inicializarReproductor());
} else {
  try { inicializarReproductor(); } catch {}
}

/* ==========================
   Sección playlists 
   ========================== */
let currentViewPlaylist  = "allPlayList";

function clickBackBtnPlaylist(){
  if(currentViewPlaylist  === "allSongsPlayList"){
    showPlaylists();
  }
}

export function crearPlaylist(){ console.log('crearPlaylist (stub)'); }
export function likePlaylist(id){ console.log('likePlaylist stub:', id); }
export function editarPlaylist(id){ console.log('editarPlaylist stub:', id); }
export function eliminarPlaylist(id){ console.log('eliminarPlaylist stub:', id); }

export function showPlaylists() {
  currentViewPlaylist  = "allPlayList";
  fetch('/playlist/getAllList', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(data => {
      const content = document.getElementById('content');
      if (!content) return;
      if (!Array.isArray(data) || data.length === 0) {
        content.innerHTML = '<li>No hay playlists.</li>';
        return;
      }
      content.innerHTML = '';
      data.forEach(p => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'flex-start';
        li.style.marginBottom = '20px';
        li.style.position = 'relative';

        const nameDiv = document.createElement('div');
        nameDiv.innerHTML = `<strong>${_esc(p.name || 'Playlist')}</strong>`;
        nameDiv.style.marginBottom = '8px';
        li.appendChild(nameDiv);

        const mediaContainer = document.createElement('div');
        mediaContainer.style.display = 'flex';
        mediaContainer.style.alignItems = 'flex-start';

        const img = document.createElement('img');
        img.src = '/static/inicio_sesion/img_playlist.png';
        img.width = 307;
        img.height = 222;
        img.alt = 'portada';
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => verSongs(p.id));
        mediaContainer.appendChild(img);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.style.display = 'flex';
        buttonsDiv.style.flexDirection = 'column';
        buttonsDiv.style.marginLeft = '10px';
        buttonsDiv.style.justifyContent = 'flex-start';
        buttonsDiv.style.gap = '8px';

        const likeBtn = document.createElement('button');
        likeBtn.textContent = 'Like';
        likeBtn.className = 'btnRoundPlaylist';
        likeBtn.addEventListener('click', () => likePlaylist(p.id));

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Editar';
        editBtn.className = 'btnRoundPlaylist';
        editBtn.addEventListener('click', () => editarPlaylist(p.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Eliminar';
        deleteBtn.className = 'btnRoundPlaylist';
        deleteBtn.addEventListener('click', () => eliminarPlaylist(p.id));

        buttonsDiv.appendChild(likeBtn);
        buttonsDiv.appendChild(editBtn);
        buttonsDiv.appendChild(deleteBtn);

        mediaContainer.appendChild(buttonsDiv);
        li.appendChild(mediaContainer);
        content.appendChild(li);
      });
    })
    .catch(err => console.error('Error al cargar playlists:', err));
}

export function verSongs(playlistId) {
  currentViewPlaylist = "allSongsPlayList";
  fetch(`/playlist/${playlistId}/songs/`, { credentials: 'same-origin' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      const content = document.getElementById('content');
      if (!content) return;

      const songs = Array.isArray(data?.songs) ? data.songs : [];
      if (!songs.length) {
        content.innerHTML = '<p>No hay canciones en esta playlist.</p>';
        const main = document.getElementById('main-content');
        if (main) main.dataset.view = 'playlist';
        try { window.MDFCore?.rebindReproductor?.(); } catch {}
        return;
      }

      const rowsHTML = songs.map((song) => {
        const audio = pickFirst(
          song.audioUrl, song.audio_url, song.audio,
          song.file, song.file_url, song.filePath, song.file_path,
          song.audioFile, song.audio_file, song.audioPath, song.audio_path,
          song.src, song.source, song.stream_url, song.streamUrl,
          song?.audio?.url, song?.file?.url, song?.media?.audio, song?.media?.url
        );
        if (!audio) return "";

        const cover  = pickFirst(
          song.coverUrl, song.cover_url, song.cover, song.thumbnail, song.thumb,
          song?.cover?.url, song?.image?.url, song?.media?.cover
        ) || "/static/inicio_sesion/img_song.png";

        const title  = pickFirst(song.title, song.name) || "—";
        const author = pickFirst(song.artist_display_name, song.artist, song.author, song.singer) || "—";
        const genre  = pickFirst(song.genre, song.genero, song.gen) || "";

        return `
          <li class="song-item"
              data-id="${_esc(song.id ?? '')}"
              data-audio-url="${_esc(audio)}"
              data-title="${_esc(title)}"
              data-author="${_esc(author)}"
              ${genre ? `data-genre="${_esc(genre)}"` : ""}
              ${cover ? `data-cover-url="${_esc(cover)}"` : ""}>
            <img class="song-cover" src="${_esc(cover)}" alt="${_esc(title)}"
                 style="width:56px;height:56px;border-radius:10px;object-fit:cover;">
            <div class="song-info">
              <div class="song-title"><strong>${_esc(title)}</strong></div>
              <div class="song-author"><small style="color:#b3b3b3">${_esc(author)}</small></div>
            </div>
          </li>`;
      }).filter(Boolean).join("");

      content.innerHTML = rowsHTML
        ? `<ul style="list-style:none;padding:0;margin:0">${rowsHTML}</ul>`
        : '<p>No hay canciones reproducibles (faltan URLs de audio).</p>';

      const main = document.getElementById('main-content');
      if (main) main.dataset.view = 'playlist';

      try {
        const prev = Array.isArray(window._playlists) ? window._playlists : [];
        const plId = `pl:${playlistId}`;
        const plName = (data && (data.name || data.playlist?.name)) || `Playlist ${playlistId}`;
        const normSongs = songs.map(normalizeSong).filter(Boolean);
        const others = prev.filter(p => String(p.id) !== String(plId) && String(p.id) !== 'my' && String(p.id) !== '1');
        window._playlists = [{ id: plId, name: plName, songs: normSongs }, ...others];
      } catch {}

      try {
        window.MDFCore?.rebindReproductor?.();
        document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow', { bubbles:true, detail:{} }));
      } catch (e) { console.warn('No pude rebindear el reproductor:', e); }
    })
    .catch(error => {
      const content = document.getElementById('content');
      if (content) content.innerHTML = `<p style="color:red;">Error: ${_esc(error.message)}</p>`;
    });
}

export function playSong(id){ console.log('Reproduciendo canción con ID:', id); }
export function likeSong(){ /* pendiente */ }
