import { describe, it, expect } from 'vitest';
import { scrubPII } from '../electron/services/piiScrubber';

describe('PII Scrubber', () => {
  it('redacts emails, phones, serial numbers, street addresses, and names while preserving camera LAN IPs', () => {
    const rawTicket = `
From: Michael Henderson <m.henderson@gracechurchav.org>
Hi Support,

My Move 4K camera (S/N: PTZ4K99881122, MAC: A4:B2:C3:11:22:33) is stuck on 192.168.100.88 and won't talk to our SuperJoy on 192.168.1.50.
Our church public IP is 74.122.45.199 and our shipping address is 412 Oakwood Avenue Suite 100.
You can call me at (610) 555-0194 or 610-555-0199.

Thanks,
Michael Henderson
    `.trim();

    const result = scrubPII(rawTicket, {
      knownCustomerNames: ['Michael Henderson'],
      knownAgentNames: ['Alex Support'],
    });

    // Must not contain any PII
    expect(result.scrubbedText).not.toContain('m.henderson@gracechurchav.org');
    expect(result.scrubbedText).not.toContain('Michael');
    expect(result.scrubbedText).not.toContain('Henderson');
    expect(result.scrubbedText).not.toContain('PTZ4K99881122');
    expect(result.scrubbedText).not.toContain('A4:B2:C3:11:22:33');
    expect(result.scrubbedText).not.toContain('74.122.45.199');
    expect(result.scrubbedText).not.toContain('412 Oakwood Avenue');
    expect(result.scrubbedText).not.toContain('555-0194');
    expect(result.scrubbedText).not.toContain('555-0199');

    // Must preserve diagnostic LAN IP addresses so Seer knows it is a subnet mismatch issue!
    expect(result.scrubbedText).toContain('192.168.100.88');
    expect(result.scrubbedText).toContain('192.168.1.50');
    expect(result.scrubbedText).toContain('Move 4K');
    expect(result.scrubbedText).toContain('SuperJoy');
    expect(result.redactionCount).toBeGreaterThanOrEqual(7);
  });

  it('redacts greeting and signature names even when metadata is missing', () => {
    const raw = `Hi Jessica Taylor,\nWe checked your PT-JOY-G4 baud rate.\nBest regards,\nMarcus Vance`;
    const res = scrubPII(raw);
    expect(res.scrubbedText).not.toContain('Jessica Taylor');
    expect(res.scrubbedText).not.toContain('Marcus Vance');
    expect(res.scrubbedText).toContain('Hi [CUSTOMER]');
    expect(res.scrubbedText).toContain('[PERSON]');
  });
});
