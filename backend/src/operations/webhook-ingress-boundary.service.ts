import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

export type WebhookIngressMode = 'shadow' | 'manual_refresh';

export type WebhookIngressStatus = {
  mode: WebhookIngressMode;
  ingressVerified: boolean;
  allowedCidrCount: number;
};

export type WebhookIngressDecision =
  | { kind: 'accepted' }
  | { kind: 'manual_refresh' }
  | {
      kind: 'rejected';
      code: 'INGRESS_ADDRESS_REJECTED' | 'ROUTE_SECRET_REJECTED';
    };

type IPv4Cidr = {
  network: number;
  mask: number;
};

@Injectable()
export class WebhookIngressBoundaryService {
  constructor(private readonly configService: ConfigService) {}

  status(): WebhookIngressStatus {
    const parsedCidrs = this.parseCidrs();
    const ingressVerified =
      this.isEnabled('WEBHOOK_SHADOW_MODE') &&
      this.isEnabled('WEBHOOK_INGRESS_VERIFIED') &&
      parsedCidrs.valid &&
      parsedCidrs.cidrs.length > 0;

    return {
      mode: ingressVerified ? 'shadow' : 'manual_refresh',
      ingressVerified,
      allowedCidrCount: parsedCidrs.cidrs.length,
    };
  }

  authenticate(
    remoteAddress: string | undefined,
    suppliedSecret: string | undefined,
    expectedSecret: string | null,
  ): WebhookIngressDecision {
    const status = this.status();
    if (status.mode !== 'shadow' || !expectedSecret) {
      return { kind: 'manual_refresh' };
    }

    const parsedCidrs = this.parseCidrs();
    if (!this.isAllowedAddress(remoteAddress, parsedCidrs.cidrs)) {
      return { kind: 'rejected', code: 'INGRESS_ADDRESS_REJECTED' };
    }

    if (!suppliedSecret || !this.secretsMatch(suppliedSecret, expectedSecret)) {
      return { kind: 'rejected', code: 'ROUTE_SECRET_REJECTED' };
    }

    return { kind: 'accepted' };
  }

  private isEnabled(key: string): boolean {
    return this.configService.get<string>(key)?.toLowerCase() === 'true';
  }

  private parseCidrs(): { valid: boolean; cidrs: IPv4Cidr[] } {
    const value = this.configService.get<string>(
      'WEBHOOK_INGRESS_ALLOWED_CIDRS',
    );
    if (!value) {
      return { valid: false, cidrs: [] };
    }

    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const cidrs = entries.map((entry) => this.parseCidr(entry));

    return {
      valid: entries.length > 0 && cidrs.every((cidr) => cidr !== null),
      cidrs: cidrs.filter((cidr): cidr is IPv4Cidr => cidr !== null),
    };
  }

  private parseCidr(value: string): IPv4Cidr | null {
    const [address, prefixValue] = value.split('/');
    if (!address || !prefixValue || value.split('/').length !== 2) {
      return null;
    }

    const network = this.ipv4ToNumber(address);
    const prefix = Number(prefixValue);
    if (
      network === null ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > 32
    ) {
      return null;
    }

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return { network: network & mask, mask };
  }

  private isAllowedAddress(
    address: string | undefined,
    cidrs: readonly IPv4Cidr[],
  ): boolean {
    if (!address) {
      return false;
    }

    const normalized = address.startsWith('::ffff:')
      ? address.slice('::ffff:'.length)
      : address;
    const value = this.ipv4ToNumber(normalized);
    return (
      value !== null &&
      cidrs.some((cidr) => (value & cidr.mask) === cidr.network)
    );
  }

  private ipv4ToNumber(value: string): number | null {
    const parts = value.split('.');
    if (parts.length !== 4) {
      return null;
    }

    let result = 0;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) {
        return null;
      }
      const octet = Number(part);
      if (octet > 255) {
        return null;
      }
      result = (result << 8) | octet;
    }
    return result >>> 0;
  }

  private secretsMatch(
    suppliedSecret: string,
    expectedSecret: string,
  ): boolean {
    const supplied = Buffer.from(suppliedSecret, 'utf8');
    const expected = Buffer.from(expectedSecret, 'utf8');

    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }
}
