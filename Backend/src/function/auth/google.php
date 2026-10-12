<?php
/**
 * function/google.php - admin-only "Continue with Google" (single admin system).
 *
 * Pair: Google button on src/function/auth/login.html <-> this file.
 * The verified Google email must belong to the ONE existing admin account:
 * unknown emails get 404 (no account is ever created here) and cashier
 * emails get 403 (cashiers log in with username + password only).
 * Active admin gets a direct session.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\UTCDateTime;

function google_verify_token(string $idToken): array
{
    $clientId = $_ENV['GOOGLE_CLIENT_ID'] ?? getenv('GOOGLE_CLIENT_ID') ?: '';
    if ($clientId === '') {
        api_abort('Google sign-in is not configured', 500);
    }
    if ($idToken === '') {
        api_abort('Google token is required', 422);
    }
    // ignore_errors: Google answers 400 + JSON for bad tokens (not a PHP failure).
    // We read the status line ourselves to tell "invalid" (401) from "network" (502).
    $ctx = stream_context_create(['http' => ['timeout' => 10, 'ignore_errors' => true]]);
    $raw = @file_get_contents(
        'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken),
        false,
        $ctx
    );
    $status = (string)($http_response_header[0] ?? '');
    if ($raw === false || !str_contains($status, ' 200 ')) {
        if (str_contains($status, ' 400 ')) {
            api_abort('invalid Google sign-in', 401);
        }
        api_abort('could not verify Google sign-in, try again', 502);
    }
    $info = json_decode($raw, true);
    if (!is_array($info) || isset($info['error'])) {
        api_abort('invalid Google sign-in', 401);
    }
    if (($info['aud'] ?? '') !== $clientId) {
        api_abort('invalid Google sign-in', 401);
    }
    if ((int)($info['exp'] ?? 0) < time()) {
        api_abort('Google sign-in expired, try again', 401);
    }
    if (($info['email_verified'] ?? '') !== 'true') {
        api_abort('Google email is not verified', 403);
    }
    $email = strtolower(trim((string)($info['email'] ?? '')));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        api_abort('Google account has no valid email', 422);
    }
    return [
        'email' => $email,
        'sub' => (string)($info['sub'] ?? ''),
        'name' => trim((string)($info['name'] ?? '')),
    ];
}

/** POST /api/auth/google {idToken} — admin-only Google door (no creation). */
function google_login(array $params = []): array
{
    $data = json_body();
    $g = google_verify_token((string)($data['idToken'] ?? ''));

    $users = DatabaseConnection::db()->selectCollection('users');
    $user = $users->findOne(['email' => $g['email']]);
    if ($user === null) {
        api_abort('no account found for this Google email — contact your administrator', 404);
    }
    if (($user['role'] ?? '') !== 'admin') {
        api_abort('Google sign-in is for the admin account — cashiers log in with username and password', 403);
    }
    // Keep the verified Google subject linked for audit continuity.
    if (empty($user['googleSub'] ?? '')) {
        $users->updateOne(['_id' => $user['_id']], ['$set' => ['googleSub' => $g['sub']]]);
    }

    if (($user['status'] ?? '') === 'pending') {
        api_abort('awaiting admin approval', 403);
    }
    if (($user['status'] ?? '') === 'archived') {
        api_abort('account archived', 403);
    }
    if (($user['status'] ?? '') !== 'active') {
        api_abort('account is not active', 403);
    }

    // Active: direct session, no second step.
    $_SESSION['user'] = [
        'id' => (string)$user['_id'],
        'username' => $user['username'] ?? null,
        'email' => $user['email'] ?? null,
        'role' => $user['role'],
    ];
    return [
        'ok' => true,
        'username' => $user['username'] ?? null,
        'email' => $user['email'] ?? null,
        'role' => $user['role'],
    ];
}

/** GET /api/config — public Frontend settings (client IDs are public by design). */
function app_config(array $params = []): array
{
    return [
        'ok' => true,
        'googleClientId' => $_ENV['GOOGLE_CLIENT_ID'] ?? getenv('GOOGLE_CLIENT_ID') ?: '',
    ];
}