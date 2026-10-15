<?php
/**
 * src/function/cashiers/transactions.php - billing + payment close-out (Sprint 3).
 *
 * Pair: Frontend/src/function/cashiers/cashier-dashboard.js (cashier bills)
 *   <-> Frontend/src/function/admin/transactions.html (admin watches)
 *   <-> Frontend/src/function/shared/receipt.html (print receipt).
 *
 * Flow (two steps, prevents double-billing):
 *   POST /api/cashier/sessions/{id}/end  -> {amount} (session status=closed)
 *   POST /api/cashier/transactions {sessionId, method, received} -> {transaction}
 *
 * Collection `transactions`: one doc per paid sessionId.
 *   {ref unique GH-YYYYMMDD-XXXX, sessionId unique, tableId, tableName,
 *    customerName, cashierId, cashierName, minutes (ceil display),
 *    pricePerHour (snapshot copy), total, method cash|gcash,
 *    received, change, paidAt, createdAt}
 *
 * Indexes live in Backend/scripts/setup_transactions_indexes.php (one-time,
 * never per-request per AGENTS.md).
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

function transactions_col()
{
    return DatabaseConnection::db()->selectCollection('transactions');
}

function transactions_logs()
{
    return DatabaseConnection::db()->selectCollection('activityLogs');
}

function transactions_id(string $raw): ObjectId
{
    if (!preg_match('#^[0-9a-fA-F]{24}$#', $raw)) {
        api_abort('sessionId must be a 24-hex id', 422);
    }
    return new ObjectId($raw);
}

/** GH-YYYYMMDD-XXXX, 4-char upper alnum, retry on collision (caller retries). */
function transactions_ref_once(): string
{
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $suffix = '';
    for ($i = 0; $i < 4; $i++) {
        $suffix .= $chars[random_int(0, 35)];
    }
    return 'GH-' . gmdate('Ymd') . '-' . $suffix;
}

function transactions_shape($doc): array
{
    return [
        'id' => isset($doc['_id']) ? (string)$doc['_id'] : null,
        'ref' => $doc['ref'] ?? '',
        'sessionId' => isset($doc['sessionId']) ? (string)$doc['sessionId'] : null,
        'tableId' => isset($doc['tableId']) ? (string)$doc['tableId'] : null,
        'tableName' => $doc['tableName'] ?? '—',
        'customerName' => $doc['customerName'] ?? '',
        'cashierId' => isset($doc['cashierId']) ? (string)$doc['cashierId'] : null,
        'cashierName' => $doc['cashierName'] ?? '—',
        'minutes' => isset($doc['minutes']) ? (int)$doc['minutes'] : 0,
        'pricePerHour' => isset($doc['pricePerHour']) ? (float)$doc['pricePerHour'] : 0,
        'total' => isset($doc['total']) ? (float)$doc['total'] : 0,
        'method' => $doc['method'] ?? '',
        'received' => isset($doc['received']) ? (float)$doc['received'] : 0,
        'change' => isset($doc['change']) ? (float)$doc['change'] : 0,
        'paidAt' => isset($doc['paidAt']) && $doc['paidAt'] instanceof UTCDateTime
            ? $doc['paidAt']->toDateTime()->format(DATE_ATOM) : null,
        'createdAt' => isset($doc['createdAt']) && $doc['createdAt'] instanceof UTCDateTime
            ? $doc['createdAt']->toDateTime()->format(DATE_ATOM) : null,
    ];
}

/** Strict YYYY-MM-DD -> UTC midnight, or null when empty. Invalid -> 422. */
function transactions_day_start(?string $raw, string $field): ?DateTimeImmutable
{
    $raw = trim((string)($raw ?? ''));
    if ($raw === '') {
        return null;
    }
    if (!preg_match('#^\d{4}-\d{2}-\d{2}$#', $raw)) {
        api_abort($field . ' must be YYYY-MM-DD', 422);
    }
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $raw, new DateTimeZone('UTC'));
    if ($dt === false) {
        api_abort($field . ' must be YYYY-MM-DD', 422);
    }
    return $dt;
}

