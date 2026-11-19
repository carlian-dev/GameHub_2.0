// Cookie-jar contract helper.
// Logs in as admin or cashier and returns a supertest agent that reuses the
// stateless JWT auth cookie across requests. No secrets are logged.
// supertest is CommonJS: the default export is the request function and
// `request.agent(app)` is the cookie-reusing agent (no named `Agent` export).
import request from "supertest";

// Stateless JWT cookie (see config/env.js AUTH_COOKIE_NAME).
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "gh_token";

/** Build a logged-in supertest agent against the Express app. */
export async function loginAs(app, { role, email, username, password }) {
  const agent = request.agent(app);
  const body = {};
  if (email !== undefined) body.email = email;
  if (username !== undefined) body.username = username;
  body.password = password;

  const res = await agent.post("/api/login").send(body);
  if (res.status !== 200 || !res.body.ok) {
    throw new Error(
      `contract login failed for ${role}: ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return agent;
}

/** Extract the auth cookie value from a supertest response/agent jar. */
export function sessionCookie(res) {
  const setCookie = res.headers["set-cookie"] || [];
  for (const c of setCookie) {
    if (c.startsWith(`${COOKIE_NAME}=`)) {
      return c.split(";")[0];
    }
  }
  return null;
}

/** Attach an existing auth cookie to a supertest agent. */
export function withCookie(app, cookie) {
  const agent = request.agent(app);
  agent.jar.setCookie(cookie, "http://localhost");
  return agent;
}
