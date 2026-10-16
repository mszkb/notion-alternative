<?php

declare(strict_types=1);

namespace NotionAlt\Config;

/** Connection to MariaDB or MySQL instead of the SQLite file (ADR 0024). */
final class MysqlConfig
{
    public function __construct(
        public readonly string $host,
        public readonly int $port,
        public readonly string $database,
        public readonly string $user,
        #[\SensitiveParameter]
        public readonly string $password,
    ) {}
}
