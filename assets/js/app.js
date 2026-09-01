/**
 * app.js
 * Vistas de la aplicacion: catalogo de modulos, cuestionario y resultados.
 * Sin framework ni paso de compilacion: se sirve tal cual.
 */

import { sesion, URL_LOGIN, URL_LOGOUT } from "./auth.js";
import {
  cargarCatalogo,
  guardarLocal,
  borrarLocal,
  leerProgreso,
  guardarProgreso,
  leerLocales,
} from "./datos.js";
import { normalizarModulo, letra } from "./formato.js";

const app = document.getElementById("app");
const barra = document.getElementById("barra");

const estado = {
  config: {},
  modulos: [],
  errores: [],
  usuario: null,
  quiz: null, // sesion de cuestionario en curso
};

/* == utilidades ============================================================ */

const esc = (valor) =>
  String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

const plural = (n, singular, prural) => `${n} ${n === 1 ? singular : prural}`;

/** De un enunciado con contexto, se queda con la pregunta (el último párrafo). */
const soloPregunta = (texto) => texto.split(/\n{2,}/).filter((t) => t.trim()).pop() || texto;

function barajar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function mismoConjunto(a, b) {
  if (a.length !== b.length) return false;
  const x = [...a].sort((m, n) => m - n);
  const y = [...b].sort((m, n) => m - n);
  return x.every((v, i) => v === y[i]);
}

function pintar(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/**
 * ¿Se puede añadir módulos desde el navegador?
 * En el sitio publicado no: el catálogo lo controla quien mantiene el repositorio.
 * Con "local" solo se permite al abrir la app en tu equipo o el archivo suelto,
 * que es como cada persona puede probar sus propios módulos.
 */
function sePuedeSubir() {
  const valor = estado.config.permitirSubida;
  if (typeof valor === "boolean") return valor;
  return (
    location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname)
  );
}

/** Hay un intento en curso con respuestas ya enviadas. */
const intentoVivo = () =>
  Boolean(estado.quiz && estado.quiz.historial.length && !estado.quiz.terminado);

/* == barra superior ======================================================== */

function pintarBarra() {
  const u = estado.usuario;
  let derecha = "";

  if (u?.estado === "dentro") {
    derecha = `
      <span class="usuario" title="${esc(u.nombre)}">
        <span class="avatar" aria-hidden="true">${esc(u.iniciales)}</span>
        <span class="usuario-nombre">${esc(u.nombre)}</span>
      </span>
      <a class="btn fantasma pequeno" href="${URL_LOGOUT()}">Salir</a>`;
  } else if (u?.estado === "fuera") {
    derecha = `<a class="btn pequeno" href="${URL_LOGIN()}">Iniciar sesión con Microsoft</a>`;
  } else {
    derecha = `<span class="usuario"><span class="avatar" aria-hidden="true">··</span>
      <span class="usuario-nombre">Modo local</span></span>`;
  }

  barra.innerHTML = `
    <div class="barra-int">
      <button class="marca" type="button" data-ir="inicio">
        <span class="icono" aria-hidden="true">📖</span>${esc(estado.config.marca || "Ruta de estudio")}
      </button>
      <div class="barra-fin">${derecha}</div>
    </div>`;
}

/* == vista: catalogo de modulos ============================================ */

function vistaInicio() {
  estado.quiz = null;
  const progreso = leerProgreso();
  const total = estado.modulos.reduce((n, m) => n + m.preguntas.length, 0);

  const tarjetas = estado.modulos
    .map((m, i) => {
      const nota = progreso[m.id];
      const etiqueta = m.etiqueta || `Módulo ${m.orden ?? i + 1}`;
      const insignias = [
        nota ? `<span class="marca-nota ${nota.mejor >= m.notaMinima ? "aprobado" : ""}">Mejor: ${Number(nota.mejor) || 0}%</span>` : "",
        m.origen === "local" ? `<span class="marca-nota local">Solo en este navegador</span>` : "",
      ].join("");

      return `
        <button class="tarjeta" type="button" data-modulo="${esc(m.id)}">
          <span class="tarjeta-cab">
            <span class="etiqueta">${esc(etiqueta)}</span>
            <span class="flecha" aria-hidden="true">→</span>
          </span>
          <h2>${esc(m.titulo)}</h2>
          <p>${esc(m.descripcion)}</p>
          <span class="tarjeta-pie">
            <span>${plural(m.preguntas.length, "pregunta", "preguntas")}</span>
            ${insignias}
          </span>
        </button>`;
    })
    .join("");

  const avisos = estado.errores.length
    ? `<div class="error-carga">
         <h2>Algún módulo no se pudo cargar</h2>
         ${estado.errores.map((e) => `<p>${esc(e)}</p>`).join("")}
       </div>`
    : "";

  pintar(`
    <h1>${esc(estado.config.titulo)}</h1>
    <p class="subtitulo">${esc(estado.config.descripcion)}</p>
    <span class="pastilla">${plural(estado.modulos.length, "módulo", "módulos")} · ${plural(total, "pregunta", "preguntas")}</span>

    <div class="rejilla">
      ${tarjetas}
      ${
        sePuedeSubir()
          ? `<button class="tarjeta fantasma" type="button" data-ir="subir">
               <span class="tarjeta-cab">
                 <span class="etiqueta">Nuevo</span>
                 <span class="flecha" aria-hidden="true">+</span>
               </span>
               <h2>Añadir un módulo</h2>
               <p>Sube un archivo JSON con tus preguntas o copia la plantilla.</p>
             </button>`
          : ""
      }
    </div>
    ${avisos}`);

  app.querySelectorAll("[data-modulo]").forEach((btn) => {
    btn.addEventListener("click", () => empezarModulo(btn.dataset.modulo));
  });
}