/** Build {paidAt range + optional method} filter from ?from&to&method. */
function transactions_range_filter(bool $allowMethod): array
{
    $from = transactions_day_start($_GET['from'] ?? null, 'from');
    $to = transactions_day_start($_GET['to'] ?? null, 'to');
    $filter = [];
    $range = [];
    if ($from !== null) {
        $range['$gte'] = new UTCDateTime($from);
    }
    if ($to !== null) {
        $range['$lt'] = new UTCDateTime($to->modify('+1 day'));
    }
    if ($range !== []) {
        $filter['paidAt'] = $range;
    }
    if ($allowMethod) {
        $m = strtolower(trim((string)($_GET['method'] ?? 'all')));
        if (in_array($m, ['cash', 'gcash'], true)) {
            $filter['method'] = $m;
        }
    }
    return $filter;
}

function transactions_cashier_name(array $sessionUser): string
{
    $idRaw = (string)($sessionUser['id'] ?? '');
    if (preg_match('#^[0-9a-fA-F]{24}$#', $idRaw)) {
        try {
            $u = DatabaseConnection::db()->selectCollection('users')
                ->findOne(['_id' => new ObjectId($idRaw)]);
            if ($u !== null) {
                $dn = trim((string)($u['displayName'] ?? ''));
                if ($dn !== '') {
                    return $dn;
                }
                if (!empty($u['username'])) {
                    return (string)$u['username'];
                }
                if (!empty($u['email'])) {
                    return (string)$u['email'];
                }
            }
        } catch (Throwable $ignored) {
        }
    }
    return $sessionUser['username'] ?? $sessionUser['email'] ?? 'cashier';
}

/**
 * CA-020/022/023/024: create a bill for a closed session.
 * Body {sessionId, method cash|gcash, received}.
 * 404 session missing, 422 not-closed/bad method/short payment, 409 double-bill.
 */
