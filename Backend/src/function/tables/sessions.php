<?php
/**
 * src/function/tables/sessions.php - playing session lifecycle (CA-004..CA-014, AD-014/AD-027).
 *
 * Pair: Frontend/src/function/cashiers/cashier-dashboard.html (cashier operates)
 *   <-> Frontend/src/function/tables/sessions.html (admin watches).
 *
 * Model per session:
 *   {tableId, tableName (denormalized), customerName, cashierId, cashierName,
 *    startTime, endTime (planned end = start + plannedMinutes, moved by extend),
 *    plannedMinutes, status: active|closed|cancelled, pricePerHour (snapshot),
 *    closedAt, createdAt, updatedAt}
 *
 * Timer rule: the cashier inputs the planned duration (e.g. customer says
 * "2 hrs" -> 120 min). endTime is the countdown target; the Frontend ticks
 * remaining = endTime - now every second. Extend pushes endTime forward.
 * Table flips to occupied on start, back to available on end/cancel.
 * Every mutation writes activityLogs (CA-033).
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

function sessions_col()
{
    return DatabaseConnection::db()->selectCollection('sessions');
}

function sessions_logs()
{
    return DatabaseConnection::db()->selectCollection('activityLogs');
}

function sessions_id(string $raw): ObjectId
{
    if (!preg_match('#^[0-9a-fA-F]{24}$#', $raw)) {
        api_abort('invalid id', 422);
    }
    return new ObjectId($raw);
}

function sessions_actor_name($userDoc, array $sessionUser): string
{
    if ($userDoc !== null) {
        $dn = trim((string)($userDoc['displayName'] ?? ''));
        if ($dn !== '') {
            return $dn;
        }
        if (!empty($userDoc['username'])) {
            return (string)$userDoc['username'];
        }
        if (!empty($userDoc['email'])) {
            return (string)$userDoc['email'];
        }
    }
    return $sessionUser['username'] ?? $sessionUser['email'] ?? 'cashier';
}

/** Enrich one session doc with table + cashier names (null-safe for old docs). */
function sessions_shape($doc, array $tableMap = [], array $userMap = []): array
{
    $tableId = isset($doc['tableId']) ? (string)$doc['tableId'] : null;
    $cashierId = isset($doc['cashierId']) ? (string)$doc['cashierId'] : null;
    return [
        'id' => (string)$doc['_id'],
        'tableId' => $tableId,
        'tableName' => $doc['tableName'] ?? ($tableId !== null ? ($tableMap[$tableId] ?? $tableId) : '—'),
        'customerName' => $doc['customerName'] ?? '',
        'cashierId' => $cashierId,
        'cashierName' => $doc['cashierName'] ?? ($cashierId !== null ? ($userMap[$cashierId] ?? '—') : '—'),
        'startTime' => isset($doc['startTime']) ? $doc['startTime']->toDateTime()->format(DATE_ATOM) : null,
        'endTime' => isset($doc['endTime']) ? $doc['endTime']->toDateTime()->format(DATE_ATOM) : null,
        'plannedMinutes' => (int)($doc['plannedMinutes'] ?? 0),
        'status' => $doc['status'] ?? '',
        'pricePerHour' => isset($doc['pricePerHour']) ? (float)$doc['pricePerHour'] : null,
        'closedAt' => isset($doc['closedAt']) ? $doc['closedAt']->toDateTime()->format(DATE_ATOM) : null,
    ];
}

