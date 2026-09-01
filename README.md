# Ruta de estudio — repaso por módulos

Aplicación web para repasar temas con preguntas de opción múltiple.
Cada módulo es independiente: eliges uno, respondes pregunta a pregunta, ves si has
acertado y por qué, y **no se puede volver atrás** una vez enviada la respuesta.

Incluye el banco AWS completo: **12 módulos y 127 preguntas** convertidas desde
`PREGUNTAS AWS PRACTICA.docx` (110 de ellas con explicación).

- Sin framework, sin build, sin base de datos: HTML + CSS + JavaScript estático.
- Responsivo (móvil, tablet y escritorio).
- Se puede servir como carpeta o como **un único archivo** (`repasar.html`).

```
index.html                     página principal
assets/css/estilos.css         diseño
assets/js/app.js               vistas: catálogo, cuestionario, resultados
assets/js/formato.js           lectura y validación del JSON de módulos
assets/js/datos.js             carga del catálogo y progreso local
assets/js/auth.js              sesión de Microsoft 365
modules/index.json             catálogo: título de la portada y lista de módulos
modules/*.json                 un archivo por módulo
modules/_PLANTILLA.json        plantilla para copiar
herramientas/word_a_modulos.py convierte el banco de Word en módulos JSON
herramientas/empaquetar.py     genera repasar.html (todo en un solo archivo)
repasar.html                   la app entera en un archivo (generado)
staticwebapp.config.json       exige iniciar sesión (solo en Azure Static Web Apps)
```

---

## 1. Añadir preguntas

### Desde el Word (banco existente)

```bash
python herramientas/word_a_modulos.py "C:/ruta/PREGUNTAS AWS PRACTICA.docx" --modulos 12
```

Regenera `modules/*.json` y actualiza `modules/index.json`. El conversor espera:

| En el Word | Se convierte en |
|---|---|
| Título del módulo **resaltado** | Un módulo nuevo |
| Párrafo con `?` | La pregunta (los párrafos anteriores, su enunciado) |
| Párrafos siguientes | Las opciones A, B, C… |
| Opción escrita en **verde** | La respuesta correcta (varias verdes = varias correctas) |
| Párrafo `RTA: …` | La explicación (opcional) |
| Párrafo `RTA NO: …` | Se añade como «Por qué no: …» |
| Tablas de Word | Se ignoran (son los glosarios de recursos) |

Al terminar avisa de dos cosas: las respuestas que ha **deducido** del texto de la
RTA (conviene revisarlas) y las preguntas que ha **omitido** por no tener ninguna
opción en verde. Para esas últimas hay dos salidas: marcarlas en verde en el Word,
o anotarlas en `herramientas/respuestas.json`, que es donde están las cuatro que el
documento actual no marcaba. Los títulos y descripciones de cada módulo se editan
en `herramientas/modulos.json`, no en los JSON generados (se sobrescriben).

### A mano

Copia `modules/_PLANTILLA.json`, escribe las preguntas y añade el nombre del
archivo a la lista `modulos` de `modules/index.json`:

```json
{
  "titulo": "Introducción a la nube",
  "descripcion": "Infraestructura global y responsabilidad compartida.",
  "preguntas": [
    {
      "pregunta": "¿Cuál es una ventaja de la nube?",
      "opciones": ["Gasto variable", "Cero seguridad", "Cero fallos", "Menos código"],
      "correcta": "A",
      "explicacion": "Se paga por consumo en lugar de comprar servidores por adelantado."
    },
    {
      "pregunta": "Selecciona las responsabilidades del cliente.",
      "opciones": ["Permisos IAM", "Grupos de seguridad", "Centros de datos", "Discos físicos"],
      "correcta": ["A", "B"]
    }
  ]
}
```

| Campo | Obligatorio | Qué es |
|---|---|---|
| `pregunta` | sí | Enunciado. Si lleva varios párrafos (`\n\n`), los primeros se muestran como contexto. |
| `opciones` | sí | Lista de textos. Se numeran A, B, C… en ese orden. |
| `correcta` | sí | `"A"`, una lista `["A", "C"]`, o el texto exacto de la opción. |
| `explicacion` | **no** | Por qué es correcta. Si falta, solo se indica acierto o fallo. |
| `tipo` | no | `"multiple"` para forzar casillas aunque solo haya una correcta. |

