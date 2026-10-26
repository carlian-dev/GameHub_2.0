<?php
/**
 * src/function/admin/cashiers.php - Backend logic for admin staff management.
 *
 * Pair: Frontend/src/function/admin/cashiers.html <-> this file.
 * Staff list + edit safe fields (never role, email, or passwordHash).
 * Archive/unarchive cashiers only (admins protected). Invite link IS the
 * approval — new cashiers arrive "active", no approve/decline step.
 * Archive/unarchive are written to activityLogs. All are admin-only:
 * guests get 401, cashiers get 403.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

function cashiers_users()
{
    return DatabaseConnection::db()->selectCollection('users');
}

function cashiers_logs()
{
    return DatabaseConnection::db()->selectCollection('activityLogs');
}

function cashiers_id(string $raw): ObjectId
{
    if (!preg_match('#^[0-9a-fA-F]{24}$#', $raw)) {
        api_abort('invalid id', 422);
    }
    return new ObjectId($raw);
}

function cashiers_shape($doc): array
{
    return [
        'id' => (string)$doc['_id'],
        'email' => $doc['email'] ?? null,
        'username' => $doc['username'] ?? null,
        'role' => $doc['role'] ?? 'cashier',
        'authProvider' => $doc['authProvider'] ?? 'password',
        'status' => $doc['status'] ?? '',
        'firstName' => $doc['firstName'] ?? '',
        'lastName' => $doc['lastName'] ?? '',
        'displayName' => $doc['displayName'] ?? '',
        'emailVerified' => (bool)($doc['emailVerified'] ?? false),
        'schedule' => $doc['schedule'] ?? '',
        'createdAt' => isset($doc['createdAt'])
            ? $doc['createdAt']->toDateTime()->format(DATE_ATOM) : null,
    ];
}

/** Staff list. ?status=active|archived|declined|all & ?role=cashier|admin|all. */
function cashiers_list(array $params = []): array
{
    require_admin();
    $status = strtolower(trim((string)($_GET['status'] ?? 'all')));
    $role = strtolower(trim((string)($_GET['role'] ?? 'all')));
    $filter = [];
    if (in_array($role, ['cashier', 'admin'], true)) {
        $filter['role'] = $role;
    }
    if (in_array($status, ['pending', 'active', 'archived', 'declined'], true)) {
        $filter['status'] = $status;
    }
    $cursor = cashiers_users()->find($filter, [
        'projection' => ['passwordHash' => 0],
        'sort' => ['createdAt' => -1],
    ]);
    $out = [];
    foreach ($cursor as $doc) {
        $out[] = cashiers_shape($doc);
    }
    return ['ok' => true, 'cashiers' => $out];
}

/** AD-005: update safe cashier fields (name, schedule). */
function cashiers_update(array $params = []): array
{
    require_admin();
    $data = json_body();
    $set = [];
    if (array_key_exists('displayName', $data)) {
        $set['displayName'] = trim((string)$data['displayName']);
    }
    if (array_key_exists('schedule', $data)) {
        $schedule = trim((string)$data['schedule']);
        if ($schedule !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d - ([01]\d|2[0-3]):[0-5]\d$/', $schedule)) {
            api_abort('schedule must be HH:MM - HH:MM (or empty to clear)', 422);
        }
        $set['schedule'] = $schedule;
    }
    if ($set === []) {
        api_abort('nothing to update (allowed: displayName, schedule)', 422);
    }
    $id = cashiers_id($params['id'] ?? '');
    $user = cashiers_users()->findOne(['_id' => $id]);
    if ($user === null || ($user['role'] ?? '') !== 'cashier') {
        api_abort('cashier not found', 404);
    }
    cashiers_users()->updateOne(['_id' => $id], ['$set' => $set]);
    $fresh = cashiers_users()->findOne(['_id' => $id], ['projection' => ['passwordHash' => 0]]);
    return ['ok' => true, 'cashier' => cashiers_shape($fresh)];
}

/**
 * Archive a cashier in one step (no OTP): the Frontend confirm dialog is the
 * only gate. Keeps history, blocks future logins. AD-006.1: admins can NEVER
 * be archived. Idempotent: archiving twice is fine, it just stays archived.
 */
function cashiers_archive(array $params = []): array
{
    $admin = require_admin();
    $user = cashiers_users()->findOne(['_id' => cashiers_id($params['id'] ?? '')]);
    if ($user === null) {
        api_abort('account not found', 404);
    }
    if (($user['role'] ?? '') === 'admin') {
        api_abort('admin accounts cannot be archived', 403);
    }
    if (($user['role'] ?? '') !== 'cashier') {
        api_abort('cashier not found', 404);
    }
    cashiers_users()->updateOne(['_id' => $user['_id']], ['$set' => ['status' => 'archived']]);
    cashiers_logs()->insertOne([
        'actorId' => $admin['id'],
        'action' => 'archive_cashier',
        'target' => (string)$user['_id'],
        'at' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'id' => (string)$user['_id'], 'status' => 'archived'];
}

/** Unarchive a cashier (archived -> active, login works again). */
function cashiers_unarchive(array $params = []): array
{
    $admin = require_admin();
    $id = cashiers_id($params['id'] ?? '');
    $user = cashiers_users()->findOne(['_id' => $id]);
    if ($user === null) {
        api_abort('account not found', 404);
    }
    if (($user['role'] ?? '') === 'admin') {
        api_abort('admin accounts cannot be archived', 403);
    }
    if (($user['role'] ?? '') !== 'cashier') {
        api_abort('cashier not found', 404);
    }
    if (($user['status'] ?? '') !== 'archived') {
        api_abort('only archived accounts can be unarchived', 422);
    }
    cashiers_users()->updateOne(['_id' => $id], ['$set' => ['status' => 'active']]);
    cashiers_logs()->insertOne([
        'actorId' => $admin['id'],
        'action' => 'unarchive_cashier',
        'target' => (string)$user['_id'],
        'at' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'id' => (string)$user['_id'], 'status' => 'active'];
}