<?php
require __DIR__ . '/../vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/..');
$dotenv->safeLoad();
require __DIR__ . '/../src/Config/DatabaseConnection.php';
$db = App\Config\DatabaseConnection::db();
$users = $db->selectCollection('users');
// Admin account (single admin by design)
$adminEmail = 'jamespepito833@gmail.com';
if ($users->countDocuments(['email' => $adminEmail]) === 0) {
    $users->insertOne([
        'email' => $adminEmail,
        'passwordHash' => password_hash('Admin123!', PASSWORD_BCRYPT),
        'role' => 'admin',
        'status' => 'active',
        'displayName' => 'Admin',
        'authProvider' => 'local',
        'createdAt' => new MongoDB\BSON\UTCDateTime(),
    ]);
    echo "admin created\n";
} else {
    echo "admin exists\n";
}
// healthcheck doc
$hc = $db->selectCollection('healthcheck');
if ($hc->countDocuments() === 0) {
    $hc->insertOne(['heartbeat' => new MongoDB\BSON\UTCDateTime()]);
    echo "healthcheck created\n";
}
// rates
$rates = $db->selectCollection('rates');
foreach (['regular' => 140, 'special' => 180] as $type => $price) {
    $rates->updateOne(
        ['type' => $type],
        ['$setOnInsert' => ['type' => $type, 'pricePerHour' => $price, 'active' => true, 'updatedAt' => new MongoDB\BSON\UTCDateTime()]],
        ['upsert' => true]
    );
}
echo "rates seeded\n";
// sample tables
$tables = $db->selectCollection('tables');
if ($tables->countDocuments() === 0) {
    foreach (['Table 1','Table 2','Table 3','Table 4','Table 5'] as $n) {
        $tables->insertOne(['name' => $n, 'status' => 'available', 'archived' => false, 'createdAt' => new MongoDB\BSON\UTCDateTime()]);
    }
    echo "tables seeded\n";
}
// One-time indexes (AGENTS.md: never create indexes per request).
// Re-running is safe: createIndex with an identical spec is a no-op.
$indexSetup = [
    ['tables',    ['name' => 1],     ['unique' => true, 'name' => 'uniq_table_name']],
    ['rates',     ['type' => 1],     ['unique' => true, 'name' => 'uniq_rate_type']],
    // users: partial-unique email + unique username when present (string only),
    // so docs missing/null username (e.g. the admin) never collide.
    ['users',     ['email' => 1],    ['unique' => true, 'name' => 'uniq_email',
        'partialFilterExpression' => ['email' => ['$type' => 'string']]]],
    ['users',     ['username' => 1], ['unique' => true, 'name' => 'uniq_username',
        'partialFilterExpression' => ['username' => ['$type' => 'string']]]],
    // invitations: single-use tokens (see src/function/auth/invite.php).
    ['invitations', ['tokenHash' => 1], ['unique' => true, 'name' => 'uniq_tokenHash']],
];
foreach ($indexSetup as [$coll, $keys, $opts]) {
    $db->selectCollection($coll)->createIndex($keys, $opts);
    echo "index ok: {$coll}.{$opts['name']}\n";
}
echo "done\n";