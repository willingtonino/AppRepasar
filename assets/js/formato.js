/**
 * formato.js
 * Normaliza y valida el JSON de un modulo.
 *
 * Formato recomendado (ver modules/_PLANTILLA.json):
 * {
 *   "id": "aws-m1",
 *   "titulo": "Introduccion a la nube",
 *   "descripcion": "...",
 *   "etiqueta": "Modulo 1",
 *   "preguntas": [
 *     {
 *       "pregunta": "...",
 *       "opciones": ["...", "...", "...", "..."],
 *       "correcta": "A",              // o ["A", "C"] para varias
 *       "explicacion": "..."          // opcional
 *     }
 *   ]
 * }
 *
 * Se aceptan sinonimos en ingles y otras formas de marcar la respuesta;
 * todo se reduce a la estructura interna que usa la aplicacion.
 */

export const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const letra = (i) => LETRAS[i] ?? `#${i + 1}`;

/** Devuelve el primer valor no vacio entre varias claves posibles. */
function elegir(obj, claves) {
  for (const clave of claves) {
    const valor = obj?.[clave];
    if (valor !== undefined && valor !== null && valor !== "") return valor;
  }
  return undefined;
}

const texto = (valor) => (typeof valor === "string" ? valor.trim() : "");

/** Convierte las opciones a un array de { texto, correctaInline }. */
function leerOpciones(bruto) {
  if (Array.isArray(bruto)) {
    return bruto.map((op) => {
      if (op && typeof op === "object") {
        return {
          texto: texto(elegir(op, ["texto", "text", "opcion", "label", "valor"])),
          correctaInline: Boolean(elegir(op, ["correcta", "correcto", "esCorrecta", "correct", "isCorrect"])),
        };
      }
      return { texto: String(op ?? "").trim(), correctaInline: false };
    });
  }

  // Forma { "A": "texto", "B": "texto" }
  if (bruto && typeof bruto === "object") {
    return Object.keys(bruto)
      .sort()
      .map((clave) => ({ texto: String(bruto[clave] ?? "").trim(), correctaInline: false }));
  }

  return [];
}

/** Traduce una referencia de respuesta a indice de opcion. */
function resolverIndice(valor, opciones, numerosBaseCero) {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    const idx = numerosBaseCero ? valor : valor - 1;
    return idx >= 0 && idx < opciones.length ? idx : -1;
  }

  const bruto = String(valor ?? "").trim();
  if (!bruto) return -1;

  // Letra suelta: A, b, C...
  if (/^[A-Za-z]$/.test(bruto)) {
    const idx = LETRAS.indexOf(bruto.toUpperCase());
    return idx >= 0 && idx < opciones.length ? idx : -1;
  }

  // Numero escrito como texto
  if (/^\d+$/.test(bruto)) {
    return resolverIndice(Number(bruto), opciones, numerosBaseCero);
  }

  // Texto exacto de la opcion (sin distinguir mayusculas ni espacios extra)
  const normal = bruto.toLowerCase().replace(/\s+/g, " ");
  const idx = opciones.findIndex((op) => op.texto.toLowerCase().replace(/\s+/g, " ") === normal);
  return idx;
}

/** Reune todas las referencias de respuesta declaradas en la pregunta. */
function leerReferencias(pregunta) {
  const bruto = elegir(pregunta, [
    "correcta", "correctas", "correcto", "correctos",
    "respuesta", "respuestas", "solucion",
    "answer", "answers", "correct",
  ]);

  if (bruto === undefined) return [];

  const lista = Array.isArray(bruto) ? bruto : [bruto];

  // "A,C" o "A y C" en una sola cadena
  return lista.flatMap((valor) => {
    if (typeof valor === "string" && /[,;]/.test(valor)) {
      return valor.split(/[,;]+/).map((parte) => parte.trim()).filter(Boolean);
    }
    return [valor];
  });
}

