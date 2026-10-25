<?php
/**
 * src/function/auth/invite.php - cashier invitation links (single admin system).
 *
 * Pair: Invite button + invitations list on Frontend/src/function/admin/cashiers.html
 * <-> this file; token-gated register.html <-> invite_check/register.
 * Flow: admin types an applicant email -> unique link mailed (24h, single-use)
 * -> holder opens register.html?token=... -> creates the CASHIER account whose
 * email must equal the invited email -> link marked used (double-submit safe).
 * No account is ever created without a valid unused unexpired token.
 */
declare(strict_types=1);

use App\Config\DatabaseConnection;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use PHPMailer\PHPMailer\PHPMailer;

const INVITE_TTL_SECONDS = 86400;   // 24 hours

function invite_col()
{
    // No per-request index creation here (php -S is single-threaded;
    // keep index setup as a one-time script, never per-request).
    // Required one-time index: unique {tokenHash:1} on `invitations`.
    return DatabaseConnection::db()->selectCollection('invitations');
}

/** Robust expiry read: UTCDateTime -> epoch millis. */
function invite_expires_ms($doc): int
{
    $exp = $doc['expiresAt'] ?? null;
    if ($exp instanceof UTCDateTime) {
        try {
            return $exp->toDateTime()->getTimestamp() * 1000;
        } catch (Throwable $ignored) {
            // Fall through to string cast below.
        }
        return (int)((string)$exp);
    }
    return 0;
}

function invite_send_mail(string $toEmail, string $link): void
{
    $user = $_ENV['MAIL_USER'] ?? getenv('MAIL_USER') ?: '';
    $pass = $_ENV['MAIL_PASS'] ?? getenv('MAIL_PASS') ?: '';
    $fromName = $_ENV['MAIL_FROM'] ?? getenv('MAIL_FROM') ?: 'GameHub';
    if ($user === '' || $pass === '') {
        api_abort('mail sending is not configured (set MAIL_USER/MAIL_PASS in Backend/.env)', 500);
    }
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = 'smtp.gmail.com';
    $mail->SMTPAuth = true;
    $mail->Username = $user;
    $mail->Password = $pass;
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port = 587;
    $mail->Timeout = 15;
    $mail->CharSet = 'UTF-8';
    $mail->setFrom($user, $fromName);
    $mail->addAddress($toEmail);
    $mail->Subject = 'Your GameHub cashier invitation';
    $mail->Body = "Hi there,\n\n"
        . "You have been invited to create a GameHub cashier account.\n"
        . "Open this link within 24 hours (single use):\n\n{$link}\n\n"
        . "If you did not expect this, ignore this mail.\n";
    try {
        $mail->send();
    } catch (Throwable $e) {
        // Log the driver detail for the admin (never leaks to Frontend).
        error_log('[gamehub] invite mail to ' . $toEmail . ' failed: ' . $mail->ErrorInfo . ' | ' . $e->getMessage());
        api_abort('could not send the invitation email — check MAIL_USER/MAIL_PASS app password, then try again', 502);
    }
}

/** Lookup a presented token. Returns [doc|null, state]. Never reveals emails. */
function invite_find(string $token): array
{
    if ($token === '') {
        return [null, 'invalid'];
    }
    $doc = invite_col()->findOne(['tokenHash' => hash('sha256', $token)]);
    if ($doc === null) {
        return [null, 'invalid'];
    }
    if (!empty($doc['used'])) {
        return [$doc, 'used'];
    }
    if (invite_expires_ms($doc) < (int)(microtime(true) * 1000)) {
        return [$doc, 'expired'];
    }
    return [$doc, 'valid'];
}

/** POST /api/admin/invitations {email} — invite (or re-invite) a cashier. */
function invite_create(array $params = []): array
{
    $admin = require_admin();
    $data = json_body();
    $email = strtolower(trim((string)($data['email'] ?? '')));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        api_abort('valid email is required', 422);
    }

    $base = rtrim($_ENV['FRONTEND_URL'] ?? getenv('FRONTEND_URL') ?: '', '/');
    if ($base === '') {
        api_abort('FRONTEND_URL is not set in Backend/.env, cannot build the invitation link', 500);
    }

    $col = invite_col();
    // Resend replaces: one live invitation per email at a time.
    $col->deleteMany(['email' => $email, 'used' => false]);
    $token = bin2hex(random_bytes(32));
    $now = new UTCDateTime();
    $res = $col->insertOne([
        'email' => $email,
        'tokenHash' => hash('sha256', $token),
        'role' => 'cashier',
        'expiresAt' => new UTCDateTime((time() + INVITE_TTL_SECONDS) * 1000),
        'used' => false,
        'createdBy' => $admin['id'],
        'createdAt' => $now,
    ]);

    $link = $base . '/src/function/auth/register.html?token=' . $token;
    try {
        invite_send_mail($email, $link);
    } catch (Throwable $e) {
        // Don't leave a phantom pending invite that was never mailed.
        $col->deleteOne(['_id' => $res->getInsertedId()]);
        throw $e;
    }

    return [
        'ok' => true,
        'id' => (string)$res->getInsertedId(),
        'email' => $email,
        'link' => $link,
        'message' => 'invitation sent (valid 24 hours, single use)',
    ];
}

/** GET /api/invitations/{token} — public validity check for the register page. */
function invite_check(array $params = []): array
{
    [$doc, $state] = invite_find((string)($params['token'] ?? ''));
    if ($state !== 'valid') {
        api_abort('invitation ' . $state, $state === 'invalid' ? 404 : 410);
    }
    return ['ok' => true, 'valid' => true, 'email' => $doc['email']];
}

/** GET /api/admin/invitations — pending/used/expired invitation list. */
function invite_list(array $params = []): array
{
    require_admin();
    $nowMs = (int)(microtime(true) * 1000);
    $out = [];
    foreach (invite_col()->find([], ['sort' => ['createdAt' => -1]]) as $doc) {
        $status = !empty($doc['used']) ? 'used' : (invite_expires_ms($doc) < $nowMs ? 'expired' : 'pending');
        $out[] = [
            'id' => (string)$doc['_id'],
            'email' => $doc['email'] ?? '',
            'status' => $status,
            'createdAt' => isset($doc['createdAt']) ? $doc['createdAt']->toDateTime()->format(DATE_ATOM) : null,
        ];
    }
    return ['ok' => true, 'invitations' => $out];
}

/** POST /api/admin/invitations/{id}/revoke — kill a live invitation. */
function invite_revoke(array $params = []): array
{
    require_admin();
    $id = cashiers_id($params['id'] ?? '');
    $doc = invite_col()->findOne(['_id' => $id]);
    if ($doc === null) {
        api_abort('invitation not found', 404);
    }
    invite_col()->updateOne(['_id' => $id], ['$set' => ['used' => true, 'revoked' => true]]);
    return ['ok' => true, 'id' => (string)$doc['_id'], 'status' => 'revoked'];
}
