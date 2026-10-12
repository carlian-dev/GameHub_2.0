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
 *   ['POST', '/api/login', 'auth_login'],   // handled in src/function/auth/login.php
 */
declare(strict_types=1);

// Route map: METHOD + PATH => handler function in Backend/src/function/.
// Purpose: keeps public/index.php thin, all API routes listed here.
// Each pair: Frontend/src/function/<page> talks to Backend/src/function/<logic>.
require_once __DIR__ . '/../src/function/shared/health.php';
require_once __DIR__ . '/../src/function/auth/register.php';
require_once __DIR__ . '/../src/function/auth/login.php';
require_once __DIR__ . '/../src/function/admin/cashiers.php';
require_once __DIR__ . '/../src/function/auth/google.php';
require_once __DIR__ . '/../src/function/auth/invite.php';
require_once __DIR__ . '/../src/function/tables/tables.php';
require_once __DIR__ . '/../src/function/tables/rates.php';
// Teammate slots (B/C/D re-add with their files):
// B: require tables/rates.php + GET/PUT /api/admin/rates
// C: require tables/sessions.php + /api/admin/sessions + /api/cashier/sessions*
// D: require cashiers/tables.php + GET /api/cashier/tables

return [
    ['GET', '/api/health', 'health_handle'],
    ['GET', '/api/config', 'app_config'],
    // Sprint by Carl: auth (JAM builds, PJ reuses for admin).
    // Cashier registration is invitation-only (admin invites by email).
    ['POST', '/api/cashiers/register', 'auth_register'],
    ['GET', '/api/invitations/{token}', 'invite_check'],
    ['POST', '/api/login', 'auth_login'],
    ['POST', '/api/auth/google', 'google_login'],
    ['POST', '/api/logout', 'auth_logout'],
    ['GET', '/api/me', 'auth_me'],
    // Cashier management (lists/updates/archives). Invite link IS the
    // approval — no applicants approve/decline step.
    // Cashier invitations (admin-only).
    ['POST', '/api/admin/invitations', 'invite_create'],
    ['GET', '/api/admin/invitations', 'invite_list'],
    ['POST', '/api/admin/invitations/{id}/revoke', 'invite_revoke'],
    // Sprint by Carl: cashier management (lists/updates/archives).
    ['GET', '/api/admin/cashiers', 'cashiers_list'],
    ['PUT', '/api/admin/cashiers/{id}', 'cashiers_update'],
    ['POST', '/api/admin/cashiers/{id}/archive', 'cashiers_archive'],
    ['POST', '/api/admin/cashiers/{id}/unarchive', 'cashiers_unarchive'],
    // Sprint 02: tables (AD-008..AD-013) + rates (AD-016/017) + sessions view (AD-014).
    ['GET', '/api/admin/tables', 'tables_list'],
    ['POST', '/api/admin/tables', 'tables_add'],
    ['PUT', '/api/admin/tables/{id}', 'tables_rename'],
    ['PUT', '/api/admin/tables/{id}/status', 'tables_status'],
    ['POST', '/api/admin/tables/{id}/archive', 'tables_archive'],
    ['POST', '/api/admin/tables/{id}/unarchive', 'tables_unarchive'],
    ['GET', '/api/admin/rates', 'rates_list'],
    ['PUT', '/api/admin/rates', 'rates_set'],
    // C owns: GET /api/admin/sessions + session lifecycle (CA-004..CA-014)
    // D owns: GET /api/cashier/tables (tables_cashier_list)
    // Public availability stays here (handler lives in tables/tables.php).
    ['GET', '/api/tables/availability', 'tables_public_list'],
];