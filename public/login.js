"use strict";

const form = document.querySelector("#login-form");
const passwordInput = document.querySelector("#password");
const error = document.querySelector("#login-error");

async function readResponse(response) {
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    if (response.status === 404) {
      throw new Error("Esta dirección está sirviendo solo los archivos estáticos, sin el servidor de la aplicación. Inicie Flask con PostgreSQL y abra su dirección.");
    }
    throw new Error("El servidor devolvió una respuesta no válida.");
  }
  if (!response.ok) {
    throw new Error(result.error || "No se pudo completar la solicitud.");
  }
  return result;
}

async function checkSession() {
  const session = await readResponse(await fetch("/api/session"));
  if (session.authenticated) window.location.replace("/");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    await readResponse(response);
    window.location.replace("/");
  } catch (loginError) {
    error.textContent = loginError.message;
    error.hidden = false;
    passwordInput.focus();
  } finally {
    submitButton.disabled = false;
  }
});

checkSession().catch((sessionError) => {
  error.textContent = sessionError.message;
  error.hidden = false;
});