/* == cuestionario ========================================================== */

function empezarModulo(id) {
  const modulo = estado.modulos.find((m) => m.id === id);
  if (!modulo) return vistaInicio();

  let preguntas = modulo.barajarPreguntas ? barajar(modulo.preguntas) : [...modulo.preguntas];

  if (modulo.barajarOpciones) {
    preguntas = preguntas.map((p) => {
      const orden = barajar(p.opciones.map((_, i) => i));
      return {
        ...p,
        opciones: orden.map((i) => p.opciones[i]),
        correctas: p.correctas.map((c) => orden.indexOf(c)).sort((a, b) => a - b),
      };
    });
  }

  estado.quiz = {
    modulo,
    preguntas,
    indice: 0,
    seleccion: [],
    comprobada: false,
    historial: [], // { pregunta, elegidas, acierto }
  };

  history.pushState({ vista: "quiz" }, "");
  vistaQuiz();
}

function vistaQuiz() {
  const q = estado.quiz;
  if (!q) return vistaInicio();

  const pregunta = q.preguntas[q.indice];
  const numero = q.indice + 1;
  const totales = q.preguntas.length;
  const pct = Math.round(((numero - 1) / totales) * 100);

  const cuantas = pregunta.correctas.length;
  const tipo = pregunta.multiple
    ? `Selecciona las ${cuantas} correctas`
    : "Selecciona una opción";

  // El enunciado puede traer varios párrafos: los previos son el contexto y el
  // último es la pregunta en sí.
  const parrafos = pregunta.enunciado.split(/\n{2,}/).filter((t) => t.trim());
  const enunciado = parrafos.pop() || pregunta.enunciado;
  const contexto = parrafos.map((t) => `<p class="contexto">${esc(t)}</p>`).join("");

  const opciones = pregunta.opciones
    .map((texto, i) => `
      <label class="opcion" data-indice="${i}">
        <input type="${pregunta.multiple ? "checkbox" : "radio"}" name="opcion" value="${i}" />
        <span class="letra" aria-hidden="true">${letra(i)}</span>
        <span class="texto">${esc(texto)}</span>
      </label>`)
    .join("");

  pintar(`
    <button class="volver" type="button" data-salir>← Salir del módulo</button>

    <div class="quiz-cab">
      <h2>${esc(q.modulo.titulo)}</h2>
      <span class="quiz-meta">Pregunta ${numero} de ${totales}</span>
    </div>
    <div class="progreso"><i id="barra-progreso"></i></div>

    <section class="panel">
      <span class="tipo-nota">${tipo}</span>
      ${contexto}
      <p class="enunciado">${esc(enunciado)}</p>

      <fieldset class="opciones" id="opciones">
        <legend class="solo-lector">${esc(enunciado)}</legend>
        ${opciones}
      </fieldset>

      <div id="zona-feedback" aria-live="polite"></div>

      <div class="acciones">
        <button class="btn" type="button" id="comprobar" disabled>Comprobar respuesta</button>
        <span class="aviso" id="aviso">${
          pregunta.multiple
            ? `Marcadas 0 de ${cuantas}. Hay que acertar todas.`
            : "No podrás volver a esta pregunta."
        }</span>
      </div>
    </section>`);

  app.querySelector("#barra-progreso").style.width = `${pct}%`;

  const contenedor = app.querySelector("#opciones");
  const botonComprobar = app.querySelector("#comprobar");

  const aviso = app.querySelector("#aviso");

  contenedor.addEventListener("change", () => {
    if (q.comprobada) return;
    const marcadas = [...contenedor.querySelectorAll("input:checked")].map((el) => Number(el.value));
    q.seleccion = marcadas;
    contenedor.querySelectorAll(".opcion").forEach((el) => {
      el.classList.toggle("marcada", marcadas.includes(Number(el.dataset.indice)));
    });

    if (pregunta.multiple) {
      // Se responde con el conjunto completo: no hay aciertos parciales.
      botonComprobar.disabled = marcadas.length !== cuantas;
      aviso.textContent = `Marcadas ${marcadas.length} de ${cuantas}. Hay que acertar todas.`;
    } else {
      botonComprobar.disabled = marcadas.length === 0;
    }
  });

  botonComprobar.addEventListener("click", comprobar);
  app.querySelector("[data-salir]").addEventListener("click", salirDelModulo);
}

