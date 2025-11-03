# inicio_sesion/vistas/views_stream.py
"""
Streaming de archivos de /uploaded_media con soporte HTTP Range.

Decodifica la ruta URL-encoded antes de resolver el archivo físico.
"""

import mimetypes
import os
import re
from typing import Iterator
from urllib.parse import unquote

from django.conf import settings
from django.http import FileResponse, Http404, StreamingHttpResponse
from django.utils.http import http_date
from django.views.decorators.http import require_http_methods

BASE_UPLOAD_DIR = os.path.abspath(os.path.join(settings.BASE_DIR, "uploaded_media"))


def _safe_join_uploaded(relpath: str) -> str:
    """
    Resuelve una ruta absoluta segura dentro de BASE_UPLOAD_DIR.
    - Decodifica %xx (URL-encoding).
    - Elimina separadores iniciales.
    - Previene directory traversal.
    - 404 si no existe o no es archivo regular.
    """
    relpath = unquote(relpath).lstrip("/\\")
    candidate = os.path.abspath(os.path.join(BASE_UPLOAD_DIR, relpath))
    base = BASE_UPLOAD_DIR
    if os.path.commonpath([base, candidate]) != base:
        raise Http404("Ruta fuera de uploaded_media")
    if not (os.path.exists(candidate) and os.path.isfile(candidate)):
        raise Http404("Archivo no encontrado")
    return candidate


def _range_iter(
    path: str, start: int, length: int, chunk_size: int = 8192
) -> Iterator[bytes]:
    """Generador de bytes para respuestas parciales."""
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            data = f.read(min(chunk_size, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


@require_http_methods(["GET", "HEAD"])
def stream_uploaded_media(request, relpath: str):
    """
    Sirve /uploaded_media/<relpath> con soporte HTTP Range.
    - Con Range válido: 206 + Content-Range + Content-Length parcial.
    - Sin Range: 200 + Content-Length completo.
    - 416 cuando el rango es inválido.
    """
    file_path = _safe_join_uploaded(relpath)
    size = os.path.getsize(file_path)
    ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    mtime = http_date(os.path.getmtime(file_path))

    range_header = (request.headers.get("Range") or "").strip()
    if range_header:
        m = re.match(r"bytes=(\d+)-(\d*)$", range_header)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
            if start >= size or start > end:
                resp = StreamingHttpResponse(status=416, content_type=ctype)
                resp["Content-Range"] = f"bytes */{size}"
                resp["Accept-Ranges"] = "bytes"
                resp["Last-Modified"] = mtime
                return resp

            end = min(end, size - 1)
            length = end - start + 1

            if request.method == "HEAD":
                resp = StreamingHttpResponse(status=206, content_type=ctype)
            else:
                resp = StreamingHttpResponse(
                    _range_iter(file_path, start, length),
                    status=206,
                    content_type=ctype,
                )
            resp["Content-Range"] = f"bytes {start}-{end}/{size}"
            resp["Content-Length"] = str(length)
            resp["Accept-Ranges"] = "bytes"
            resp["Last-Modified"] = mtime
            return resp

    if request.method == "HEAD":
        resp = StreamingHttpResponse(status=200, content_type=ctype)
    else:
        resp = FileResponse(open(file_path, "rb"), content_type=ctype)
    resp["Content-Length"] = str(size)
    resp["Accept-Ranges"] = "bytes"
    resp["Last-Modified"] = mtime
    return resp
