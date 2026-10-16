<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Compose passes only the variables listed under `environment` to the backend; a variable that is
 * documented for `.env` but missing there silently has no effect.
 */
final class DockerComposeTest extends TestCase
{
    /** Set by the image or meaningless in the container; TRUST_PROXY must stay on behind nginx. */
    private const NOT_PASSED = ['DATA_DIR', 'DATABASE_PATH', 'ATTACHMENTS_DIR', 'NOTION_ALT_CONFIG', 'TRUST_PROXY'];

    public function testPassesEveryConfigVariableToTheBackend(): void
    {
        $environment = self::backendEnvironment();
        $missing = array_values(array_diff(self::configVariables(), self::NOT_PASSED, $environment));

        self::assertSame([], $missing);
    }

    public function testDoesNotLetTrustProxyBeTurnedOff(): void
    {
        self::assertNotContains('TRUST_PROXY', self::backendEnvironment());
    }

    /** @return list<string> */
    private static function configVariables(): array
    {
        $source = (string) file_get_contents(__DIR__ . '/../../src/Config/ConfigLoader.php');
        preg_match_all("/'([A-Z][A-Z0-9_]+)'/", $source, $matches);
        self::assertContains('ATTACHMENT_MAX_MB', $matches[1]);

        return array_values(array_unique($matches[1]));
    }

    /** @return list<string> variable names under `services.backend.environment` */
    private static function backendEnvironment(): array
    {
        $compose = (string) file_get_contents(__DIR__ . '/../../../../docker-compose.yml');
        if (preg_match('/^  backend:\n(.*?)^  \S/ms', $compose, $service) !== 1) {
            self::fail('no backend service in docker-compose.yml');
        }
        if (preg_match('/^    environment:\n((?:      .*\n)+)/m', $service[1], $block) !== 1) {
            self::fail('no environment for the backend in docker-compose.yml');
        }
        preg_match_all('/^      ([A-Z][A-Z0-9_]+):/m', $block[1], $names);
        self::assertContains('LOG_LEVEL', $names[1]);

        return $names[1];
    }
}
