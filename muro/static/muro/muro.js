// static/muro/muro.js
// Muro del artista: gestión de canciones (selección, eliminación individual y múltiple, undo) y UI básica.
// El comportamiento se limita a #muro-content para no interferir con otras vistas.

(function () {
  "use strict";

  // ============================= Utilidades ==============================
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const H  = { "X-Requested-With": "fetch" };

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function getCSRF() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || getCookie("csrftoken");
  }

  // ============================== Root ===================================
  const root = document.getElementById("muro-content");
  if (!root) return;

  // Nodos base de canciones dentro del contenedor principal
  const grid     = $("#songs-grid", root);
  const selAll   = $("#sel-all", root);
  const btnBulk  = $("#bulk-delete", root);
  const selCount = $("#sel-count", root);
  const undoForm = $("#muro-undo-form", root);

  // Endpoints obtenidos de #main-content (con valores por defecto)
  const main = document.getElementById("main-content");
  const URLS = {
    bulkDelete: main?.dataset?.urlMuroBulk     || "/mi-muro/canciones/eliminar-multiples/",
    undo:       main?.dataset?.urlRevertirMuro || "/mi-muro/undo/",
  };

  // ======================= Undo (UI y helpers) ===========================
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

  // ===================== Estado de selección =============================
  /** @type {Set<number>} */
  const selected = new Set();
  /** Cache de tarjetas eliminadas para deshacer sin recargar la página */
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

  // ========================== Modal de confirmación ======================
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

  // ==================== Selección múltiple de canciones ==================
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (!t) return;

    // Selección global
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

    // Checkbox individual
    if (t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id); else selected.delete(id);
        updateUI();
      }
    }
  });

  // Cache de la tarjeta antes de enviar el formulario de eliminación individual
  root.addEventListener("submit", (e) => {
    const f = e.target;
    if (!f || !f.classList || !f.classList.contains("js-delete-form")) return;
    const card = f.closest(".js-song-card");
    const sid  = Number(f.dataset.songId || card?.dataset.songId || NaN);
    if (card && !Number.isNaN(sid) && !removedCache.has(sid)) {
      removedCache.set(sid, card);
    }
  }, true);

  // ===================== Eliminación individual ==========================
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
        headers: { ...H, "X-CSRFToken": getCSRF() },
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

  // ======================= Eliminación múltiple ==========================
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

      const res = await fetch(URLS.bulkDelete, {
        method: "POST",
        body: fd,
        headers: { ...H, "X-CSRFToken": getCSRF() },
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

  // ============================== Undo ===================================
  undoForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(undoForm);
      const res = await fetch(URLS.undo || undoForm.action, {
        method: "POST",
        body: fd,
        headers: { ...H, "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      // Código 204: restaurar tarjetas desde la caché local
      if (res.status === 204) {
        const frag = document.createDocumentFragment();
        removedCache.forEach(node => { if (node) frag.appendChild(node); });
        if (frag.childNodes.length && grid) grid.prepend(frag);
        removedCache.clear();
        resetSelection();
        hideUndo();
        return;
      }

      // Recarga completa en caso alternativo
      location.reload();
    } catch {
      location.reload();
    }
  });

  // =================== Menú lateral y menú de usuario ====================
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

  (function userMenu(){
    const trigger = document.getElementById("user-trigger");
    const menu    = document.getElementById("user-menu");
    if (trigger && menu){
      trigger.addEventListener("click", (e)=>{
        const inside = e.target.closest("#user-menu");
        if (!inside){
          e.preventDefault();
          menu.style.display = (menu.style.display === "block" ? "none" : "block");
        }
      });
      document.addEventListener("click", (e)=>{
        if (!e.target.closest("#user-trigger")) menu.style.display = "none";
      });
    }
    const logout = document.getElementById("menu-logout");
    if (logout){
      logout.addEventListener("click", async (e)=>{
        e.preventDefault();
        const url = (window.MELODIFY_LOGOUT_URL || "/logout/");
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {"X-CSRFToken": getCSRF()},
            credentials: "same-origin"
          });
          if (res.redirected) { location.href = res.url; return; }
          if (res.ok) {
            location.href = (document.getElementById("main-content")?.dataset.urlHome || "/");
            return;
          }
        } catch {}
        location.href = url;
      });
    }
  })();

  // ============== Subida de canción con barra de progreso ================
  (function singleUploadProgress(){
    const form = document.getElementById("form-upload");
    if (!form) return;

    // Entrada de género libre cuando se selecciona la opción "Otro"
    const genreSel   = form.querySelector("#genre");
    const genreOther = document.getElementById("genre-other");
    if (genreSel && genreOther){
      const toggleOther = () => { genreOther.style.display = (genreSel.value === "_other" ? "block" : "none"); };
      genreSel.addEventListener("change", toggleOther);
      toggleOther();
    }

    const bar     = document.getElementById("upload-bar");
    const barFill = bar?.querySelector(".progress > i");
    const barPct  = document.getElementById("upload-pct");
    const btn     = form.querySelector('button[type="submit"]');

    function setPct(p){
      const pct = Math.max(0, Math.min(100, p|0));
      bar?.classList.add("is-visible");
      if (barFill) barFill.style.width = pct + "%";
      if (barPct)  barPct.textContent  = pct + "%";
    }

    form.addEventListener("submit", (e) => {
      // Solo se aplica envío asíncrono cuando el formulario está marcado con data-ajax="1"
      if (form.dataset.ajax !== "1") return;
      e.preventDefault();

      const fd   = new FormData(form);
      const xhr  = new XMLHttpRequest();
      const csrf = getCSRF();

      xhr.open("POST", form.action, true);
      if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
      xhr.setRequestHeader("X-Requested-With","XMLHttpRequest");

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setPct((ev.loaded / ev.total) * 100);
        else setPct(10);
      };
      xhr.onloadstart = () => { btn?.setAttribute("disabled","disabled"); setPct(0); };
      xhr.onerror = xhr.onabort = () => {
        setPct(0);
        bar?.classList.remove("is-visible");
        btn?.removeAttribute("disabled");
        alert("No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.");
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300){
          setPct(100);
          setTimeout(()=>location.reload(), 500);
        } else {
          btn?.removeAttribute("disabled");
          bar?.classList.remove("is-visible");
          alert("Error al subir: " + xhr.status + " " + xhr.statusText);
        }
      };

      xhr.send(fd);
    });
  })();

  // ========================== Inicialización =============================
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateUI);
  } else {
    updateUI();
  }
})();
