<?php
/**
 * Backend/scripts/setup_settings.php - one-time integration settings setup.
 *
 * Creates the unique `settings.key` index and seeds one document per registry
 * key. Run once from the repository root (or Backend/):
 *   php Backend/scripts/setup_settings.php
 * Never called per request (per AGENTS.md). Safe to run repeatedly: existing
 * documents are left untouched via $setOnInsert.
 */
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Dotenv\Dotenv;
use App\Config\DatabaseConnection;

$dotenv = Dotenv::createImmutable(__DIR__ . '/..');
$dotenv->safeLoad();

require __DIR__ . '/../src/function/admin/settings.php';

$col = DatabaseConnection::db()->selectCollection('settings');
$index = $col->createIndex(['key' => 1], ['unique' => true, 'name' => 'uniq_setting_key']);
echo "settings index OK: {$index}" . PHP_EOL;

foreach (array_keys(settings_registry()) as $key) {
    $result = $col->updateOne(
        ['key' => $key],
        ['$setOnInsert' => settings_default($key)],
        ['upsert' => true]
    );
    $state = $result->getUpsertedCount() > 0 ? 'seeded' : 'exists';
    echo "{$state}: {$key}" . PHP_EOL;
}
