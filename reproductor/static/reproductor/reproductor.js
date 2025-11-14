/* ==========================================================================
   Reproductor central (cola + audio) con Discover Weekly y “Music that I Love”
   - Contadores por canción (visual, por usuario):
       * Diario (Top 10)     -> badge en vivo (no altera el orden congelado)
       * 7 días (Discover)   -> badge en vivo (rolling, incluye HOY)
   - Barras de estadísticas:
       * Top-10: Reproducciones (hoy) + Género top (hoy) + Artista top (hoy)
       * Discover: Reproducciones (7d) + “Canciones likeadas: X”
   - Namespace por usuario en localStorage (plays, top10, discover)
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

// ---------------------------- Plays diarios --------------------------------
function _loadDailyPlays(stamp){ return _loadJSON(PLAYS_PREFIX()+stamp, {}); }
function _saveDailyPlays(stamp, obj){ _saveJSON(PLAYS_PREFIX()+stamp, obj||{}); }

// Rolling 7d (excluye hoy, para el snapshot congelado)
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
  return agg; // { songKey: sum7d sin hoy }
}

// Rolling 7d (incluye hoy, uso visual)
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
  return agg; // { songKey: sum7d con hoy }
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

// Discover cache por usuario + semana
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

/** Genera Discover (likes ~40%, hábitos ~40%, exploración ~20%) con cache semanal por usuario */
function buildDiscoverWeekly({playlists, likes=[], size=30}){
  // Cache semanal sobre el universo actual
  const cachedKeys = (_loadDiscover()||[]).map(k=>String(k));
  const base = _flattenUniqueSongs(playlists);
  const byKey = new Map(base.map(s=>[_songKey(s), s]));
  const cachedSongs = cachedKeys.map(k=>byKey.get(k)).filter(Boolean);
  if(cachedSongs.length >= Math.min(12,size*0.4)){
    return { id:'pl:discover', name:'Discover Weekly', songs: cachedSongs.slice(0,size) };
  }

  // Universo = playlists + likes (deduplicado)
  const likeSet = new Set((likes||[]).map(s=>_songKey(s)).filter(Boolean));
  const universe = _dedup([...(base||[]), ...(likes||[])], s => _songKey(s));

  // Scoring (7d sin hoy para snapshot semanal)
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
  return (Array.isArray(playlists)?playlists:[])
    .flatMap(pl=>Array.isArray(pl.songs)?pl.songs:[]);
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

/**
 * countsMode:
 *   - null/undefined  -> sin badge
 *   - 'daily'         -> hoy (live) data-scope="day"
 *   - 'weekly'        -> 7d rolling (incluye hoy) data-scope="week"
 */
function _playlistSongRow(song, {countsMode=null, countsStamp=null, weeklyAgg=null}={}){
  const isStr=typeof song==='string';
  const title=isStr?song:(song?.title||'—');
  const author=isStr?'—':(song?.author||song?.artist_display_name||song?.artist||'—');
  const cover=isStr?null:ensureAbs(song?.coverUrl||song?.cover_url||song?.cover||'');
  const audio=isStr?'':ensureAbs(song?.audioUrl||song?.audio_url||song?.audio||'');
  const genre=!isStr?(song?.genre||song?.genero||''):'';  
  const skey=_songKey(song);

  let playsBadge = '';
  if(countsMode==='daily'){
    const plays = getTodayCount(song);
    playsBadge = `<span class="rep-badge" data-badge="plays" data-skey="${_esc(skey)}" data-scope="day">${plays}</span>`;
  } else if(countsMode==='weekly'){
    const plays = getWeeklyPlayCount(song, /*weeklyAgg*/null, /*includeToday*/true);
    playsBadge = `<span class="rep-badge" data-badge="plays" data-skey="${_esc(skey)}" data-scope="week">${plays}</span>`;
  }

  const coverHTML = cover
    ? `<img src="${_esc(cover)}" alt="${_esc(title)}" class="song-cover">`
    : `<div class="song-cover song-cover--placeholder"></div>`;

  return `
    <div class="song-item" data-id="${_esc(song?.id ?? '')}" data-audio-url="${_esc(audio)}"
         data-title="${_esc(title)}" data-author="${_esc(author)}" data-genre="${_esc(genre)}" data-skey="${_esc(skey)}">
      ${coverHTML}
      <div class="song-info">
        <div class="song-title">${_esc(title)} ${playsBadge}</div>
        <div class="song-author">${_esc(author)}</div>
      </div>
    </div>`;
}

export function renderLeftSongs(songs, titleForEmpty='Playlist', {countsMode=null, countsStamp=null, weeklyAgg=null}={}){
  const left=q('.rep-left'); if(!left) return;
  if(!songs||!songs.length){
    left.innerHTML=`<div class="rep-empty"><div><h3 style="margin:0">${_esc(titleForEmpty)}</h3><p>No hay canciones.</p></div></div>`;
  }else{
    const rows = songs.map(s => _playlistSongRow(s,{countsMode, countsStamp, weeklyAgg})).join('');
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

  a.addEventListener("loadedmetadata", ()=>{ const dur = Number.isFinite(a.duration) ? a.duration : 0; fire("melodify:loaded", { duration: dur }); });
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
function toggle(){ if(!_state.audio||!_state.audio.src) return; if(_state.audio.paused) _state.audio.play().catch(()=>{}); else _state.audio.pause(); }
function prev(){ if(_state.queue.length===0) return; const i=_state.index>0?_state.index-1:_state.queue.length-1; load(i,true); }
function next(){ if(_state.queue.length===0) return; const i=(_state.index+1)%_state.queue.length; load(i,true); }

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

// ---------------------------- API global -----------------------------------
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
  const P = Array.isArray(playlists) ? playlists.slice() : [];

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

  // Orden: all -> mine -> likes -> top10 -> discover -> resto
  let insertAfter = 0;
  for (const id of ['pl:all','pl:mine','pl:likes']){
    const idx = P.findIndex(p => p.id===id);
    if (idx >= 0 && idx >= insertAfter) insertAfter = idx + 1;
  }
  P.splice(insertAfter, 0, top10);
  if(discover) P.splice(insertAfter+1, 0, discover);

  const liHTML = P.map(pl=>{
    const songs = Array.isArray(pl.songs) ? pl.songs : [];
    const label = pl.id==='pl:top10' ? 'Top 10 personal'
                 : pl.id==='pl:discover' ? 'Discover Weekly'
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
            // weeklyAgg lógico (sin hoy) no se utiliza en la visualización actual; se mantiene por compatibilidad
            renderLeftSongs(d.songs, d.name, {countsMode:'weekly', weeklyAgg:null});
            const stats = _computeWeeklyStats({playlists: window._playlists||[], likes: window._likes||[]});
            _renderDiscoverHeader({playlistDW: d, stats});
            return;
          }catch(e){ console.warn('discover click failed', e); }
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

// ---------------------------- Modelo de playlists --------------------------
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

    return await Promise.all(lists.map(byId));
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
    const raw = (Array.isArray(data?.songs) && data.songs) || [];
    return raw.map(normalizeSong).filter(Boolean);
  }catch(e){ console.warn('fetchMyLikes() falló:', e); return []; }
}

function buildPlaylistsModel({ allPlaylists, mySongs, myLikes, isArtist = false }) {
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
  const keyer = (s) => _songKey(s) || abs(s.audioUrl) || `${(s.title||'').toLowerCase()}::${(s.author||'').toLowerCase()}`;

  const flattenAll = (Array.isArray(allPlaylists) ? allPlaylists : [])
    .flatMap(pl => Array.isArray(pl.songs) ? pl.songs : []);
  const allUnique  = dedup(flattenAll, keyer);
  const allPlaylist = { id: 'pl:all', name: 'Todas las canciones', songs: allUnique };

  const mineUnique = dedup(mySongs || [], keyer);
  const likesUnique = dedup(myLikes || [], keyer);

  const out = [allPlaylist, ...(Array.isArray(allPlaylists) ? allPlaylists : [])];

  if (isArtist && mineUnique.length) {
    out.splice(1, 0, { id: 'pl:mine', name: 'Mi música', songs: mineUnique });
  }

  if (likesUnique.length) {
    const after = out.findIndex(p => p.id === 'pl:mine');
    const insertAt = after >= 0 ? after + 1 : 1;
    out.splice(insertAt, 0, { id: 'pl:likes', name: 'Music that i love', songs: likesUnique });
  }

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

  // Fallback de “Mi música” vía JSON embebido (si aplica)
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
  window._playlists = buildPlaylistsModel({ allPlaylists, mySongs, myLikes, isArtist: IS_ARTIST });

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
  window.addEventListener('melodify:playlistChanged', async ()=>{
    if((mainContent?.dataset.view||'')==='reproductor'){
      try{ await renderMenuReproductor({ mainContent, contentDiv:document.getElementById('content') }); }catch{}
    }
  });
}

// ---------------------------- Listeners en vivo (badges / stats) -----------
window.addEventListener("melodify:playcount", (ev)=>{
  const k = ev?.detail?.key; if(!k) return;

  // 1) Actualiza badges para esa canción (día/semana)
  const nodes = document.querySelectorAll(`.rep-badge[data-badge="plays"][data-skey="${CSS.escape(k)}"]`);
  nodes.forEach((n)=>{
    const scope = n.getAttribute('data-scope');
    if (scope === 'day') n.textContent = String(getTodayCount({ _k:k }) || 0);
    else if (scope === 'week') n.textContent = String(getWeekCount({ _k:k }, 7, /*includeToday*/true) || 0);
  });

  // 2) Recalcula totales de la cabecera visible (si existe)
  const header = q('.rep-left .rep-stats'); if(!header) return;
  const scope = header.getAttribute('data-scope'); // 'day' | 'week'
  let total = 0;
  qa('.rep-left .song-item').forEach((row)=>{
    const sk = row.getAttribute('data-skey');
    if(!sk) return;
    if(scope==='day') total += getTodayCount({ _k:sk });
    else total += getWeekCount({ _k:sk }, 7, /*includeToday*/true);
  });
  const totalNode = header.querySelector('.rep-total');
  if(totalNode){
    if(scope==='day') totalNode.innerHTML = `<strong>Reproducciones (hoy):</strong> ${total}`;
    else totalNode.innerHTML = `<strong>Reproducciones (7d):</strong> ${total}`;
  }

  // 3) Actualiza género y artista principales del Top-10 si la cabecera está activa
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
export function crearPlaylist(){ console.log('crearPlaylist (stub)'); }
export function likePlaylist(id){ console.log('likePlaylist stub:', id); }
export function editarPlaylist(id){ console.log('editarPlaylist stub:', id); }
export function eliminarPlaylist(id){ console.log('eliminarPlaylist stub:', id); }
export function showPlaylists(){ /* Pendiente de implementación en este módulo. */ }
export function verSongs(playlistId){ /* Pendiente de implementación en este módulo. */ }
export function playSong(id){ console.log('Reproduciendo canción con ID:', id); }
export function likeSong(){ /* Implementación vacía en este módulo. */ }

// ---------------------------- Auto-init ------------------------------------
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ()=>inicializarReproductor());
} else {
  try { inicializarReproductor(); } catch {}
}
