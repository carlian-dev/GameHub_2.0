<?php
/**
 * src/function/shared/health.php - Backend logic for the landing-page status card.
 *
 * Pair: Frontend/src/function/shared/index.js (status check) <-> this file.
 * Answers "Is the Backend + Database alive?" by pinging Atlas and counting
 * the "healthcheck" collection. Example reply:
 *   {"ok":true,"db":"gamehub_2_0","ping":"ok","healthcheck_count":1}
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;

function health_handle(array $params = []): array
{
    $dbName = DatabaseConnection::dbName();
    $db = DatabaseConnection::db();
    // Ping Atlas
    $db->command(['ping' => 1]);
    // Count healthcheck docs (created in Atlas Data Explorer)
    $count = $db->selectCollection('healthcheck')->countDocuments();

    return [
        'ok' => true,
        'db' => $dbName,
        'ping' => 'ok',
        'healthcheck_count' => $count,
    ];
}