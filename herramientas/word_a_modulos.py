# -*- coding: utf-8 -*-
"""
word_a_modulos.py
Convierte un banco de preguntas en Word (.docx) en los archivos JSON de modules/.

Convenciones que espera el documento:

  * Cada modulo empieza con un titulo RESALTADO (subrayado con color de resalte).
  * Cada pregunta es un parrafo que contiene "?".
  * Los parrafos anteriores a la pregunta (hasta la pregunta anterior) son el
    contexto o enunciado largo, y se anaden delante de la pregunta.
  * Debajo van las opciones, un parrafo cada una.
  * La opcion correcta va escrita en VERDE (color de fuente 00B050).
    Si hay varias en verde, la pregunta pasa a ser de seleccion multiple.
  * La explicacion es un parrafo que empieza por "RTA:" (opcional).
    Los parrafos "RTA NO:" o "NO RTA:" explican por que otra opcion no vale y
    se anaden a la explicacion precedidos de "Por que no:".

Uso:
    python herramientas/word_a_modulos.py "ruta/al/banco.docx" [--salida modules]

Las preguntas sin respuesta en verde (y que no se puedan deducir del texto de
la RTA) se OMITEN y se listan al final para que las marques en el Word.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
COLORES_CORRECTO = {"00B050", "008000", "92D050", "00B0F0"}

RE_RTA = re.compile(r"^\s*(RTA\s*NO|NO\s*RTA|RTA)\s*[:.\-]?\s*", re.I)
RE_RTA_NEGATIVA = re.compile(r"^\s*(RTA\s*NO|NO\s*RTA)\b", re.I)
RE_ANOTACION = re.compile(r"\s*\bNO\s+ES\b\s*$", re.I)
RE_CUANTAS = re.compile(r"seleccione\s+(una|dos|tres|cuatro|cinco|\d+)", re.I)

NUMEROS = {"una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5}
LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Se rellena en main() desde herramientas/respuestas.json. La clave es el texto
# de la pregunta seguido del de su primera opcion (para distinguir preguntas que
# se formulan igual); el valor, la letra o letras correctas.
RESPUESTAS = {}


# -- lectura del documento --------------------------------------------------

def leer_parrafos(ruta):
    """[{texto, correcto, cabecera}] en el orden del documento."""
    with zipfile.ZipFile(ruta) as z:
        raiz = ET.fromstring(z.read("word/document.xml"))

    # Los glosarios y las tablas de recursos van en tablas de Word: no son
    # preguntas ni enunciados, asi que se marcan para ignorarlos.
    en_tabla = set()
    for tabla in raiz.iter(W + "tbl"):
        for p in tabla.iter(W + "p"):
            en_tabla.add(id(p))

    salida = []
    for p in raiz.iter(W + "p"):
        texto = "".join(t.text or "" for t in p.iter(W + "t"))
        texto = texto.replace("\xa0", " ").strip()
        correcto = False
        cabecera = False
        for r in p.iter(W + "r"):
            trozo = "".join(x.text or "" for x in r.iter(W + "t"))
            if not trozo.strip():
                continue
            rpr = r.find(W + "rPr")
            if rpr is None:
                continue
            color = rpr.find(W + "color")
            if color is not None and (color.get(W + "val") or "").upper() in COLORES_CORRECTO:
                correcto = True
            if rpr.find(W + "highlight") is not None:
                cabecera = True
        salida.append({"texto": texto, "correcto": correcto, "cabecera": cabecera,
                       "tabla": id(p) in en_tabla})
    return salida


# -- utilidades -------------------------------------------------------------

def normalizar(texto):
    texto = unicodedata.normalize("NFKD", texto.lower())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", texto).strip()


def es_pregunta(p):
    t = p["texto"]
    return bool(t) and not p["tabla"] and "?" in t and len(t) < 400 and not RE_RTA.match(t)


def precede_a_pregunta(ps, k, fin):
    """El parrafo k es el enunciado de la pregunta siguiente, no la cola de una RTA.

    Se reconoce porque el siguiente parrafo con texto ya es una pregunta: en ese
    caso pertenece al bloque que viene, no a la explicacion que acaba de leerse.
    """
    n = k + 1
    while n < fin and not ps[n]["texto"]:
        n += 1
    return n < fin and es_pregunta(ps[n])


def cuantas_pide(texto):
    m = RE_CUANTAS.search(texto)
    if not m:
        return None
    palabra = m.group(1).lower()
    return NUMEROS.get(palabra, int(palabra) if palabra.isdigit() else None)


def deducir_por_rta(opciones, explicacion):
    """Si nadie marco la respuesta, intenta deducirla del texto de la RTA."""
    if not explicacion:
        return []
    cabeza = normalizar(explicacion[:160])
    encontrados = []
    for i, op in enumerate(opciones):
        clave = normalizar(op)
        # nombre entre parentesis: "AWS Key Management Service (AWS KMS)" -> "aws kms"
        alias = re.findall(r"\(([^)]+)\)", op)
        candidatos = [clave] + [normalizar(a) for a in alias]
        if any(len(c) > 4 and c in cabeza for c in candidatos):
            encontrados.append(i)
    return encontrados if len(encontrados) == 1 else []


# -- troceado ---------------------------------------------------------------

def trocear(ps, ini, fin):
    """Devuelve (preguntas, descartadas) del rango [ini, fin)."""
    preguntas, descartadas = [], []
    i = ini

    while i < fin:
        # 1. localizar la siguiente pregunta
        qi = next((k for k in range(i, fin) if es_pregunta(ps[k])), None)
        if qi is None:
            break

        # El contexto es el ultimo bloque de prosa seguida que hay justo antes de
        # la pregunta. Se lee hacia atras y se para en el primer hueco: asi no se
        # arrastra la cola de la explicacion de la pregunta anterior.
        contexto = []
        k = qi - 1
        while k >= i and not ps[k]["texto"]:
            k -= 1
        while k >= i:
            p = ps[k]
            if not p["texto"] or p["tabla"] or p["cabecera"] or RE_RTA.match(p["texto"]):
                break
            contexto.insert(0, p["texto"])
            k -= 1

        # 2. opciones
        j = qi + 1
        while j < fin and not ps[j]["texto"]:
            j += 1
        opciones = []
        while j < fin:
            p = ps[j]
            if not p["texto"] or p["cabecera"] or p["tabla"] or RE_RTA.match(p["texto"]) or es_pregunta(p):
                break
            opciones.append({"texto": RE_ANOTACION.sub("", p["texto"]).strip(),
                             "correcto": p["correcto"]})
            j += 1

        # 3. explicacion: uno o varios parrafos RTA (con sus continuaciones)
        trozos, positivos = [], []
        while True:
            k = j
            while k < fin and not ps[k]["texto"]:
                k += 1
            if k >= fin or not RE_RTA.match(ps[k]["texto"]):
                break
            negativa = bool(RE_RTA_NEGATIVA.match(ps[k]["texto"]))
            cuerpo = RE_RTA.sub("", ps[k]["texto"]).strip()
            trozos.append(("Por qué no: " if negativa else "") + cuerpo)
            if not negativa:
                positivos.append(cuerpo)
            k += 1
            while k < fin and ps[k]["texto"] and not ps[k]["cabecera"] and not ps[k]["tabla"] \
                    and not RE_RTA.match(ps[k]["texto"]) and not es_pregunta(ps[k]) \
                    and not precede_a_pregunta(ps, k, fin):
                trozos.append(ps[k]["texto"])
                k += 1
            j = k

        explicacion = "\n\n".join(t for t in trozos if t)
        # Solo las RTA afirmativas sirven para deducir la respuesta: las "RTA NO"
        # explican justo lo contrario, la opcion que hay que descartar.
        explicacion_positiva = "\n\n".join(positivos)
        textos = [o["texto"] for o in opciones]
        correctas = [n for n, o in enumerate(opciones) if o["correcto"]]
        deducida = False

        if not correctas and len(textos) >= 2:
            correctas = deducir_por_rta(textos, explicacion_positiva)
            deducida = bool(correctas)

        # 4. respuestas corregidas a mano (herramientas/respuestas.json)
        clave = normalizar(ps[qi]["texto"] + " " + (textos[0] if textos else ""))[:120]
        if clave in RESPUESTAS:
            correctas = sorted(LETRAS.index(l.upper()) for l in RESPUESTAS[clave])
            deducida = False
            manual = True
        else:
            manual = False

        enunciado = "\n\n".join(contexto + [ps[qi]["texto"]])
        pide = cuantas_pide(ps[qi]["texto"])

        registro = {
            "parrafo": qi,
            "pregunta": enunciado,
            "opciones": textos,
            "correctas": correctas,
            "explicacion": explicacion,
            "pide": pide,
            "deducida": deducida,
            "manual": manual,
        }

        if len(textos) < 2:
            registro["motivo"] = "no parece una pregunta (menos de 2 opciones)"
            descartadas.append(registro)
        elif not correctas:
            registro["motivo"] = "ninguna opción marcada en verde"
            descartadas.append(registro)
        elif len(textos) > 8:
            registro["motivo"] = "demasiadas opciones (%d)" % len(textos)
            descartadas.append(registro)
        else:
            preguntas.append(registro)

        i = max(j, qi + 1)

    return preguntas, descartadas


def cabeceras(ps, hasta=None):
    return [(i, p["texto"]) for i, p in enumerate(ps[:hasta])
            if p["cabecera"] and p["texto"] and not p["tabla"] and len(p["texto"]) < 90]


# -- salida -----------------------------------------------------------------

def a_modulo(idm, titulo, descripcion, preguntas):
    salida = []
    for p in preguntas:
        item = {
            "pregunta": p["pregunta"],
            "opciones": p["opciones"],
            "correcta": ([LETRAS[i] for i in p["correctas"]]
                         if len(p["correctas"]) > 1 else LETRAS[p["correctas"][0]]),
        }
        if len(p["correctas"]) > 1 or (p["pide"] or 1) > 1:
            item["tipo"] = "multiple"
        if p["explicacion"]:
            item["explicacion"] = p["explicacion"]
        salida.append(item)
    return {
        "id": "aws-m%d" % idm,
        "modulo": idm,
        "titulo": titulo,
        "descripcion": descripcion,
        "notaMinima": 70,
        "preguntas": salida,
    }


def main():
    ap = argparse.ArgumentParser(description="Convierte un .docx de preguntas en modulos JSON.")
    ap.add_argument("docx")
    ap.add_argument("--salida", default="modules")
    ap.add_argument("--listar", action="store_true", help="solo muestra las cabeceras detectadas")
    ap.add_argument("--modulos", type=int, default=0, help="procesar solo los N primeros modulos")
    ap.add_argument("--meta", default="herramientas/modulos.json",
                    help="titulos y descripciones por numero de modulo (opcional)")
    ap.add_argument("--respuestas", default="herramientas/respuestas.json",
                    help="respuestas corregidas a mano para preguntas sin marcar (opcional)")
    args = ap.parse_args()

    if args.respuestas and os.path.exists(args.respuestas):
        with open(args.respuestas, encoding="utf-8") as f:
            for k, v in json.load(f).items():
                if not k.startswith("_"):
                    RESPUESTAS[normalizar(k)[:120]] = [v] if isinstance(v, str) else v

    ps = leer_parrafos(args.docx)
    titulos = cabeceras(ps)

    meta = {}
    if args.meta and os.path.exists(args.meta):
        with open(args.meta, encoding="utf-8") as f:
            meta = json.load(f)

    if args.listar:
        for i, t in titulos:
            print("%6d  %s" % (i, t))
        return

    # Rango de cada modulo: desde su cabecera hasta la siguiente
    limites = [i for i, _ in titulos]
    if args.modulos:
        titulos = titulos[:args.modulos]
    total, omitidas, deducidas = 0, [], []
    indice = []

    for n, (ini, titulo) in enumerate(titulos, start=1):
        fin = limites[n] if n < len(limites) else len(ps)
        info = meta.get(str(n), {})
        preguntas, descartadas = trocear(ps, ini + 1, fin)
        if not preguntas:
            continue
        total += len(preguntas)
        omitidas.extend((titulo, d) for d in descartadas)
        deducidas.extend((titulo, d) for d in preguntas if d["deducida"])
        modulo = a_modulo(n, info.get("titulo") or titulo.capitalize(), info.get("descripcion", ""), preguntas)
        nombre = info.get("archivo") or "%02d-%s.json" % (n, normalizar(titulo).replace(" ", "-")[:40])
        ruta = os.path.join(args.salida, nombre)
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(modulo, f, ensure_ascii=False, indent=2)
        indice.append(nombre)
        print("%-45s %3d preguntas -> %s" % (titulo[:45], len(preguntas), ruta))

    ruta_indice = os.path.join(args.salida, "index.json")
    if indice and os.path.exists(ruta_indice):
        with open(ruta_indice, encoding="utf-8") as f:
            catalogo = json.load(f)
        catalogo["modulos"] = indice
        with open(ruta_indice, "w", encoding="utf-8") as f:
            json.dump(catalogo, f, ensure_ascii=False, indent=2)
        print("\nCatálogo actualizado: %s" % ruta_indice)

    print("\nTotal: %d preguntas" % total)

    if deducidas:
        print("\nRespuestas deducidas del texto de la RTA (%d). Conviene revisarlas:" % len(deducidas))
        for titulo, d in deducidas:
            letras = "".join(LETRAS[i] for i in d["correctas"])
            print("  [%s] párrafo %d -> %s: %s"
                  % (titulo[:22], d["parrafo"], letras, d["opciones"][d["correctas"][0]][:70]))

    if omitidas:
        print("\nOmitidas (%d). Marca la respuesta en verde en el Word y vuelve a ejecutar:" % len(omitidas))
        for titulo, d in omitidas:
            print("  [%s] parrafo %d - %s" % (titulo[:22], d["parrafo"], d["motivo"]))
            print("      %s" % d["pregunta"].splitlines()[-1][:100])


if __name__ == "__main__":
    sys.exit(main())
