<?php
/**
 * src/function/admin/settings.php - admin-only integration settings.
 *
 * Owns the server-side integration registry, MongoDB-backed integration
 * documents, masked credential shapes, the public /api/config projection, and
 * the admin list endpoint. Credential values are never returned in full:
 * admin responses expose only a mask and a boolean "configured" flag.
 *
 * Storage: `settings` collection, one document per registry key. The database
 * is the source of truth once a document exists; environment values are used
 * only as a default when the document is missing. Index creation and seeding
 * live in Backend/scripts/setup_settings.php (never per request).
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Driver\Session;
use MongoDB\Operation\FindOneAndUpdate;

function settings_collection(): \MongoDB\Collection
{
    return DatabaseConnection::db()->selectCollection('settings');
}

/** Server-defined integrations. Drives both the admin cards and enforcement. */
function settings_registry(): array
{
    return [
        'googleAuth' => [
            'name' => 'Google Authentication',
            'description' => 'Admin Google sign-in',
            'available' => true,
            'credentials' => [
                'clientId' => [
                    'label' => 'OAuth Client ID',
                    'required' => true,
                    'secret' => false,
                ],
            ],
        ],
        'googleMaps' => [
            'name' => 'Google Maps',
            'description' => 'Location map on the public landing page',
            'available' => true,
            'credentials' => [
                'apiKey' => [
                    'label' => 'Maps API key (optional)',
                    'required' => false,
                    'secret' => false,
                ],
            ],
        ],
        'recaptcha' => [
            'name' => 'reCAPTCHA',
            'description' => 'Bot protection (planned)',
            'available' => false,
            'credentials' => [
                'siteKey' => ['label' => 'Site key', 'required' => false, 'secret' => false],
                'secretKey' => ['label' => 'Secret key', 'required' => false, 'secret' => true],
            ],
        ],
        'otp' => [
            'name' => 'OTP / email codes',
            'description' => 'Email verification codes (planned)',
            'available' => false,
            'credentials' => [],
        ],
    ];
}

/** Recursively turn BSON documents/arrays into plain PHP arrays. */
function settings_normalize(mixed $value): mixed
{
    if ($value instanceof UTCDateTime || $value instanceof ObjectId) {
        return $value;
    }
    if ($value instanceof \MongoDB\BSON\Document) {
        $value = $value->toPHP();
        if (is_array($value) && count($value) === 1 && array_key_exists('root', $value)) {
            $value = $value['root'];
        }
    } elseif ($value instanceof \Traversable) {
        $value = iterator_to_array($value);
    } elseif (is_object($value)) {
        $value = (array)$value;
    }
    if (is_array($value)) {
        foreach ($value as $k => $v) {
            $value[$k] = settings_normalize($v);
        }
    }
    return $value;
}

/**
 * Safe display hint for a credential. Google client IDs have a fixed domain
 * suffix, so the hint comes from the identifying part instead of ".com".
 */
function settings_credential_hint(string $key, string $name, string $value): string
{
    if ($value === '') {
        return '';
    }
    if ($key === 'googleAuth' && $name === 'clientId') {
        $suffix = '.apps.googleusercontent.com';
        if (str_ends_with($value, $suffix)) {
            $prefix = substr($value, 0, -strlen($suffix));
            return $prefix !== '' ? substr($prefix, -4) : '';
        }
    }
    return substr($value, -4);
}

/**
 * Default effective settings when no document exists. Google Auth falls back
 * to GOOGLE_CLIENT_ID; Maps preserves the legacy landing-page map.
 */
function settings_default(string $key): array
{
    $registry = settings_registry();
    $credentials = [];
    foreach (($registry[$key]['credentials'] ?? []) as $name => $def) {
        $credentials[$name] = ['value' => '', 'last4' => '', 'updatedAt' => null];
    }
    $enabled = false;
    if ($key === 'googleAuth') {
        $clientId = trim((string)($_ENV['GOOGLE_CLIENT_ID'] ?? getenv('GOOGLE_CLIENT_ID') ?: ''));
        if ($clientId !== '') {
            $enabled = true;
            $credentials['clientId'] = [
                'value' => $clientId,
                'last4' => settings_credential_hint('googleAuth', 'clientId', $clientId),
                'updatedAt' => null,
            ];
        }
    } elseif ($key === 'googleMaps') {
        // Legacy default: the keyless embed is shown when nothing is configured.
        $enabled = true;
    }
    return [
        'key' => $key,
        'enabled' => $enabled,
        'credentials' => $credentials,
        'updatedAt' => null,
        'updatedBy' => null,
    ];
}

