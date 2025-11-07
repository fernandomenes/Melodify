// static/muro/muro.js
// ============================================================================
// Muro – Gestión de selección múltiple, eliminación en lote y deshacer (SPA)
// ============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /**
   * Obtiene el valor de una cookie por nombre.
   * @param {string} name
   * @returns {string}
   */
  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  /**
   * Obtiene el token CSRF desde meta o cookie.
   * @returns {string}
   */
  function getCSRF() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || getCookie("csrftoken");
  }

  /**
   * Muestra la barra de deshacer con un mensaje.
   * @param {string} label
   */
  function showUndo(label) {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = label || "Acción realizada.";
    if (bar) bar.style.display = "flex";
  }

  /** Oculta la barra de deshacer. */
  function hideUndo() {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = "";
    if (bar) bar.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  // Selección múltiple
  // ---------------------------------------------------------------------------
  /** @type {Set<number>} */
  const selected = new Set();
  /** Snapshots de tarjetas eliminadas para restauración sin recarga. id -> nodo clonado */
  const removedSnapshots = new Map();

  /** Actualiza controles y contadores del modo de selección múltiple. */
  function updateBulkUI() {
    const btn = $("#bulk-delete-muro");
    const count = selected.size;
    if (btn) btn.disabled = count === 0;

    const sc = $("#sel-count-muro");
    if (sc) sc.textContent = count ? `${count} seleccionada${count !== 1 ? "s" : ""}` : "";

    const all = $("#sel-all-muro");
    if (all) {
      const checks = $$("#muro-grid .song-select");
      all.checked = checks.length > 0 && checks.every(ch => ch.checked);
      all.indeterminate = count > 0 && count < checks.length;
    }
  }

  /** Limpia la selección actual. */
  function resetSelection() {
    selected.clear();
    const checks = $$("#muro-grid .song-select");
    checks.forEach(ch => (ch.checked = false));
    updateBulkUI();
  }

  document.addEventListener("change", e => {
    const t = e.target;

    // (1) selección por ítem
    if (t && t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id);
        else selected.delete(id);
        updateBulkUI();
      }
    }

    // (2) seleccionar todo
    if (t && t.id === "sel-all-muro") {
      const checks = $$("#muro-grid .song-select");
      checks.forEach(ch => {
        ch.checked = t.checked;
        const id = parseInt(ch.value, 10);
        if (!isNaN(id)) {
          if (t.checked) selected.add(id);
          else selected.delete(id);
        }
      });
      updateBulkUI();
    }
  });

  // ---------------------------------------------------------------------------
  // Eliminación múltiple
  // ---------------------------------------------------------------------------
  /**
   * Ejecuta eliminación en lote y actualiza el DOM. Soporta respuesta JSON o recarga.
   * @param {number[]} ids
   */
  async function doBulkDeleteMuro(ids) {
    try {
      // Snapshot del DOM antes de eliminar (para deshacer sin recargar).
      ids.forEach(id => {
        const card = document.querySelector(`#muro-grid .js-song-card[data-song-id="${id}"]`);
        if (card && !removedSnapshots.has(id)) {
          removedSnapshots.set(id, card.cloneNode(true));
        }
      });

      const fd = new FormData();
      ids.forEach(id => fd.append("ids[]", String(id)));

      const res = await fetch("/muro/canciones/eliminar-multiples/", {
        method: "POST",
        body: fd,
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) {
        location.reload();
        return;
      }

      const j = await res.json();
      if (!j.ok) {
        alert(j.error || "No fue posible eliminar las canciones.");
        return;
      }

      // Retira tarjetas del DOM
      (j.removed_ids || ids).forEach(id => {
        const card = document.querySelector(`#muro-grid .js-song-card[data-song-id="${id}"]`);
        if (card) card.remove();
      });

      if (j.undo_label) showUndo(j.undo_label);
      resetSelection();
    } catch {
      location.reload();
    }
  }

  document.addEventListener("click", async e => {
    const btn = e.target.closest("#bulk-delete-muro");
    if (!btn) return;
    e.preventDefault();
    if (selected.size === 0) return;

    // Mensaje de confirmación con pluralización correcta.
    const n = selected.size;
    const noun = n === 1 ? "canción seleccionada" : "canciones seleccionadas";
    if (!window.confirm(`¿Eliminar ${n} ${noun}?`)) return;

    await doBulkDeleteMuro(Array.from(selected));
  });

  // ---------------------------------------------------------------------------
  // Deshacer (restauración sin recargar)
  // ---------------------------------------------------------------------------
  const undoForm = $("#muro-undo-form");
  undoForm?.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const fd = new FormData(undoForm);
      const res = await fetch(undoForm.action, {
        method: "POST",
        body: fd,
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      // Compatibilidad: 204 (sin contenido) o JSON con detalle.
      if (res.status === 204) {
        const grid = $("#muro-grid");
        removedSnapshots.forEach(node => {
          if (grid && node) grid.prepend(node);
        });
        removedSnapshots.clear();
        hideUndo();
        // Recarga opcional para sincronizar contadores/estado del servidor:
        // location.reload();
        return;
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json();
        if (j.ok) {
          const ids = j.restored_ids || Array.from(removedSnapshots.keys());
          const grid = $("#muro-grid");
          ids.forEach(id => {
            const node = removedSnapshots.get(id);
            if (grid && node) grid.prepend(node);
            removedSnapshots.delete(id);
          });
          hideUndo();
          resetSelection();
          return;
        }
      }

      // Fallback
      location.reload();
    } catch {
      location.reload();
    }
  });

  // ---------------------------------------------------------------------------
  // Inicialización
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    resetSelection();
  });
})();