Del módulo, solo `titulo` y `preguntas` son obligatorios; `id`, `modulo`,
`descripcion`, `notaMinima` (70 por defecto), `barajarPreguntas` y
`barajarOpciones` son opcionales. También se aceptan los nombres en inglés
(`title`, `questions`, `question`, `options`, `answer`, `explanation`).

> La pantalla **Añadir un módulo** de la propia app valida el JSON, señala los
> errores uno a uno y te deja probar el módulo sin publicarlo.

### Quién puede añadir módulos

El catálogo publicado lo decide **quien mantiene el repositorio**: cambiarlo exige
un commit. La pantalla de añadir módulos ni siquiera aparece en el sitio publicado.

Lo controla `permitirSubida` en `modules/index.json`:

| Valor | Efecto |
|---|---|
| `"local"` (por defecto) | Solo al abrir la app desde tu equipo (`localhost`) o el archivo suelto (`file://`) |
| `false` | Nunca |
| `true` | Siempre, también en el sitio publicado |

Quien quiera estudiar con sus propias preguntas descarga `repasar.html`, lo abre
con doble clic y ahí sí puede añadir sus módulos. Se guardan únicamente en su
navegador: no tocan el sitio ni lo que ven los demás.

---

## 2. Probar en local

Hace falta un servidor HTTP porque el navegador bloquea la lectura de los JSON al
abrir `index.html` con doble clic:

```bash
npx serve .
```

Y abre `http://localhost:3000`. En local no hay inicio de sesión: la barra superior
muestra «Modo local».

(La versión de un solo archivo, `repasar.html`, **sí** funciona con doble clic.)

---

## 3. Publicarlo

Cuatro caminos, todos sin coste. De más sencillo a más controlado:

| Opción | Coste | Quién entra | Esfuerzo |
|---|---|---|---|
| **A. GitHub Pages** | 0 € | Cualquiera con el enlace | 2 clics |
| **B. Un solo archivo por Teams/OneDrive** | 0 € | Quien reciba el archivo | Copiar un archivo |
| **C. SharePoint** | 0 € (ya lo pagas) | Cuentas de tu organización | Requiere permisos de administrador |
| **D. Azure Static Web Apps** | 0 € (plan Free) | Cualquier cuenta Microsoft 365 | Crear el recurso una vez |

### A. GitHub Pages — la más rápida

1. Sube el repositorio a GitHub.
2. **Settings → Pages → Source: Deploy from a branch →** rama `main`, carpeta `/`.
3. En un minuto tienes `https://<usuario>.github.io/<repo>/`.

Cada `git push` republica. El sitio es **público**: cualquiera con el enlace entra,
no hay inicio de sesión. Para un temario de estudio suele bastar.

### B. Un solo archivo

```bash
python herramientas/empaquetar.py
```

Genera `repasar.html` (~160 KB) con el diseño, el código y las 127 preguntas
dentro. Se puede subir a Teams o a OneDrive y compartirlo: quien lo descargue lo
abre con doble clic y funciona **sin conexión y sin servidor**. Es también el
archivo que usa la opción C.

> `repasar.html` está versionado, pero **no se regenera solo**: después de tocar
> las preguntas hay que volver a ejecutar `empaquetar.py` antes del commit, o el
> archivo quedará desfasado respecto a `modules/`.

### C. SharePoint — sin salir de Microsoft 365

Ventaja: SharePoint ya exige iniciar sesión con la cuenta de la organización, así
que el control de acceso sale gratis. Inconveniente: SharePoint **no muestra**
archivos HTML por defecto, los descarga, y para cambiarlo hace falta administrador.

1. Genera el archivo único y renómbralo a `.aspx`:
   ```bash
   python herramientas/empaquetar.py --salida repasar.aspx
   ```
2. Un administrador debe permitir scripts personalizados en ese sitio:
   - En el centro de administración de Microsoft 365, la directiva de *Baseline
     Security Mode* **«No permitir nuevos scripts personalizados en sitios de
     SharePoint»** tiene que estar desactivada. Si sigue activa, el permiso del
     paso siguiente **se revierte solo en 24 horas** y la página vuelve a
     descargarse en vez de abrirse.
   - Después, sobre el sitio concreto:
     ```powershell
     Set-SPOSite -Identity https://TUORG.sharepoint.com/sites/TUSITIO -DenyAddAndCustomizePages $false
     ```
3. Sube `repasar.aspx` a una biblioteca de documentos y comparte su enlace directo.

Si tu organización no quiere tocar esa directiva —es una decisión de seguridad
razonable—, usa la opción B (compartir el archivo) o la D.

