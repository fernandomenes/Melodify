/* ==========================================================================
   Reproductor central (cola + audio) — SIN control de la barra
   - Emite eventos para que barra_reproduccion.js pinte/controle la UI
   - Expone 'window.MDFCore' para la barra
   - Exporta funciones para la SPA (render, hooks, etc.)
   ========================================================================== */

// ---------------------------- Estado interno -------------------------------
let _state = {
  queue: [],
  index: -1,
  audio: null,
  boundItems: new Set(),
  guardHooked: false,
  moView: null,
  moList: null,
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

  return { title, author, coverUrl: cover, audioUrl: audio, genre };
}

// ------------------ Carga playlists reales (devuelve array) ----------------
async function fetchAllPlaylistsWithSongs() {
  try {
    const res = await fetch('/playlist/getAllList', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lists = await res.json(); // [{id, name, ...}, ...]

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

// ------- Construye modelo final: Todas + Mi música + playlists reales ------
function buildPlaylistsModel({allPlaylists, mySongs}){
  const dedup = (arr, keyFn) => {
    const seen = new Set(); const out = [];
    for (const it of arr) {
      const k = keyFn(it);
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(it);
    }
    return out;
  };
  const abs = (u)=>{ try{ return u? new URL(u, location.origin).href : ""; }catch{ return u||""; } };

  const flattenAll = allPlaylists.flatMap(pl => Array.isArray(pl.songs) ? pl.songs : []);
  const allUnique  = dedup(flattenAll, s => abs(s.audioUrl) || `${(s.title||'').toLowerCase()}::${(s.author||'').toLowerCase()}`);
  const allPlaylist  = { id:'pl:all',  name:'Todas las canciones', songs: allUnique };

  const mineUnique   = dedup(mySongs||[], s => abs(s.audioUrl) || `${(s.title||'').toLowerCase()}::${(s.author||'').toLowerCase()}`);
  const minePlaylist = { id:'pl:mine', name:'Mi música', songs: mineUnique };

  // Orden: Todas → Mi música → el resto
  return [allPlaylist, minePlaylist, ...allPlaylists];
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

function collectQueueFromDOM(){
  const items=qa(".song-item,[data-audio-url]");
  const curHref=absHref(_state.audio?.src||"");
  const nextQueue=[]; let k=0;

  items.forEach((el)=>{
    const title=el.dataset.title||el.querySelector(".song-title")?.textContent||"—";
    const author=el.dataset.author||el.querySelector(".song-author")?.textContent||"—";
    const coverUrl=ensureAbs(el.dataset.coverUrl||el.querySelector(".song-cover")?.getAttribute("src")||"");
    const audioUrl=ensureAbs(el.dataset.audioUrl||"");
    const genre = el.dataset.genre || "";
    if(audioUrl){
      nextQueue.push({ title, author, coverUrl, audioUrl, genre });
      el.dataset._idx=String(k++);
      if(!el.classList.contains("song-item")) el.classList.add("song-item");
      const img=el.querySelector(".song-cover"); if(img&&coverUrl) img.src=coverUrl;
    }else{
      el.removeAttribute("data-_idx");
    }
  });

  _state.queue=nextQueue;
  const want = curHref ? _state.queue.findIndex(s=>absHref(ensureAbs(s.audioUrl))===curHref) : -1;
  _state.index=want;
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
      const hadSrc = !!_state.audio?.src;
      collectQueueFromDOM();
      bindClicks(isPlayableView());
      if(hadSrc) fire("melodify:bar:shouldShow", {});
    }
  });
  _state.moList.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:["data-audio-url"]});
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
const PLAYABLE_VIEWS = new Set(["reproductor", "playlist"]);
function getCurrentView(){
  const m=document.getElementById("main-content");
  return (m?.dataset.view||m?.dataset.initialView||"").trim();
}
function isPlayableView(){ return PLAYABLE_VIEWS.has(getCurrentView()); }

