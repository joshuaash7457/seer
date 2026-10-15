import { ScrubResult } from '../../src/types/seer';

export interface ScrubContext {
  knownCustomerNames?: string[];
  knownAgentNames?: string[];
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Matches US & international phone numbers while avoiding IP addresses or camera model numbers
const PHONE_REGEX = /(?<!\d|\.)(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}(?!\d|\.\d)/g;

// Matches common street addresses (e.g. "123 Main St", "4500 Brooktree Rd Suite 200")
const STREET_ADDRESS_REGEX =
  /\b\d{1,6}\s+[A-Za-z0-9.\s]{2,30}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Parkway|Pkwy|Circle|Cir)\.?(?:\s+(?:Suite|Ste|Apt|Unit|#)\s*[A-Za-z0-9-]+)?\b/gi;

// Matches PTZOptics / hardware serial numbers when labeled (e.g., "S/N: X12345678", "Serial: 20230918442")
const SERIAL_REGEX = /\b(?:S\/N|SN|Serial(?:\s*Number|\s*#)?)\s*[:#=-]?\s*[A-Z0-9-]{6,20}\b/gi;

// Matches MAC addresses (e.g. AA:BB:CC:DD:EE:FF)
const MAC_ADDRESS_REGEX = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;

// Matches greeting/signature name patterns (e.g., "Hi John Smith,", "Thanks,\nSarah Miller", "From: David Jones")
const GREETING_NAME_REGEX =
  /\b(Hi|Hello|Dear|Hey)\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)(?=[,\n\r!])/g;

const SIGNATURE_NAME_REGEX =
  /(?:Thanks|Thank you|Best regards|Regards|Sincerely|Cheers|Best),\s*\r?\n+\s*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)/g;

const HEADER_FROM_TO_REGEX =
  /\b(From|To|Sent by|Customer Name|Contact Name|Requester)\s*:\s*([A-Z][a-zA-Z.-]+(?:\s+[A-Z][a-zA-Z.-]+){0,2})/g;

// Preserves standard private LAN IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x, 224.x.x.x, 255.255.x.x)
// because camera IP troubleshooting depends on seeing subnet mismatches, while redacting public WAN IPs!
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

function isPrivateOrDiagnosticIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 127 || a === 169 && b === 254) return true; // Loopback & link-local (APIPA)
  if (a >= 224 && a <= 239) return true; // Multicast (NDI)
  if (a === 255 || a === 0) return true; // Subnet masks / broadcast
  if (ip === '8.8.8.8' || ip === '8.8.4.4' || ip === '1.1.1.1') return true; // Public DNS used in camera setup
  return false;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scrubPII(rawText: string, context: ScrubContext = {}): ScrubResult {
  if (!rawText) {
    return { scrubbedText: '', redactionCount: 0, redactionSummary: {} };
  }

  let text = rawText;
  const summary: Record<string, number> = {};
  let total = 0;

  const record = (type: string, count = 1) => {
    summary[type] = (summary[type] || 0) + count;
    total += count;
  };

  // 1. Replace emails first so names inside email addresses don't split the email token
  text = text.replace(EMAIL_REGEX, () => {
    record('email');
    return '[EMAIL]';
  });

  // 2. Replace known customer names and agent names
  if (context.knownCustomerNames) {
    for (const rawName of context.knownCustomerNames) {
      const clean = rawName?.trim();
      if (!clean || clean.length < 2) continue;
      const parts = clean.split(/\s+/).filter((p) => p.length >= 3);
      for (const variant of [clean, ...parts]) {
        const regex = new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
          record('customer_name', matches.length);
          text = text.replace(regex, '[CUSTOMER]');
        }
      }
    }
  }

  if (context.knownAgentNames) {
    for (const rawName of context.knownAgentNames) {
      const clean = rawName?.trim();
      if (!clean || clean.length < 2) continue;
      const regex = new RegExp(`\\b${escapeRegExp(clean)}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches && matches.length > 0) {
        record('agent_name', matches.length);
        text = text.replace(regex, '[AGENT]');
      }
    }
  }

  // 3. Replace phone numbers
  text = text.replace(PHONE_REGEX, () => {
    record('phone');
    return '[PHONE]';
  });

  // 4. Replace street addresses
  text = text.replace(STREET_ADDRESS_REGEX, () => {
    record('address');
    return '[ADDRESS]';
  });

  // 5. Replace serial numbers & MAC addresses
  text = text.replace(SERIAL_REGEX, () => {
    record('serial_number');
    return 'S/N: [SERIAL_REDACTED]';
  });

  text = text.replace(MAC_ADDRESS_REGEX, () => {
    record('mac_address');
    return '[MAC_REDACTED]';
  });

  // 6. Replace public WAN IPs while keeping private LAN/subnet diagnostic IPs (e.g., 192.168.100.88)
  text = text.replace(IPV4_REGEX, (match) => {
    if (isPrivateOrDiagnosticIp(match)) {
      return match;
    }
    record('public_ip');
    return '[PUBLIC_IP]';
  });

  // 7. Replace names in greetings, headers, and email signatures
  text = text.replace(HEADER_FROM_TO_REGEX, (_full, label) => {
    record('header_name');
    return `${label}: [PERSON]`;
  });

  text = text.replace(GREETING_NAME_REGEX, (_full, greeting, name) => {
    if (/^(Team|Support|PTZOptics|There|All)$/i.test(name.trim())) {
      return _full;
    }
    record('greeting_name');
    return `${greeting} [CUSTOMER]`;
  });

  text = text.replace(SIGNATURE_NAME_REGEX, (fullMatch, name) => {
    if (/^(PTZOptics|Support Team)$/i.test(name.trim())) {
      return fullMatch;
    }
    record('signature_name');
    return fullMatch.replace(name, '[PERSON]');
  });

  return {
    scrubbedText: text,
    redactionCount: total,
    redactionSummary: summary,
  };
}
