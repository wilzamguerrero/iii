/**
 * Alta por dispositivo de GitHub, para usar Copilot con la cuenta de la persona.
 *
 * `POST /api/github-device` con `{step:"code"}` pide un código; con
 * `{step:"token", device_code}` pregunta si ya se autorizó. Es el flujo que usan
 * las herramientas de línea de órdenes: aparece un código de ocho caracteres, la
 * persona lo escribe en github.com/login/device y aquí se recoge el token.
 *
 * Se hace por el servidor porque el endpoint de GitHub no manda cabeceras CORS.
 *
 * El `client_id` lo pone el servidor y no el cuerpo de la petición, al contrario
 * que en `reference/`: aceptarlo del navegador convertía este endpoint en un relé
 * al alta de dispositivos de GitHub para cualquier aplicación ajena. El valor por
 * omisión es el `client_id` público de Copilot —el mismo que usan opencode y la
 * CLI de Copilot—; es público por diseño, no es un secreto, y quien despliegue
 * con su propia aplicación puede cambiarlo con `GITHUB_CLIENT_ID`.
 */

import type { ApiHandler } from "./_types.ts";
import { describe, noStore } from "./_ai.ts";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** El `client_id` público de Copilot. Ver el comentario de cabecera. */
const DEFAULT_CLIENT_ID = "Ov23li8tweQw6odWQebz";
const SCOPE = "read:user";

/** Los códigos de GitHub son cortos y opacos; esto descarta un cuerpo absurdo. */
const DEVICE_CODE = /^[A-Za-z0-9._-]{8,200}$/;

async function relay(url: string, body: unknown): Promise<{ status: number; text: string }> {
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: upstream.status, text: await upstream.text() };
}

const handler: ApiHandler = async (req, res) => {
  noStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed", message: "Usa POST." });
    return;
  }

  const body = (req.body ?? {}) as { step?: unknown; device_code?: unknown };
  const clientId = process.env.GITHUB_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;

  try {
    if (body.step === "code") {
      const { status, text } = await relay(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });
      res.status(status);
      res.setHeader("Content-Type", "application/json");
      res.send(text);
      return;
    }

    if (body.step === "token") {
      const deviceCode = typeof body.device_code === "string" ? body.device_code.trim() : "";
      if (!DEVICE_CODE.test(deviceCode)) {
        res.status(400).json({ error: "bad_device_code", message: "Falta el código del dispositivo." });
        return;
      }
      const { status, text } = await relay(ACCESS_TOKEN_URL, {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: GRANT_TYPE,
      });
      // GitHub contesta 200 con `{"error":"authorization_pending"}` mientras la
      // persona no ha terminado. El cliente distingue; aquí se pasa tal cual.
      res.status(status);
      res.setHeader("Content-Type", "application/json");
      res.send(text);
      return;
    }

    res.status(400).json({ error: "bad_step", message: "El paso debe ser «code» o «token»." });
  } catch (error) {
    console.error("[github-device]", describe(error));
    res.status(502).json({ error: "github_unreachable", message: describe(error) });
  }
};

export default handler;