function transactions_create(array $params = []): array
{
    $me = require_login();
    $data = json_body();
    $sessionRaw = trim((string)($data['sessionId'] ?? ''));
    $method = strtolower(trim((string)($data['method'] ?? '')));
    $receivedRaw = $data['received'] ?? null;

    if ($sessionRaw === '') {
        api_abort('sessionId is required', 422);
    }
    $sessionId = transactions_id($sessionRaw);
    if (!in_array($method, ['cash', 'gcash'], true)) {
        api_abort('method must be cash or gcash', 422);
    }
    if (!is_numeric($receivedRaw)) {
        api_abort('received must be a number', 422);
    }
    $received = (float)$receivedRaw;
    if (!($received > 0) || $received > 1000000) {
        api_abort('received must be > 0 and <= 1000000', 422);
    }

    $session = DatabaseConnection::db()->selectCollection('sessions')
        ->findOne(['_id' => $sessionId]);
    if ($session === null) {
        api_abort('session not found', 404);
    }
    if (($session['status'] ?? '') !== 'closed') {
        api_abort('session must be closed before billing (end it first)', 422);
    }
    $dup = transactions_col()->findOne(['sessionId' => $sessionId]);
    if ($dup !== null) {
        api_abort('session already billed (' . ($dup['ref'] ?? 'billed') . ')', 409);
    }

    // Total reuses sessions_charge(): per-second billing on the snapshot rate.
    // Closed sessions bill up to closedAt; fallback to now for legacy docs.
    $start = $session['startTime'] instanceof UTCDateTime
        ? $session['startTime']->toDateTime() : null;
    if ($start === null) {
        api_abort('session has no start time and cannot be billed', 422);
    }
    $until = ($session['closedAt'] ?? null) instanceof UTCDateTime
        ? $session['closedAt']->toDateTime()
        : new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $secs = $until->getTimestamp() - $start->getTimestamp();
    if ($secs < 0) {
        $secs = 0;
    }
    $price = isset($session['pricePerHour']) ? (float)$session['pricePerHour'] : 120.0;
    $total = round(($secs / 3600) * $price, 2);
    if ($received < $total) {
        api_abort('short payment: received ' . $received . ' < total ' . $total, 422);
    }
    $change = round($received - $total, 2);
    $minutes = (int)ceil($secs / 60);

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $ref = '';
    $inserted = null;
    for ($i = 0; $i < 5; $i++) {
        $ref = transactions_ref_once();
        if (transactions_col()->findOne(['ref' => $ref]) === null) {
            try {
                $res = transactions_col()->insertOne([
                    'ref' => $ref,
                    'sessionId' => $sessionId,
                    'tableId' => $session['tableId'] ?? null,
                    'tableName' => $session['tableName'] ?? '',
                    'customerName' => $session['customerName'] ?? '',
                    'cashierId' => (string)($me['id'] ?? ''),
                    'cashierName' => transactions_cashier_name($me),
                    'minutes' => $minutes,
                    'pricePerHour' => $price,
                    'total' => $total,
                    'method' => $method,
                    'received' => $received,
                    'change' => $change,
                    'paidAt' => new UTCDateTime($now),
                    'createdAt' => new UTCDateTime($now),
                ]);
                $inserted = $res->getInsertedId();
                break;
            } catch (Throwable $e) {
                // Duplicate-key race on ref/sessionId: retry ref, or surface double-bill.
                $msg = $e->getMessage();
                if (stripos($msg, 'sessionId') !== false) {
                    api_abort('session already billed', 409);
                }
                continue;
            }
        }
    }
    if ($inserted === null) {
        api_abort('could not generate a unique reference, try again', 500);
    }
    transactions_logs()->insertOne([
        'actorId' => (string)($me['id'] ?? ''),
        'action' => 'payment_record',
        'target' => $ref,
        'sessionId' => $sessionRaw,
        'total' => $total,
        'method' => $method,
        'at' => new UTCDateTime(),
    ]);
    $doc = transactions_col()->findOne(['_id' => $inserted]);
    return ['ok' => true, 'transaction' => transactions_shape($doc)];
}

/** CA-013 companion: cashier lists bills (date-range filter AD-023). */
function transactions_cashier_list(array $params = []): array
{
    require_login();
    $filter = transactions_range_filter(false);
    $docs = iterator_to_array(transactions_col()->find(
        $filter, ['sort' => ['paidAt' => -1], 'limit' => 200]
    ));
    $out = [];
    foreach ($docs as $d) {
        $out[] = transactions_shape($d);
    }
    return ['ok' => true, 'transactions' => $out];
}

/** Receipt lookup (cashier): one bill by ref. */
function transactions_cashier_get(array $params = []): array
{
    require_login();
    $ref = trim((string)($params['ref'] ?? ''));
    if ($ref === '') {
        api_abort('ref is required', 422);
    }
    $doc = transactions_col()->findOne(['ref' => $ref]);
    if ($doc === null) {
        api_abort('transaction not found', 404);
    }
    return ['ok' => true, 'transaction' => transactions_shape($doc)];
}

/** AD-020 + AD-023: admin lists bills (?from&to&method). */
function transactions_admin_list(array $params = []): array
{
    require_admin();
    $filter = transactions_range_filter(true);
    $docs = iterator_to_array(transactions_col()->find(
        $filter, ['sort' => ['paidAt' => -1], 'limit' => 500]
    ));
    $out = [];
    foreach ($docs as $d) {
        $out[] = transactions_shape($d);
    }
    return ['ok' => true, 'transactions' => $out];
}

/** Receipt lookup (admin twin). */
function transactions_admin_get(array $params = []): array
{
    require_admin();
    $ref = trim((string)($params['ref'] ?? ''));
    if ($ref === '') {
        api_abort('ref is required', 422);
    }
    $doc = transactions_col()->findOne(['ref' => $ref]);
    if ($doc === null) {
        api_abort('transaction not found', 404);
    }
    return ['ok' => true, 'transaction' => transactions_shape($doc)];
}
