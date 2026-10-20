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
                'last4' => substr($clientId, -4),
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

/** Effective settings: database document when present, defaults otherwise. */
function settings_effective(string $key): array
{
    $registry = settings_registry();
    if (!isset($registry[$key])) {
        api_abort('unknown integration', 404);
    }
    $doc = settings_document($key);
    $basis = $doc ?? settings_default($key);

    $credentials = [];
    $rawCredentials = is_array($basis['credentials'] ?? null) ? $basis['credentials'] : [];
    foreach ($registry[$key]['credentials'] as $name => $def) {
        $raw = is_array($rawCredentials[$name] ?? null) ? $rawCredentials[$name] : [];
        $value = (string)($raw['value'] ?? '');
        $last4 = (string)($raw['last4'] ?? '');
        if ($last4 === '' && $value !== '') {
            $last4 = substr($value, -4);
        }
        $updatedAt = $raw['updatedAt'] ?? null;
        $credentials[$name] = [
            'value' => $value,
            'last4' => $last4,
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

/** Eight bullets plus the last four characters; bullets only for short values. */
function settings_mask_value(string $value): string
{
    if ($value === '') {
        return '';
    }
    if (strlen($value) > 8) {
        return str_repeat('•', 8) . substr($value, -4);
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
        $credentials[] = [
            'name' => $name,
            'label' => $def['label'],
            'required' => (bool)$def['required'],
            'configured' => $value !== '',
            'masked' => settings_mask_value($value),
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

/** Public integration state for GET /api/config (never includes secrets). */
function settings_public_config(): array
{
    $auth = settings_effective('googleAuth');
    $maps = settings_effective('googleMaps');
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

/** Google Auth state for backend enforcement. Throws when the store fails. */
function settings_google_auth(): array
{
    $auth = settings_effective('googleAuth');
    return [
        'enabled' => (bool)$auth['enabled'],
        'clientId' => (string)$auth['credentials']['clientId']['value'],
    ];
}

/** GET /api/config - public feature state. Fail closed on a store failure. */
function app_config(array $params = []): array
{
    header('Cache-Control: no-store');
    try {
        $integrations = settings_public_config();
    } catch (Throwable $e) {
        error_log('[gamehub] settings config read failed');
        $clientId = trim((string)($_ENV['GOOGLE_CLIENT_ID'] ?? getenv('GOOGLE_CLIENT_ID') ?: ''));
        $integrations = [
            'googleAuth' => [
                'enabled' => $clientId !== '',
                'clientId' => $clientId,
            ],
            'googleMaps' => ['enabled' => false, 'apiKey' => ''],
        ];
    }
    return [
        'ok' => true,
        // Temporary compatibility key for the current login.js (removed in Task 4).
        'googleClientId' => $integrations['googleAuth']['clientId'],
        'integrations' => $integrations,
    ];
}

/** GET /api/admin/settings/integrations - admin-only, masked credentials. */
function settings_list(array $params = []): array
{
    require_admin();
    $out = [];
    foreach (array_keys(settings_registry()) as $key) {
        $out[] = settings_shape($key, settings_effective($key));
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
        if (preg_match('/\s/', $value) || !str_ends_with($value, '.apps.googleusercontent.com')) {
            api_abort('Google client ID must end with .apps.googleusercontent.com', 422);
        }
    }
    if ($key === 'googleMaps' && $name === 'apiKey' && $value !== '' && preg_match('/\s/', $value)) {
        api_abort('Maps API key must not contain whitespace', 422);
    }
}

/** Append an audit entry. Metadata must never include credential values. */
function settings_log(string $action, string $target, array $meta): void
{
    $actor = current_user();
    DatabaseConnection::db()->selectCollection('activityLogs')->insertOne([
        'actorId' => $actor['id'] ?? null,
        'action' => $action,
        'target' => $target,
        'meta' => $meta,
        'at' => new UTCDateTime(),
    ]);
}

/**
 * PUT /api/admin/settings/integrations/{key}
 * Toggle an integration and/or replace/clear its credentials. Omitted fields
 * stay unchanged; an empty string clears a credential. Clearing a required
 * credential auto-disables the integration.
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
    $enabled = (bool)$effective['enabled'];
    $changed = [];

    if (array_key_exists('enabled', $data)) {
        if (!is_bool($data['enabled'])) {
            api_abort('enabled must be a boolean', 422);
        }
        $enabled = $data['enabled'];
        $changed[] = 'enabled';
    }

    // Start from current values so omitted credentials stay unchanged.
    $credentials = [];
    foreach ($registry[$key]['credentials'] as $name => $def) {
        $current = $effective['credentials'][$name] ?? [];
        $currentUpdatedAt = $current['updatedAt'] ?? null;
        $credentials[$name] = [
            'value' => (string)($current['value'] ?? ''),
            'last4' => (string)($current['last4'] ?? ''),
            'updatedAt' => $currentUpdatedAt instanceof UTCDateTime ? $currentUpdatedAt : null,
        ];
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
            $credentials[$name] = [
                'value' => $value,
                'last4' => $value !== '' ? substr($value, -4) : '',
                'updatedAt' => new UTCDateTime(),
            ];
            $changed[] = 'credentials.' . $name;
        }
    }

    if ($changed === []) {
        api_abort('nothing to update (allowed: enabled, credentials)', 422);
    }

    foreach ($registry[$key]['credentials'] as $name => $def) {
        if (empty($def['required']) || $credentials[$name]['value'] !== '') {
            continue;
        }
        if ($enabled) {
            if (in_array('enabled', $changed, true)) {
                api_abort('cannot enable this integration without its required credential', 422);
            }
            // Clearing a required credential auto-disables the integration.
            $enabled = false;
        }
    }

    settings_collection()->updateOne(
        ['key' => $key],
        [
            '$set' => [
                'enabled' => $enabled,
                'credentials' => $credentials,
                'updatedAt' => new UTCDateTime(),
                'updatedBy' => $admin['email'] ?? null,
            ],
            '$setOnInsert' => ['key' => $key],
        ],
        ['upsert' => true]
    );
    settings_log('integration_settings_update', $key, [
        'enabled' => $enabled,
        'changed' => $changed,
    ]);

    return ['ok' => true, 'integration' => settings_shape($key, settings_effective($key))];
}
