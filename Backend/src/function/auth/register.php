<?php
/**
 * function/register.php - Backend logic for cashier self-registration.
 *
 * Pair: Frontend/function/register.html <-> this file.
 * CA-001.1: cashier creates an account with a personal email. New accounts
 * start as "pending" and cannot log in until an admin approves them
 * (see function/cashiers.php approve). Passwords are bcrypt hashes;
 * the plain password is never stored or returned.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\UTCDateTime;

function auth_register(array $params = []): array
{
    $data = json_body();
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $password = (string)($data['password'] ?? '');

    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        api_abort('valid email is required', 422);
    }
    if (strlen($password) < 8) {
        api_abort('password must be at least 8 characters', 422);
    }

    $users = DatabaseConnection::db()->selectCollection('users');
    if ($users->findOne(['email' => $email]) !== null) {
        api_abort('email already used', 409);
    }

    $res = $users->insertOne([
        'email' => $email,
        'passwordHash' => password_hash($password, PASSWORD_BCRYPT),
        'role' => 'cashier',
        'status' => 'pending',
        'createdAt' => new UTCDateTime(),
    ]);

    return [
        'ok' => true,
        'id' => (string)$res->getInsertedId(),
        'status' => 'pending',
        'message' => 'awaiting admin approval',
    ];
}
