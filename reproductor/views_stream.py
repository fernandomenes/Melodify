# reproductor/views_stream.py
"""
Streaming seguro de archivos dentro de /uploaded_media con soporte HTTP Range.

Características principales:
- Respuesta a peticiones GET/HEAD, con soporte de rangos parciales (206) y
  descargas completas (200).
- Prevención de directory traversal y validación de existencia del archivo.
- Cabeceras ETag, Last-Modified y Cache-Control para facilitar el cacheo
  por parte del navegador.
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

# Directorio base de archivos subidos (relativo a BASE_DIR del proyecto)
BASE_UPLOAD_DIR = os.path.abspath(os.path.join(settings.BASE_DIR, "uploaded_media"))


def _safe_join_uploaded(relpath: str) -> str:
    """
    Calcula una ruta absoluta segura **dentro** de BASE_UPLOAD_DIR.

    - Decodifica componentes %xx.
    - Elimina separadores iniciales.
    - Verifica que la ruta resultante permanezca dentro de BASE_UPLOAD_DIR.
    - Comprueba que exista un archivo regular en esa ruta.

    Lanza Http404 si la ruta es inválida o el archivo no existe.
    """
    relpath = unquote(relpath).lstrip("/\\")
    candidate = os.path.abspath(os.path.join(BASE_UPLOAD_DIR, relpath))
    if os.path.commonpath([BASE_UPLOAD_DIR, candidate]) != BASE_UPLOAD_DIR:
        raise Http404("Ruta fuera de uploaded_media")
    if not (os.path.exists(candidate) and os.path.isfile(candidate)):
        raise Http404("Archivo no encontrado")
    return candidate


def _range_iter(path: str, start: int, length: int, chunk_size: int = 8192) -> Iterator[bytes]:
    """
    Generador de bloques de bytes para respuestas parciales (HTTP 206).

    Recorre el archivo desde la posición `start` y entrega `length` bytes
    en chunks de tamaño máximo `chunk_size`.
    """
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
    """
    Añade cabeceras comunes a las respuestas de streaming (parcial o completa):

    - Accept-Ranges: bytes
    - Last-Modified
    - ETag (débil, basada en mtime y tamaño)
    - Cache-Control
    - Content-Type
    """
    resp["Accept-Ranges"] = "bytes"
    resp["Last-Modified"] = http_date(mtime)
    # ETag simple basada en mtime entero y tamaño del archivo
    resp["ETag"] = f'W/"{int(mtime)}-{size}"'
    # Se permite cachear durante 1 día (ajustable según políticas del proyecto)
    resp["Cache-Control"] = "public, max-age=86400"
    resp["Content-Type"] = ctype
    return resp


def _maybe_not_modified(request, etag: str, mtime: float):
    """
    Evalúa cabeceras condicionales y, si corresponde, devuelve un 304 Not Modified.

    Tiene en cuenta:
    - If-None-Match: compara contra el ETag calculado.
    - If-Modified-Since: compara la marca de tiempo de modificación.
    """
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
    Sirve archivos de /uploaded_media con soporte de HTTP Range.

    - Si la petición incluye Range válido:
        * Devuelve 206 Partial Content, con Content-Range y longitud parcial.
    - Si no hay Range:
        * Devuelve 200 OK con el archivo completo.
    - Si el rango solicitado es inválido:
        * Devuelve 416 Range Not Satisfiable.

    En todos los casos válidos se añaden cabeceras de cacheo y metadatos
    (ETag, Last-Modified, Content-Type, Content-Length).
    """
    file_path = _safe_join_uploaded(relpath)
    size = os.path.getsize(file_path)
    mtime = os.path.getmtime(file_path)
    ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    # ETag/Last-Modified → posible 304 Not Modified
    current_etag = f'W/"{int(mtime)}-{size}"'
    nm = _maybe_not_modified(request, current_etag, mtime)
    if nm is not None:
        # Se añaden cabeceras básicas también en 304
        _add_common_headers(nm, ctype, size, mtime)
        return nm

    range_header = (request.headers.get("Range") or "").strip()

    if range_header:
        # Soporte únicamente de rangos del tipo "bytes=start-end"
        m = re.match(r"bytes=(\d+)-(\d*)$", range_header)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1

            # Rango fuera de límites
            if start >= size or start > end:
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

    if request.method == "HEAD":
        resp = StreamingHttpResponse(status=200)
    else:
        resp = FileResponse(open(file_path, "rb"))

    _add_common_headers(resp, ctype, size, mtime)
    resp["Content-Length"] = str(size)
    return resp
