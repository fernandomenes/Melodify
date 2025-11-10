// static/muro/muro.js
// Muro aislado: selección múltiple, eliminar (individual y lote), deshacer, tabs.
// Todo scopeado a #muro-content para no interferir con el Home.

(function () {
  // ----------------------------- Utils ---------------------------------
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function getCSRF() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || getCookie("csrftoken");
  }

  function showUndo(label) {
    const bar = $("#undo-bar", root);
    const lbl = $("#undo-label", root);
    if (lbl) lbl.textContent = label || "Acción realizada.";
    if (bar) bar.style.display = "flex";
  }
  function hideUndo() {
    const bar = $("#undo-bar", root);
    const lbl = $("#undo-label", root);
    if (lbl) lbl.textContent = "";
    if (bar) bar.style.display = "none";
  }

  // ------------------------------ Root ---------------------------------
  const root = document.getElementById("muro-content");
  if (!root) return;

  // Nodos base (dentro del root)
  const grid     = $("#songs-grid", root);
  const selAll   = $("#sel-all", root);
  const btnBulk  = $("#bulk-delete", root);
  const selCount = $("#sel-count", root);
  const undoForm = $("#muro-undo-form", root);

  // Dataset desde main-content
  const main     = document.getElementById("main-content");
  const ENDPOINT_BULK = main?.dataset?.urlMuroBulk || "/canciones/eliminar-multiples/";

  // -------------------------- Estado de selección ----------------------
  /** @type {Set<number>} */
  const selected = new Set();
  /** Cache de tarjetas eliminadas para deshacer sin recargar */
  const removedCache = new Map(); // id -> HTMLElement

  function updateUI() {
    const n = selected.size;
    if (btnBulk)  btnBulk.disabled = n === 0;
    if (selCount) selCount.textContent = n ? `${n} seleccionada${n!==1?'s':''}` : "";

    const checks = grid ? $$(".song-select", grid) : [];
    if (selAll) {
      selAll.checked       = (checks.length > 0 && checks.every(ch => ch.checked));
      selAll.indeterminate = (n > 0 && n < checks.length);
    }
  }

  function resetSelection() {
    selected.clear();
    if (grid) $$(".song-select", grid).forEach(ch => ch.checked = false);
    updateUI();
  }

  // -------------------------- Modal de confirm -------------------------
  function confirmWithModal(texto = "¿Eliminar este elemento?") {
    const modal     = $("#confirm-modal", document);
    const dlg       = modal?.querySelector(".dialog");
    const txt       = modal?.querySelector("#confirm-text");
    const btnOk     = modal?.querySelector("#confirm-accept");
    const btnCancel = modal?.querySelector("#confirm-cancel");

    if (!modal || !btnOk || !btnCancel) {
      return Promise.resolve(window.confirm(texto));
    }
    if (txt) txt.textContent = texto;

    return new Promise((resolve) => {
      function cleanup() {
        modal.classList.remove("show");
        btnOk.removeEventListener("click", onOk);
        btnCancel.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKey);
      }
      function onOk()    { cleanup(); resolve(true); }
      function onCancel(){ cleanup(); resolve(false); }
      function onKey(e)  { if (e.key === "Escape") onCancel(); }

      btnOk.addEventListener("click", onOk);
      btnCancel.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);

      modal.classList.add("show");
      (dlg || modal).focus?.();
    });
  }

  // ------------------------- Selección múltiple ------------------------
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (!t) return;

    // (1) Seleccionar todo
    if (t.id === "sel-all") {
      if (!grid) return;
      $$(".song-select", grid).forEach(ch => {
        ch.checked = t.checked;
        const id = parseInt(ch.value, 10);
        if (!isNaN(id)) (t.checked ? selected.add(id) : selected.delete(id));
      });
      updateUI();
      return;
    }

    // (2) Checkbox individual
    if (t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id); else selected.delete(id);
        updateUI();
      }
    }
  });

  // (B) Captura la tarjeta ANTES de enviar form de borrar (para deshacer)
  root.addEventListener("submit", (e) => {
    const f = e.target;
    if (!f || !f.classList || !f.classList.contains("js-delete-form")) return;
    const card = f.closest(".js-song-card");
    const sid  = Number(f.dataset.songId || card?.dataset.songId || NaN);
    if (card && !Number.isNaN(sid) && !removedCache.has(sid)) {
      removedCache.set(sid, card);
    }
  }, true);

  // --------------------- Eliminación individual (AJAX) -----------------
  root.addEventListener("submit", async (e) => {
    const f = e.target;
    if (!f || !f.classList || !f.classList.contains("js-delete-form")) return;

    e.preventDefault();

    const title = f.dataset.title || "este elemento";
    const ok = await confirmWithModal(`¿Eliminar “${title}”?`);
    if (!ok) return;

    const card = f.closest(".js-song-card");

    try {
      const fd = new FormData(f);
      const res = await fetch(f.action, {
        method: "POST",
        body: fd,
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();

      if (ct.includes("application/json")) {
        const j = await res.json();
        if (card) card.remove();
        showUndo(j.undo_label || `Se eliminó “${title}”.`);
        resetSelection();
        return;
      }
      if (res.status === 204) {
        if (card) card.remove();
        showUndo(`Se eliminó “${title}”.`);
        resetSelection();
        return;
      }

      location.reload();
    } catch {
      location.reload();
    }
  }, true);

  // ------------------------- Eliminación múltiple ----------------------
  btnBulk?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (selected.size === 0) return;

    const n = selected.size;
    const noun = n === 1 ? "canción seleccionada" : "canciones seleccionadas";
    const ok = await confirmWithModal(`¿Eliminar ${n} ${noun}?`);
    if (!ok) return;

    try {
      const fd = new FormData();
      Array.from(selected).forEach(id => fd.append("ids[]", String(id)));
      fd.append("ids", JSON.stringify(Array.from(selected)));

      const res = await fetch(ENDPOINT_BULK, {
        method: "POST",
        body: fd,
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) { location.reload(); return; }

      const j = await res.json();
      if (!j.ok) { alert(j.error || "No fue posible eliminar las canciones."); return; }

      (j.removed_ids || []).forEach(id => {
        const card = grid?.querySelector(`.js-song-card[data-song-id="${id}"]`);
        if (card) { removedCache.set(id, card); card.remove(); }
      });

      selected.clear();
      updateUI();
      showUndo(j.undo_label || `Se eliminaron ${n} ${noun}.`);
    } catch {
      location.reload();
    }
  });

  // ------------------------------ Deshacer -----------------------------
  undoForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(undoForm);
      const res = await fetch(undoForm.action, {
        method: "POST",
        body: fd,
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      if (res.status === 204) {
        const frag = document.createDocumentFragment();
        removedCache.forEach(node => { if (node) frag.appendChild(node); });
        if (frag.childNodes.length && grid) grid.prepend(frag);
        removedCache.clear();
        resetSelection();
        hideUndo();
        return;
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json();
        if (j.ok) {
          const ids = j.restored_ids || Array.from(removedCache.keys());
          const frag = document.createDocumentFragment();
          ids.forEach(id => { const node = removedCache.get(id); if (node) { removedCache.delete(id); frag.appendChild(node); } });
          if (frag.childNodes.length && grid) grid.prepend(frag);
          resetSelection();
          hideUndo();
          return;
        }
      }

      location.reload();
    } catch {
      location.reload();
    }
  });

  // ------------------------------ Tabs --------------------------------
  (function tabs(){
    function setActiveTab(name){
      const secs = $$(".tab", root);
      const btns = $$(".tab-btn", root);
      secs.forEach(sec=>{
        const on = (sec.id === `tab-${name}`);
        sec.toggleAttribute("hidden", !on);
        sec.classList.toggle("active", on);
        sec.setAttribute("aria-hidden", on ? "false" : "true");
      });
      btns.forEach(b=>{
        const on = (b.dataset.tab === name);
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true":"false");
      });
    }
    root.addEventListener("click", (e)=>{
      const btn = e.target.closest?.(".tab-btn");
      if (!btn || !root.contains(btn)) return;
      e.preventDefault();
      setActiveTab(btn.dataset.tab);
    });
    function init(){
      const first = $(".tabs .tab-btn.active", root)?.dataset.tab || "songs";
      setActiveTab(first);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  })();

  // --------------------------- Menu toggle -----------------------------
  (function menuToggle(){
    const btn    = document.getElementById("menu-toggle-btn");
    const menu   = document.getElementById("menuLateral");
    const header = document.getElementById("header");
    btn?.addEventListener("click", () => {
      menu?.classList.toggle("collapsed");
      document.getElementById("main-content")?.classList.toggle("menuLateral-collapsed");
      header?.classList.toggle("menuLateral-collapsed");
    });
  })();

  // -------------------------- User menu / logout -----------------------
  (function userMenu(){
    const trigger = document.getElementById("user-trigger");
    const menu    = document.getElementById("user-menu");
    if (trigger && menu){
      trigger.addEventListener("click", (e)=>{
        const inside = e.target.closest("#user-menu");
        if (!inside){ e.preventDefault(); menu.style.display = (menu.style.display === "block" ? "none" : "block"); }
      });
      document.addEventListener("click", (e)=>{ if (!e.target.closest("#user-trigger")) menu.style.display = "none"; });
    }
    const logout = document.getElementById("menu-logout");
    if (logout){
      logout.addEventListener("click", async (e)=>{
        e.preventDefault();
        const url = (window.MELODIFY_LOGOUT_URL || "/logout/");
        try {
          const res = await fetch(url, { method: "POST", headers: {"X-CSRFToken": getCSRF()}, credentials: "same-origin" });
          if (res.redirected) { location.href = res.url; return; }
          if (res.ok) { location.href = (document.getElementById('main-content')?.dataset.urlHome || "/"); return; }
        } catch {}
        location.href = url;
      });
    }
  })();

  // --------------------------- Init visual -----------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateUI);
  } else {
    updateUI();
  }
})();
