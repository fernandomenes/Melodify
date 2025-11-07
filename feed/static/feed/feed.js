// feed/static/feed/feed.js
// ============================================================================
// Feed – UI dinámica (tarjetas de canción, subida asíncrona, eliminación con
// confirmación y barra de deshacer, y polling de novedades).
// ============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Utilidades de selección
  // ---------------------------------------------------------------------------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------------------------------------------------------------------
  // Identidad visual: sincroniza nombre de usuario si está disponible
  // ---------------------------------------------------------------------------
  try {
    const mc = $("#main-content");
    const USERNAME = mc?.dataset.username || "Usuario";
    const un = $("#username");
    if (un && un.textContent.trim() === "Usuario") un.textContent = USERNAME;
  } catch {}

  // ---------------------------------------------------------------------------
  // CSRF helpers
  // ---------------------------------------------------------------------------
  /**
   * Obtiene el valor de una cookie.
   * @param {string} name
   * @returns {string}
   */
  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  /**
   * Recupera el token CSRF desde meta o cookie.
   * @returns {string}
   */
  function getCSRF() {
    return document.querySelector("meta[name=csrf-token]")?.getAttribute("content") || getCookie("csrftoken");
  }

  // ---------------------------------------------------------------------------
  // Audio exclusivo (garantiza una sola reproducción simultánea)
  // ---------------------------------------------------------------------------
  document.addEventListener(
    "play",
    (ev) => {
      const t = ev.target;
      if (!t || t.tagName !== "AUDIO") return;
      $$("audio").forEach((a) => {
        if (a !== t) a.pause();
      });
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Campo de género: manejo de opción «Otro»
  // ---------------------------------------------------------------------------
  (function () {
    const sel = $("#genre");
    const other = $("#genre-other");
    if (!sel || !other) return;
    const toggle = () => {
      const u = sel.value === "_other";
      other.style.display = u ? "block" : "none";
      if (!u) other.value = "";
    };
    sel.addEventListener("change", toggle);
    toggle();
  })();

  // ---------------------------------------------------------------------------
  // Construcción de tarjeta
  // ---------------------------------------------------------------------------
  /**
   * Formatea fecha/hora a «YYYY-MM-DD HH:mm».
   * @param {string|number|Date} dt
   * @returns {string}
   */
  function fmt(dt) {
    try {
      const d = new Date(dt);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch {
      return "";
    }
  }

  /**
   * Construye el bloque de acciones del propietario (editar/eliminar).
   * @param {Object} song
   * @returns {HTMLElement}
   */
  function buildOwnerActions(song) {
    const wrapper = document.createElement("div");
    wrapper.style.marginTop = "8px";

    if (song.editar_url) {
      const a = document.createElement("a");
      a.className = "btn";
      a.href = song.editar_url;
      a.textContent = "Editar";
      wrapper.appendChild(a);
    }

    if (song.eliminar_url) {
      const f = document.createElement("form");
      f.method = "post";
      f.action = song.eliminar_url;
      f.className = "js-delete-form";
      f.style.display = "inline";
      f.dataset.title = song.title || "esta canción";
      f.dataset.songId = song.id;

      const csrf = document.createElement("input");
      csrf.type = "hidden";
      csrf.name = "csrfmiddlewaretoken";
      csrf.value = getCSRF();
      f.appendChild(csrf);

      const btn = document.createElement("button");
      btn.className = "btn btnDanger";
      btn.type = "submit";
      btn.textContent = "Eliminar";
      f.appendChild(btn);

      wrapper.appendChild(f);
    }
    return wrapper;
  }

  /**
   * Crea una tarjeta de canción a partir de datos estándar.
   * @param {Object} song
   * @returns {HTMLElement}
   */
  function createSongCard(song) {
    const tpl = $("#song-card-template");
    let card;

    if (tpl) {
      card = tpl.content.firstElementChild.cloneNode(true);
      card.dataset.songId = song.id;
      card.dataset.createdAt = song.created_at || "";

      const coverImg = card.querySelector("[data-slot=cover]");
      const coverFallback = card.querySelector("[data-slot=cover-fallback]");
      if (song.cover_url) {
        if (coverFallback) coverFallback.remove();
        if (coverImg) {
          coverImg.src = song.cover_url;
          coverImg.alt = `Portada de ${song.title || ""}`;
          coverImg.style.display = "";
        }
      } else {
        if (coverImg) coverImg.remove();
      }

      const title  = card.querySelector("[data-slot=title]");
      const artist = card.querySelector("[data-slot=artist]");
      const genre  = card.querySelector("[data-slot=genre]");
      const ca     = card.querySelector("[data-slot=created_at]");
      if (title)  title.textContent  = song.title || "—";
      if (artist) artist.textContent = song.artist_display_name || "—";
      if (genre)  genre.textContent  = song.genre || "—";
      if (ca)     ca.textContent     = fmt(song.created_at);

      const source = card.querySelector("[data-slot=audio-src]");
      if (source && song.audio_url) {
        source.src = song.audio_url;
      }

      const owner = card.querySelector("[data-slot=owner-actions]");
      if (owner) owner.replaceWith(buildOwnerActions(song));
    } else {
      // Fallback sin template
      card = document.createElement("article");
      card.className = "song js-song-card";
      card.dataset.songId = song.id;
      card.dataset.createdAt = song.created_at || "";
      card.innerHTML = `
        <div class="row">
          ${song.cover_url
            ? `<img class="preview" src="${song.cover_url}" alt="Portada de ${song.title || ""}" loading="lazy">`
            : `<div class="preview" aria-hidden="true"></div>`}
          <div>
            <div style="font-weight:600">${song.title || "—"}</div>
            <div class="muted">${song.artist_display_name || "—"}</div>
            <div class="muted">Género: ${song.genre || "—"}</div>
            <div class="muted">Subida: ${fmt(song.created_at)}</div>
          </div>
        </div>
        <div style="margin-top:8px">
          ${song.audio_url ? `<audio controls preload="none" style="width:100%"><source src="${song.audio_url}"></audio>` : ``}
        </div>
      `;
      card.appendChild(buildOwnerActions(song));
    }
    return card;
  }

  /**
   * Inserta una tarjeta al inicio de un contenedor.
   * @param {HTMLElement} container
   * @param {Object} song
   */
  function prependSong(container, song) {
    const card = createSongCard(song);
    container.prepend(card);
  }

  // ---------------------------------------------------------------------------
  // Intercepción de subida (formularios con data-ajax="1")
  // ---------------------------------------------------------------------------
  (function () {
    document.addEventListener(
      "submit",
      async (e) => {
        const form = e.target;
        if (!form.matches("form[data-ajax='1']")) return;

        e.preventDefault();
        e.stopPropagation();

        const btn = form.querySelector("button[type=submit]");
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Subiendo…";
        }

        const inlineMsg = $("#inline-msg");
        if (inlineMsg) inlineMsg.style.display = "none";

        const fd = new FormData(form);

        // Género «Otro»: sustituye el valor por el contenido libre
        const sel = $("#genre");
        const other = $("#genre-other");
        if (sel && sel.value === "_other") {
          const val = (other?.value || "").trim();
          if (!val) {
            if (inlineMsg) {
              inlineMsg.textContent = "Escribe un género.";
              inlineMsg.className = "msg error";
              inlineMsg.style.display = "block";
            }
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Subir";
            }
            return;
          }
          fd.set("genre", val);
        }

        try {
          const res = await fetch(form.action, {
            method: "POST",
            body: fd,
            headers: { "X-Requested-With": "fetch" },
          });

          const ct = res.headers.get("Content-Type") || "";
          if (!ct.includes("application/json")) {
            throw new Error("Respuesta no JSON");
          }

          const data = await res.json();
          if (!data.ok) {
            if (inlineMsg) {
              inlineMsg.textContent = data.error || "No se pudo subir la canción.";
              inlineMsg.className = "msg error";
              inlineMsg.style.display = "block";
            }
            if (data.suggested_title) {
              const t = form.querySelector("input[name=title]");
              if (t) {
                t.value = data.suggested_title;
                t.focus();
              }
            }
            return;
          }

          // Inserta en el grid
          const grid = $("#songs-grid");
          if (grid) {
            prependSong(grid, data.song);
            const latest = data.song?.created_at || "";
            if (latest) grid.dataset.latest = latest;
          }

          // Deshacer (barra)
          if (data.undo?.label) {
            const bar = $("#undo-bar");
            const lbl = $("#undo-label");
            if (bar && lbl) {
              lbl.textContent = data.undo.label;
              bar.style.display = "flex";
            }
          }

          form.reset();
          if (other) other.style.display = "none";
        } catch {
          if (inlineMsg) {
            inlineMsg.textContent = "Error de red al subir la canción.";
            inlineMsg.className = "msg error";
            inlineMsg.style.display = "block";
          }
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Subir";
          }
        }
      },
      true
    );
  })();

  // ---------------------------------------------------------------------------
  // Eliminación con confirmación (modal si está disponible)
  // ---------------------------------------------------------------------------
  (function () {
    const modal = $("#confirm-modal");
    const txt = $("#confirm-text");
    const btnCancel = $("#confirm-cancel");
    const btnAccept = $("#confirm-accept");
    let pendingForm = null;

    function openModal(message) {
      if (!modal) return false;
      if (txt) txt.textContent = message || "¿Eliminar este elemento?";
      modal.classList.add("show");
      modal.setAttribute("aria-hidden", "false");
      return true;
    }

    function closeModal() {
      if (!modal) return;
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
      pendingForm = null;
    }

    btnCancel?.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
    });
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    btnAccept?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!pendingForm) return;
      await doDelete(pendingForm);
      closeModal();
    });

    /**
     * Ejecuta la eliminación de una tarjeta y actualiza vistas/undo.
     * @param {HTMLFormElement} form
     */
    async function doDelete(form) {
      try {
        const fd = new FormData(form);
        const res = await fetch(form.action, {
          method: "POST",
          body: fd,
          headers: { "X-Requested-With": "fetch", "X-CSRFToken": getCSRF() },
          credentials: "same-origin",
        });

        const ct = (res.headers.get("content-type") || "").toLowerCase();

        if (ct.includes("application/json")) {
          const j = await res.json();

          // Deshacer
          if (j.undo_label) {
            const bar = document.getElementById("undo-bar");
            const lbl = document.getElementById("undo-label");
            if (bar && lbl) {
              lbl.textContent = j.undo_label;
              bar.style.display = "flex";
            }
          }

          // Reemplazo de pestaña Usuarios si aplica
          if (j.usuarios_html) {
            const wrap = document.createElement("div");
            wrap.innerHTML = j.usuarios_html.trim();
            const fresh = wrap.querySelector("#tab-usuarios");
            const old = document.getElementById("tab-usuarios");
            if (fresh && old) old.replaceWith(fresh);
          } else {
            // Eliminación local de fila/tarjeta
            const rowOrCard = form.closest(".js-song-card, tr, .song");
            if (rowOrCard) rowOrCard.remove();
          }
          return;
        }

        // Respuesta no JSON → recarga
        location.reload();
      } catch {
        location.reload();
      }
    }

    document.addEventListener(
      "submit",
      (e) => {
        const f = e.target;
        if (!f.classList || !f.classList.contains("js-delete-form")) return;
        e.preventDefault();
        e.stopPropagation();
        const t = f.dataset.title || "este elemento";
        pendingForm = f;
        if (!openModal(`¿Eliminar “${t}”?`)) {
          if (confirm(`¿Eliminar “${t}”?`)) {
            doDelete(f);
          }
        }
      },
      true
    );
  })();

  // ---------------------------------------------------------------------------
  // Polling de cambios (muro y catálogo)
  // ---------------------------------------------------------------------------
  (function () {
    const mc = $("#main-content");
    if (!mc) return;
    if (mc.dataset.live !== "1") return;

    const scope = mc.dataset.feedScope || "muro"; // "muro" | "catalogo-admin"
    const artist = mc.dataset.artist || "";
    const role = (mc.dataset.role || "").toLowerCase();
    const view = role === "administrador" || role === "admin" ? "admin" : "owner";

    const grid = scope === "catalogo-admin" ? $("#catalogo-grid") : $("#songs-grid");
    if (!grid) return;
    let latest = grid.dataset.latest || "";

    async function poll() {
      try {
        const url = new URL(location.origin + "/feed/songs/changes/");
        url.searchParams.set("scope", scope === "catalogo-admin" ? "catalogo" : "muro");
        url.searchParams.set("view", view);
        if (latest) url.searchParams.set("since", latest);
        if (scope !== "catalogo-admin" && artist) url.searchParams.set("artist", artist);

        const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
        const data = await res.json();
        if (!data.ok) return;

        const items = data.items || [];
        if (items.length > 0) {
          // Inserta en orden cronológico (antiguo→nuevo) usando prepend
          for (let i = items.length - 1; i >= 0; i--) {
            prependSong(grid, items[i]);
          }
          if (data.latest_created_at) {
            latest = data.latest_created_at;
            grid.dataset.latest = latest;
          }
        }
      } catch {}
    }

    // Frecuencia de consulta: 10s
    setInterval(poll, 10000);
  })();
})();
