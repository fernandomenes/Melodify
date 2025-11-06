// static/gestion/gestion.js
// ============================================================================
// Gestión – Administración de pestañas, selección múltiple, eliminación (con
// modal de confirmación), deshacer y reemplazo parcial de vistas.
// ============================================================================

(function () {
  "use strict";

  // Exponer bandera de carga (diagnóstico)
  window.__gestion_loaded__ = true;

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const $all = $$;

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

  // ---------------------------------------------------------------------------
  // Mensajería en línea (errores/success)
  // ---------------------------------------------------------------------------
  /**
   * Muestra un mensaje de error en el contenedor inline.
   * @param {string} msg
   */
  function showInlineError(msg) {
    const box = $("#inline-msg");
    if (!box) return;
    box.textContent = msg || "No se pudo completar la acción.";
    box.className = "msg error";
    box.style.display = "block";
  }

  /** Oculta el contenedor de mensaje en línea. */
  function clearInlineMsg() {
    const box = $("#inline-msg");
    if (box) box.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  // Barra de deshacer (undo)
  // ---------------------------------------------------------------------------
  /**
   * Muestra la barra de deshacer con etiqueta.
   * @param {string} label
   */
  function showUndo(label) {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = label || "Acción realizada.";
    if (bar) bar.style.display = "flex";
  }

  /** Oculta la barra de deshacer y limpia etiqueta. */
  function hideUndo() {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = "";
    if (bar) bar.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  // Reemplazos parciales (Usuarios / Catálogo)
  // ---------------------------------------------------------------------------
  /**
   * Reemplaza la pestaña #tab-usuarios por su versión fresca en HTML.
   * @param {string} html
   */
  function replaceUsuariosTab(html) {
    if (!html) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    const fresh = wrap.querySelector("#tab-usuarios");
    const old   = $("#tab-usuarios");
    if (fresh && old) old.replaceWith(fresh);

    // Marcar pestaña como activa si aplica
    const tabBtn = $('.tab-btn[data-tab="usuarios"]');
    if (tabBtn) tabBtn.setAttribute("aria-selected", "true");
  }

  /**
   * Sustituye el grid del catálogo con el fragmento recibido y reinicia selección.
   * @param {string} html
   */
  function replaceCatalogo(html) {
    const cont = $("#catalogo-songs");
    if (!cont || typeof html !== "string") return;

    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();

    const fresh = wrap.querySelector("#catalogo-grid") || wrap.firstElementChild;
    const old   = cont.querySelector("#catalogo-grid");

    if (fresh) {
      if (old) old.replaceWith(fresh);
      else cont.innerHTML = html;
    } else {
      cont.innerHTML = html;
    }

    resetSelection();
  }

  // ---------------------------------------------------------------------------
  // Tabs accesibles (ARIA)
  // ---------------------------------------------------------------------------
  /**
   * Activa una pestaña y su panel asociado.
   * @param {string} tabName
   * @param {boolean} [push=true] Actualiza hash en URL.
   */
  function activateTabs(tabName, push = true) {
    const tablist = $('.tabs[role="tablist"]');
    if (!tablist) return;

    tablist.querySelectorAll('.tab-btn[role="tab"]').forEach((b) => {
      const on = b.dataset.tab === tabName;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });

    $$('.tab[role="region"]').forEach((p) => {
      const show = p.id === "tab-" + tabName;
      p.classList.toggle("active", show);
      p.hidden = !show;
    });

    if (push) {
      const u = new URL(location.href);
      u.hash = tabName;
      history.replaceState(null, "", u);
    }
  }

  /** Inicializa control de tabs (mouse/teclado). */
  function initTabs() {
    const tablist = $('.tabs[role="tablist"]');
    if (!tablist) return;

    tablist.addEventListener("click", (e) => {
      const btn = e.target.closest('.tab-btn[role="tab"]');
      if (!btn) return;
      e.preventDefault();
      activateTabs(btn.dataset.tab);
    });

    tablist.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const btns = Array.from(tablist.querySelectorAll('.tab-btn[role="tab"]'));
      let i = btns.indexOf(document.activeElement);
      if (i === -1) i = btns.findIndex((b) => b.getAttribute("aria-selected") === "true");
      let j = i;
      if (e.key === "ArrowRight") j = (i + 1) % btns.length;
      if (e.key === "ArrowLeft") j = (i - 1 + btns.length) % btns.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = btns.length - 1;
      btns[j].focus();
      btns[j].click();
    });

    activateTabs((location.hash || "").slice(1) || "usuarios", false);
  }

  // ---------------------------------------------------------------------------
  // Modal de confirmación
  // ---------------------------------------------------------------------------
  const modal      = $("#confirm-modal");
  const txt        = $("#confirm-text");
  const btnCancel  = $("#confirm-cancel");
  const btnAccept  = $("#confirm-accept");

  /** @type {HTMLFormElement|null} */
  let pendingForm  = null;
  /** @type {number[]|null} */
  let pendingBulkIds = null;

  /**
   * Abre el modal con un mensaje.
   * @param {string} message
   * @returns {boolean} true si se mostró.
   */
  function openModal(message) {
    if (!modal) return false;
    if (txt) txt.textContent = message || "¿Eliminar este elemento?";
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    return true;
  }

  /** Cierra el modal y limpia estados pendientes. */
  function closeModal() {
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    pendingForm = null;
    pendingBulkIds = null;
  }

  btnCancel?.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });
  modal?.addEventListener("click",  (e) => { if (e.target === modal) closeModal(); });

  // ---------------------------------------------------------------------------
  // Eliminación múltiple (Catálogo)
  // ---------------------------------------------------------------------------
  /**
   * Ejecuta eliminación en lote y actualiza vistas.
   * @param {number[]} ids
   */
  async function doBulkDelete(ids) {
    try {
      const fd = new FormData();
      ids.forEach(id => fd.append("ids[]", String(id)));

      const res = await fetch("/gestion/canciones/eliminar-multiples/", {
        method: "POST",
        body: fd,
        headers: {
          "X-Requested-With": "fetch",
          "X-CSRFToken": getCSRF(),
        },
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) { location.reload(); return; }

      const j = await res.json();
      if (!j.ok) {
        showInlineError(j.error || "No fue posible eliminar las canciones.");
        return;
      }

      if (j.undo_label) showUndo(j.undo_label);
      if (j.catalogo_html) {
        replaceCatalogo(j.catalogo_html);
      } else {
        (j.removed_ids || []).forEach(id => {
          const card = document.querySelector(`.js-song-card[data-song-id="${id}"]`);
          if (card) card.remove();
        });
      }
    } catch {
      location.reload();
    } finally {
      pendingBulkIds = null;
      resetSelection();
    }
  }

  /**
   * Ejecuta una acción de eliminación individual.
   * @param {HTMLFormElement} form
   */
  async function doDelete(form) {
    try {
      const fd  = new FormData(form);
      const res = await fetch(form.action, {
        method: "POST",
        body: fd,
        headers: {
          "X-Requested-With": "fetch",
          "X-CSRFToken": getCSRF(),
        },
        redirect: "follow",
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json();

        if (j.ok === false) {
          showInlineError(j.error || "No se pudo completar la acción.");
          return;
        }

        if (j.undo_label)   showUndo(j.undo_label);
        if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
        if (j.catalogo_html) replaceCatalogo(j.catalogo_html);
        else if (!j.usuarios_html) {
          const rowOrCard = form.closest(".js-song-card, tr, .song");
          if (rowOrCard) rowOrCard.remove();
        }
        return;
      }

      location.reload();
    } catch {
      location.reload();
    }
  }

  // ---------------------------------------------------------------------------
  // Selección múltiple en Catálogo
  // ---------------------------------------------------------------------------
  /** @type {Set<number>} */
  const selected = new Set();

  /** Sincroniza controles y contador del modo de selección. */
  function updateBulkUI() {
    const btn = $("#bulk-delete");
    const count = selected.size;
    if (btn) btn.disabled = count === 0;

    const sc = $("#sel-count");
    if (sc) sc.textContent = count ? `${count} seleccionada${count !== 1 ? "s" : ""}` : "";

    const all = $("#sel-all");
    if (all) {
      const checks = $all("#catalogo-grid .song-select");
      all.checked = checks.length > 0 && checks.every(ch => ch.checked);
      all.indeterminate = count > 0 && count < checks.length;
    }
  }

  /** Limpia el conjunto de selección y actualiza UI. */
  function resetSelection() {
    selected.clear();
    updateBulkUI();
  }

  // Delegación de cambios en checkboxes
  document.addEventListener("change", (e) => {
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
    if (t && t.id === "sel-all") {
      const checks = $all("#catalogo-grid .song-select");
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

  // Eliminar seleccionadas (con modal; sin confirm nativo)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("#bulk-delete");
    if (!btn) return;

    e.preventDefault();
    if (selected.size === 0) return;

    const n   = selected.size;
    const ids = Array.from(selected);
    const noun = n === 1 ? "canción seleccionada" : "canciones seleccionadas";

    if (openModal(`¿Eliminar ${n} ${noun}?`)) {
      pendingBulkIds = ids; // será consumido por el handler de btnAccept
      return;
    }

    // Fallback si no existiera el modal
    if (!window.confirm(`¿Eliminar ${n} ${noun}?`)) return;
    await doBulkDelete(ids);
  });

  // ---------------------------------------------------------------------------
  // Intercepción de formularios
  // ---------------------------------------------------------------------------
  document.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;

    const href = form.action || "";

    // 1) Borrados con modal
    if (form.classList.contains("js-delete-form")) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      const t = form.dataset.title || "este elemento";
      pendingForm = form;
      if (!openModal(`¿Eliminar “${t}”?`)) {
        if (confirm(`¿Eliminar “${t}”?`)) await doDelete(form);
      }
      return;
    }

    // 2) Deshacer (barra)
    const isUndo = href.includes("/revertir_accion") || href.endsWith("/gestion/undo/");
    if (isUndo) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      try {
        const fd = new FormData(form);
        const res = await fetch(href, {
          method: "POST",
          body: fd,
          headers: {
            "X-Requested-With": "fetch",
            "X-CSRFToken": getCSRF(),
          },
          redirect: "follow",
          credentials: "same-origin",
        });

        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          const j = await res.json();
          hideUndo();
          if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
          if (j.catalogo_html)  replaceCatalogo(j.catalogo_html);
          return;
        }
        hideUndo();
        location.reload();
      } catch {
        hideUndo();
        location.reload();
      }
      return;
    }

    // 3) Toggle / Registrar (acciones con deshacer)
    const isEliminar = href.includes("/gestion/usuarios/eliminar/") || href.includes("/gestion/canciones/eliminar/");
    const isToggle   = href.includes("/gestion/usuarios/desactivar/") || href.includes("/gestion/usuarios/activar/");
    const isRegister = /\/gestion\/registrar[-_](?:artista|admin)\/?$/i.test(href);
    const isUndoable = isEliminar || isToggle || isRegister;
    if (!isUndoable) return;

    e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    clearInlineMsg();

    // Validaciones mínimas en registro
    if (isRegister) {
      const u = form.querySelector('input[name="user"]')?.value?.trim() || "";
      const p = form.querySelector('input[name="password"]')?.value || "";
      if (!u || !p) { showInlineError("Completa usuario y contraseña."); return; }
      if (p.length < 6) { showInlineError("La contraseña debe tener al menos 6 caracteres."); return; }
      const desc = form.querySelector('textarea[name="description"]')?.value || "";
      if (desc && desc.length > 200) { showInlineError("La descripción no puede superar 200 caracteres."); return; }
    }

    try {
      const fd = new FormData(form);
      const res = await fetch(href, {
        method: "POST",
        body: fd,
        headers: {
          "X-Requested-With": "fetch",
          "X-CSRFToken": getCSRF(),
        },
        redirect: "follow",
        credentials: "same-origin",
      });

      if (res.status === 204) { hideUndo(); return; }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json();

        if (j.ok === false) {
          showInlineError(j.error || "No se pudo completar la acción.");
          return;
        }

        if (j.undo_label)    showUndo(j.undo_label);
        if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
        if (j.catalogo_html) replaceCatalogo(j.catalogo_html);

        // Fallback local si fue eliminación y no vino HTML para reemplazar
        if (isEliminar && !j.usuarios_html && !j.catalogo_html) {
          const rowOrCard = form.closest(".js-song-card, tr, .song");
          if (rowOrCard) rowOrCard.remove();
        }

        if (isRegister) form.reset();
        return;
      }

      showInlineError("No se pudo completar la acción (valida los campos).");
    } catch {
      showInlineError("Error de red.");
    }
  }, true);

  // ---------------------------------------------------------------------------
  // Confirmación desde el modal
  // ---------------------------------------------------------------------------
  btnAccept?.addEventListener("click", async (e) => {
    e.preventDefault();

    if (pendingForm) {
      await doDelete(pendingForm);
      closeModal();
      return;
    }

    if (pendingBulkIds && pendingBulkIds.length) {
      await doBulkDelete(pendingBulkIds);
      closeModal();
      return;
    }

    closeModal();
  });

  // ---------------------------------------------------------------------------
  // Inicialización
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    resetSelection();
  });
})();