/** Raw settings document, or null when the key is not seeded. Throws on DB failure. */
function settings_document(string $key): ?array
{
    $doc = settings_collection()->findOne(['key' => $key]);
    if ($doc === null) {
        return null;
    }
    $normalized = settings_normalize($doc);
    return is_array($normalized) ? $normalized : null;
}

/** Effective settings from an already-loaded document (or a default). */
function settings_effective_from_doc(string $key, ?array $doc): array
{
    $registry = settings_registry();
    if (!isset($registry[$key])) {
        api_abort('unknown integration', 404);
    }
    $basis = $doc ?? settings_default($key);

    $credentials = [];
    $rawCredentials = is_array($basis['credentials'] ?? null) ? $basis['credentials'] : [];
    foreach ($registry[$key]['credentials'] as $name => $def) {
        $raw = is_array($rawCredentials[$name] ?? null) ? $rawCredentials[$name] : [];
        $value = (string)($raw['value'] ?? '');
        $updatedAt = $raw['updatedAt'] ?? null;
        $credentials[$name] = [
            'value' => $value,
            'last4' => settings_credential_hint($key, (string)$name, $value),
            'updatedAt' => $updatedAt instanceof UTCDateTime ? $updatedAt : null,
        ];
    }

    $enabled = (bool)($basis['enabled'] ?? false);
    // A required credential is a hard prerequisite, even for legacy documents.
    foreach ($registry[$key]['credentials'] as $name => $def) {
        if (!empty($def['required']) && $credentials[$name]['value'] === '') {
            $enabled = false;
        }
    }

    return [
        'key' => $key,
        'enabled' => $enabled,
        'credentials' => $credentials,
        'updatedAt' => ($basis['updatedAt'] ?? null) instanceof UTCDateTime
            ? $basis['updatedAt'] : null,
        'updatedBy' => isset($basis['updatedBy']) ? (string)$basis['updatedBy'] : null,
    ];
}

/** Load several settings documents in one round trip. Throws on DB failure. */
function settings_documents(array $keys): array
{
    $keys = array_values(array_unique($keys));
    if ($keys === []) {
        return [];
    }
    $out = [];
    foreach (settings_collection()->find(['key' => ['$in' => $keys]]) as $doc) {
        $normalized = settings_normalize($doc);
        if (is_array($normalized) && isset($normalized['key'])) {
            $out[(string)$normalized['key']] = $normalized;
        }
    }
    return $out;
}

/** Effective settings for several keys from one database read. */
function settings_effective_many(array $keys): array
{
    $docs = settings_documents($keys);
    $out = [];
    foreach ($keys as $key) {
        $out[$key] = settings_effective_from_doc((string)$key, $docs[(string)$key] ?? null);
    }
    return $out;
}

/** Effective settings: database document when present, defaults otherwise. */
function settings_effective(string $key): array
{
    return settings_effective_from_doc($key, settings_document($key));
}

/** Eight bullets plus a safe four-character hint; bullets only for short values. */
function settings_mask_value(string $value, string $hint = ''): string
{
    if ($value === '') {
        return '';
    }
    if (strlen($value) > 8) {
        return str_repeat('•', 8) . ($hint !== '' ? $hint : substr($value, -4));
    }
    return str_repeat('•', 8);
}

/** Safe admin shape for one integration: masked credentials only. */
function settings_shape(string $key, array $doc): array
{
    $registry = settings_registry();
    if (!isset($registry[$key])) {
        api_abort('unknown integration', 404);
    }
    $credentials = [];
    foreach ($registry[$key]['credentials'] as $name => $def) {
        $value = (string)($doc['credentials'][$name]['value'] ?? '');
        $hint = (string)($doc['credentials'][$name]['last4'] ?? '');
        $credentials[] = [
            'name' => $name,
            'label' => $def['label'],
            'required' => (bool)$def['required'],
            'configured' => $value !== '',
            'masked' => settings_mask_value($value, $hint),
        ];
    }
    $updatedAt = $doc['updatedAt'] ?? null;
    return [
        'key' => $key,
        'name' => $registry[$key]['name'],
        'description' => $registry[$key]['description'],
        'available' => (bool)$registry[$key]['available'],
        'enabled' => (bool)($doc['enabled'] ?? false),
        'credentials' => $credentials,
        'updatedAt' => $updatedAt instanceof UTCDateTime
            ? $updatedAt->toDateTime()->format(DATE_ATOM) : null,
        'updatedBy' => isset($doc['updatedBy']) ? (string)$doc['updatedBy'] : null,
    ];
}

