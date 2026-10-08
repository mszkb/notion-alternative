<?php

declare(strict_types=1);

namespace NotionAlt\Config;

use NotionAlt\Text\Js;

/**
 * Reads the configuration from environment variables and an optional `config.php` (ADR 0018);
 * invalid values fail with a message that names only variables, never values.
 * Environment variables win over `config.php`; empty values count as unset in both.
 */
final class ConfigLoader
{
    /** Variable naming the config file; default: `config.php` in the app directory. */
    public const CONFIG_FILE_VARIABLE = 'NOTION_ALT_CONFIG';

    private const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

    private const DEFAULT_PUSH_ALLOWED_HOSTS = 'fcm.googleapis.com,updates.push.services.mozilla.com,*.push.apple.com,*.notify.windows.com';

    /** @var array<string, string> */
    private array $values;

    /** @var list<string> */
    private array $errors = [];

    /**
     * @param array<string, string> $values
     */
    private function __construct(array $values, private readonly string $appDir)
    {
        // Compose passes unset optional variables as empty strings (`${S3_ENDPOINT:-}`): treat as unset.
        $this->values = array_filter($values, static fn(string $value): bool => $value !== '');
    }

    /**
     * Loads from the process environment and the config file.
     *
     * @param string $appDir base of relative paths and location of the default `config.php`
     */
    public static function fromEnvironment(string $appDir): Config
    {
        /** @var array<string, string> $env */
        $env = getenv();
        $file = $env[self::CONFIG_FILE_VARIABLE] ?? '';
        if ($file === '') {
            $file = $appDir . '/config.php';
            $fileValues = is_file($file) ? self::readFile($file) : [];
        } else {
            $fileValues = self::readFile($file);
        }

        return self::load($env, $appDir, $fileValues);
    }

    /**
     * @param array<string, string> $env
     * @param array<string, string> $fileValues values from `config.php`
     */
    public static function load(array $env, string $appDir, array $fileValues = []): Config
    {
        $nonEmptyEnv = array_filter($env, static fn(string $value): bool => $value !== '');

        return (new self(array_merge($fileValues, $nonEmptyEnv), $appDir))->build();
    }

    /**
     * Reads a `config.php` that returns an array of variables (strings, numbers, booleans; a list
     * for `PUSH_ALLOWED_HOSTS`).
     *
     * @return array<string, string>
     */
    public static function readFile(string $path): array
    {
        if (!is_file($path) || !is_readable($path)) {
            throw new ConfigException("Config file {$path} is not readable");
        }
        $data = (static fn(string $path): mixed => require $path)($path);
        if (!\is_array($data)) {
            throw new ConfigException("Config file {$path} must return an array");
        }
        $values = [];
        foreach ($data as $name => $value) {
            $name = (string) $name;
            $values[$name] = match (true) {
                \is_string($value) => $value,
                \is_bool($value) => $value ? 'true' : 'false',
                \is_int($value), \is_float($value) => (string) $value,
                $value === null => '',
                \is_array($value) && array_is_list($value) => implode(',', array_map(
                    static fn(mixed $item): string => \is_scalar($item) ? (string) $item : '',
                    $value,
                )),
                default => throw new ConfigException("Config file {$path}: {$name} must be a string, number or boolean"),
            };
        }

        return $values;
    }