function comprobar() {
  const q = estado.quiz;
  const pregunta = q.preguntas[q.indice];
  const elegidas = [...q.seleccion].sort((a, b) => a - b);
  const acierto = mismoConjunto(elegidas, pregunta.correctas);

  q.comprobada = true;
  q.historial.push({ pregunta, elegidas, acierto });

  const contenedor = app.querySelector("#opciones");
  contenedor.classList.add("resuelto");
  contenedor.querySelectorAll("input").forEach((el) => (el.disabled = true));

  contenedor.querySelectorAll(".opcion").forEach((el) => {
    const i = Number(el.dataset.indice);
    const esCorrecta = pregunta.correctas.includes(i);
    const elegida = elegidas.includes(i);
    if (esCorrecta) {
      el.classList.add("correcta");
      el.insertAdjacentHTML("beforeend", `<span class="pista">Correcta</span>`);
    } else if (elegida) {
      el.classList.add("fallada");
      el.insertAdjacentHTML("beforeend", `<span class="pista">Tu respuesta</span>`);
    }
  });

  const solucion = pregunta.correctas.map((i) => letra(i)).join(", ");
  const explicacion = pregunta.explicacion
    ? `<p class="porque"><b>Por qué:</b> ${esc(pregunta.explicacion)}</p>`
    : "";

  app.querySelector("#zona-feedback").innerHTML = `
    <div class="feedback ${acierto ? "bien" : "mal"}">
      <strong>${acierto ? "¡Correcto!" : "Incorrecto"}</strong>
      <p>Respuesta correcta: <b>${solucion}</b> — ${esc(
        pregunta.correctas.map((i) => pregunta.opciones[i]).join(" · ")
      )}</p>
      ${explicacion}
    </div>`;

  const ultima = q.indice === q.preguntas.length - 1;
  const acciones = app.querySelector(".acciones");
  acciones.innerHTML = `
    <button class="btn" type="button" id="siguiente">${ultima ? "Ver resultados" : "Siguiente pregunta →"}</button>`;

  const siguiente = acciones.querySelector("#siguiente");
  siguiente.addEventListener("click", () => {
    if (ultima) return vistaResultados();
    q.indice += 1;
    q.seleccion = [];
    q.comprobada = false;
    vistaQuiz();
  });
  siguiente.focus();
}

function salirDelModulo() {
  const q = estado.quiz;
  if (intentoVivo() && !confirm("Si sales ahora perderás las respuestas de este intento. ¿Salir?")) return;
  estado.quiz = null;
  vistaInicio();
}

/* == vista: resultados ===================================================== */

