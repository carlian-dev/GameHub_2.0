// Cookie-jar contract helper.
// Logs in as admin or cashier and returns a supertest agent that reuses the
// session cookie across requests. Mirrors migration.md §16 "Cookie-jar helper".
// No secrets are logged.
import { Agent } from "supertest";

const COOKIE_NAME = "gh_session";

/** Build a logged-in supertest agent against the Express app. */
export async function loginAs(app, { role, email, username, password }) {
  const agent = new Agent(app);
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

/** Extract the session cookie value from a supertest response/agent jar. */
export function sessionCookie(res) {
  const setCookie = res.headers["set-cookie"] || [];
  for (const c of setCookie) {
    if (c.startsWith(`${COOKIE_NAME}=`)) {
      return c.split(";")[0];
    }
  }
  return null;
}

/** Attach an existing session cookie to a supertest agent. */
export function withCookie(app, cookie) {
  const agent = new Agent(app);
  agent.jar.setCookie(cookie, "http://localhost");
  return agent;
}