    private function build(): Config
    {
        $logLevel = $this->enum('LOG_LEVEL', self::LOG_LEVELS, 'info');
        $dataDir = $this->string('DATA_DIR', './data');
        $databasePath = $this->optionalString('DATABASE_PATH');
        $allowRegistration = $this->boolean('ALLOW_REGISTRATION', false);
        $cookieSecure = $this->boolean('COOKIE_SECURE', false);
        $sessionTtlDays = (int) $this->number('SESSION_TTL_DAYS', 30, true, 1, 365);
        $metricsEnabled = $this->boolean('METRICS_ENABLED', false);
        $windowMinutes = (int) $this->number('AUTH_RATE_LIMIT_WINDOW_MINUTES', 15, true, 1, 1440);
        $loginPerIp = (int) $this->number('LOGIN_MAX_FAILURES_PER_IP', 20, true, 1);
        $loginPerEmail = (int) $this->number('LOGIN_MAX_FAILURES_PER_EMAIL', 5, true, 1);
        $registerPerIp = (int) $this->number('REGISTER_MAX_ATTEMPTS_PER_IP', 10, true, 1);
        $pushSubject = $this->string('PUSH_SUBJECT', 'mailto:admin@localhost');
        $attachmentsDir = $this->optionalString('ATTACHMENTS_DIR');
        $attachmentMaxMb = $this->number('ATTACHMENT_MAX_MB', 25, false, 1, 1024);
        $retentionDays = (int) $this->number('ATTACHMENT_RETENTION_DAYS', 30, true, 0, 3650);
        $workspaceStorageMb = $this->number('WORKSPACE_STORAGE_MB', 2048, false, 0);
        $storage = $this->enum('ATTACHMENT_STORAGE', ['volume', 's3'], 'volume');
        $s3Endpoint = $this->optionalString('S3_ENDPOINT');
        if ($s3Endpoint !== null && !self::isUrl($s3Endpoint)) {
            $this->errors[] = 'S3_ENDPOINT must be a URL';
        }
        $s3Region = $this->string('S3_REGION', 'us-east-1');
        $s3ForcePathStyle = $this->boolean('S3_FORCE_PATH_STYLE', true);
        $importMaxMb = $this->number('IMPORT_MAX_MB', 50, false, 1, 4096);
        $pushAllowedHosts = $this->string('PUSH_ALLOWED_HOSTS', self::DEFAULT_PUSH_ALLOWED_HOSTS);

        if ($this->errors !== []) {
            throw new ConfigException('Invalid configuration: ' . implode('; ', $this->errors));
        }

        return new Config(
            logLevel: $logLevel,
            databasePath: $databasePath !== null
                ? $this->resolvePath($databasePath)
                : $this->resolvePath($dataDir) . '/app.sqlite',
            allowRegistration: $allowRegistration,
            cookieSecure: $cookieSecure,
            sessionTtlDays: $sessionTtlDays,
            metricsEnabled: $metricsEnabled,
            importMaxBytes: self::megabytes($importMaxMb),
            attachments: new AttachmentsConfig(
                dir: $attachmentsDir !== null
                    ? $this->resolvePath($attachmentsDir)
                    : $this->resolvePath($dataDir) . '/attachments',
                // Decimal megabytes, like the browsers' storage pages and the app's display.
                maxBytes: self::megabytes($attachmentMaxMb),
                retentionDays: $retentionDays,
                workspaceQuotaBytes: $workspaceStorageMb > 0 ? self::megabytes($workspaceStorageMb) : null,
                s3: $storage === 's3' ? $this->s3Config($s3Region, $s3ForcePathStyle) : null,
            ),
            push: new PushConfig(
                subject: $pushSubject,
                allowedHosts: array_values(array_filter(
                    array_map(static fn(string $host): string => strtolower(Js::trim($host)), explode(',', $pushAllowedHosts)),
                    static fn(string $host): bool => $host !== '',
                )),
            ),
            authRateLimit: new AuthRateLimitConfig(
                windowMinutes: $windowMinutes,
                loginMaxFailuresPerIp: $loginPerIp,
                loginMaxFailuresPerEmail: $loginPerEmail,
                registerMaxAttemptsPerIp: $registerPerIp,
            ),
        );
    }

    private function s3Config(string $region, bool $forcePathStyle): S3Config
    {
        $names = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
        $missing = array_values(array_filter($names, fn(string $name): bool => !isset($this->values[$name])));
        // Names only, never values: credentials must not end up in logs.
        if ($missing !== []) {
            throw new ConfigException('ATTACHMENT_STORAGE=s3 needs ' . implode(', ', $missing));
        }

        return new S3Config(
            endpoint: $this->values['S3_ENDPOINT'],
            region: $region,
            bucket: $this->values['S3_BUCKET'],
            accessKeyId: $this->values['S3_ACCESS_KEY_ID'],
            secretAccessKey: $this->values['S3_SECRET_ACCESS_KEY'],
            forcePathStyle: $forcePathStyle,
        );
    }

