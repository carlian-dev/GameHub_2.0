// Google Gemini AI diagnostic — verifies the GEMINI_API_KEY value.
// Queries the Google Gemini models endpoint: https://generativelanguage.googleapis.com/v1beta/models
// Run from server/: `npm run check:gemini`.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serverRoot, ".env") });

import { env } from "../src/config/env.js";
import { geminiService } from "../src/services/gemini.service.js";

async function main() {
  const apiKey = (env.GEMINI_API_KEY_OVERRIDE || env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    console.error("[checkGemini] disabled — missing GEMINI_API_KEY (or GEMINI_API_KEY_OVERRIDE).");
    console.error("[checkGemini] Fix: set GEMINI_API_KEY in server/.env or configure it via Admin Settings > API Integrations.");
    process.exitCode = 1;
    return;
  }

  const masked = apiKey.length > 8 ? `••••••••${apiKey.slice(-4)}` : "••••••••";
  console.log(`[checkGemini] testing Gemini API key: ${masked}`);

  const svc = geminiService();
  try {
    const res = await svc.testConnection(apiKey);
    console.log(`[checkGemini] OK — Google Gemini AI API key is valid and working.`);
    console.log(`[checkGemini] Available models found: ${res.modelsCount}`);
  } catch (err) {
    console.error(`[checkGemini] verification failed: ${err && err.message ? err.message : String(err)}`);
    if (err && err.status === 422) {
      console.error("[checkGemini] Fix: Check that the Gemini API key was copied correctly from Google AI Studio (https://aistudio.google.com/app/apikey).");
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[checkGemini] unexpected error:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
