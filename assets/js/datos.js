/**
 * datos.js
 * Carga del catalogo (modules/index.json + los archivos de cada modulo),
 * modulos anadidos desde el navegador y progreso guardado.
 */

import { normalizarModulo } from "./formato.js";

const BASE = "modules/";
const CLAVE_LOCALES = "repasar:v1:modulos-locales";
const CLAVE_PROGRESO = "repasar:v1:progreso";

const sinCache = { cache: "no-cache", headers: { accept: "application/json" } };

async function leerJson(ruta) {
  const respuesta = await fetch(ruta, sinCache);
  if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta} (HTTP ${respuesta.status})`);
  try {
    return await respuesta.json();
  } catch {
    throw new Error(`${ruta} no contiene JSON válido.`);
  }
}

/**
 * Version de un solo archivo (herramientas/empaquetar.py): los modulos vienen
 * incrustados en la propia pagina y no hace falta pedir nada al servidor.
 */
function leerIncrustado() {
  const etiqueta = document.getElementById("datos-modulos");
  if (!etiqueta) return null;
  try {
    return JSON.parse(etiqueta.textContent);
  } catch {
    return null;
  }
}

/**
 * Lee el catalogo completo. Nunca lanza: los problemas se devuelven en `errores`
 * para poder mostrarlos en pantalla sin romper el resto de modulos.
 */
export async function cargarCatalogo() {
  const errores = [];
  let indice;

  const incrustado = leerIncrustado();
  if (incrustado) {
    const modulos = (incrustado.modulos || [])
      .map((bruto, i) => {
        const { ok, modulo, errores: fallos } = normalizarModulo(bruto, { idPorDefecto: `m${i + 1}` });
        if (!ok) {
          errores.push(`Módulo ${i + 1}: ${fallos.join(" ")}`);
          return null;
        }
        return { ...modulo, origen: "catalogo", orden: modulo.orden ?? i + 1 };
      })
      .filter(Boolean);
    return {
      config: { ...configPorDefecto(), ...incrustado },
      modulos: [...modulos, ...leerLocales()],
      errores,
    };
  }

  try {
    indice = await leerJson(`${BASE}index.json`);
  } catch (e) {
    return {
      config: configPorDefecto(),
      modulos: leerLocales(),
      errores: [`${e.message} Revisa que exista modules/index.json y que la página se sirva por HTTP.`],
    };
  }

  const config = { ...configPorDefecto(), ...indice };
  const entradas = Array.isArray(indice.modulos) ? indice.modulos : [];

  const cargados = await Promise.all(
    entradas.map(async (entrada, i) => {
      const archivo = typeof entrada === "string" ? entrada : entrada?.archivo || entrada?.file;
      if (!archivo) {
        errores.push(`Entrada ${i + 1} de index.json: falta el nombre del archivo.`);
        return null;
      }
      try {
        const bruto = await leerJson(BASE + archivo);
        const idPorDefecto = archivo.replace(/\.json$/i, "");
        const { ok, modulo, errores: fallos } = normalizarModulo(bruto, { idPorDefecto });
        if (!ok) {
          errores.push(`${archivo}: ${fallos.join(" ")}`);
          return null;
        }
        return { ...modulo, archivo, origen: "catalogo", orden: modulo.orden ?? i + 1 };
      } catch (e) {
        errores.push(e.message);
        return null;
      }
    })
  );

  const modulos = cargados.filter(Boolean);
  modulos.sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999));

  return { config, modulos: [...modulos, ...leerLocales()], errores };
}

function configPorDefecto() {
  return {
    marca: "Ruta de estudio",
    titulo: "¿Qué módulo quieres estudiar?",
    descripcion:
      "Selecciona un módulo. Recibirás retroalimentación inmediata y podrás repetirlo cuantas veces necesites.",
    // true | false | "local" (solo al abrirlo en tu equipo, no en el sitio publicado)
    permitirSubida: "local",
  };
}

/* -- Modulos anadidos desde el navegador ---------------------------------- */

export function leerLocales() {
  try {
    const guardados = JSON.parse(localStorage.getItem(CLAVE_LOCALES) || "[]");
    return guardados
      .map((bruto, i) => {
        const { ok, modulo } = normalizarModulo(bruto, { idPorDefecto: `local-${i}` });
        return ok ? { ...modulo, origen: "local", orden: 900 + i } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function escribirLocales(lista) {
  guardar(CLAVE_LOCALES, lista);
}

/** Escribe en localStorage sin romperse si el navegador no lo permite
 *  (modo privado, archivo abierto con doble clic, cuota agotada...). */
function guardar(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

function crudosLocales() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_LOCALES) || "[]");
  } catch {
    return [];
  }
}

/** Anade (o reemplaza, si coincide el id) un modulo en este navegador. */
export function guardarLocal(bruto, id) {
  const lista = crudosLocales().filter((m) => (m.id || "") !== id);
  escribirLocales([...lista, bruto]);
}

export function borrarLocal(id) {
  escribirLocales(crudosLocales().filter((m, i) => (m.id || `local-${i}`) !== id));
}

/* -- Progreso -------------------------------------------------------------- */

export function leerProgreso() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PROGRESO) || "{}");
  } catch {
    return {};
  }
}

export function guardarProgreso(idModulo, resultado) {
  const todo = leerProgreso();
  const previo = todo[idModulo];
  todo[idModulo] = {
    ...resultado,
    fecha: new Date().toISOString(),
    mejor: Math.max(resultado.porcentaje, previo?.mejor ?? 0),
    intentos: (previo?.intentos ?? 0) + 1,
  };
  guardar(CLAVE_PROGRESO, todo);
}