function normalizarPregunta(bruta, i, errores) {
  const donde = `Pregunta ${i + 1}`;
  const enunciado = texto(elegir(bruta, ["pregunta", "enunciado", "question", "texto", "text", "titulo"]));
  if (!enunciado) errores.push(`${donde}: falta el texto de la pregunta ("pregunta").`);

  const opciones = leerOpciones(elegir(bruta, ["opciones", "options", "respuestas", "alternativas", "choices"]));
  if (opciones.length < 2) errores.push(`${donde}: se necesitan al menos 2 opciones ("opciones").`);
  if (opciones.some((op) => !op.texto)) errores.push(`${donde}: hay opciones vacías.`);

  const correctas = new Set();

  // 1) Opciones marcadas con "correcta": true
  opciones.forEach((op, idx) => {
    if (op.correctaInline) correctas.add(idx);
  });

  // 2) Campo "correcta" / "respuesta" / ...
  const referencias = leerReferencias(bruta);
  const numeros = referencias.filter((r) => typeof r === "number" || /^\d+$/.test(String(r).trim()));
  // Si aparece un 0, el autor cuenta desde 0; si no, desde 1 (1 = A).
  const baseCero = numeros.some((r) => Number(r) === 0);

  for (const ref of referencias) {
    const idx = resolverIndice(ref, opciones, baseCero);
    if (idx < 0) {
      errores.push(`${donde}: no se entiende la respuesta "${ref}". Usa una letra (A, B, C...) o el texto exacto de la opción.`);
    } else {
      correctas.add(idx);
    }
  }

  if (correctas.size === 0 && referencias.length === 0 && opciones.length >= 2) {
    errores.push(`${donde}: falta indicar la respuesta correcta ("correcta": "A").`);
  }

  const tipoDeclarado = texto(elegir(bruta, ["tipo", "type"])).toLowerCase();
  const multiple = tipoDeclarado
    ? /multi|varias|multiple/.test(tipoDeclarado)
    : correctas.size > 1;

  return {
    id: texto(elegir(bruta, ["id"])) || `p${i + 1}`,
    enunciado,
    opciones: opciones.map((op) => op.texto),
    correctas: [...correctas].sort((a, b) => a - b),
    multiple,
    explicacion: texto(elegir(bruta, ["explicacion", "explicación", "explanation", "porque", "porqué", "razon", "razón", "justificacion", "motivo"])),
  };
}

/**
 * @returns {{ ok: boolean, modulo: object|null, errores: string[] }}
 */
export function normalizarModulo(bruto, { idPorDefecto = "" } = {}) {
  const errores = [];

  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, modulo: null, errores: ['El archivo debe ser un objeto JSON con "titulo" y "preguntas".'] };
  }

  const titulo = texto(elegir(bruto, ["titulo", "título", "title", "nombre", "tema"]));
  if (!titulo) errores.push('Falta el título del módulo ("titulo").');

  const brutoPreguntas = elegir(bruto, ["preguntas", "questions", "items"]);
  if (!Array.isArray(brutoPreguntas) || brutoPreguntas.length === 0) {
    errores.push('Falta la lista de preguntas ("preguntas": [ ... ]).');
  }

  const preguntas = Array.isArray(brutoPreguntas)
    ? brutoPreguntas.map((p, i) => normalizarPregunta(p ?? {}, i, errores))
    : [];

  const numero = elegir(bruto, ["modulo", "módulo", "numero", "número", "orden", "module"]);
  const etiqueta =
    texto(elegir(bruto, ["etiqueta", "label", "badge"])) ||
    (numero !== undefined ? `Módulo ${numero}` : "");

  const modulo = {
    id: texto(elegir(bruto, ["id", "clave", "slug"])) || idPorDefecto || titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    titulo,
    descripcion: texto(elegir(bruto, ["descripcion", "descripción", "description", "resumen", "subtitulo"])),
    etiqueta,
    orden: Number.isFinite(Number(numero)) ? Number(numero) : null,
    notaMinima: Number(elegir(bruto, ["notaMinima", "aprobadoEn", "minimo"]) ?? 70),
    barajarPreguntas: Boolean(elegir(bruto, ["barajarPreguntas", "shuffleQuestions", "barajar"])),
    barajarOpciones: Boolean(elegir(bruto, ["barajarOpciones", "shuffleOptions"])),
    preguntas,
  };

  return { ok: errores.length === 0, modulo: errores.length === 0 ? modulo : null, errores };
}
