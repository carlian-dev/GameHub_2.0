<?php
/**
 * src/function/admin/reports.php - daily income + CSV export (Sprint 3).
 *
 * Pair: Frontend/src/function/admin/transactions.html <-> this file.
 * AD-019 daily income, AD-021 CSV export, AD-023 date-range filter.
 * Source of truth is `transactions.paidAt` (UTC day buckets; Asia/Manila
 * cut is a next-sprint ?tz item per the frozen plan).
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\UTCDateTime;

function reports_col()
{
    return DatabaseConnection::db()->selectCollection('transactions');
}

/** Strict YYYY-MM-DD -> UTC midnight. Invalid -> 422. */
function reports_day(string $raw, string $field = 'date'): DateTimeImmutable
{
    $raw = trim($raw);
    if (!preg_match('#^\d{4}-\d{2}-\d{2}$#', $raw)) {
        api_abort($field . ' must be YYYY-MM-DD', 422);
    }
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $raw, new DateTimeZone('UTC'));
    if ($dt === false) {
        api_abort($field . ' must be YYYY-MM-DD', 422);
    }
    return $dt;
}

function reports_range_filter(): array
{
    $filter = [];
    $fromRaw = trim((string)($_GET['from'] ?? ''));
    $toRaw = trim((string)($_GET['to'] ?? ''));
    $range = [];
    if ($fromRaw !== '') {
        $range['$gte'] = new UTCDateTime(reports_day($fromRaw, 'from'));
    }
    if ($toRaw !== '') {
        $range['$lt'] = new UTCDateTime(reports_day($toRaw, 'to')->modify('+1 day'));
    }
    if ($range !== []) {
        $filter['paidAt'] = $range;
    }
    $m = strtolower(trim((string)($_GET['method'] ?? 'all')));
    if (in_array($m, ['cash', 'gcash'], true)) {
        $filter['method'] = $m;
    }
    return $filter;
}

/**
 * AD-019: daily income for one UTC day.
 * GET /api/admin/reports/daily?date=YYYY-MM-DD (default: today UTC).
 * Returns {date, count, gross, byMethod:{cash:{count,gross},gcash:{count,gross}}}.
 */
function reports_daily(array $params = []): array
{
    require_admin();
    $raw = trim((string)($_GET['date'] ?? gmdate('Y-m-d')));
    if ($raw === '') {
        $raw = gmdate('Y-m-d');
    }
    $day = reports_day($raw, 'date');
    $next = $day->modify('+1 day');
    $docs = iterator_to_array(reports_col()->find(
        ['paidAt' => ['$gte' => new UTCDateTime($day), '$lt' => new UTCDateTime($next)]]
    ));
    $count = 0;
    $gross = 0.0;
    $byMethod = [
        'cash' => ['count' => 0, 'gross' => 0.0],
        'gcash' => ['count' => 0, 'gross' => 0.0],
    ];
    foreach ($docs as $d) {
        $t = (float)($d['total'] ?? 0);
        $count++;
        $gross += $t;
        $m = strtolower((string)($d['method'] ?? ''));
        if (isset($byMethod[$m])) {
            $byMethod[$m]['count']++;
            $byMethod[$m]['gross'] += $t;
        }
    }
    $gross = round($gross, 2);
    $byMethod['cash']['gross'] = round($byMethod['cash']['gross'], 2);
    $byMethod['gcash']['gross'] = round($byMethod['gcash']['gross'], 2);
    return [
        'ok' => true,
        'date' => $day->format('Y-m-d'),
        'count' => $count,
        'gross' => $gross,
        'byMethod' => $byMethod,
    ];
}

/**
 * AD-021: CSV export of bills.
 * GET /api/admin/reports/export?format=csv&from&to&method
 * Streams text/csv with Content-Disposition: attachment (URL-based, not JSON).
 */
function reports_export(array $params = []): array
{
    require_admin();
    $format = strtolower(trim((string)($_GET['format'] ?? 'csv')));
    if ($format !== 'csv') {
        api_abort('format must be csv', 422);
    }
    $filter = reports_range_filter();
    $cursor = reports_col()->find($filter, ['sort' => ['paidAt' => 1], 'limit' => 5000]);

    $from = trim((string)($_GET['from'] ?? 'all'));
    $to = trim((string)($_GET['to'] ?? 'all'));
    $fname = 'gamehub-transactions-' . ($from === '' ? 'all' : $from)
        . '-to-' . ($to === '' ? 'all' : $to) . '.csv';
    $fname = preg_replace('#[^A-Za-z0-9._-]#', '_', $fname);

    http_response_code(200);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $fname . '"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['ref', 'paidAt', 'table', 'customer', 'cashier', 'minutes', 'billedHours', 'rate', 'rateType', 'total', 'method', 'received', 'change']);
    foreach ($cursor as $d) {
        fputcsv($out, [
            $d['ref'] ?? '',
            isset($d['paidAt']) && $d['paidAt'] instanceof UTCDateTime
                ? $d['paidAt']->toDateTime()->format(DATE_ATOM) : '',
            $d['tableName'] ?? '',
            $d['customerName'] ?? '',
            $d['cashierName'] ?? '',
            $d['minutes'] ?? 0,
            $d['billedHours'] ?? 0,
            $d['pricePerHour'] ?? 0,
            $d['rateType'] ?? '',
            $d['total'] ?? 0,
            $d['method'] ?? '',
            $d['received'] ?? 0,
            $d['change'] ?? 0,
        ]);
    }
    fclose($out);
    exit;
}
