<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Text\InlineText;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class InlineTextTest extends TestCase
{
    /**
     * Expected values from `inlineToPlainText` in packages/shared (fixture inline-plaintext.json).
     *
     * @return iterable<string, array{string, string}>
     */
    public static function cases(): iterable
    {
        $json = file_get_contents(__DIR__ . '/../fixtures/inline-plaintext.json');
        \assert(\is_string($json));
        /** @var list<array{source: string, text: string}> $cases */
        $cases = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        foreach ($cases as $index => $case) {
            yield "#{$index} " . $case['source'] => [$case['source'], $case['text']];
        }
    }

    #[DataProvider('cases')]
    public function testMatchesTheTypeScriptImplementation(string $source, string $expected): void
    {
        self::assertSame($expected, InlineText::toPlainText($source));
    }
}
