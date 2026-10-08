<?php

declare(strict_types=1);

namespace NotionAlt\Tests\Unit;

use NotionAlt\Http\ClientIp;
use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

final class ClientIpTest extends TestCase
{
    public function testPrivateAddressesLikeTheNodeServer(): void
    {
        foreach (['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fd12:3456::1'] as $address) {
            self::assertTrue(ClientIp::isPrivateAddress($address), $address);
        }
        foreach (['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '256.0.0.1', '10.0.0', 'fe80::1', '2001:db8::1', '', 'localhost'] as $address) {
            self::assertFalse(ClientIp::isPrivateAddress($address), $address);
        }
    }

    public function testTrustsOneHopFromAPrivateProxy(): void
    {
        self::assertSame('10.0.0.7', ClientIp::resolve('127.0.0.1', '10.0.0.7'));
        // The first entries are client-controlled: only the last hop counts.
        self::assertSame('10.0.0.7', ClientIp::resolve('127.0.0.1', '1.2.3.4, 10.0.0.7'));
        self::assertSame('203.0.113.9', ClientIp::resolve('192.168.0.2', '203.0.113.9'));
        self::assertSame('127.0.0.1', ClientIp::resolve('127.0.0.1', ''));
        self::assertSame('127.0.0.1', ClientIp::resolve('127.0.0.1', '1.2.3.4, '));
    }

    public function testIgnoresTheHeaderFromPublicAddresses(): void
    {
        self::assertSame('203.0.113.5', ClientIp::resolve('203.0.113.5', '10.0.0.7'));
    }

    public function testReadsTheRequest(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/x', ['REMOTE_ADDR' => '127.0.0.1'])
            ->withHeader('X-Forwarded-For', '9.9.9.9, 10.1.1.1');
        self::assertSame('10.1.1.1', ClientIp::of($request));
        self::assertSame('', ClientIp::of((new ServerRequestFactory())->createServerRequest('GET', '/api/x')));
    }
}