/** Build id->name maps so list responses show "Table 1 / Juan" not raw ids. */
function sessions_maps(array $docs): array
{
    $tableMap = [];
    $userMap = [];
    $tableIds = [];
    $userIds = [];
    foreach ($docs as $d) {
        if (isset($d['tableId']) && $d['tableId'] instanceof ObjectId) {
            $tableIds[(string)$d['tableId']] = $d['tableId'];
        }
        if (!empty($d['cashierId'])) {
            $userIds[(string)$d['cashierId']] = (string)$d['cashierId'];
        }
    }
    if ($tableIds !== []) {
        $tables = DatabaseConnection::db()->selectCollection('tables')->find(
            ['_id' => ['$in' => array_values($tableIds)]]
        );
        foreach ($tables as $t) {
            $tableMap[(string)$t['_id']] = $t['name'] ?? (string)$t['_id'];
        }
    }
    $objIds = [];
    foreach ($userIds as $hex) {
        if (preg_match('#^[0-9a-fA-F]{24}$#', $hex)) {
            $objIds[] = new ObjectId($hex);
        }
    }
    if ($objIds !== []) {
        $users = DatabaseConnection::db()->selectCollection('users')->find(
            ['_id' => ['$in' => $objIds]],
            ['projection' => ['displayName' => 1, 'username' => 1, 'email' => 1]]
        );
        foreach ($users as $u) {
            $id = (string)$u['_id'];
            $userMap[$id] = trim((string)($u['displayName'] ?? ''))
                ?: (string)($u['username'] ?? $u['email'] ?? $id);
        }
    }
    return [$tableMap, $userMap];
}

function sessions_status_filter(): array
{
    $status = strtolower(trim((string)($_GET['status'] ?? 'active')));
    if ($status === 'all') {
        return [];
    }
    if (in_array($status, ['active', 'closed', 'cancelled'], true)) {
        return ['status' => $status];
    }
    // Unknown value: fall back to active (same convention as tables/cashiers lists).
    return ['status' => 'active'];
}

/** AD-014 + AD-027: admin views sessions operated by cashiers (active/closed/cancelled/all). */
function sessions_list(array $params = []): array
{
    require_admin();
    $filter = sessions_status_filter();
    $docs = iterator_to_array(
        sessions_col()->find($filter, ['sort' => ['startTime' => -1], 'limit' => 200])
    );
    [$tableMap, $userMap] = sessions_maps($docs);
    $out = [];
    foreach ($docs as $doc) {
        $out[] = sessions_shape($doc, $tableMap, $userMap);
    }
    return ['ok' => true, 'sessions' => $out];
}

/** CA-004 + CA-013: cashier views sessions (same shape, defaults to active). */
function sessions_cashier_list(array $params = []): array
{
    require_login();
    $filter = sessions_status_filter();
    $docs = iterator_to_array(
        sessions_col()->find($filter, ['sort' => ['startTime' => -1], 'limit' => 200])
    );
    [$tableMap, $userMap] = sessions_maps($docs);
    $out = [];
    foreach ($docs as $doc) {
        $out[] = sessions_shape($doc, $tableMap, $userMap);
    }
    return ['ok' => true, 'sessions' => $out];
}

/**
 * CA-006 + CA-007: start a walk-in session on an available table.
 * Body: {tableId, customerName, durationMinutes} — duration is what the
 * customer tells the cashier ("2 hrs" -> 120). Table flips to occupied.
 */
