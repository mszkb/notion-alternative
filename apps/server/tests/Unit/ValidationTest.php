<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Http\HttpError;
use NotionAlt\Shared\AuthSchemas;
use NotionAlt\Shared\WorkspaceSchemas;
use NotionAlt\Validation\Issue;
use NotionAlt\Validation\Schema;
use NotionAlt\Validation\Undefined;
use NotionAlt\Validation\V;
use NotionAlt\Validation\Validation;
use PHPUnit\Framework\TestCase;

/** Expected issues were taken from zod 4 (packages/shared) for the same input. */
final class ValidationTest extends TestCase
{
    public function testParseInputThrowsInvalidInputWithIssues(): void
    {
        try {
            Validation::parseInput(AuthSchemas::loginInput(), self::json('{"email":1,"password":"","x":1}'));
            self::fail('expected an HttpError');
        } catch (HttpError $error) {
            self::assertSame(400, $error->statusCode);
            self::assertSame('invalid_input', $error->errorCode);
            self::assertSame('Invalid input', $error->getMessage());
            self::assertSame(['issues' => [
                ['path' => 'email', 'message' => 'Invalid input: expected string, received number'],
                ['path' => 'password', 'message' => 'Too small: expected string to have >=1 characters'],
            ]], $error->details);
        }
    }

    public function testParseInputReturnsTheTransformedValue(): void
    {
        self::assertSame(
            ['email' => 'a@b.de', 'password' => 'x'],
            Validation::parseInput(AuthSchemas::loginInput(), self::json('{"email":" A@B.DE ","password":"x","unknown":true}')),
        );
    }

    public function testRegisterInput(): void
    {
        self::assertIssues(AuthSchemas::registerInput(), self::json('{"email":"  NOPE ","password":"short","extra":true}'), [
            ['email', 'invalid_format', 'Invalid email address'],
            ['password', 'too_small', 'Too small: expected string to have >=10 characters'],
        ]);
        self::assertIssues(AuthSchemas::registerInput(), self::json('{"email":"' . str_repeat('a', 250) . '@x.de","password":1}'), [
            ['email', 'too_big', 'Too big: expected string to have <=254 characters'],
            ['password', 'invalid_type', 'Invalid input: expected string, received number'],
        ]);
        self::assertIssues(AuthSchemas::registerInput(), self::json('{}'), [
            ['email', 'invalid_type', 'Invalid input: expected string, received undefined'],
            ['password', 'invalid_type', 'Invalid input: expected string, received undefined'],
        ]);
        self::assertIssues(AuthSchemas::registerInput(), ['email' => 'a@b.de', 'password' => str_repeat('x', 257)], [
            ['password', 'too_big', 'Too big: expected string to have <=256 characters'],
        ]);
    }

    public function testObjectsRejectOtherTypes(): void
    {
        foreach ([
            'null' => null,
            'array' => [],
            'string' => 'str',
            'undefined' => Undefined::Value,
            'number' => 5,
            'boolean' => true,
        ] as $type => $value) {
            self::assertIssues(AuthSchemas::registerInput(), $value, [
                ['', 'invalid_type', "Invalid input: expected object, received {$type}"],
            ]);
        }
        self::assertIssues(AuthSchemas::registerInput(), self::json('[1]'), [
            ['', 'invalid_type', 'Invalid input: expected object, received array'],
        ]);
    }

    public function testStrictObjectsRejectUnknownKeys(): void
    {
        self::assertIssues(AuthSchemas::registerInput()->strict(), ['email' => 'a@b.de', 'password' => 'xxxxxxxxxx', 'x' => 1, 'y' => 2], [
            ['', 'unrecognized_keys', 'Unrecognized keys: "x", "y"'],
        ]);
        self::assertIssues(V::object([])->strict(), self::json('{"a":1}'), [
            ['', 'unrecognized_keys', 'Unrecognized key: "a"'],
        ]);
    }

