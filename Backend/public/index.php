<?php
/**
 * GameHub_2.0 Backend - main entry point (public/index.php)
 *
 * Purpose in plain words:
 * Every API call from the Frontend goes through THIS file first.
 * Think of it as the front door of a building. Example: when the
 * Frontend asks for "http://localhost:8000/api/health", this file
 * receives it, checks the guest list (routes/api.php), and sends
 * it to the right room (a Controller like HealthController).
 *
 * What it does step by step:
 * 1. Loads libraries (vendor/autoload.php) and helpers.
 * 2. Reads secrets from .env (like your Atlas password).
 * 3. Allows the Frontend to call it (CORS header).
 * 4. Looks at the URL and method, e.g. GET + /api/health.
 * 5. Calls the matching Controller, returns JSON.
 * 6. Returns {"ok":false,"error":"Not found"} if no route matches.
 */
declare(strict_types=1);

// Purpose: single entry point. Loads .env, enables CORS for Frontend, routes requests.

require __DIR__ . '/../vendor/autoload.php';
require __DIR__ . '/../src/Helpers/response.php';
require __DIR__ . '/../src/Helpers/request.php';
require __DIR__ . '/../src/Helpers/auth.php';

use Dotenv\Dotenv;

// Sessions: login stores the user in $_SESSION, later requests read it back.
// Must start before any output. Cookie is Lax (fine when Frontend and Backend
// are both on localhost — open the Frontend via http://localhost:PORT, see .env).
session_start();

// Load .env from Backend/
$dotenv = Dotenv::createImmutable(__DIR__ . '/..');
$dotenv->safeLoad();

$frontendUrl = $_ENV['FRONTEND_URL'] ?? 'http://localhost:5500';
header('Access-Control-Allow-Origin: ' . $frontendUrl);
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Normalize path (works for php -S and Apache)
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Root info
if ($uri === '/' && $method === 'GET') {
    json_response([
        'ok' => true,
        'service' => 'GameHub_2.0 Backend (PHP)',
        'db' => $_ENV['MONGODB_DB'] ?? 'gamehub_2_0',
        'endpoints' => ['GET /api/health', 'POST /api/login', 'GET /api/me'],
    ]);
}

$routes = require __DIR__ . '/../routes/api.php';
foreach ($routes as [$routeMethod, $routePath, $handler]) {
    if ($method !== $routeMethod) {
        continue;
    }
    // Routes may contain {id} placeholders, e.g. /api/admin/cashiers/{id}.
    // Turn them into a pattern and capture the values to pass to the handler.
    $pattern = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', $routePath) . '$#';
    if (preg_match($pattern, $uri, $m)) {
        $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
        try {
            $data = call_user_func($handler, $params);
            json_response($data);
        } catch (Throwable $e) {
            // Database outages must never leak topology (hostnames) or driver
            // internals to the Frontend. Log the detail, answer generically.
            if ($e instanceof \MongoDB\Driver\Exception\Exception) {
                error_log('[gamehub] db error: ' . $e->getMessage());
                json_response(['ok' => false, 'error' => 'database unavailable, try again later'], 503);
            }
            $code = $e->getCode();
            if (!in_array($code, [400, 401, 403, 404, 409, 410, 422, 502, 503], true)) {
                $code = 500;
            }
            json_response(['ok' => false, 'error' => $e->getMessage()], $code);
        }
    }
}

json_response(['ok' => false, 'error' => 'Not found', 'path' => $uri], 404);
