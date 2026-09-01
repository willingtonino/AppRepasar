# -*- coding: utf-8 -*-
"""
empaquetar.py
Genera "repasar.html": TODA la aplicacion (diseno, codigo y preguntas) en un
unico archivo HTML sin dependencias externas.

Sirve para:
  * subirlo a SharePoint (renombrado a .aspx) sin subir carpetas ni JSON sueltos,
  * repartirlo por Teams o correo para abrirlo con doble clic, incluso sin red,
  * publicarlo en cualquier hosting arrastrando un solo archivo.

Uso:
    python herramientas/empaquetar.py            -> repasar.html
    python herramientas/empaquetar.py --salida dist/quiz.html
"""

import argparse
import base64
import hashlib
import io
import json
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Orden de concatenacion: cada modulo solo usa los anteriores.
GUIONES = [
    "assets/js/formato.js",
    "assets/js/auth.js",
    "assets/js/datos.js",
    "assets/js/app.js",
]

RE_IMPORT = re.compile(r"^\s*import\s[^;]*?;\s*$", re.M | re.S)
RE_EXPORT = re.compile(r"^export\s+", re.M)
RE_CSP = re.compile(r'<meta http-equiv="Content-Security-Policy"[^>]*>')


def hash_csp(texto):
    """'sha256-...' del contenido exacto de un bloque en linea, para la CSP."""
    resumen = hashlib.sha256(texto.encode("utf-8")).digest()
    return "'sha256-%s'" % base64.b64encode(resumen).decode("ascii")


def leer(ruta):
    with io.open(os.path.join(RAIZ, ruta), encoding="utf-8") as f:
        return f.read()


def catalogo():
    """index.json + el contenido de cada modulo, en un solo objeto."""
    indice = json.loads(leer("modules/index.json"))
    modulos = []
    for archivo in indice.get("modulos", []):
        nombre = archivo if isinstance(archivo, str) else archivo.get("archivo")
        modulos.append(json.loads(leer("modules/" + nombre)))
    datos = {k: v for k, v in indice.items() if k != "modulos"}
    datos["modulos"] = modulos
    return datos


def juntar_guiones():
    """Convierte los modulos ES en un unico script clasico."""
    partes = []
    for ruta in GUIONES:
        codigo = leer(ruta)
        codigo = RE_IMPORT.sub("", codigo)
        codigo = RE_EXPORT.sub("", codigo)
        partes.append("/* === %s === */\n%s" % (os.path.basename(ruta), codigo))
    return "\n\n".join(partes)


def construir():
    html = leer("index.html")
    datos = json.dumps(catalogo(), ensure_ascii=False, separators=(",", ":"))
    # </script> dentro de los datos romperia la etiqueta
    datos = datos.replace("</", "<\\/")

    estilos = "\n%s\n" % leer("assets/css/estilos.css")
    guiones = "\n%s\n  " % juntar_guiones()

    # Al ir todo en linea, 'self' ya no sirve: se autoriza cada bloque por su
    # hash. Es tan estricto como los archivos externos y evita 'unsafe-inline'.
    csp = (
        "default-src 'none'; "
        "script-src %s %s; "
        "style-src %s; "
        "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'"
        % (hash_csp(guiones), hash_csp(datos), hash_csp(estilos))
    )
    html = RE_CSP.sub(
        '<meta http-equiv="Content-Security-Policy" content="%s">' % csp, html, count=1
    )

    html = html.replace(
        '<link rel="stylesheet" href="assets/css/estilos.css" />',
        "<style>%s</style>" % estilos,
    )
    html = html.replace(
        '<script type="module" src="assets/js/app.js"></script>',
        '<script id="datos-modulos" type="application/json">%s</script>\n'
        "  <script>%s</script>" % (datos, guiones),
    )
    return html


def main():
    ap = argparse.ArgumentParser(description="Empaqueta la aplicacion en un solo HTML.")
    ap.add_argument("--salida", default="repasar.html")
    args = ap.parse_args()

    html = construir()
    destino = os.path.join(RAIZ, args.salida)
    os.makedirs(os.path.dirname(destino) or ".", exist_ok=True)
    with io.open(destino, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    datos = catalogo()
    preguntas = sum(len(m.get("preguntas", [])) for m in datos["modulos"])
    print("%s  ·  %d módulos  ·  %d preguntas  ·  %.0f KB"
          % (args.salida, len(datos["modulos"]), preguntas, os.path.getsize(destino) / 1024))


if __name__ == "__main__":
    main()