    public function testEmail(): void
    {
        $email = AuthSchemas::email();
        self::assertSame('a@b.de', $email->safeParse(' A@B.DE ')->data);
        // JavaScript's trim also removes Unicode spaces.
        self::assertSame('a@b.de', $email->safeParse("\u{00A0}a@b.de\u{3000}")->data);
        self::assertSame("o'k.x+y@sub.example.com", $email->safeParse("o'k.x+y@sub.example.com")->data);
        foreach (['ä@b.de', 'a@b.c', '.a@b.de', 'a..b@b.de', 'a.@b.de', 'a@-b.de'] as $invalid) {
            self::assertIssues($email, $invalid, [['', 'invalid_format', 'Invalid email address']]);
        }
        // `$` must not match before a trailing newline (no trim in `z.email()` itself).
        self::assertIssues(V::email(), "a@b.de\n", [['', 'invalid_format', 'Invalid email address']]);
        self::assertIssues($email, str_repeat('x', 260), [
            ['', 'invalid_format', 'Invalid email address'],
            ['', 'too_big', 'Too big: expected string to have <=254 characters'],
        ]);
    }

    public function testPasswordChangeAndLogout(): void
    {
        self::assertIssues(AuthSchemas::changePasswordInput(), ['currentPassword' => '', 'newPassword' => 'short'], [
            ['currentPassword', 'too_small', 'Too small: expected string to have >=1 characters'],
            ['newPassword', 'too_small', 'Too small: expected string to have >=10 characters'],
        ]);
        self::assertSame([], AuthSchemas::logoutInput()->safeParse(self::json('{}'))->data);
        self::assertSame(['removeDevice' => true], AuthSchemas::logoutInput()->safeParse(self::json('{"removeDevice":true}'))->data);
        self::assertIssues(AuthSchemas::logoutInput(), self::json('{"removeDevice":"true"}'), [
            ['removeDevice', 'invalid_type', 'Invalid input: expected boolean, received string'],
        ]);
    }

    public function testWorkspaceName(): void
    {
        self::assertSame(['name' => 'Arbeit'], WorkspaceSchemas::createInput()->safeParse(['name' => '  Arbeit '])->data);
        self::assertIssues(WorkspaceSchemas::createInput(), ['name' => '   '], [
            ['name', 'too_small', 'Too small: expected string to have >=1 characters'],
        ]);
        self::assertIssues(WorkspaceSchemas::createInput(), ['name' => str_repeat('x', 101)], [
            ['name', 'too_big', 'Too big: expected string to have <=100 characters'],
        ]);
        // Lengths count code points (zod 4): 51 emoji are 102 UTF-16 units but pass.
        self::assertTrue(WorkspaceSchemas::createInput()->safeParse(['name' => str_repeat('😀', 100)])->success());
        self::assertFalse(WorkspaceSchemas::createInput()->safeParse(['name' => str_repeat('😀', 101)])->success());
    }

    public function testUuid(): void
    {
        foreach ([
            '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f',
            '3F2B8C1E-7D4A-4B6E-9C0F-1A2B3C4D5E6F',
            '00000000-0000-0000-0000-000000000000',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',
        ] as $valid) {
            self::assertTrue(V::uuid()->safeParse($valid)->success(), $valid);
        }
        self::assertIssues(V::uuid(), '3f2b8c1e-7d4a-0b6e-9c0f-1a2b3c4d5e6f', [['', 'invalid_format', 'Invalid UUID']]);
        self::assertIssues(
            V::object(['a' => V::object(['b' => V::array(V::uuid())])]),
            self::json('{"a":{"b":["x"]}}'),
            [['a.b.0', 'invalid_format', 'Invalid UUID']],
        );
    }

