/**
 * El alta en free-pi desde el navegador, sin instalar su CLI.
 *
 * `POST /api/freepi-device` con un `step`:
 *
 * - `{"step":"start"}` pide el código de dispositivo a GitHub (vía free-pi) y
 *   devuelve el código corto, los enlaces, el intervalo y el texto del
 *   consentimiento que hay que aceptar.
 * - `{"step":"consent","session_id":"…"}` registra el consentimiento. Sin este
 *   paso el sondeo contesta `consent_required` para siempre.
 * - `{"step":"token","session_id":"…"}` pregunta si ya autorizó. Devuelve
 *   `{status:"pending"}` mientras no, y `{status:"token",token}` cuando sí.
 * - `{"step":"me","token":"…"}` dice qué cuenta hay detrás de ese token: el
 *   usuario de GitHub, su nivel y los créditos de hoy. Sirve para enseñar con
 *   quién estás conectado y para avisar de que el token caduca.
 *
 * Se hace por el servidor por dos motivos: el host de free-pi no manda cabeceras
 * CORS, y así el `x-client-version` y la forma del cuerpo quedan en un solo
 * sitio en vez de en el navegador de cada cual.
 *
 * Esto no es lo mismo que `api/github-device.ts`, que es el alta de GitHub
 * directa para Copilot. Aquí el flujo lo orquesta free-pi en su propio host y
 * entrega un JWT suyo, no un token de GitHub.
 */

import type { ApiHandler } from "./_types.ts";
import { describe, noStore } from "./_ai.ts";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  deviceConsent,
  devicePoll,
  deviceStart,
  freepiMe,
} from "./_freepi_device.ts";

const handler: ApiHandler = async (req, res) => {
  noStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed", message: "Usa POST." });
    return;
  }

  const body = (req.body ?? {}) as { step?: unknown; session_id?: unknown; token?: unknown };
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";

  try {
    if (body.step === "start") {
      const start = await deviceStart();
      res.status(200).json({
        ok: true,
        session_id: start.sessionId,
        user_code: start.userCode,
        verification_uri: start.verificationUri,
        verification_uri_complete: start.verificationUriComplete,
        interval: start.interval,
        expires_in: start.expiresIn,
        consent_text: CONSENT_TEXT,
        consent_version: CONSENT_VERSION,
      });
      return;
    }

    if (body.step === "consent") {
      if (!sessionId) {
        res.status(400).json({ error: "bad_session", message: "Falta session_id." });
        return;
      }
      await deviceConsent(sessionId);
      res.status(200).json({ ok: true, status: "consent" });
      return;
    }

    if (body.step === "token") {
      if (!sessionId) {
        res.status(400).json({ error: "bad_session", message: "Falta session_id." });
        return;
      }
      const result = await devicePoll(sessionId);
      if (result.kind === "token") {
        res.status(200).json({ ok: true, status: "token", token: result.token, days: result.days });
        return;
      }
      if (result.kind === "pending") {
        res.status(200).json({ ok: true, status: "pending", retry_after: result.retryAfter });
        return;
      }
      if (result.kind === "consent") {
        res.status(200).json({ ok: true, status: "consent", message: result.message });
        return;
      }
      if (result.kind === "expired") {
        res.status(200).json({ ok: true, status: "expired", message: result.message });
        return;
      }
      res.status(502).json({ ok: false, status: "error", message: result.message });
      return;
    }

    if (body.step === "me") {
      if (!token) {
        res.status(400).json({ error: "bad_token", message: "Falta el token." });
        return;
      }
      const me = await freepiMe(token);
      if (!me) {
        res.status(502).json({ error: "freepi_unreachable", message: "free-pi no dijo qué cuenta es." });
        return;
      }
      res.status(200).json({ ok: true, ...me });
      return;
    }

    res.status(400).json({
      error: "bad_step",
      message: "El paso debe ser «start», «consent», «token» o «me».",
    });
  } catch (error) {
    console.error("[freepi-device]", describe(error));
    res.status(502).json({ error: "freepi_unreachable", message: describe(error) });
  }
};

export default handler;