<?php
/**
 * src/function/auth/login.php - Backend logic for login, logout, and "who am I".
 *
 * Pair: Frontend/src/function/auth/login.html <-> this file.
 * Dual identifier: input containing "@" logs in by EMAIL (admins + legacy
 * email cashiers); anything else by USERNAME (cashiers). Valid ACTIVE
 * accounts get a direct session — no second step, never at login.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

function auth_login(array $params = []): array
{
    $data = json_body();
    $login = trim((string)($data['email'] ?? $data['username'] ?? ''));
    $password = (string)($data['password'] ?? '');

    if ($login === '' || $password === '') {
        api_abort('login and password are required', 422);
    }

    $users = DatabaseConnection::db()->selectCollection('users');
    if (str_contains($login, '@')) {
        // EMAIL path: admins + legacy email cashiers.
        $user = $users->findOne(['email' => strtolower($login)]);
    } else {
        // USERNAME path: cashiers only, password-only (no email to send to).
        $user = $users->findOne([
            'username' => strtolower($login),
            'role' => 'cashier',
        ]);
    }
    if ($user === null || !password_verify($password, (string)($user['passwordHash'] ?? ''))) {
        api_abort('invalid credentials', 401);
    }
    if (($user['status'] ?? '') === 'pending') {
        api_abort('awaiting admin approval', 403);
    }
    if (($user['status'] ?? '') === 'archived') {
        api_abort('account archived', 403);
    }
    if (($user['status'] ?? '') === 'declined') {
        api_abort('application was declined', 403);
    }
    if (($user['status'] ?? '') !== 'active') {
        api_abort('account is not active', 403);
    }

    // Valid active account: direct session, no second step.
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

function auth_logout(array $params = []): array
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    return ['ok' => true];
}

function auth_me(array $params = []): array
{
    $u = require_login();
    $doc = DatabaseConnection::db()->selectCollection('users')->findOne(
        ['_id' => new ObjectId($u['id'])]
    );
    if ($doc === null) {
        api_abort('not logged in', 401);
    }
    $googleSub = (string)($doc['googleSub'] ?? '');
    $createdAt = $doc['createdAt'] ?? null;
    if ($createdAt instanceof UTCDateTime) {
        $createdAt = $createdAt->toDateTime()->format(DATE_ATOM);
    } elseif ($createdAt instanceof \DateTimeInterface) {
        $createdAt = $createdAt->format(DATE_ATOM);
    } else {
        $createdAt = null;
    }
    $provider = (string)($doc['authProvider'] ?? '');
    if ($provider === '') {
        $provider = $googleSub !== '' ? 'google' : 'local';
    }
    return [
        'ok' => true,
        'username' => $doc['username'] ?? null,
        'email' => $doc['email'] ?? null,
        'role' => $doc['role'],
        'status' => $doc['status'],
        'displayName' => (string)($doc['displayName'] ?? ''),
        'authProvider' => $provider,
        'createdAt' => $createdAt,
        'googleLinked' => $googleSub !== '',
    ];
}