/* ==========================================================================
   Melodify — Barra de reproducción global (UI “beat-meter”)
   --------------------------------------------------------------------------
   Responsabilidades principales:
   - Renderizar una barra fija de reproducción controlada por MDFCore
     (prev / play / next / seek / volumen / velocidad).
   - Sincronizar título, artista, portada y tiempos con el <audio> central.
   - Aplicar visualización reactiva al audio (“beat-meter”) usando WebAudio
     y una EMA asimétrica para evitar ruido visual.
   - Persistir velocidad de reproducción y estado mostrar/ocultar en
     localStorage.
   - Exponer una pequeña API de consola: window.MDFBarUI / window.MDFBar.
   ========================================================================== */
(function () {

  // Tabla de velocidades permitidas (se guarda en localStorage)
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Hue por género (clave normalizada sin acentos ni espacios)
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

  // ---------------------------------------------------------------------------
  // Estado global de la barra
  // ---------------------------------------------------------------------------
  let els = {};          // Referencias a elementos del DOM
  let audio = null;      // <audio> controlado por MDFCore
  let hue = 270;         // Tinte actual del glow
  let intensity = 0.22;  // Intensidad visual actual
  let lockGenreHue = true;

  // WebAudio / beat-meter
  let ac = null, analyser = null, buf = null, raf = 0;

  // Último <audio> al que se enganchó el listener de velocidad
  let lastAudioForSpeedListener = null;
  const _mdfSyncSpeed = () => applySpeed(getSavedSpeed());

  // ---------------------------------------------------------------------------
  // Velocidad (persistente en localStorage)
  // ---------------------------------------------------------------------------
  function getSavedSpeed(){
    const s = Number(localStorage.getItem("mdf.speed") || "1");
    return SPEEDS.includes(s) ? s : 1;
  }

  function labelOf(rate){
    return String(rate).replace(/\.0$/,"") + "×";
  }

  function applySpeed(rate){
    const r = SPEEDS.includes(Number(rate)) ? Number(rate) : getSavedSpeed();
    localStorage.setItem("mdf.speed", String(r));
    if (audio) audio.playbackRate = r;
    if (els.speed) els.speed.textContent = labelOf(r);
  }

  // ---------------------------------------------------------------------------
  // Parámetros del medidor de ritmo (beat-meter)
  // ---------------------------------------------------------------------------
  // Preset agresivo pero controlado (sin ruido visual)
  const METER = {
    bands: { low: [50, 180], mid: [180, 1800] },

    // Respuesta temporal (EMA)
    emaRise: 0.60,   // Ataque rápido
    emaFall: 0.12,   // Caída moderada

    // Bases (idle vs reproducción)
    baseIdle: 0.08,
    basePlay: 0.16,

    // Pesos y ganancias por banda
    wLow: 0.45,
    wMid: 0.28,
    gainLow: 1.30,
    gainMid: 0.90,

    // Límites de la señal
    clampMin: 0.05,
    clampMax: 0.98
  };

  // Pulso adicional por transitorios en graves (punch)
  let prevLow = 0, pulseEnv = 0;
  const PULSE = {
    threshold: 0.040, // Sensibilidad a subidas súbitas en graves
    strength:  0.26,  // Cuánto suma al brillo final
    decay:     0.88   // Release corto
  };

  // Curva para enfatizar picos sin ruido
  const shape = v => Math.pow(v, 1.45);

  // ---------------------------------------------------------------------------
  // Utilidades generales
  // ---------------------------------------------------------------------------
  const q = (s, r=document)=>r.querySelector(s);
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

  function slug(s){
    return String(s||"")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/g,"");
  }

  function normGenre(g){
    const k = slug(g);
    if (!k) return null;
    if (k === "hip-hop") return "hiphop";
    if (k === "regionalmexicano" || k === "regional mexicano") return "regionalmexicano";
    return k;
  }

  function fmt(t){
    if(!Number.isFinite(t)) return "0:00";
    t = Math.max(0,Math.floor(t));
    const m = Math.floor(t/60), s = String(t%60).padStart(2,"0");
    return `${m}:${s}`;
  }

  // Actualiza variables CSS del glow (intensidad + hue)
  function setVars(inten=intensity, h=hue){
    const bar = els.bar; if(!bar) return;
    bar.style.setProperty("--viz-int", String(clamp(inten,0,1)));
    bar.style.setProperty("--viz-hue", String((((h%360)+360)%360)));
  }

  // ---------------------------------------------------------------------------
  // Toggle mostrar/ocultar barra (estado guardado en localStorage)
  // ---------------------------------------------------------------------------
  const BAR_HIDDEN_KEY = "mdf.bar.hidden";

  function _loadHidden(){
    try { return localStorage.getItem(BAR_HIDDEN_KEY) === "1"; }
    catch { return false; }
  }

  function _saveHidden(v){
    try { localStorage.setItem(BAR_HIDDEN_KEY, v ? "1" : "0"); }
    catch {}
  }

  // Crea el botón flotante de mostrar/ocultar si no existe
  function ensureBarToggle(){
    if (document.getElementById("mdf-bar-toggle")) return;
    const btn = document.createElement("button");
    btn.id = "mdf-bar-toggle";
    btn.type = "button";
    btn.title = "Mostrar/Ocultar reproductor";
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = "▾";
    btn.addEventListener("click", () => {
      const bar = els.bar || document.querySelector("._mdf-player-bar");
      if (!bar) return;
      const hide = !bar.classList.contains("mdf-bar--hidden");
      bar.classList.toggle("mdf-bar--hidden", hide);
      btn.setAttribute("aria-pressed", hide ? "true" : "false");
      btn.innerHTML = hide ? "▴" : "▾";
      _saveHidden(hide);
    });
    document.body.appendChild(btn);
  }

  // Aplica el estado guardado a la barra y al botón
  function applySavedHidden(){
    const bar = els.bar || document.querySelector("._mdf-player-bar");
    if (!bar) return;
    const hide = _loadHidden();
    bar.classList.toggle("mdf-bar--hidden", hide);
    const btn = document.getElementById("mdf-bar-toggle");
    if (btn){
      btn.setAttribute("aria-pressed", hide ? "true" : "false");
      btn.innerHTML = hide ? "▴" : "▾";
    }
  }

  // Relleno visual de los <input type="range">
  function setRangeFill(input, p0to100){
    if(!input) return;
    const p = clamp(Number(p0to100 ?? input.value),0,100);
    input.style.background =
      `linear-gradient(90deg, var(--accent) 0%, var(--accent-2) ${p}%, #2b2b2b ${p}%)`;
  }

  // ---------------------------------------------------------------------------
  // Construcción de UI (DOM)
  // ---------------------------------------------------------------------------
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

    ensureBarToggle();
    applySavedHidden();

    // Controles principales → delegan en MDFCore o, en el caso de play/pausa,
    // controlan directamente el <audio> conocido.
    els.prev.onclick = () => {
      if (window.MDFCore && typeof window.MDFCore.prev === "function") {
        window.MDFCore.prev();
      }
    };

    els.next.onclick = () => {
      if (window.MDFCore && typeof window.MDFCore.next === "function") {
        window.MDFCore.next();
      }
    };

    els.play.onclick = () => {
      try {
        if (audio) {
          // Control directo del <audio> que está sonando
          if (audio.paused) {
            audio.play().catch(() => {});
          } else {
            audio.pause();
          }
        } else if (window.MDFCore && typeof window.MDFCore.toggle === "function") {
          // Fallback por si aún no se ha resuelto audio
          window.MDFCore.toggle();
        }
      } catch (e) {
        console.warn("MDFBar toggle() error:", e);
      }
    };

    els.seek.addEventListener("input", (e)=>{
      const p = clamp(Number(e.target.value||0),0,100);
      setRangeFill(els.seek, p);
      const frac = p / 100;
      if (window.MDFCore && typeof window.MDFCore.seekPercent === "function") {
        window.MDFCore.seekPercent(frac);
      } else if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = audio.duration * frac;
      }
    });

    els.vol.addEventListener("input", (e)=>{
      const v = clamp(Number(e.target.value||0),0,1);
      setRangeFill(els.vol, v*100);
      if (window.MDFCore && typeof window.MDFCore.setVolume === "function") {
        window.MDFCore.setVolume(v);
      } else if (audio) {
        audio.volume = v;
      }
    });

    // Velocidad persistente (texto + ciclo al hacer click)
    els.speed.textContent = labelOf(getSavedSpeed());
    els.speed.addEventListener("click", ()=>{
      const cur = getSavedSpeed();
      const i = SPEEDS.indexOf(cur);
      const next = SPEEDS[(i+1)%SPEEDS.length];
      applySpeed(next);
    });

    // Rellenos iniciales + intensidad inicial
    setRangeFill(els.seek, Number(els.seek.value));
    setRangeFill(els.vol, 100*Number(els.vol.value));
    setVars(intensity, hue);
  }

  function show(){ els.bar?.classList.add("is-visible"); }
  function hide(){ els.bar?.classList.remove("is-visible"); }

  // ---------------------------------------------------------------------------
  // Visibilidad de la barra según contexto
  // ---------------------------------------------------------------------------
  function getCurrentView(){
    const m=document.getElementById("main-content");
    return (m?.dataset.view||m?.dataset.initialView||"").trim();
  }

  function enforceVisibility(){
    const hasAudio = !!(audio && audio.src);
    const forceHide = !!window.__MDF_FORMS_HIDE_BAR__;
    if (!forceHide && hasAudio) { show(); }
    else { hide(); }
  }

  // Observa cambios de data-view para refrescar visibilidad
  function hookViewObserver(){
    const main=document.getElementById("main-content");
    if(!main) return;
    const mo=new MutationObserver(enforceVisibility);
    mo.observe(main,{attributes:true,attributeFilter:["data-view"]});
    enforceVisibility();
  }

  // ---------------------------------------------------------------------------
  // Beat meter (WebAudio)
  // ---------------------------------------------------------------------------
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
        analyser.fftSize = 512;               // Resolución temporal alta
        analyser.smoothingTimeConstant = 0.0; // Sin smoothing interno (se hace a mano)
        src.connect(analyser);
        analyser.connect(ac.destination);
        buf = new Uint8Array(analyser.frequencyBinCount);
      }
      if(raf) cancelAnimationFrame(raf);

      let smoothed = intensity; // Arranca desde el valor actual
      const sr = ac.sampleRate || 44100;
      const N  = analyser.fftSize;
      const lowA = hzToIndex(METER.bands.low[0], sr, N);
      const lowB = hzToIndex(METER.bands.low[1], sr, N);
      const midA = hzToIndex(METER.bands.mid[0], sr, N);
      const midB = hzToIndex(METER.bands.mid[1], sr, N);

      const tick = ()=>{
        analyser.getByteFrequencyData(buf);

        // Energía promedio por banda
        let sumL=0, cL=0, sumM=0, cM=0;
        for(let i=Math.max(0,lowA); i<=Math.min(buf.length-1,lowB); i++){ sumL+=buf[i]; cL++; }
        for(let i=Math.max(0,midA); i<=Math.min(buf.length-1,midB); i++){ sumM+=buf[i]; cM++; }
        const eLow = cL? (sumL/cL)/255 : 0;
        const eMid = cM? (sumM/cM)/255 : 0;

        // Pulso por subida súbita en graves
        const deltaLow = eLow - prevLow; prevLow = eLow;
        if(deltaLow > PULSE.threshold){
          pulseEnv = Math.min(1, pulseEnv + deltaLow * 2.6); // Ataque rápido
        } else {
          pulseEnv *= PULSE.decay; // Release corto
        }

        // Mezcla lineal con base según estado (idle vs play)
        const playing = !!(audio && !audio.paused);
        const base = playing ? METER.basePlay : METER.baseIdle;

        let lin = base
          + (eLow * METER.gainLow * METER.wLow)
          + (eMid * METER.gainMid * METER.wMid);
        lin = clamp(lin, METER.clampMin, METER.clampMax);

        // Suavizado EMA asimétrico
        const alpha = (lin > smoothed) ? METER.emaRise : METER.emaFall;
        smoothed = (1 - alpha) * smoothed + alpha * lin;

        // Salida final: suavizado + pulso, con curva de énfasis
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

  // ---------------------------------------------------------------------------
  // Listeners de eventos provenientes de MDFCore
  // ---------------------------------------------------------------------------
  function onAudioReady(ev){
    audio = ev?.detail?.audio || window.MDFCore?.getAudio?.();
    if(!audio) return;

    // Reaplicar velocidad persistida y enganchar loadedmetadata
    if (lastAudioForSpeedListener) {
      lastAudioForSpeedListener.removeEventListener("loadedmetadata", _mdfSyncSpeed, false);
    }
    lastAudioForSpeedListener = audio;
    audio.addEventListener("loadedmetadata", _mdfSyncSpeed, false);
    applySpeed(getSavedSpeed());

    // Sincroniza volumen UI ↔ audio
    els.vol.value = String(audio.volume || 1);
    setRangeFill(els.vol, 100*Number(els.vol.value));

    startBeatMeter();
    enforceVisibility();
  }

function onTrackMeta(ev){
  const d = ev?.detail || {};
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  const fullTitle  = d.title  || "—";
  const fullArtist = d.artist || "—";

  // Límites de caracteres en móvil
  const TITLE_LIMIT  = 8;   // por si luego quieres subir/bajar
  const ARTIST_LIMIT = 10;

  const clampText = (text, limit) => {
    text = String(text || "—");
    if (!isMobile || !limit || text.length <= limit) return text;
    return text.slice(0, limit) + "…";
  };

  const displayTitle  = clampText(fullTitle, TITLE_LIMIT);
  const displayArtist = clampText(fullArtist, ARTIST_LIMIT);

  // Texto que se ve en la barra
  els.title.textContent  = displayTitle;
  els.artist.textContent = displayArtist;

  // Tooltip con el texto completo (útil en desktop)
  els.title.title  = fullTitle;
  els.artist.title = fullArtist;

  // --------- lo demás igual que ya lo tenías ---------
  if (d.cover){
    els.cover.style.visibility = "visible";
    els.cover.src = d.cover;
    els.cover.onerror = () => { els.cover.style.visibility = "hidden"; };
  } else {
    els.cover.removeAttribute("src");
    els.cover.style.visibility = "hidden";
  }

  const k = normGenre(d.genre);
  const h = k != null ? GENRE_HUES[k] : null;

  // Tema blanco para género “otro”
  els.bar?.classList.toggle("mdf-whiteglow", k === "otro");

  if (h != null){
    lockGenreHue = true;
    hue = h;
  } else {
    lockGenreHue = false;
  }
  setVars(intensity, hue);
}

  function onTrackChange(){
    enforceVisibility();
    // Reafirma velocidad por si cambia el <audio> interno
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
    enforceVisibility();
  }

  function onState(ev){
    const playing = !!ev.detail?.playing;
    els.play.textContent = playing ? "⏸" : "▶";
  }

  function onShowBar(){
    ensureBarToggle();
    applySavedHidden();
    enforceVisibility();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
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

    // Si MDFCore ya está listo cuando se carga esta UI
    if(window.MDFCore && typeof window.MDFCore.getAudio === "function"){
      onAudioReady({detail:{audio:window.MDFCore.getAudio()}});
    }
  }

  // ---------------------------------------------------------------------------
  // API de consola / uso externo
  // ---------------------------------------------------------------------------
  window.MDFBarUI = {
    init, show, hide,
    setLockGenre(flag){ lockGenreHue = !!flag; },
    setHue(h){ hue = Number(h)||0; setVars(intensity, hue); },
    setSpeed(rate){ applySpeed(Number(rate)); },
    getPersistedSpeed(){ return getSavedSpeed(); },
    setPersistedSpeed(rate){ applySpeed(Number(rate)); }
  };
  window.MDFBar = window.MDFBarUI; // alias

  // Auto-init al cargar el documento
  if(document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else
    init();

})();