/** Public shape from already-resolved effective settings (never secrets). */
function settings_public_config_from_effective(array $effective): array
{
    $auth = $effective['googleAuth'];
    $maps = $effective['googleMaps'];
    return [
        'googleAuth' => [
            'enabled' => (bool)$auth['enabled'],
            'clientId' => $auth['enabled'] ? (string)$auth['credentials']['clientId']['value'] : '',
        ],
        'googleMaps' => [
            'enabled' => (bool)$maps['enabled'],
            'apiKey' => $maps['enabled'] ? (string)$maps['credentials']['apiKey']['value'] : '',
        ],
    ];
}

/** Public integration state for GET /api/config (never includes secrets). */
function settings_public_config(): array
{
    return settings_public_config_from_effective(
        settings_effective_many(['googleAuth', 'googleMaps'])
    );
}

/** Google Auth state for backend enforcement. Throws when the store fails. */
function settings_google_auth(): array
{
    $auth = settings_effective('googleAuth');
    return [
        'enabled' => (bool)$auth['enabled'],
        'clientId' => (string)$auth['credentials']['clientId']['value'],
    ];
}

/**
 * GET /api/config - public feature state. A store failure fails closed for both
 * integrations; environment defaults are used only when the documents are
 * positively absent (inside settings_default()).
 */
function app_config(array $params = []): array
{
    header('Cache-Control: no-store');
    try {
        $integrations = settings_public_config();
    } catch (Throwable $e) {
        error_log('[gamehub] settings config read failed');
        $integrations = [
            'googleAuth' => ['enabled' => false, 'clientId' => ''],
            'googleMaps' => ['enabled' => false, 'apiKey' => ''],
        ];
    }
    return [
        'ok' => true,
        'integrations' => $integrations,
    ];
}

/** GET /api/admin/settings/integrations - admin-only, masked credentials. */
function settings_list(array $params = []): array
{
    require_admin();
    $keys = array_keys(settings_registry());
    $effective = settings_effective_many($keys);
    $out = [];
    foreach ($keys as $key) {
        $out[] = settings_shape($key, $effective[$key]);
    }
    return ['ok' => true, 'integrations' => $out];
}

/** Validate one credential without ever echoing its value. */
function settings_validate_credential(string $key, string $name, string $value): void
{
    if (strlen($value) > 2048) {
        api_abort('credential is too long (maximum 2048 characters)', 422);
    }
    if ($key === 'googleAuth' && $name === 'clientId' && $value !== '') {
        if (
            preg_match('/\s/', $value) ||
            !preg_match('/^[A-Za-z0-9_-]{5,}\.apps\.googleusercontent\.com$/', $value)
        ) {
            api_abort('Google client ID must end with .apps.googleusercontent.com and include an identifier', 422);
        }
    }
    if ($key === 'googleMaps' && $name === 'apiKey' && $value !== '' && preg_match('/\s/', $value)) {
        api_abort('Maps API key must not contain whitespace', 422);
    }
}

/** Append an audit entry. Metadata must never include credential values. */
function settings_log(string $action, string $target, array $meta, ?Session $session = null): void
{
    $actor = current_user();
    $options = $session !== null ? ['session' => $session] : [];
    DatabaseConnection::db()->selectCollection('activityLogs')->insertOne([
        'actorId' => $actor['id'] ?? null,
        'action' => $action,
        'target' => $target,
        'meta' => $meta,
        'at' => new UTCDateTime(),
    ], $options);
}

/**
 * Build a field-level update plan. Validation and required-credential rules
 * live here so they can be tested without a database.
 */