    public function testInt(): void
    {
        self::assertSame(3, V::int()->safeParse(3.0)->data);
        self::assertIssues(V::int(), 1.5, [['', 'invalid_type', 'Invalid input: expected int, received number']]);
        self::assertIssues(V::int(), 1e20, [['', 'too_big', 'Too big: expected int to be <=9007199254740991']]);
        self::assertIssues(V::int()->min(1), 0, [['', 'too_small', 'Too small: expected number to be >=1']]);
        self::assertIssues(V::int()->max(3), 4, [['', 'too_big', 'Too big: expected number to be <=3']]);
        self::assertIssues(V::int(), '1', [['', 'invalid_type', 'Invalid input: expected number, received string']]);
    }

    public function testEnumArrayNullableOptional(): void
    {
        self::assertIssues(V::enum(['a', 'b']), 'c', [['', 'invalid_value', 'Invalid option: expected one of "a"|"b"']]);
        self::assertIssues(V::array(V::string())->max(1), ['a', 1, 'b'], [
            ['1', 'invalid_type', 'Invalid input: expected string, received number'],
            ['', 'too_big', 'Too big: expected array to have <=1 items'],
        ]);
        self::assertIssues(V::array(V::string())->min(2), ['a'], [['', 'too_small', 'Too small: expected array to have >=2 items']]);
        $schema = V::object(['a' => V::string()->nullable(), 'b' => V::string()->optional()]);
        self::assertIssues($schema, self::json('{}'), [['a', 'invalid_type', 'Invalid input: expected string, received undefined']]);
        self::assertSame(['a' => null], $schema->safeParse(self::json('{"a":null}'))->data);
        self::assertSame(['a' => 'x', 'b' => 'y'], $schema->safeParse(self::json('{"a":"x","b":"y"}'))->data);
        self::assertIssues($schema, self::json('{"a":null,"b":null}'), [['b', 'invalid_type', 'Invalid input: expected string, received null']]);
    }

    public function testStringTypes(): void
    {
        self::assertIssues(V::string(), null, [['', 'invalid_type', 'Invalid input: expected string, received null']]);
        self::assertIssues(V::string(), [], [['', 'invalid_type', 'Invalid input: expected string, received array']]);
        self::assertIssues(V::string(), 1.5, [['', 'invalid_type', 'Invalid input: expected string, received number']]);
        self::assertIssues(V::string()->max(2), 'abc', [['', 'too_big', 'Too big: expected string to have <=2 characters']]);
        self::assertIssues(V::string()->min(2), '', [['', 'too_small', 'Too small: expected string to have >=2 characters']]);
        // Checks run in order: min before trim sees the untrimmed value.
        self::assertTrue(V::string()->min(3)->trim()->safeParse(' a ')->success());
        self::assertFalse(V::string()->trim()->min(3)->safeParse(' a ')->success());
    }

    /**
     * @param list<array{string, string, string}> $expected path, code, message
     */
    private static function assertIssues(Schema $schema, mixed $value, array $expected): void
    {
        $result = $schema->safeParse($value);
        self::assertSame($expected, array_map(
            static fn(Issue $issue): array => [$issue->pathString(), $issue->code, $issue->message],
            $result->issues,
        ));
    }

    /** `z.url()` as checked with zod 4 (`new URL()`), and literals. */
    public function testUrlAndLiteral(): void
    {
        $url = V::string()->url();
        foreach (['https://a', 'mailto:x@y', 'file:///x', 'javascript:alert(1)', 'https://ü.de/x', ' https://a.de', 'https://u:p@h:443/p?q#f'] as $valid) {
            self::assertTrue($url->safeParse($valid)->success(), $valid);
        }
        foreach (['nope', 'http://', 'https://a b', '', '1http://a'] as $invalid) {
            self::assertSame('Invalid URL', $url->safeParse($invalid)->issues[0]->message ?? null, $invalid);
        }
        self::assertTrue(V::literal(3)->safeParse(3)->success());
        self::assertSame('Invalid input: expected 3', V::literal(3)->safeParse(2)->issues[0]->message ?? null);
    }

    private static function json(string $json): mixed
    {
        return json_decode($json, false, 512, JSON_THROW_ON_ERROR);
    }
}