function vistaResultados() {
  const q = estado.quiz;
  if (!q) return vistaInicio();

  const total = q.historial.length;
  const aciertos = q.historial.filter((h) => h.acierto).length;
  const porcentaje = total ? Math.round((aciertos / total) * 100) : 0;
  const aprobado = porcentaje >= q.modulo.notaMinima;
  q.terminado = true;

  guardarProgreso(q.modulo.id, { aciertos, total, porcentaje });

  const repaso = q.historial
    .map((h, i) => {
      const tuya = h.elegidas.length
        ? h.elegidas.map((x) => `${letra(x)}. ${esc(h.pregunta.opciones[x])}`).join("<br>")
        : "Sin responder";
      const buena = h.pregunta.correctas
        .map((x) => `${letra(x)}. ${esc(h.pregunta.opciones[x])}`)
        .join("<br>");
      const porque = h.pregunta.explicacion
        ? `<dt>Por qué</dt><dd>${esc(h.pregunta.explicacion)}</dd>`
        : "";

      return `
        <article class="repaso-item ${h.acierto ? "bien" : "mal"}">
          <h3>${i + 1}. ${esc(soloPregunta(h.pregunta.enunciado))}</h3>
          <dl>
            <dt>Tu respuesta</dt>
            <dd class="${h.acierto ? "ok" : "no"}">${tuya}</dd>
            ${h.acierto ? "" : `<dt>Respuesta correcta</dt><dd class="ok">${buena}</dd>`}
            ${porque}
          </dl>
        </article>`;
    })
    .join("");

  pintar(`
    <section class="panel">
      <div class="marcador">
        <div class="nota" id="nota"><span>${porcentaje}%</span></div>
        <div class="marcador-txt">
          <h2>${aprobado ? "¡Módulo superado!" : "Sigue repasando"}</h2>
          <p>Has acertado <b>${aciertos}</b> de <b>${total}</b> preguntas de
             <b>${esc(q.modulo.titulo)}</b>. Mínimo para superarlo: ${q.modulo.notaMinima}%.</p>
        </div>
      </div>
      <div class="acciones">
        <button class="btn" type="button" id="repetir">Repetir módulo</button>
        <button class="btn fantasma" type="button" data-ir="inicio">Volver a los módulos</button>
      </div>
    </section>

    <h2 class="titulo-seccion">Repaso de las respuestas</h2>
    <div class="repaso">${repaso}</div>`);

  app.querySelector("#nota").style.setProperty("--pct", porcentaje);
  app.querySelector("#repetir").addEventListener("click", () => empezarModulo(q.modulo.id));
}

/* == vista: subir modulos ================================================== */

const PLANTILLA = {
  id: "mi-modulo-1",
  modulo: 1,
  titulo: "Título del módulo",
  descripcion: "Una línea describiendo qué se repasa aquí.",
  barajarPreguntas: false,
  barajarOpciones: false,
  preguntas: [
    {
      pregunta: "¿Pregunta de una sola respuesta?",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      correcta: "B",
      explicacion: "Aquí explicas por qué B es la correcta (este campo es opcional).",
    },
    {
      pregunta: "¿Pregunta con varias respuestas correctas?",
      opciones: ["Opción A", "Opción B", "Opción C", "Opción D"],
      correcta: ["A", "C"],
    },
  ],
};

