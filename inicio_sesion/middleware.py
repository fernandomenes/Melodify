# inicio_sesion/middleware.py
from django.contrib.messages import get_messages


def _is_ajax(request) -> bool:
    """
    Detecta peticiones AJAX/fetch.
    """
    xrw = (request.headers.get("X-Requested-With") or "").lower()
    if xrw in ("xmlhttprequest", "fetch"):
        return True
    accept = (request.headers.get("Accept") or "").lower()
    return "application/json" in accept


class AjaxMessageSilencerMiddleware:
    """
    Si la respuesta proviene de una petición AJAX (fetch/XHR) en Muro o Gestión,
    consume los mensajes de Django para que NO “brinquen” a la siguiente página (login/home).
    """
    _PREFIXES = ("/mi-muro", "/gestion")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if _is_ajax(request) and request.path.startswith(self._PREFIXES):
            try:
                storage = get_messages(request)
                for _ in storage:
                    pass  # consumirlos
            except Exception:
                pass
        return response


class NoCacheMiddleware:
    """
    Evita caché cuando hay sesión iniciada.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if "user" in request.session:
            response["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response["Pragma"] = "no-cache"
            response["Expires"] = "0"
        return response