function sessions_start(array $params = []): array
{
    $me = require_login();
    $data = json_body();
    $tableIdRaw = trim((string)($data['tableId'] ?? ''));
    $customer = trim((string)($data['customerName'] ?? $data['customer'] ?? ''));
    $minutes = $data['durationMinutes'] ?? $data['plannedMinutes'] ?? null;
    // Accept hours+minutes convenience fields from the start form too.
    if ($minutes === null && (isset($data['hours']) || isset($data['minutes']))) {
        $minutes = (int)($data['hours'] ?? 0) * 60 + (int)($data['minutes'] ?? 0);
    }
    $minutes = is_numeric($minutes) ? (int)$minutes : 0;

    if ($tableIdRaw === '' || !preg_match('#^[0-9a-fA-F]{24}$#', $tableIdRaw)) {
        api_abort('tableId is required', 422);
    }
    if ($customer === '' || mb_strlen($customer) > 60) {
        api_abort('customer name is required (max 60 chars)', 422);
    }
    if ($minutes < 5 || $minutes > 1440) {
        api_abort('duration must be 5 to 1440 minutes (e.g. 2 hrs = 120)', 422);
    }

    $tableId = new ObjectId($tableIdRaw);
    $tables = DatabaseConnection::db()->selectCollection('tables');
    $table = $tables->findOne(['_id' => $tableId]);
    if ($table === null) {
        api_abort('table not found', 404);
    }
    if (!empty($table['archived'])) {
        api_abort('archived tables cannot start sessions', 422);
    }
    if (($table['status'] ?? 'available') !== 'available') {
        api_abort('table is not available (current: ' . ($table['status'] ?? '?') . ')', 409);
    }
    if (sessions_col()->findOne(['tableId' => $tableId, 'status' => 'active']) !== null) {
        api_abort('table already has an active session', 409);
    }

    $users = DatabaseConnection::db()->selectCollection('users');
    $actor = null;
    if (preg_match('#^[0-9a-fA-F]{24}$#', (string)($me['id'] ?? ''))) {
        $actor = $users->findOne(['_id' => new ObjectId((string)$me['id'])]);
    }
    $cashierName = sessions_actor_name($actor, $me);

    $rateDoc = DatabaseConnection::db()->selectCollection('rates')->findOne(['type' => 'regular']);
    $price = $rateDoc !== null && isset($rateDoc['pricePerHour']) ? (float)$rateDoc['pricePerHour'] : 120.0;

    $start = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $end = $start->modify('+' . $minutes . ' minutes');
    $res = sessions_col()->insertOne([
        'tableId' => $tableId,
        'tableName' => $table['name'] ?? $tableIdRaw,
        'customerName' => $customer,
        'cashierId' => (string)($me['id'] ?? ''),
        'cashierName' => $cashierName,
        'startTime' => new UTCDateTime($start),
        'endTime' => new UTCDateTime($end),
        'plannedMinutes' => $minutes,
        'status' => 'active',
        'pricePerHour' => $price,
        'createdAt' => new UTCDateTime($start),
        'updatedAt' => new UTCDateTime($start),
    ]);
    $tables->updateOne(['_id' => $tableId], ['$set' => ['status' => 'occupied']]);
    sessions_logs()->insertOne([
        'actorId' => (string)($me['id'] ?? ''),
        'action' => 'session_start',
        'target' => (string)$res->getInsertedId(),
        'at' => new UTCDateTime(),
    ]);
    $doc = sessions_col()->findOne(['_id' => $res->getInsertedId()]);
    return ['ok' => true, 'session' => sessions_shape($doc)];
}

/**
 * CA-009: extend an active session (customer asks for more time).
 * Body: {extraMinutes} — pushes endTime forward, grows plannedMinutes.
 */
function sessions_extend(array $params = []): array
{
    $me = require_login();
    $data = json_body();
    $extra = $data['extraMinutes'] ?? $data['minutes'] ?? null;
    $extra = is_numeric($extra) ? (int)$extra : 0;
    if ($extra < 5 || $extra > 720) {
        api_abort('extraMinutes must be 5 to 720 (e.g. +60 for one more hour)', 422);
    }
    $id = sessions_id($params['id'] ?? '');
    $doc = sessions_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('session not found', 404);
    }
    if (($doc['status'] ?? '') !== 'active') {
        api_abort('only active sessions can be extended', 422);
    }
    $newPlanned = (int)($doc['plannedMinutes'] ?? 0) + $extra;
    if ($newPlanned > 1440) {
        api_abort('total planned time cannot exceed 1440 minutes (24h)', 422);
    }
    $curEnd = $doc['endTime'] instanceof UTCDateTime
        ? $doc['endTime']->toDateTime()
        : $doc['startTime']->toDateTime();
    $newEnd = (DateTimeImmutable::createFromMutable((clone $curEnd)) ?: new DateTimeImmutable('now', new DateTimeZone('UTC')))
        ->modify('+' . $extra . ' minutes');
    sessions_col()->updateOne(
        ['_id' => $id],
        ['$set' => [
            'endTime' => new UTCDateTime($newEnd),
            'plannedMinutes' => $newPlanned,
            'updatedAt' => new UTCDateTime(),
        ]]
    );
    sessions_logs()->insertOne([
        'actorId' => (string)($me['id'] ?? ''),
        'action' => 'session_extend',
        'target' => (string)$doc['_id'],
        'at' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'session' => sessions_shape(sessions_col()->findOne(['_id' => $id]))];
}

