<?php
/**
 * src/function/cashiers/tables.php - cashier read-only view of billiard tables.
 *
 * Pair: Frontend/src/function/cashiers/cashier-dashboard.html <-> this file.
 * CA-003/CA-017: cashiers see current statuses (Available/Occupied/Reserved/
 * Maintenance). Read-only: no rename/status/archive here (CA-018 later).
 * Archived tables are never returned (same convention as play flows).
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;

function tables_cashier_list(array $params = []): array
{
    require_login();
    $status = strtolower(trim((string)($_GET['status'] ?? 'all')));
    $filter = ['archived' => ['$ne' => true]];
    if (in_array($status, TABLE_STATUSES, true)) {
        $filter['status'] = $status;
    }
    $out = [];
    $cursor = DatabaseConnection::db()->selectCollection('tables')->find(
        $filter,
        ['sort' => ['name' => 1]]
    );
    foreach ($cursor as $doc) {
        $out[] = [
            'id' => (string)$doc['_id'],
            'name' => $doc['name'] ?? '',
            'status' => $doc['status'] ?? 'available',
        ];
    }
    return ['ok' => true, 'tables' => $out];
}
