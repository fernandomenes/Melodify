/* ==========================================================================
   Barra de reproducción (UI) — versión “beat-meter” fluida y sin disco
   - Reacciona al ritmo ajustando --viz-int (glow) con WebAudio + suavizado EMA
   - Color por género (GENRE_HUES).
   - API consola: window.MDFBarUI y alias window.MDFBar
   ========================================================================== */
(function () {
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Hue por género (clave normalizada, sin acentos)
  const GENRE_HUES = {
    pop:210, rock:355,
    electronica:140, electro:140, edm:140,
    salsa:10, indie:270,
    hiphop:50, rap:50, trap:50,
    reggaeton:295, regueton:295, "reguetón":295,
    regional:125, "regionalmexicano":125, "regional mexicano":125,
    balada:195, jazz:30,
    clasica:35, clasico:35, clásica:35,
    instrumental:180,
    otro:270
  };

  // ---------- Estado ----------
  let els = {}, audio = null;
  let hue = 270, intensity = 0.22;
  let lockGenreHue = true;

  // WebAudio / Beat meter
  let ac = null, analyser = null, buf = null, raf = 0;

  // Listener para re-aplicar velocidad al cargar metadata
  let lastAudioForSpeedListener = null;
  const _mdfSyncSpeed = ()=> applySpeed(getSavedSpeed());

  // ---------- Velocidad (persistente) ----------
  function getSavedSpeed(){
    const s = Number(localStorage.getItem("mdf.speed") || "1");
    return SPEEDS.includes(s) ? s : 1;
  }
  function labelOf(rate){ return String(rate).replace(/\.0$/,'') + "×"; }
  function applySpeed(rate){
    const r = SPEEDS.includes(Number(rate)) ? Number(rate) : getSavedSpeed();
    localStorage.setItem("mdf.speed", String(r));
    if (audio) audio.playbackRate = r;
    if (els.speed) els.speed.textContent = labelOf(r);
  }

  // Preset agresivo (pero sin saturar)
  const METER = {
    bands: { low: [50, 180], mid: [180, 1800] },

    // respuesta temporal
    emaRise: 0.60,   // ataque rápido
    emaFall: 0.12,   // caída moderada

    // bases más bajas = más contraste
    baseIdle: 0.08,
    basePlay: 0.16,

    // pesos y ganancias por banda
    wLow: 0.45,
    wMid: 0.28,
    gainLow: 1.30,
    gainMid: 0.90,

    // límites
    clampMin: 0.05,
    clampMax: 0.98
  };

  // Pulso por transitorio en graves (punch)
  let prevLow = 0, pulseEnv = 0;
  const PULSE = {
    threshold: 0.040, // sensibilidad a disparo (subida súbita en low)
    strength:  0.26,  // cuánto suma al brillo final
    decay:     0.88   // se apaga rápido
  };

  // curva para enfatizar picos sin añadir ruido
  const shape = v => Math.pow(v, 1.45);

  // ---------- Utils ----------
  const q = (s, r=document)=>r.querySelector(s);
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
  function slug(s){
    return String(s||'')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9]+/g,'');
  }
  function normGenre(g){
    const k = slug(g);
    if (!k) return null;
    if (k === 'hip-hop') return 'hiphop';
    if (k === 'regionalmexicano' || k === 'regional mexicano') return 'regionalmexicano';
    return k;
  }
  function fmt(t){
    if(!Number.isFinite(t)) return "0:00";
    t=Math.max(0,Math.floor(t));
    const m=Math.floor(t/60), s=String(t%60).padStart(2,"0");
    return `${m}:${s}`;
  }
  function setVars(inten=intensity, h=hue){
    const bar = els.bar; if(!bar) return;
    bar.style.setProperty('--viz-int', String(clamp(inten,0,1)));
    bar.style.setProperty('--viz-hue', String((((h%360)+360)%360)));
  }
  function setRangeFill(input, p0to100){
    if(!input) return;
    const p=clamp(Number(p0to100??input.value),0,100);
    input.style.background =
      `linear-gradient(90deg, var(--accent) 0%, var(--accent-2) ${p}%, #2b2b2b ${p}%)`;
  }

  // ---------- UI ----------
  function build(){
    let bar = q("._mdf-player-bar");
    if(!bar){
      bar = document.createElement("div");
      bar.className = "_mdf-player-bar";
      bar.innerHTML = `
        <div class="_mdf-now">
          <img class="_mdf-cover" alt="" style="visibility:hidden">
          <div class="_mdf-meta">
            <div class="_mdf-player-title"></div>
            <div class="_mdf-player-artist"></div>
          </div>
        </div>
        <div class="_mdf-ctrls">
          <button class="_mdf-speed" title="Velocidad">1×</button>
          <button class="_mdf-btn _mdf-prev"  title="Anterior">⏮</button>
          <button class="_mdf-btn _mdf-btn--primary _mdf-play" title="Reproducir/Pausar">▶</button>
          <button class="_mdf-btn _mdf-next"  title="Siguiente">⏭</button>
        </div>
        <div class="_mdf-right">
          <span class="_mdf-time">0:00 / 0:00</span>
          <input class="_mdf-player-seek" type="range" min="0" max="100" value="0" step="1">
          <input class="_mdf-vol" type="range" min="0" max="1" step=".01" value="1">
        </div>`;
      document.body.appendChild(bar);
    }

    els.bar   = bar;
    els.cover = q("._mdf-cover", bar);
    els.title = q("._mdf-player-title", bar);
    els.artist= q("._mdf-player-artist", bar);
    els.prev  = q("._mdf-prev", bar);
    els.next  = q("._mdf-next", bar);
    els.play  = q("._mdf-play", bar);
    els.time  = q("._mdf-time", bar);
    els.seek  = q("._mdf-player-seek", bar);
    els.vol   = q("._mdf-vol", bar);
    els.ctrls = q("._mdf-ctrls", bar);
    els.speed = q("._mdf-speed", bar);

    // Controles
    els.prev.onclick = ()=>window.MDFCore?.prev();
    els.next.onclick = ()=>window.MDFCore?.next();
    els.play.onclick = ()=>window.MDFCore?.toggle();

    els.seek.addEventListener("input", (e)=>{
      const p = clamp(Number(e.target.value||0),0,100);
      setRangeFill(els.seek, p);
      window.MDFCore?.seekPercent(p/100);
    });
    els.vol.addEventListener("input", (e)=>{
      const v = clamp(Number(e.target.value||0),0,1);
      setRangeFill(els.vol, v*100);
      window.MDFCore?.setVolume(v);
    });

    // Velocidad persistente (UI + click)
    els.speed.textContent = labelOf(getSavedSpeed());
    els.speed.addEventListener("click", ()=>{
      const cur = getSavedSpeed();
      const i = SPEEDS.indexOf(cur);
      const next = SPEEDS[(i+1)%SPEEDS.length];
      applySpeed(next);
    });

    // Rellenos iniciales + brillo inicial
    setRangeFill(els.seek, Number(els.seek.value));
    setRangeFill(els.vol, 100*Number(els.vol.value));
    setVars(intensity, hue);
  }

  function show(){ els.bar?.classList.add("is-visible"); }
  function hide(){ els.bar?.classList.remove("is-visible"); }

