<?php
/**
 * routes/api.php - the guest list / menu of your API.
 *
 * Purpose in plain words:
 * This file lists every URL your Backend understands.
 * public/index.php reads this list to decide where to send
 * each request. To add a new feature, you add one line here.
 *
 * Format per line: [HTTP_METHOD, URL_PATH, handlerFunctionName]
 * Example - add user login later:
 *   ['POST', '/api/login', 'auth_login'],   // handled in function/login.php
 */
declare(strict_types=1);

// Route map: METHOD + PATH => handler function in Backend/function/.
// Purpose: keeps public/index.php thin, all API routes listed here.
// Each pair: Frontend/function/<page> talks to Backend/function/<logic>.
require_once __DIR__ . '/../function/health.php';
require_once __DIR__ . '/../function/register.php';
require_once __DIR__ . '/../function/login.php';
require_once __DIR__ . '/../function/cashiers.php';

return [
    ['GET', '/api/health', 'health_handle'],
    // Sprint by Carl: auth (JAM builds, PJ reuses for admin).
    ['POST', '/api/cashiers/register', 'auth_register'],
    ['POST', '/api/login', 'auth_login'],
    ['POST', '/api/logout', 'auth_logout'],
    ['GET', '/api/me', 'auth_me'],
    // Sprint by Carl: cashier management (PJ lists/approves, JAZ updates/archives).
    ['GET', '/api/admin/cashiers', 'cashiers_list'],
    ['POST', '/api/admin/cashiers/{id}/approve', 'cashiers_approve'],
    ['PUT', '/api/admin/cashiers/{id}', 'cashiers_update'],
    ['POST', '/api/admin/cashiers/{id}/archive', 'cashiers_archive'],
];