    private function string(string $name, string $default): string
    {
        return $this->values[$name] ?? $default;
    }

    private function optionalString(string $name): ?string
    {
        return $this->values[$name] ?? null;
    }

    /**
     * @param list<string> $allowed
     */
    private function enum(string $name, array $allowed, string $default): string
    {
        $value = $this->values[$name] ?? $default;
        if (!\in_array($value, $allowed, true)) {
            $this->errors[] = "{$name} must be one of " . implode(', ', $allowed);

            return $default;
        }

        return $value;
    }

    /** `true`, `false`, `1` or `0` (booleanFromEnv). */
    private function boolean(string $name, bool $default): bool
    {
        if (!isset($this->values[$name])) {
            return $default;
        }
        $value = $this->values[$name];
        if (!\in_array($value, ['true', 'false', '1', '0'], true)) {
            $this->errors[] = "{$name} must be true, false, 1 or 0";

            return $default;
        }

        return $value === 'true' || $value === '1';
    }

    /** `z.coerce.number()` with optional `.int()`, `.min()` and `.max()`. */
    private function number(string $name, int $default, bool $integer, ?int $min = null, ?int $max = null): float
    {
        if (!isset($this->values[$name])) {
            return $default;
        }
        $value = self::toNumber($this->values[$name]);
        $valid = !is_nan($value)
            && (!$integer || (is_finite($value) && floor($value) === $value && abs($value) <= 9007199254740991))
            && ($min === null || $value >= $min)
            && ($max === null || $value <= $max);
        if (!$valid) {
            $range = match (true) {
                $min !== null && $max !== null => " between {$min} and {$max}",
                $min !== null => " of at least {$min}",
                default => '',
            };
            $this->errors[] = "{$name} must be " . ($integer ? 'an integer' : 'a number') . $range;

            return $default;
        }

        return $value;
    }

    /** JavaScript's `Number(string)`. */
    private static function toNumber(string $value): float
    {
        $value = Js::trim($value);
        if ($value === '') {
            return 0.0;
        }
        if (preg_match('/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/D', $value) === 1) {
            return (float) $value;
        }
        if (preg_match('/^0([xob])([0-9a-f]+)$/iD', $value, $match) === 1) {
            $base = match (strtolower($match[1])) {
                'x' => 16,
                'o' => 8,
                default => 2,
            };
            $digits = strtolower($match[2]);
            if (strspn($digits, substr('0123456789abcdef', 0, $base)) === \strlen($digits)) {
                return (float) base_convert($digits, $base, 10);
            }

            return NAN;
        }

        return match ($value) {
            'Infinity', '+Infinity' => INF,
            '-Infinity' => -INF,
            default => NAN,
        };
    }

    /** `z.url()`: anything with a scheme that parses as a URL. */
    private static function isUrl(string $value): bool
    {
        return preg_match('/^[a-z][a-z0-9+.\-]*:/iD', $value) === 1 && parse_url($value) !== false;
    }

    /** Decimal megabytes to bytes (`Math.round(mb * 1_000_000)`). */
    private static function megabytes(float $value): int
    {
        return (int) round($value * 1_000_000);
    }

    /**
     * Relative paths are resolved against the app directory (the working directory is not fixed
     * under PHP).
     */
    private function resolvePath(string $path): string
    {
        if ($path === ':memory:' || str_starts_with($path, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1) {
            return rtrim($path, '/') === '' ? '/' : rtrim($path, '/');
        }
        while (str_starts_with($path, './')) {
            $path = substr($path, 2);
        }
        $path = rtrim($path, '/');

        return $path === '' || $path === '.' ? $this->appDir : $this->appDir . '/' . $path;
    }
}