function hookViewGuard(){
  if(_state.guardHooked) return; _state.guardHooked=true;
  const main=document.getElementById("main-content"); if(!main) return;

  const apply=()=>{
    const playable=isPlayableView();
    if(playable){ collectQueueFromDOM(); bindClicks(true); observeListChanges(); }
    else{ bindClicks(false); observeListChanges(); }
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

function _esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _playlistSongRow(song){
  const isStr=typeof song==='string';
  const title=isStr?song:(song?.title||'—');
  const author=isStr?'—':(song?.author||song?.artist_display_name||song?.artist||'—');
  const cover=isStr?null:ensureAbs(song?.coverUrl||song?.cover_url||song?.cover||'');
  const audio=isStr?'':ensureAbs(song?.audioUrl||song?.audio_url||song?.audio||'');
  const genre=!isStr?(song?.genre||song?.genero||''):'';
  const coverHTML = cover?`<img src="${_esc(cover)}" alt="${_esc(title)}" class="song-cover">`:`<div class="song-cover song-cover--placeholder"></div>`;
  return `
    <div class="song-item" data-audio-url="${_esc(audio)}" data-title="${_esc(title)}" data-author="${_esc(author)}" data-genre="${_esc(genre)}">
      ${coverHTML}
      <div class="song-info">
        <div class="song-title">${_esc(title)}</div>
        <div class="song-author">${_esc(author)}</div>
      </div>
    </div>`;
}

export function renderLeftSongs(songs, titleForEmpty='Playlist'){
  const left=q('.rep-left'); if(!left) return;
  if(!songs||!songs.length){
    left.innerHTML=`<div class="rep-empty"><div><h3 style="margin:0">${_esc(titleForEmpty)}</h3><p>No hay canciones.</p></div></div>`;
  }else{
    left.innerHTML=`<div class="songs-wrap">${songs.map(_playlistSongRow).join('')}</div>`;
  }
  try{ inicializarReproductor(); }catch{}
}

// ---------- Sidebar: Playlists (todas) + Géneros ---------------------------
export function buildRightSidebarHTML({playlists, genres=DEFAULT_GENRES}){
  const P = Array.isArray(playlists) ? playlists : [];
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
        const pl=(window._playlists||[]).find(p=>String(p.id)===String(id))||{name:'—',songs:[]};
        renderLeftSongs(Array.isArray(pl.songs)?pl.songs:[], pl.name||'Playlist');
      });
    });
    // Prioriza seleccionar “pl:all” al abrir
    const first=ul.querySelector('li[data-pl="pl:all"]') || ul.querySelector('li[data-pl]');
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
        renderLeftSongs(filtered, ch.textContent||'Género');
      });
    });
  }
}

// -------------------- Integración con la SPA -------------------------------
export async function renderMenuReproductor({mainContent, contentDiv, URL_MI_MUSICA_JSON}){
  const u=new URL(location.href); u.searchParams.set('view','reproductor'); history.replaceState(null,'',u.toString());
  mainContent.dataset.view='reproductor';

  // 1) Obtiene playlists reales + mis canciones
  const [allPlaylists, mySongs] = await Promise.all([
    fetchAllPlaylistsWithSongs(),
    fetchMyMusic(URL_MI_MUSICA_JSON)
  ]);

  // 2) Construye el modelo final y publica
  window._playlists = buildPlaylistsModel({ allPlaylists, mySongs });

  // 3) UI
  const P = Array.isArray(window._playlists) ? window._playlists : [];
  const initial = P.find(p => p.id==='pl:all') || P[0] || { id:'pl:tmp', name:'(sin playlists)', songs:[] };
  const songs   = Array.isArray(initial.songs) ? initial.songs : [];

  const rightHTML = buildRightSidebarHTML({playlists:P, genres:DEFAULT_GENRES||[]}) || '';
  contentDiv.innerHTML = `<div class="rep-grid"><div class="rep-left"></div><div class="rep-right">${rightHTML}</div></div>`;

  inicializarReproductor();
  renderLeftSongs(songs, initial.name || 'Playlist');
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