function settings_plan_update(string $key, array $effective, array $data): array
{
    $registry = settings_registry();
    if (!isset($registry[$key])) {
        api_abort('unknown integration', 404);
    }

    $enabled = (bool)($effective['enabled'] ?? false);
    $enabledChanged = false;
    $changed = [];
    $credentialWrites = [];

    if (array_key_exists('enabled', $data)) {
        if (!is_bool($data['enabled'])) {
            api_abort('enabled must be a boolean', 422);
        }
        $enabled = $data['enabled'];
        $enabledChanged = true;
        $changed[] = 'enabled';
    }

    if (array_key_exists('credentials', $data)) {
        if (!is_array($data['credentials'])) {
            api_abort('credentials must be an object', 422);
        }
        foreach ($data['credentials'] as $name => $raw) {
            if (!isset($registry[$key]['credentials'][$name])) {
                api_abort('unknown credential for this integration', 422);
            }
            if (!is_string($raw)) {
                api_abort('credential values must be strings', 422);
            }
            $value = trim($raw);
            settings_validate_credential($key, (string)$name, $value);
            $credentialWrites[$name] = $value === '' ? null : [
                'value' => $value,
                'last4' => settings_credential_hint($key, (string)$name, $value),
                'updatedAt' => new UTCDateTime(),
            ];
            $changed[] = 'credentials.' . $name;
        }
    }

    if ($changed === []) {
        api_abort('nothing to update (allowed: enabled, credentials)', 422);
    }

    foreach ($registry[$key]['credentials'] as $name => $def) {
        if (empty($def['required'])) {
            continue;
        }
        $value = array_key_exists($name, $credentialWrites)
            ? (string)($credentialWrites[$name]['value'] ?? '')
            : (string)($effective['credentials'][$name]['value'] ?? '');
        if ($value !== '') {
            continue;
        }
        if ($enabled) {
            if ($enabledChanged) {
                api_abort('cannot enable this integration without its required credential', 422);
            }
            // Clearing a required credential auto-disables the integration.
            $enabled = false;
            $enabledChanged = true;
            if (!in_array('enabled', $changed, true)) {
                $changed[] = 'enabled';
            }
        }
    }

    $set = [];
    $unset = [];
    $setOnInsert = ['key' => $key];

    if ($enabledChanged) {
        $set['enabled'] = $enabled;
    } else {
        $setOnInsert['enabled'] = $enabled;
    }

    foreach ($registry[$key]['credentials'] as $name => $def) {
        if (array_key_exists($name, $credentialWrites)) {
            if ($credentialWrites[$name] === null) {
                $unset['credentials.' . $name] = true;
            } else {
                $set['credentials.' . $name] = $credentialWrites[$name];
            }
            continue;
        }
        // Preserve omitted credentials when the document is first inserted.
        $current = is_array($effective['credentials'][$name] ?? null)
            ? $effective['credentials'][$name] : [];
        $updatedAt = $current['updatedAt'] ?? null;
        $setOnInsert['credentials.' . $name] = [
            'value' => (string)($current['value'] ?? ''),
            'last4' => (string)($current['last4'] ?? ''),
            'updatedAt' => $updatedAt instanceof UTCDateTime ? $updatedAt : null,
        ];
    }

    return [
        'enabled' => $enabled,
        'changed' => $changed,
        'set' => $set,
        'unset' => $unset,
        'set_on_insert' => $setOnInsert,
    ];
}

/**
 * PUT /api/admin/settings/integrations/{key}
 * Toggle an integration and/or replace/clear its credentials. Omitted fields
 * stay unchanged; an empty string clears a credential. Clearing a required
 * credential auto-disables the integration. The settings write and audit entry
 * commit together so a reported success is always audited.
 */
function settings_update(array $params = []): array
{
    $admin = require_admin();
    $key = (string)($params['key'] ?? '');
    $registry = settings_registry();
    if (!isset($registry[$key])) {
        api_abort('unknown integration', 404);
    }
    if (empty($registry[$key]['available'])) {
        api_abort('planned integrations cannot be changed', 422);
    }

    $data = json_body();
    $effective = settings_effective($key);
    $plan = settings_plan_update($key, $effective, $data);

    $set = $plan['set'];
    $set['updatedAt'] = new UTCDateTime();
    $set['updatedBy'] = $admin['email'] ?? null;
    $update = ['$set' => $set];
    if ($plan['unset'] !== []) {
        $update['$unset'] = $plan['unset'];
    }
    if ($plan['set_on_insert'] !== []) {
        $update['$setOnInsert'] = $plan['set_on_insert'];
    }

    $session = DatabaseConnection::client()->startSession();
    try {
        $session->startTransaction();
        $updated = settings_collection()->findOneAndUpdate(
            ['key' => $key],
            $update,
            [
                'upsert' => true,
                'returnDocument' => FindOneAndUpdate::RETURN_DOCUMENT_AFTER,
                'session' => $session,
            ]
        );
        $normalized = settings_normalize($updated);
        if (!is_array($normalized)) {
            throw new RuntimeException('settings update returned no document');
        }
        $shape = settings_shape($key, settings_effective_from_doc($key, $normalized));
        settings_log('integration_settings_update', $key, [
            'enabled' => $plan['enabled'],
            'changed' => $plan['changed'],
        ], $session);
        $session->commitTransaction();
        return ['ok' => true, 'integration' => $shape];
    } catch (Throwable $e) {
        if ($session->isInTransaction()) {
            try {
                $session->abortTransaction();
            } catch (Throwable $abortError) {
                error_log('[gamehub] settings transaction abort failed');
            }
        }
        throw $e;
    } finally {
        $session->endSession();
    }
}
