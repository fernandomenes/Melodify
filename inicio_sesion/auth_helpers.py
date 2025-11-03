"""
Helpers de autenticación/autorización compartidos entre vistas.
"""

from .models import Users


def _require_session_user(request):
    """Devuelve el nombre de usuario de la sesión; None/'' si no existe."""
    return request.session.get("user")


def _get_user_role(username: str) -> str:
    """Devuelve el rol de un usuario; cadena vacía si no está registrado."""
    try:
        u = Users.objects.get(user=username)
        return (u.type or "").strip()
    except Users.DoesNotExist:
        return ""


def _is_admin(role: str) -> bool:
    """Indica si el rol corresponde a 'administrador'."""
    return role.lower() == "administrador"


def _is_artist(role: str) -> bool:
    """Indica si el rol corresponde a 'artista'."""
    return role.lower() == "artista"
