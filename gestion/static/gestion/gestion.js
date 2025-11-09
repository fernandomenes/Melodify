// static/gestion/gestion.js
// ============================================================================
// Gestión – Tabs, selección múltiple, borrado con modal, undo y reemplazos.
// Header (avatar/nombre), menú usuario (perfil/logout) y toggle lateral.
// ============================================================================

(function () {
  "use strict";

  window.__gestion_loaded__ = true;

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const $all = $$;

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function getCSRF() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || getCookie("csrftoken");
  }
  function escapeHtml(s){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  // ---------------------------------------------------------------------------
  // Header (avatar/nombre) + menú (perfil/logout)
  // ---------------------------------------------------------------------------
  function applyHeaderIdentity() {
    const mc   = $("#main-content");
    const name = $("#username");
    const icon = $("#user-trigger .user-icon");

    const USERNAME = (mc?.dataset.username || "Usuario").trim();
    const AVATAR   = (mc?.dataset.avatar || "").trim();

    if (name) name.textContent = USERNAME || "Usuario";

    if (icon) {
      if (AVATAR) {
        icon.innerHTML = `<img src="${escapeHtml(AVATAR)}" alt="${escapeHtml(USERNAME)}"
                           style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`;
      } else {
        icon.textContent = (USERNAME || "U").charAt(0).toUpperCase();
      }
    }
  }

  function initHeaderMenu() {
    const trigger = $("#user-trigger");
    const menu    = $("#user-menu");
    const perfil  = $("#menu-perfil");
    const logout  = $("#menu-logout");
    const homeURL = (window.MELODIFY_HOME_URL || "/home/");

    if (trigger && menu){
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.classList.toggle("show");
      });
      document.addEventListener("click", () => menu.classList.remove("show"));
      menu.addEventListener("click", (e) => e.stopPropagation());
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") menu.classList.remove("show");
      });
    }

    if (perfil) {
      perfil.addEventListener("click", (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        location.href = homeURL + "?view=perfil&no_spa=1";
      });
    }

    if (logout) {
      const logoutUrl = logout.getAttribute("href") || logout.dataset.logoutUrl || "/logout/";
      logout.addEventListener("click", async (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        try {
          const res = await fetch(logoutUrl, {
            method: "POST",
            headers: { "X-CSRFToken": getCSRF() },
            credentials: "same-origin",
          });
          if (res.redirected) { location.href = res.url; return; }
          if (res.ok) { location.href = homeURL; return; }
        } catch {}
        location.href = logoutUrl; 
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle del menú lateral
  // ---------------------------------------------------------------------------
  function initSideToggle(){
    const btn    = $("#menu-toggle-btn");
    const menu   = $("#menuLateral");
    const header = $("#header");
    btn?.addEventListener("click", () => {
      menu?.classList.toggle("collapsed");
      $("#main-content")?.classList.toggle("menuLateral-collapsed");
      header?.classList.toggle("menuLateral-collapsed");
    });
  }

  // ---------------------------------------------------------------------------
  // Mensajería inline + undo bar
  // ---------------------------------------------------------------------------
  function showInlineError(msg) {
    const box = $("#inline-msg");
    if (!box) return;
    box.textContent = msg || "No se pudo completar la acción.";
    box.className = "msg error";
    box.style.display = "block";
  }
  function clearInlineMsg() {
    const box = $("#inline-msg");
    if (box) box.style.display = "none";
  }

  function showUndo(label) {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = label || "Acción realizada.";
    if (bar) bar.style.display = "flex";
  }
  function hideUndo() {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = "";
    if (bar) bar.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  // Reemplazos parciales (Usuarios / Catálogo)
  // ---------------------------------------------------------------------------
  function replaceUsuariosTab(html) {
    if (!html) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    const fresh = wrap.querySelector("#tab-usuarios");
    const old   = $("#tab-usuarios");
    if (fresh && old) old.replaceWith(fresh);
    const tabBtn = $('.tab-btn[data-tab="usuarios"]');
    if (tabBtn) tabBtn.setAttribute("aria-selected", "true");
  }

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
  // Tabs
  // ---------------------------------------------------------------------------
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
  // Modal confirm (con delegación)
  // ---------------------------------------------------------------------------
  const modal = $("#confirm-modal");
  const txt   = $("#confirm-text");

  let pendingForm    = null;   // HTMLFormElement
  let pendingBulkIds = null;   // number[]

  function openModal(message) {
    if (!modal) return false;
    if (txt) txt.textContent = message || "¿Eliminar este elemento?";
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    // Foco al botón aceptar si existe
    setTimeout(() => $("#confirm-accept")?.focus(), 0);
    return true;
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  // Clic fuera del diálogo cierra modal
  modal?.addEventListener("click",  (e) => { if (e.target === modal) closeModal(); });

  // Delegación global para aceptar/cancelar 
  document.addEventListener("click", async (e) => {
    const accept = e.target.closest?.("#confirm-accept");
    if (accept) {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (pendingForm) {
          await doDelete(pendingForm);
          pendingForm = null;
        } else if (pendingBulkIds && pendingBulkIds.length) {
          await doBulkDelete(pendingBulkIds);
          pendingBulkIds = null;
        }
      } finally {
        closeModal();
      }
      return;
    }

    const cancel = e.target.closest?.("#confirm-cancel");
    if (cancel) {
      e.preventDefault();
      e.stopPropagation();
      pendingForm = null;
      pendingBulkIds = null;
      closeModal();
    }
  });

  // ---------------------------------------------------------------------------
  // Bulk delete
  // ---------------------------------------------------------------------------
  async function doBulkDelete(ids) {
    try {
      const fd = new FormData();
      ids.forEach(id => fd.append("ids[]", String(id)));
      const res = await fetch("/gestion/canciones/eliminar-multiples/", {
        method: "POST",
        body: fd,
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) { location.reload(); return; }

      const j = await res.json();
      if (!j.ok) { showInlineError(j.error || "No fue posible eliminar las canciones."); return; }

      if (j.undo_label) showUndo(j.undo_label);
      if (j.catalogo_html) replaceCatalogo(j.catalogo_html);
      else (j.removed_ids || []).forEach(id => {
        const card = document.querySelector(`.js-song-card[data-song-id="${id}"]`);
        if (card) card.remove();
      });
    } catch {
      location.reload();
    } finally {
      resetSelection();
    }
  }

  // ---------------------------------------------------------------------------
  // Delete individual
  // ---------------------------------------------------------------------------
  async function doDelete(form) {
    try {
      const fd  = new FormData(form);
      const res = await fetch(form.action, {
        method: "POST",
        body: fd,
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        redirect: "follow",
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json();
        if (j.ok === false) { showInlineError(j.error || "No se pudo completar la acción."); return; }

        if (j.undo_label)     showUndo(j.undo_label);
        if (j.usuarios_html)  replaceUsuariosTab(j.usuarios_html);
        if (j.catalogo_html)  replaceCatalogo(j.catalogo_html);
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
  // Selección múltiple (Catálogo)
  // ---------------------------------------------------------------------------
  const selected = new Set();

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
  function resetSelection() {
    selected.clear();
    updateBulkUI();
  }

  document.addEventListener("change", (e) => {
    const t = e.target;

    if (t && t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id);
        else selected.delete(id);
        updateBulkUI();
      }
    }

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

  // Abrir modal para eliminación múltiple
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("#bulk-delete");
    if (!btn) return;

    e.preventDefault();
    if (selected.size === 0) return;

    const n   = selected.size;
    const ids = Array.from(selected);
    const noun = n === 1 ? "canción seleccionada" : "canciones seleccionadas";

    if (openModal(`¿Eliminar ${n} ${noun}?`)) {
      pendingBulkIds = ids;
      return;
    }

    if (!window.confirm(`¿Eliminar ${n} ${noun}?`)) return;
    await doBulkDelete(ids);
  });

  // ---------------------------------------------------------------------------
  // Intercepción de formularios con undo 
  // ---------------------------------------------------------------------------
  document.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;

    const href = form.action || "";

    // 1) Borrados con modal
    if (form.classList.contains("js-delete-form")) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      const t = form.dataset.title || "este elemento";
      pendingForm = form;
      if (!openModal(`¿Eliminar “${t}”?`)) {
        if (confirm(`¿Eliminar “${t}”?`)) await doDelete(form);
      }
      return;
    }

    // 2) Deshacer
    const isUndo = href.includes("/revertir_accion") || href.endsWith("/gestion/undo/");
    if (isUndo) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      try {
        const fd = new FormData(form);
        const res = await fetch(href, {
          method: "POST",
          body: fd,
          headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
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

    // 3) Toggle / Registrar / Eliminar
    const isEliminar = href.includes("/gestion/usuarios/eliminar/") || href.includes("/gestion/canciones/eliminar/");
    const isToggle   = href.includes("/gestion/usuarios/desactivar/") || href.includes("/gestion/usuarios/activar/");
    const isRegister = /\/gestion\/registrar[-_](?:artista|admin)\/?$/i.test(href);
    const isUndoable = isEliminar || isToggle || isRegister;
    if (!isUndoable) return;

    e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    clearInlineMsg();

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
        headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
        redirect: "follow",
        credentials: "same-origin",
      });

      if (res.status === 204) { hideUndo(); return; }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await res.json();

        if (j.ok === false) { showInlineError(j.error || "No se pudo completar la acción."); return; }

        if (j.undo_label)    showUndo(j.undo_label);
        if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
        if (j.catalogo_html) replaceCatalogo(j.catalogo_html);

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
  // Init
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    applyHeaderIdentity();
    initHeaderMenu();
    initSideToggle();
    initTabs();
    resetSelection();
  });
})();