/** Free the table after a session closes/is voided (never touch archived tables). */
function sessions_free_table($tableId): void
{
    if (!($tableId instanceof ObjectId)) {
        return;
    }
    $tables = DatabaseConnection::db()->selectCollection('tables');
    $t = $tables->findOne(['_id' => $tableId]);
    if ($t === null || !empty($t['archived'])) {
        return;
    }
    if (($t['status'] ?? '') === 'occupied') {
        $tables->updateOne(['_id' => $tableId], ['$set' => ['status' => 'available']]);
    }
}

/** Per-minute billing preview: elapsed minutes x snapshot rate / 60. */
function sessions_charge($doc, DateTimeInterface $until): float
{
    if (!isset($doc['startTime'])) {
        return 0.0;
    }
    $secs = $until->getTimestamp() - $doc['startTime']->toDateTime()->getTimestamp();
    if ($secs < 0) {
        $secs = 0;
    }
    $rate = isset($doc['pricePerHour']) ? (float)$doc['pricePerHour'] : 120.0;
    return round(($secs / 3600) * $rate, 2);
}

/**
 * CA-011 + CA-014: end an active session. Frees the table, stamps closedAt,
 * returns the per-minute charge so the cashier can bill it.
 */
function sessions_end(array $params = []): array
{
    $me = require_login();
    $id = sessions_id($params['id'] ?? '');
    $doc = sessions_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('session not found', 404);
    }
    if (($doc['status'] ?? '') !== 'active') {
        api_abort('only active sessions can be ended', 422);
    }
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $charge = sessions_charge($doc, $now);
    sessions_col()->updateOne(
        ['_id' => $id],
        ['$set' => ['status' => 'closed', 'closedAt' => new UTCDateTime($now), 'updatedAt' => new UTCDateTime($now)]]
    );
    sessions_free_table($doc['tableId'] ?? null);
    sessions_logs()->insertOne([
        'actorId' => (string)($me['id'] ?? ''),
        'action' => 'session_end',
        'target' => (string)$doc['_id'],
        'at' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'amount' => $charge, 'session' => sessions_shape(sessions_col()->findOne(['_id' => $id]))];
}

/**
 * CA-012: void an incorrectly created active session (authorized = any
 * logged-in staff; the confirm dialog is the gate). Frees the table.
 */
function sessions_cancel(array $params = []): array
{
    $me = require_login();
    $id = sessions_id($params['id'] ?? '');
    $doc = sessions_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('session not found', 404);
    }
    if (($doc['status'] ?? '') !== 'active') {
        api_abort('only active sessions can be voided', 422);
    }
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    sessions_col()->updateOne(
        ['_id' => $id],
        ['$set' => ['status' => 'cancelled', 'closedAt' => new UTCDateTime($now), 'updatedAt' => new UTCDateTime($now)]]
    );
    sessions_free_table($doc['tableId'] ?? null);
    sessions_logs()->insertOne([
        'actorId' => (string)($me['id'] ?? ''),
        'action' => 'session_cancel',
        'target' => (string)$doc['_id'],
        'at' => new UTCDateTime(),
    ]);
    return ['ok' => true, 'session' => sessions_shape(sessions_col()->findOne(['_id' => $id]))];
}
