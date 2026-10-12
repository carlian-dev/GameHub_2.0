<?php
/**
 * function/cashiers.php - Backend logic for admin staff management.
 *
 * Pair: Frontend/function/cashiers.html <-> this file.
 * AD-004 lists everyone (password hashes never leave the server).
 * AD-003 approves email applications (pending -> active, unlocks login).
 * AD-005 edits safe fields only (display name, schedule — never role,
 * email, or passwordHash, so nobody escalates via edit forms).
 * AD-006 archives (history kept, future logins blocked).
 * Approve/archive are written to activityLogs. All four are admin-only:
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
        'email' => $doc['email'] ?? '',
        'role' => $doc['role'] ?? 'cashier',
        'status' => $doc['status'] ?? '',
        'displayName' => $doc['displayName'] ?? '',
        'schedule' => $doc['schedule'] ?? '',
        'createdAt' => isset($doc['createdAt'])
            ? $doc['createdAt']->toDateTime()->format(DATE_ATOM) : null,
    ];
}

/** AD-004: view cashier accounts, optional ?status=pending|active|archived|all. */
function cashiers_list(array $params = []): array
{
    require_admin();
    $status = strtolower(trim((string)($_GET['status'] ?? 'all')));
    $filter = ['role' => 'cashier'];
    if (in_array($status, ['pending', 'active', 'archived'], true)) {
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

/** AD-003: approve a pending email application (pending -> active). */
function cashiers_approve(array $params = []): array
{
    $admin = require_admin();
    $user = cashiers_users()->findOne(['_id' => cashiers_id($params['id'] ?? '')]);
    if ($user === null || ($user['role'] ?? '') !== 'cashier') {
        api_abort('cashier not found', 404);
    }
    if (($user['status'] ?? '') !== 'pending') {
        api_abort('only pending cashier applications can be approved', 422);
    }
    cashiers_users()->updateOne(
        ['_id' => $user['_id']],
        ['$set' => ['status' => 'active']]
    );
    cashiers_logs()->insertOne([
        'actorId' => $admin['id'],
        'action' => 'approve_cashier',
        'target' => (string)$user['_id'],
        'at' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'id' => (string)$user['_id'], 'status' => 'active'];
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
        $set['schedule'] = trim((string)$data['schedule']);
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

/** AD-006: archive a cashier (keeps history, blocks future logins). */
function cashiers_archive(array $params = []): array
{
    $admin = require_admin();
    $id = cashiers_id($params['id'] ?? '');
    $user = cashiers_users()->findOne(['_id' => $id]);
    if ($user === null || ($user['role'] ?? '') !== 'cashier') {
        api_abort('cashier not found', 404);
    }
    // Idempotent: archiving twice is fine, it just stays archived.
    cashiers_users()->updateOne(['_id' => $id], ['$set' => ['status' => 'archived']]);
    cashiers_logs()->insertOne([
        'actorId' => $admin['id'],
        'action' => 'archive_cashier',
        'target' => (string)$user['_id'],
        'at' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'id' => (string)$user['_id'], 'status' => 'archived'];
}