function vistaSubir() {
  if (!sePuedeSubir()) return vistaInicio();
  estado.quiz = null;

  pintar(`
    <button class="volver" type="button" data-ir="inicio">← Volver a los módulos</button>
    <h1 class="titulo-menor">Añadir un módulo</h1>
    <p class="subtitulo">
      Pega o suelta un archivo JSON para probarlo aquí mismo. Se guarda solo en este navegador.
      Para que lo vea todo el mundo, copia el archivo en la carpeta <code>modules/</code> y añádelo a
      <code>modules/index.json</code>.
    </p>

    <div class="suelta" id="suelta">
      <p>Arrastra aquí un archivo <b>.json</b> o selecciónalo</p>
      <input type="file" id="archivo" accept=".json,application/json" class="solo-lector" />
      <button class="btn" type="button" id="elegir">Elegir archivo</button>
      <button class="btn fantasma" type="button" id="plantilla">Descargar plantilla</button>
    </div>

    <label for="json" class="ayuda"><b>Contenido del módulo</b></label>
    <textarea class="json" id="json" spellcheck="false"
      placeholder="Pega aquí el JSON del módulo...">${esc(JSON.stringify(PLANTILLA, null, 2))}</textarea>

    <div id="resultado-validacion"></div>

    <div class="acciones separado">
      <button class="btn fantasma" type="button" id="validar">Validar</button>
      <button class="btn" type="button" id="anadir">Añadir a este navegador</button>
    </div>

    <h2 class="titulo-seccion pequeno">Formato</h2>
    <p class="ayuda">
      Campos obligatorios: <code>titulo</code>, <code>preguntas</code>, y en cada pregunta
      <code>pregunta</code>, <code>opciones</code> y <code>correcta</code>.
      <code>explicacion</code> es opcional. Para varias respuestas correctas usa una lista:
      <code>"correcta": ["A", "C"]</code>. También valen el texto exacto de la opción y los
      sinónimos en inglés (<code>question</code>, <code>options</code>, <code>answer</code>,
      <code>explanation</code>).
    </p>

    <div id="lista-locales"></div>`);

  const caja = app.querySelector("#json");
  const zona = app.querySelector("#suelta");
  const archivo = app.querySelector("#archivo");

  const validar = () => {
    const salida = app.querySelector("#resultado-validacion");
    let bruto;
    try {
      bruto = JSON.parse(caja.value);
    } catch (e) {
      salida.innerHTML = `<ul class="lista-errores"><li>JSON mal formado: ${esc(e.message)}</li></ul>`;
      return null;
    }
    const { ok, modulo, errores } = normalizarModulo(bruto);
    if (!ok) {
      salida.innerHTML = `<ul class="lista-errores">${errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`;
      return null;
    }
    const conExplicacion = modulo.preguntas.filter((p) => p.explicacion).length;
    salida.innerHTML = `<div class="exito">
      <b>Todo correcto.</b> ${esc(modulo.titulo)} · ${plural(modulo.preguntas.length, "pregunta", "preguntas")}
      (${conExplicacion} con explicación).</div>`;
    return { bruto, modulo };
  };

  const cargarArchivo = (file) => {
    if (!file) return;
    const lector = new FileReader();
    lector.onload = () => {
      caja.value = String(lector.result);
      validar();
    };
    lector.readAsText(file);
  };

  app.querySelector("#elegir").addEventListener("click", () => archivo.click());
  archivo.addEventListener("change", () => cargarArchivo(archivo.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    zona.addEventListener(ev, (e) => {
      e.preventDefault();
      zona.classList.add("encima");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    zona.addEventListener(ev, (e) => {
      e.preventDefault();
      zona.classList.remove("encima");
    })
  );
  zona.addEventListener("drop", (e) => cargarArchivo(e.dataTransfer?.files?.[0]));

  app.querySelector("#plantilla").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(PLANTILLA, null, 2)], { type: "application/json" });
    const enlace = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: "modulo-plantilla.json",
    });
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  });

  app.querySelector("#validar").addEventListener("click", validar);

  app.querySelector("#anadir").addEventListener("click", async () => {
    const valido = validar();
    if (!valido) return;
    guardarLocal(valido.bruto, valido.modulo.id);
    await recargarCatalogo();
    vistaSubir();
    app.querySelector("#resultado-validacion").innerHTML =
      `<div class="exito"><b>Módulo añadido.</b> Ya aparece en la lista de módulos de este navegador.</div>`;
  });

  pintarLocales();
}

function pintarLocales() {
  const zona = app.querySelector("#lista-locales");
  if (!zona) return;
  const locales = leerLocales();
  if (!locales.length) {
    zona.innerHTML = "";
    return;
  }
  zona.innerHTML = `
    <h2 class="titulo-seccion pequeno">Módulos de este navegador</h2>
    <div class="tabla-locales">
      ${locales
        .map(
          (m) => `<div class="fila-local">
            <span class="nombre"><b>${esc(m.titulo)}</b> · ${plural(m.preguntas.length, "pregunta", "preguntas")}</span>
            <button class="btn fantasma pequeno" type="button" data-borrar="${esc(m.id)}">Quitar</button>
          </div>`
        )
        .join("")}
    </div>`;

  zona.querySelectorAll("[data-borrar]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      borrarLocal(btn.dataset.borrar);
      await recargarCatalogo();
      vistaSubir();
    })
  );
}

/* == arranque ============================================================== */

async function recargarCatalogo() {
  const { config, modulos, errores } = await cargarCatalogo();
  estado.config = config;
  estado.modulos = modulos;
  estado.errores = errores;
  document.title = config.marca || "Ruta de estudio";
}

// Navegacion global (marca, "volver", "añadir modulo")
document.addEventListener("click", (e) => {
  const destino = e.target.closest("[data-ir]")?.dataset.ir;
  if (!destino) return;
  if (intentoVivo()) {
    if (!confirm("Si sales ahora perderás las respuestas de este intento. ¿Salir?")) return;
    estado.quiz = null;
  }
  if (destino === "inicio") vistaInicio();
  if (destino === "subir") vistaSubir();
});

// El boton "atras" del navegador no debe devolver a una pregunta ya contestada.
window.addEventListener("popstate", () => {
  if (intentoVivo()) {
    if (!confirm("Si sales ahora perderás las respuestas de este intento. ¿Salir?")) {
      history.pushState({ vista: "quiz" }, "");
      return;
    }
  }
  estado.quiz = null;
  vistaInicio();
});

(async function iniciar() {
  estado.usuario = await sesion();
  await recargarCatalogo();
  pintarBarra();
  vistaInicio();
})();
