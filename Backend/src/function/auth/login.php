<?php
/**
 * function/login.php - Backend logic for login, logout, and "who am I".
 *
 * Pair: Frontend/function/login.html <-> this file.
 * CA-001 + AD-001 (login, both roles, email only), CA-002 + AD-002 (logout),
 * plus auth_me used by every guarded page. Flow:
 * register (pending) -> approve (cashiers.php) -> login (active only).
 * Login writes the user into $_SESSION; later requests read it back.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;

function auth_login(array $params = []): array
{
    $data = json_body();
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $password = (string)($data['password'] ?? '');

    if ($email === '' || $password === '') {
        api_abort('email and password are required', 422);
    }

    $user = DatabaseConnection::db()->selectCollection('users')->findOne(['email' => $email]);
    if ($user === null || !password_verify($password, (string)($user['passwordHash'] ?? ''))) {
        api_abort('invalid credentials', 401);
    }
    if (($user['status'] ?? '') === 'pending') {
        api_abort('awaiting admin approval', 403);
    }
    if (($user['status'] ?? '') === 'archived') {
        api_abort('account archived', 403);
    }

    $_SESSION['user'] = [
        'id' => (string)$user['_id'],
        'email' => $user['email'],
        'role' => $user['role'],
    ];

    return ['ok' => true, 'email' => $user['email'], 'role' => $user['role']];
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
    return [
        'ok' => true,
        'email' => $doc['email'],
        'role' => $doc['role'],
        'status' => $doc['status'],
    ];
}
