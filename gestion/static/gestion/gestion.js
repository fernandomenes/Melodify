// static/gestion/gestion.js
// ============================================================================
// Melodify – Panel de Gestión (administrador)
// - Header: identidad del usuario + menú perfil/logout
// - Sidebar: toggle de menú lateral
// - Tabs: Usuarios / Catálogo (accesibles con teclado)
// - Catálogo: selección múltiple, borrado con modal y deshacer
// - Formularios: registrar artista/admin con barra de progreso
// ============================================================================

(function () {
  "use strict";

  // Marca global para que el fallback inline sepa que este script sí cargó
  window.__gestion_loaded__ = true;

  // ---------------------------------------------------------------------------
  // Utils básicos
  // ---------------------------------------------------------------------------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const $all = $$;

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  function getCSRF() {
    return (
      document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
      getCookie("csrftoken")
    );
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // Header: avatar / nombre y menú perfil / logout
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
        icon.innerHTML = `<img src="${escapeHtml(AVATAR)}" alt="${escapeHtml(
          USERNAME
        )}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`;
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
    const homeURL = window.MELODIFY_HOME_URL || "/home/";

    // Toggle del menú de usuario
    if (trigger && menu) {
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

    // Ir al perfil (versión servidor, fuera de la SPA del home)
    if (perfil) {
      perfil.addEventListener("click", (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        location.href = `${homeURL}?view=perfil&no_spa=1`;
      });
    }

    // Logout por POST con CSRF y fallback a GET si algo falla
    if (logout) {
      const logoutUrl =
        logout.getAttribute("href") || logout.dataset.logoutUrl || "/logout/";
      logout.addEventListener("click", async (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        try {
          const res = await fetch(logoutUrl, {
            method: "POST",
            headers: { "X-CSRFToken": getCSRF() },
            credentials: "same-origin",
          });
          if (res.redirected) {
            location.href = res.url;
            return;
          }
          if (res.ok) {
            location.href = homeURL;
            return;
          }
        } catch {
          // Ignora y usa fallback
        }
        location.href = logoutUrl;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle del menú lateral
  // ---------------------------------------------------------------------------
  function initSideToggle() {
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
  // Mensajes inline + barra de deshacer
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
  // Reemplazos parciales (pestaña Usuarios / Catálogo)
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
  // Tabs (Usuarios / Catálogo)
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

    // Navegación por teclado entre pestañas
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
  // Modal de confirmación (borrado individual / múltiple)
  // ---------------------------------------------------------------------------
  const modal = $("#confirm-modal");
  const txt   = $("#confirm-text");

  let pendingForm    = null;   // HTMLFormElement en espera de confirmación
  let pendingBulkIds = null;   // IDs seleccionadas para borrado múltiple

  function openModal(message) {
    if (!modal) return false;
    if (txt) txt.textContent = message || "¿Eliminar este elemento?";
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => $("#confirm-accept")?.focus(), 0);
    return true;
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  // Clic fuera del diálogo → cerrar
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Botones de aceptar/cancelar del modal (delegación global)
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
  // Borrado múltiple de canciones (Catálogo)
  // ---------------------------------------------------------------------------
  async function doBulkDelete(ids) {
    try {
      const fd = new FormData();
      ids.forEach((id) => fd.append("ids[]", String(id)));

      const res = await fetch("/gestion/canciones/eliminar-multiples/", {
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
        showInlineError(j.error || "No fue posible eliminar las canciones.");
        return;
      }

      if (j.undo_label) showUndo(j.undo_label);
      if (j.catalogo_html) {
        replaceCatalogo(j.catalogo_html);
      } else {
        (j.removed_ids || []).forEach((id) => {
          const card = document.querySelector(`.js-song-card[data-song-id="${id}"]`);
          if (card) card.remove();
        });
      }
    } catch {
      location.reload();
    } finally {
      resetSelection();
    }
  }

  // ---------------------------------------------------------------------------
  // Borrado individual (usuarios / canciones)
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
        if (j.ok === false) {
          showInlineError(j.error || "No se pudo completar la acción.");
          return;
        }

        if (j.undo_label)    showUndo(j.undo_label);
        if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
        if (j.catalogo_html) replaceCatalogo(j.catalogo_html);

        // Fallback: si no hay HTML devuelto, elimina la fila/tarjeta asociada
        if (!j.usuarios_html && !j.catalogo_html) {
          const rowOrCard = form.closest(".js-song-card, tr, .song");
          if (rowOrCard) rowOrCard.remove();
        }
        return;
      }

      // Si no hay JSON, recarga como último recurso
      location.reload();
    } catch {
      location.reload();
    }
  }

  // ---------------------------------------------------------------------------
  // Selección múltiple en el catálogo
  // ---------------------------------------------------------------------------
  const selected = new Set();

  function updateBulkUI() {
    const btn   = $("#bulk-delete");
    const count = selected.size;

    if (btn) btn.disabled = count === 0;

    const sc = $("#sel-count");
    if (sc) sc.textContent = count
      ? `${count} seleccionada${count !== 1 ? "s" : ""}`
      : "";

    const all = $("#sel-all");
    if (all) {
      const checks = $all("#catalogo-grid .song-select");
      all.checked = checks.length > 0 && checks.every((ch) => ch.checked);
      all.indeterminate = count > 0 && count < checks.length;
    }
  }

  function resetSelection() {
    selected.clear();
    updateBulkUI();
  }

  // Checkboxes individuales + "seleccionar todo"
  document.addEventListener("change", (e) => {
    const t = e.target;

    // Checkbox de una canción
    if (t && t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id);
        else selected.delete(id);
        updateBulkUI();
      }
    }

    // Checkbox "seleccionar todo"
    if (t && t.id === "sel-all") {
      const checks = $all("#catalogo-grid .song-select");
      checks.forEach((ch) => {
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

  // Botón "Eliminar seleccionadas" (abre modal)
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

    // Si no hay modal (fallback), usar confirm nativo
    if (!window.confirm(`¿Eliminar ${n} ${noun}?`)) return;
    await doBulkDelete(ids);
  });

  // ---------------------------------------------------------------------------
  // Intercepción de formularios con soporte de deshacer
  // ---------------------------------------------------------------------------
  document.addEventListener(
    "submit",
    async (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      const href = form.action || "";

      // 1) Formularios de borrado con modal (usuarios/canciones)
      if (form.classList.contains("js-delete-form")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        const t = form.dataset.title || "este elemento";
        pendingForm = form;

        if (!openModal(`¿Eliminar “${t}”?`)) {
          if (window.confirm(`¿Eliminar “${t}”?`)) {
            await doDelete(form);
          }
        }
        return;
      }

      // 2) Botón "Deshacer" (revertir_accion)
      const isUndo =
        href.includes("/revertir_accion") || href.endsWith("/gestion/undo/");
      if (isUndo) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        try {
          const fd  = new FormData(form);
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
            if (j.catalogo_html) replaceCatalogo(j.catalogo_html);
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

      // 3) Acciones administrables: eliminar, activar/desactivar, registrar
      const isEliminar =
        href.includes("/gestion/usuarios/eliminar/") ||
        href.includes("/gestion/canciones/eliminar/");
      const isToggle =
        href.includes("/gestion/usuarios/desactivar/") ||
        href.includes("/gestion/usuarios/activar/");
      const isRegister = /\/gestion\/registrar[-_](?:artista|admin)\/?$/i.test(href);
      const isUndoable = isEliminar || isToggle || isRegister;

      if (!isUndoable) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      clearInlineMsg();

      // Registro de artista/admin con barra de progreso
      if (isRegister) {
        await registerWithProgress(form);
        return;
      }

      // Eliminar / activar / desactivar con fetch estándar
      try {
        const fd  = new FormData(form);
        const res = await fetch(href, {
          method: "POST",
          body: fd,
          headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
          redirect: "follow",
          credentials: "same-origin",
        });

        if (res.status === 204) {
          hideUndo();
          return;
        }

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

          if (isEliminar && !j.usuarios_html && !j.catalogo_html) {
            const rowOrCard = form.closest(".js-song-card, tr, .song");
            if (rowOrCard) rowOrCard.remove();
          }
          return;
        }

        showInlineError("No se pudo completar la acción (valida los campos).");
      } catch {
        showInlineError("Error de red.");
      }
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Registro de artista/admin con barra de progreso
  // ---------------------------------------------------------------------------
  async function registerWithProgress(form) {
    const bar     = document.getElementById("upload-bar");
    const fill    = bar?.querySelector(".progress > i");
    const pctEl   = document.getElementById("upload-pct");
    const submitB = form.querySelector('button[type="submit"]');

    const setPct = (p) => {
      const pct = Math.max(0, Math.min(100, p | 0));
      bar?.classList.add("is-visible");
      if (fill)  fill.style.width = pct + "%";
      if (pctEl) pctEl.textContent = pct + "%";
    };

    const hideBar = () => {
      if (bar) bar.classList.remove("is-visible");
      if (fill) fill.style.width = "0%";
      if (pctEl) pctEl.textContent = "0%";
    };

    // Validaciones rápidas antes de enviar
    const u = form.querySelector('input[name="user"]')?.value?.trim() || "";
    const p = form.querySelector('input[name="password"]')?.value || "";
    if (!u || !p) {
      showInlineError("Completa usuario y contraseña.");
      return;
    }
    if (p.length < 6) {
      showInlineError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    const desc = form.querySelector('textarea[name="description"]')?.value || "";
    if (desc && desc.length > 200) {
      showInlineError("La descripción no puede superar 200 caracteres.");
      return;
    }

    clearInlineMsg();

    const fd   = new FormData(form);
    const xhr  = new XMLHttpRequest();
    const csrf = getCSRF();

    xhr.open("POST", form.action, true);
    if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
    // Para que el backend trate esta petición como "fetch" y devuelva JSON
    xhr.setRequestHeader("X-Requested-With", "fetch");

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setPct((ev.loaded / ev.total) * 100);
      else setPct(15);
    };
    xhr.onloadstart = () => {
      submitB?.setAttribute("aria-busy", "true");
      setPct(0);
    };
    xhr.onerror = xhr.onabort = () => {
      hideBar();
      submitB?.removeAttribute("aria-busy");
      showInlineError("No se pudo registrar. Revisa tu conexión e inténtalo de nuevo.");
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setPct(100);
        const ct = (xhr.getResponseHeader("content-type") || "").toLowerCase();

        try {
          if (ct.includes("application/json")) {
            const j = JSON.parse(xhr.responseText || "{}");
            if (j.ok === false) {
              showInlineError(j.error || "No se pudo completar la acción.");
            } else {
              if (j.undo_label)    showUndo(j.undo_label);
              if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
              form.reset();
            }
          } else {
            // Si el servidor no devolvió JSON, recarga como fallback
            location.reload();
            return;
          }
        } catch {
          location.reload();
          return;
        }

        setTimeout(() => {
          hideBar();
          submitB?.removeAttribute("aria-busy");
        }, 350);
        return;
      }

      hideBar();
      submitB?.removeAttribute("aria-busy");
      showInlineError(
        "Error al registrar: " + xhr.status + " " + xhr.statusText
      );
    };

    xhr.send(fd);
  }

  // ---------------------------------------------------------------------------
  // Init global
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    applyHeaderIdentity();
    initHeaderMenu();
    initSideToggle();
    initTabs();
    resetSelection();
  });
})();
