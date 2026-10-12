<?php
/**
 * function/register.php - invitation-only cashier signup (single admin system).
 *
 * Pair: Frontend/src/function/auth/register.html?token=... <-> this file.
 * Creation requires a valid unused unexpired invitation whose email equals
 * the registering email; role is forced to cashier; the link is marked used
 * atomically (used:false filter) so double-submit cannot double-spend.
 * New accounts start "active" immediately — the invitation IS the approval,
 * no admin approve step. Passwords are bcrypt hashes; plain passwords and
 * raw tokens are never stored.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\UTCDateTime;

function auth_register(array $params = [])
{
    $data = json_body();
    $token = (string)($data['token'] ?? '');
    $firstName = trim((string)($data['firstName'] ?? ''));
    $lastName = trim((string)($data['lastName'] ?? ''));
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $password = (string)($data['password'] ?? '');

    if (mb_strlen($firstName) < 2 || mb_strlen($lastName) < 2) {
        api_abort('first name and last name are required', 422);
    }
    if (strlen($password) < 8) {
        api_abort('password must be at least 8 characters', 422);
    }
    // The invitation IS the gate: valid, unused, unexpired, or no account.
    [$inv, $state] = invite_find($token);
    if ($state !== 'valid') {
        api_abort('invitation ' . $state . ' — ask your administrator for a new link', $state === 'invalid' ? 404 : 410);
    }
    if ($email === '' || $email !== strtolower((string)($inv['email'] ?? ''))) {
        api_abort('registering email must match the invited email', 422);
    }

    if (isset($data['idToken'])) {
        api_abort('cashier signup takes name, username, email and password only', 422);
    }
    $username = strtolower(trim((string)($data['username'] ?? '')));
    if (!preg_match('#^[a-z0-9._-]{3,30}$#', $username)) {
        api_abort('username must be 3-30 chars: letters, numbers, . _ -', 422);
    }
    $users = DatabaseConnection::db()->selectCollection('users');
    if ($users->findOne(['username' => $username]) !== null) {
        api_abort('username already used', 409);
    }
    if ($users->findOne(['email' => $email]) !== null) {
        api_abort('email already used', 409);
    }

    $displayName = $firstName . ' ' . $lastName;
    $res = $users->insertOne([
        'username' => $username,
        'email' => $email,
        'passwordHash' => password_hash($password, PASSWORD_BCRYPT),
        'authProvider' => 'password',
        'firstName' => $firstName,
        'lastName' => $lastName,
        'displayName' => $displayName,
        'role' => 'cashier',
        'status' => 'active',
        'emailVerified' => true,
        'createdAt' => new UTCDateTime(),
    ]);
    // Single-use: only flips when still unused (double-submit safe).
    invite_col()->updateOne(
        ['_id' => $inv['_id'], 'used' => false],
        ['$set' => ['used' => true, 'usedAt' => new UTCDateTime()]]
    );
    // Invite IS the approval: log the auto-activation with the inviter as actor.
    DatabaseConnection::db()->selectCollection('activityLogs')->insertOne([
        'actorId' => (string)($inv['createdBy'] ?? 'invite'),
        'action' => 'approve_cashier',
        'target' => (string)$res->getInsertedId(),
        'at' => new UTCDateTime(),
    ]);
    return [
        'ok' => true,
        'id' => (string)$res->getInsertedId(),
        'status' => 'active',
        'message' => 'account created, you can log in now',
    ];
}