### D. Azure Static Web Apps — inicio de sesión con Microsoft 365

Es la única de las cuatro que exige identificarse **y** deja el sitio en una URL
normal. El plan Free cuesta 0 € y el proveedor de Entra ID viene incorporado: no
hay que registrar ninguna aplicación ni guardar secretos, porque
`staticwebapp.config.json` ya obliga a iniciar sesión.

1. Sube el repositorio a GitHub.
2. Portal de Azure → **Crear recurso** → **Static Web App**.
3. **Plan**: Free · **Origen**: GitHub, tu repo y tu rama · **Build presets**:
   Custom · **App location**: `/` · **Api location** y **Output location**: vacíos.
4. Azure crea el workflow y publica en un par de minutos. Comparte la URL
   `https://<nombre>.azurestaticapps.net`.

Requiere una suscripción de Azure (crearla es gratuita; el plan Free no genera
cargos). Para limitar el acceso solo a tu organización, registra una aplicación en
Entra ID y añade a `staticwebapp.config.json`:

```json
"auth": {
  "identityProviders": {
    "azureActiveDirectory": {
      "registration": {
        "openIdIssuer": "https://login.microsoftonline.com/<TENANT_ID>/v2.0",
        "clientIdSettingName": "AAD_CLIENT_ID",
        "clientSecretSettingName": "AAD_CLIENT_SECRET"
      }
    }
  }
}
```

### Ponerlo dentro de Microsoft 365

Con cualquier opción que dé una URL:

- **Teams**: en un canal, `+` → **Sitio web** → pega la URL → queda como pestaña.
- **SharePoint**: elemento web *Enlace rápido* o *Insertar* apuntando a la URL.
- **Outlook o chat**: basta con enviar el enlace.

---

## 4. Seguridad

Decisiones tomadas, por si hay que revisarlas más adelante:

- **Sin dependencias externas.** Ni CDN, ni tipografías de Google, ni analítica:
  todo el código y los datos salen del propio repositorio. No hay terceros a los
  que confiar ni que puedan cambiar el contenido servido.
- **Content-Security-Policy** declarada en el HTML: `default-src 'none'` y solo se
  permite lo estrictamente necesario. En el sitio, el código va en archivos y
  basta `'self'`; en `repasar.html`, como va en línea, `empaquetar.py` calcula el
  **hash SHA-256** de cada bloque en vez de recurrir a `'unsafe-inline'`.
  Por eso no hay ni un `style="..."` en el código: los valores dinámicos se
  aplican por CSSOM, que la CSP sí permite.
- **Todo el texto de las preguntas se escapa** antes de insertarlo en el DOM
  (`esc()` en `app.js`), así que un módulo con HTML dentro se muestra como texto,
  no se ejecuta.
- **El contenido es de solo lectura para quien visita.** No hay servidor, ni base
  de datos, ni formularios que envíen nada: cambiar el catálogo exige acceso de
  escritura al repositorio.
- **No se recoge ningún dato.** Lo único que se guarda es la mejor nota por
  módulo, en el `localStorage` del propio navegador. No se envía a ninguna parte.
- **Lo que no se puede hacer en GitHub Pages:** fijar cabeceras HTTP. Pages no
  permite `X-Frame-Options` ni `frame-ancestors`, así que la página podría
  embeberse en un iframe ajeno. Es asumible porque no hay sesión, credenciales ni
  datos personales que robar mediante clickjacking, y además es lo que permite
  usarla como pestaña de Teams. Con Azure Static Web Apps sí podrían fijarse esas
  cabeceras en `staticwebapp.config.json`.

## 5. Cómo se comporta

- Al enviar una respuesta se bloquean las opciones y se muestra el resultado. El
  botón «Atrás» del navegador tampoco devuelve a la pregunta anterior: pide
  confirmación y sale del módulo.
- En las preguntas de varias respuestas **hay que marcar todas las correctas**:
  no hay acierto parcial. El botón de comprobar solo se activa cuando el número de
  opciones marcadas coincide con el de respuestas correctas, y la app lo recuerda
  debajo («Marcadas 1 de 2»).
- Al terminar se ve la nota, el repaso completo de las respuestas y las
  explicaciones.
- El progreso (mejor nota por módulo) se guarda en el navegador de cada persona,
  en `localStorage`. No se envía a ningún servidor ni se comparte entre dispositivos.
- Los módulos añadidos desde **Añadir un módulo** solo existen en ese navegador;
  para publicarlos hay que subirlos a `modules/`.
