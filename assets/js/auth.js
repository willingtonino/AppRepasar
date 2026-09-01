/**
 * auth.js
 * Identidad de Microsoft 365 usando la autenticacion incorporada de
 * Azure Static Web Apps: no hace falta registrar una app ni guardar secretos.
 *
 *   /.auth/me                -> quien ha iniciado sesion
 *   /.auth/login/aad         -> iniciar sesion con la cuenta Microsoft
 *   /.auth/logout            -> cerrar sesion
 *
 * staticwebapp.config.json ya obliga a iniciar sesion antes de servir la
 * pagina; esto solo sirve para pintar el nombre y el boton de salir.
 * Fuera de Static Web Apps (por ejemplo en local) se entra en "modo local".
 */

const RUTA_ME = "/.auth/me";

export const URL_LOGIN = (destino = location.pathname) =>
  `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(destino)}`;

export const URL_LOGOUT = (destino = "/") =>
  `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(destino)}`;

function iniciales(nombre) {
  const partes = String(nombre || "?")
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letras = (partes[0]?.[0] ?? "?") + (partes[1]?.[0] ?? "");
  return letras.toUpperCase();
}

/**
 * @returns {Promise<{estado: 'dentro'|'fuera'|'local', nombre: string, iniciales: string, id: string}>}
 */
export async function sesion() {
  try {
    const respuesta = await fetch(RUTA_ME, { headers: { accept: "application/json" } });
    if (!respuesta.ok) return { estado: "local", nombre: "Modo local", iniciales: "··", id: "local" };

    const tipo = respuesta.headers.get("content-type") || "";
    if (!tipo.includes("json")) return { estado: "local", nombre: "Modo local", iniciales: "··", id: "local" };

    const datos = await respuesta.json();
    const principal = datos?.clientPrincipal;
    if (!principal) return { estado: "fuera", nombre: "", iniciales: "?", id: "" };

    const nombre =
      principal.claims?.find((c) => /(^|\/)name$/.test(c.typ))?.val ||
      principal.userDetails ||
      "Cuenta Microsoft";

    return { estado: "dentro", nombre, iniciales: iniciales(nombre), id: principal.userId || nombre };
  } catch {
    // Sin backend de autenticacion (file://, servidor estatico simple, etc.)
    return { estado: "local", nombre: "Modo local", iniciales: "··", id: "local" };
  }
}
