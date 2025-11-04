# reproductor/views_stream.py
"""
Streaming seguro de archivos dentro de /uploaded_media con soporte HTTP Range.

- GET/HEAD con rangos parciales (206) y completos (200).
- Previene directory traversal y valida existencia de archivo.
- ETag + Last-Modified + Cache-Control.
"""

import mimetypes
import os
import re
from typing import Iterator
from urllib.parse import unquote

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponseNotModified, StreamingHttpResponse
from django.utils.http import http_date, parse_http_date_safe
from django.views.decorators.http import require_http_methods

# Por compatibilidad con tu estructura actual:
BASE_UPLOAD_DIR = os.path.abspath(os.path.join(settings.BASE_DIR, "uploaded_media"))


def _safe_join_uploaded(relpath: str) -> str:
    """
    Resuelve una ruta segura (absoluta) **dentro** de BASE_UPLOAD_DIR.
    - Decodifica %xx.
    - Elimina separadores iniciales.
    - Garantiza que no se salga del directorio base.
    - Exige archivo regular existente.
    """
    relpath = unquote(relpath).lstrip("/\\")
    candidate = os.path.abspath(os.path.join(BASE_UPLOAD_DIR, relpath))
    if os.path.commonpath([BASE_UPLOAD_DIR, candidate]) != BASE_UPLOAD_DIR:
        raise Http404("Ruta fuera de uploaded_media")
    if not (os.path.exists(candidate) and os.path.isfile(candidate)):
        raise Http404("Archivo no encontrado")
    return candidate


def _range_iter(path: str, start: int, length: int, chunk_size: int = 8192) -> Iterator[bytes]:
    """Generador por chunks para respuestas parciales."""
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            data = f.read(min(chunk_size, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def _add_common_headers(resp, ctype: str, size: int, mtime: float):
    """Cabeceras comunes para parciales y completas."""
    resp["Accept-Ranges"] = "bytes"
    resp["Last-Modified"] = http_date(mtime)
    # ETag simple: mtime(int)-size
    resp["ETag"] = f'W/"{int(mtime)}-{size}"'
    # Reproductor: cachea 1 día (ajusta a tu política)
    resp["Cache-Control"] = "public, max-age=86400"
    resp["Content-Type"] = ctype
    return resp


def _maybe_not_modified(request, etag: str, mtime: float):
    """304 si If-None-Match/If-Modified-Since indican que no cambió."""
    inm = (request.headers.get("If-None-Match") or "").strip()
    ims = (request.headers.get("If-Modified-Since") or "").strip()
    etag_matches = inm and etag in [t.strip() for t in inm.split(",")]
    if etag_matches:
        return HttpResponseNotModified()
    if ims:
        ims_ts = parse_http_date_safe(ims)
        if ims_ts and int(mtime) <= int(ims_ts):
            return HttpResponseNotModified()
    return None


@require_http_methods(["GET", "HEAD"])
def stream_uploaded_media(request, relpath: str):
    """
    Sirve /u/<relpath> con soporte HTTP Range.
    - Con Range válido: 206 Partial Content + Content-Range + longitud parcial.
    - Sin Range: 200 OK + longitud completa.
    - 416 si el rango es inválido.
    """
    file_path = _safe_join_uploaded(relpath)
    size = os.path.getsize(file_path)
    mtime = os.path.getmtime(file_path)
    ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    # ETag/Last-Modified → 304 si aplica
    current_etag = f'W/"{int(mtime)}-{size}"'
    nm = _maybe_not_modified(request, current_etag, mtime)
    if nm is not None:
        # Añadimos cabeceras comunes también en 304
        _add_common_headers(nm, ctype, size, mtime)
        return nm

    range_header = (request.headers.get("Range") or "").strip()

    if range_header:
        m = re.match(r"bytes=(\d+)-(\d*)$", range_header)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
            if start >= size or start > end:
                # Rango inválido → 416 + bytes */size
                resp = StreamingHttpResponse(status=416)
                _add_common_headers(resp, ctype, size, mtime)
                resp["Content-Range"] = f"bytes */{size}"
                return resp

            end = min(end, size - 1)
            length = end - start + 1

            if request.method == "HEAD":
                resp = StreamingHttpResponse(status=206)
            else:
                resp = StreamingHttpResponse(
                    _range_iter(file_path, start, length),
                    status=206,
                )
            _add_common_headers(resp, ctype, size, mtime)
            resp["Content-Range"] = f"bytes {start}-{end}/{size}"
            resp["Content-Length"] = str(length)
            return resp

    # Sin Range → todo el archivo
    if request.method == "HEAD":
        resp = StreamingHttpResponse(status=200)
    else:
        # FileResponse usa sendfile/zero-copy cuando es posible
        resp = FileResponse(open(file_path, "rb"))
    _add_common_headers(resp, ctype, size, mtime)
    resp["Content-Length"] = str(size)
    return resp
