<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit\Attachments;

use DateTimeImmutable;
use NotionAlt\Attachments\S3Signer;
use NotionAlt\Config\S3Config;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Port of apps/server/test/s3-sign.test.ts plus requests recorded from the Node `S3Client`. */
final class S3SignerTest extends TestCase
{
    // "GET Object" example from the AWS S3 documentation (Signature Version 4, header-based).
    public function testReproducesTheAwsExampleSignature(): void
    {
        $headers = S3Signer::signV4(
            'GET',
            'https://examplebucket.s3.amazonaws.com/test.txt',
            ['Range' => 'bytes=0-9'],
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            'AKIAIOSFODNN7EXAMPLE',
            'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            'us-east-1',
            date: new DateTimeImmutable('2013-05-24T00:00:00Z'),
        );

        self::assertSame(
            'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
            . 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
            . 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
            $headers['authorization'],
        );
        self::assertSame('20130524T000000Z', $headers['x-amz-date']);
        self::assertSame('bytes=0-9', $headers['range']);
        self::assertArrayNotHasKey('host', $headers);
    }

    public function testCanonicalizesPathQueryAndHeadersLikeNode(): void
    {
        $headers = S3Signer::signV4(
            'GET',
            'https://Host.Example:443/a%20b/c+d?b=2&a=x+y&a=1&empty&z=%21',
            ['X-Amz-Meta-Foo' => '  bar  '],
            'UNSIGNED-PAYLOAD',
            'AK',
            'SK',
            'us-east-1',
            date: new DateTimeImmutable('2024-02-03T05:05:06.789+01:00'),
        );

        self::assertEquals([
            'x-amz-meta-foo' => 'bar',
            'x-amz-content-sha256' => 'UNSIGNED-PAYLOAD',
            'x-amz-date' => '20240203T040506Z',
            'authorization' => 'AWS4-HMAC-SHA256 Credential=AK/20240203/us-east-1/s3/aws4_request, '
                . 'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-meta-foo, '
                . 'Signature=74cc8923254111cb31893a3dad02891204cba45abe9f7a74b63be14722c7f344',
        ], $headers);
    }

    /** @return iterable<string, array{bool, string, string, ?string, string, string, string}> */
    public static function nodeRequests(): iterable
    {
        $minio = 'http://127.0.0.1:9000';
        $aws = 'https://s3.eu-central-1.amazonaws.com';
        $key = 'ws 1/a(b)!.png';
        yield 'path style put' => [true, $minio, 'PUT', 'hello', $key,
            'http://127.0.0.1:9000/notes/ws%201/a%28b%29%21.png',
            'dec3428279a977e6e29e2b1393ebcc8beb4d6171fccc066e6c873547bdfb3956'];
        yield 'path style get' => [true, $minio, 'GET', null, 'k',
            'http://127.0.0.1:9000/notes/k',
            'acd50563337d8827bfe43a041b4627ac44a05a9588688789aceb8fbcf9564171'];
        yield 'path style create bucket' => [true, $minio, 'PUT', null, '',
            'http://127.0.0.1:9000/notes',
            'df4d68e761f289303d72d6f72d0430c37f072930b9c26c05293ec210b6dc2520'];
        yield 'virtual host put' => [false, $aws, 'PUT', 'hello', $key,
            'https://notes.s3.eu-central-1.amazonaws.com/ws%201/a%28b%29%21.png',
            '0a5bd4ea949a8b9597fb63e3dc3833a5813fa4329db45dccf6c32b5d57818f0d'];
        yield 'virtual host get' => [false, $aws, 'GET', null, 'k',
            'https://notes.s3.eu-central-1.amazonaws.com/k',
            'c0b222b05cdf94a151df8653b21e7a2522fdb2637d8106c99320c0d439240730'];
        yield 'virtual host create bucket' => [false, $aws, 'PUT', null, '',
            'https://notes.s3.eu-central-1.amazonaws.com/',
            'd1a79caf656f9f0da43619b650f20a5cc38ad1dd9e6a910195553633e12e7a45'];
    }

    #[DataProvider('nodeRequests')]
    public function testBuildsTheSameRequestsAsTheNodeClient(
        bool $pathStyle,
        string $endpoint,
        string $method,
        ?string $body,
        string $key,
        string $url,
        string $signature,
    ): void {
        $config = new S3Config($endpoint, 'eu-central-1', 'notes', 'AK', 'SK/secret', $pathStyle);
        $request = S3Signer::request($config, $method, $key, $body, new DateTimeImmutable('2024-02-03T04:05:06.789Z'));

        self::assertSame($url, $request['url']);
        $headers = $request['headers'];
        self::assertSame($body !== null ? hash('sha256', $body) : S3Signer::EMPTY_PAYLOAD_HASH, $headers['x-amz-content-sha256']);
        self::assertSame($body !== null ? 'application/octet-stream' : null, $headers['content-type'] ?? null);
        self::assertSame('20240203T040506Z', $headers['x-amz-date']);
        self::assertSame(
            'AWS4-HMAC-SHA256 Credential=AK/20240203/eu-central-1/s3/aws4_request, SignedHeaders='
            . ($body !== null ? 'content-type;' : '') . 'host;x-amz-content-sha256;x-amz-date, Signature=' . $signature,
            $headers['authorization'],
        );
    }

    public function testEncodesSegmentsPerRfc3986(): void
    {
        self::assertSame('a%20b%21%27%28%29%2A-_.~%C3%A4%2F', S3Signer::encodeSegment("a b!'()*-_.~ä/"));
    }
}
