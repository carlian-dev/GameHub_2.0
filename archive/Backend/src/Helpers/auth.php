<?php
/**
 * auth.php - who is logged in, and who is allowed to do what.
 *
 * Purpose in plain words: login stores the user in $_SESSION (a server-side
 * box the browser references with a cookie). Every later request carries that
 * cookie, so these helpers can answer "who is this?" without asking for the
 * password again.
 *
 * Use: current_user() returns the session user or null.
 * require_login() stops with 401 when nobody is logged in.
 * require_admin() stops with 401/403 unless an admin is logged in.
 * is_admin() is a quiet true/false check (used by pages, not APIs).
 */
declare(strict_types=1);

function current_user(): ?array
{
    $u = $_SESSION['user'] ?? null;
    return is_array($u) ? $u : null;
}

function require_login(): array
{
    $u = current_user();
    if ($u === null) {
        api_abort('not logged in', 401);
    }
    return $u;
}

function is_admin(): bool
{
    $u = current_user();
    return $u !== null && ($u['role'] ?? '') === 'admin';
}

function require_admin(): array
{
    $u = require_login();
    if (($u['role'] ?? '') !== 'admin') {
        api_abort('admin only', 403);
    }
    return $u;
}
