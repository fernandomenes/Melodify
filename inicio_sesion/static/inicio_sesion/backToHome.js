/**
 * Navegación universal "Back to Home".
 *
 * Define un manejador global de clics que detecta:
 *  - Un elemento con id "#back-btn", o
 *  - Cualquier elemento con el atributo [data-back-to="home"]
 * y redirige a la URL de inicio.
 *
 * La URL objetivo se toma de `window.MELODIFY_HOME_URL` si existe,
 * de lo contrario se usa "/" como valor por defecto.
 *
 * Notas de implementación:
 * - Se usa el modo *capturing* para adelantarse a otros listeners.
 * - Se evita la propagación del evento para no interferir con otros manejadores.
 */
(function () {
  /** @type {string} URL de Home resuelta en cliente. */
  var HOME = (window.MELODIFY_HOME_URL && String(window.MELODIFY_HOME_URL)) || "/";

  document.addEventListener(
    "click",
    function (ev) {
      var el = ev.target.closest("#back-btn,[data-back-to='home']");
      if (!el) return;

      ev.preventDefault();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      if (ev.stopPropagation) ev.stopPropagation();

      window.location.assign(HOME);
    },
    true // capturing
  );
})();