// ---------- Visibilidad de la barra ----------
// Mostramos la barra si hay audio y NO estamos en vistas de servidor
function getCurrentView(){
  const m=document.getElementById("main-content");
  return (m?.dataset.view||m?.dataset.initialView||"").trim();
}
function enforceVisibility(){
  const hasAudio = !!(audio && audio.src);
  const spaEnabled = !window.__DISABLE_HOME_SCRIPT__;         // false en /mi-muro, /gestion, etc.
  const view = getCurrentView();
  const spaViews = new Set(["home","playlist","reproductor","perfil"]);
  const inSpaView = spaViews.has(view);
  if (spaEnabled && inSpaView && hasAudio) { show(); } else { hide(); }
}

  function hookViewObserver(){
    const main=document.getElementById("main-content");
    if(!main) return;
    const mo=new MutationObserver(enforceVisibility);
    mo.observe(main,{attributes:true,attributeFilter:["data-view"]});
    enforceVisibility();
  }

  // ---------- Beat meter (WebAudio) ----------
  function hzToIndex(hz, sampleRate, fftSize){
    return Math.round(hz * fftSize / sampleRate);
  }

  function startBeatMeter(){
    if(!audio) return;
    try{
      if(!ac){ ac = new (window.AudioContext||window.webkitAudioContext)(); }
      if(!analyser){
        const src = ac.createMediaElementSource(audio);
        analyser = ac.createAnalyser();
        analyser.fftSize = 512;               // más nervio temporal
        analyser.smoothingTimeConstant = 0.0; // suavizamos 
        src.connect(analyser);
        analyser.connect(ac.destination);
        buf = new Uint8Array(analyser.frequencyBinCount);
      }
      if(raf) cancelAnimationFrame(raf);

      let smoothed = intensity; // arranca desde el valor actual
      const sr = ac.sampleRate || 44100;
      const N  = analyser.fftSize;
      const lowA = hzToIndex(METER.bands.low[0], sr, N);
      const lowB = hzToIndex(METER.bands.low[1], sr, N);
      const midA = hzToIndex(METER.bands.mid[0], sr, N);
      const midB = hzToIndex(METER.bands.mid[1], sr, N);

      const tick = ()=>{
        analyser.getByteFrequencyData(buf);

        // energía promedio por banda
        let sumL=0, cL=0, sumM=0, cM=0;
        for(let i=Math.max(0,lowA); i<=Math.min(buf.length-1,lowB); i++){ sumL+=buf[i]; cL++; }
        for(let i=Math.max(0,midA); i<=Math.min(buf.length-1,midB); i++){ sumM+=buf[i]; cM++; }
        const eLow = cL? (sumL/cL)/255 : 0;
        const eMid = cM? (sumM/cM)/255 : 0;

        // pulso por subida súbita en graves
        const deltaLow = eLow - prevLow; prevLow = eLow;
        if(deltaLow > PULSE.threshold){
          pulseEnv = Math.min(1, pulseEnv + deltaLow * 2.6); // ataque rápido
        } else {
          pulseEnv *= PULSE.decay; // release corto
        }

        // mezcla lineal con base por estado
        const playing = !!(audio && !audio.paused);
        const base = playing ? METER.basePlay : METER.baseIdle;

        let lin = base
          + (eLow * METER.gainLow * METER.wLow)
          + (eMid * METER.gainMid * METER.wMid);
        lin = clamp(lin, METER.clampMin, METER.clampMax);

        // suavizado EMA asimétrico
        const alpha = (lin > smoothed) ? METER.emaRise : METER.emaFall;
        smoothed = (1 - alpha) * smoothed + alpha * lin;

        // salida = suavizado + pulso, con curva de énfasis
        let out = smoothed + pulseEnv * PULSE.strength;
        out = shape(clamp(out, METER.clampMin, METER.clampMax));

        intensity = out;
        setVars(intensity, hue);

        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      ac.resume().catch(()=>{});
    }catch{/* noop */}
  }
  function stopBeatMeter(){
    if(raf){ cancelAnimationFrame(raf); raf=0; }
  }

  // ---------- Listeners MDFCore ----------
  function onAudioReady(ev){
    audio = ev?.detail?.audio || window.MDFCore?.getAudio?.();
    if(!audio) return;

    // (Re)aplicar velocidad persistida y enganchar loadedmetadata del <audio>
    if (lastAudioForSpeedListener) {
      lastAudioForSpeedListener.removeEventListener("loadedmetadata", _mdfSyncSpeed, false);
    }
    lastAudioForSpeedListener = audio;
    audio.addEventListener("loadedmetadata", _mdfSyncSpeed, false);
    applySpeed(getSavedSpeed());

    // volumen UI ↔ audio
    els.vol.value = String(audio.volume || 1);
    setRangeFill(els.vol, 100*Number(els.vol.value));

    startBeatMeter();
  }

  function onTrackMeta(ev){
    const d = ev?.detail||{};
    els.title.textContent  = d.title || '—';
    els.artist.textContent = d.artist || '—';
    if(d.cover){
      els.cover.style.visibility = "visible";
      els.cover.src = d.cover;
      els.cover.onerror = ()=>{ els.cover.style.visibility="hidden"; };
    }else{
      els.cover.removeAttribute("src");
      els.cover.style.visibility="hidden";
    }

    const k = normGenre(d.genre);
    const h = k!=null ? GENRE_HUES[k] : null;

    els.bar?.classList.toggle("mdf-whiteglow", k === "otro");

    if(h != null){
      lockGenreHue = true;
      hue = h;
    }else{
      lockGenreHue = false;
    }
    setVars(intensity, hue);
  }

  function onTrackChange(){
    enforceVisibility();
    setTimeout(()=>applySpeed(getSavedSpeed()), 0);
  }

  function onTime(ev){
    const cur = Number(ev.detail?.currentTime||0), dur=Number(ev.detail?.duration||0);
    els.time.textContent = `${fmt(cur)} / ${fmt(dur)}`;
    const pct = dur>0 ? (cur/dur) : 0;
    els.seek.value = String(Math.round(pct*100));
    setRangeFill(els.seek, pct*100);
  }

  function onLoaded(ev){
    const dur=Number(ev.detail?.duration||0);
    els.time.textContent = `${fmt(0)} / ${fmt(dur)}`;
    els.seek.value = "0";
    setRangeFill(els.seek, 0);
    applySpeed(getSavedSpeed());
  }

  function onState(ev){
    const playing = !!ev.detail?.playing;
    els.play.textContent = playing ? "⏸" : "▶";
  }

  function onShowBar(){ enforceVisibility(); }

  // ---------- Init ----------
  function init(){
    build();
    hookViewObserver();

    document.addEventListener("melodify:audioReady", onAudioReady);
    document.addEventListener("melodify:trackmeta",   onTrackMeta);
    document.addEventListener("melodify:trackchange", onTrackChange);
    document.addEventListener("melodify:time",        onTime);
    document.addEventListener("melodify:loaded",      onLoaded);
    document.addEventListener("melodify:state",       onState);
    document.addEventListener("melodify:bar:shouldShow", onShowBar);

    if(window.MDFCore){
      onAudioReady({detail:{audio:window.MDFCore.getAudio?.()}});
    }
  }

  // ---------- API consola ----------
  window.MDFBarUI = {
    init, show, hide,
    setLockGenre(flag){ lockGenreHue = !!flag; },
    setHue(h){ hue = Number(h)||0; setVars(intensity, hue); },
    setSpeed(rate){ applySpeed(Number(rate)); }, // delega en applySpeed (persiste + UI)
    getPersistedSpeed(){ return getSavedSpeed(); },
    setPersistedSpeed(rate){ applySpeed(Number(rate)); }
  };
  window.MDFBar = window.MDFBarUI; // alias compat

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
