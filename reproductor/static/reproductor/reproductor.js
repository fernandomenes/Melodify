// static/reproductor/reproductor.js
// Punto de entrada del reproductor central.
// La lógica principal vive en reproductor-core.js.

import {
  inicializarReproductor,
  stopReproductor,
  rebindReproductor,
  stopReproductorIfLoaded,
  renderMenuReproductor,
  wireReproductorPlaylistEvents,
  DEFAULT_GENRES,
  buildRightSidebarHTML,
  attachSidebarHandlers,
} from "./reproductor-core.js";

// Reexporta la API pública esperada por el resto de la aplicación
export {
  inicializarReproductor,
  stopReproductor,
  rebindReproductor,
  stopReproductorIfLoaded,
  renderMenuReproductor,
  wireReproductorPlaylistEvents,
  DEFAULT_GENRES,
  buildRightSidebarHTML,
  attachSidebarHandlers,
};

// Inicialización automática del reproductor
function autoInitReproductor() {
  try {
    inicializarReproductor();
  } catch (e) {
    console.warn("Error al inicializar reproductor:", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoInitReproductor);
} else {
  autoInitReproductor();
}
