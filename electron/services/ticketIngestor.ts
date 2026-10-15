import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { RawTicketInput, ScrubbedTicket } from '../../src/types/seer';
import { scrubPII } from './piiScrubber';

function pickFirst(row: Record<string, unknown>, keys: string[]): string {
  const lowerMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      lowerMap[k.toLowerCase().trim()] = String(v).trim();
    }
  }
  for (const key of keys) {
    const val = lowerMap[key.toLowerCase()];
    if (val) return val;
  }
  return '';
}

export function normalizeAndScrubTickets(
  rawTickets: RawTicketInput[],
  dateRangeStart?: string,
  dateRangeEnd?: string
): ScrubbedTicket[] {
  const startMs = dateRangeStart ? new Date(dateRangeStart).setHours(0, 0, 0, 0) : null;
  const endMs = dateRangeEnd ? new Date(dateRangeEnd).setHours(23, 59, 59, 999) : null;

  const results: ScrubbedTicket[] = [];

  for (let i = 0; i < rawTickets.length; i++) {
    const raw = rawTickets[i];
    const parsedDate = raw.createdAt ? new Date(raw.createdAt) : new Date();
    const validDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    const ms = validDate.getTime();

    if (startMs && !isNaN(startMs) && ms < startMs) continue;
    if (endMs && !isNaN(endMs) && ms > endMs) continue;

    const combinedRawBody = [
      raw.subject ? `Subject: ${raw.subject}` : '',
      raw.content ? `Description:\n${raw.content}` : '',
      raw.threadText ? `Support Thread:\n${raw.threadText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const knownCustomerNames = [raw.customerName || ''].filter(Boolean);
    const knownAgentNames = [raw.agentName || ''].filter(Boolean);

    const scrubbedSubject = scrubPII(raw.subject || 'Support Ticket', {
      knownCustomerNames,
      knownAgentNames,
    });

    const scrubbedBodyResult = scrubPII(combinedRawBody, {
      knownCustomerNames,
      knownAgentNames,
    });

    const externalId =
      raw.externalId ||
      crypto.createHash('md5').update(`${raw.subject}-${raw.createdAt}-${i}`).digest('hex').slice(0, 10);

    results.push({
      id: `tkt_${externalId}`,
      externalId: String(externalId),
      subject: scrubbedSubject.scrubbedText,
      scrubbedBody: scrubbedBodyResult.scrubbedText,
      createdAt: validDate.toISOString(),
      status: raw.status || 'Closed',
      redactionCount: scrubbedBodyResult.redactionCount + scrubbedSubject.redactionCount,
    });
  }

  return results;
}

export function parseTicketFile(
  filePath: string,
  dateRangeStart?: string,
  dateRangeEnd?: string
): ScrubbedTicket[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ticket file not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const rawTickets: RawTicketInput[] = [];

  if (ext === '.json') {
    const parsed = JSON.parse(rawContent);
    const arr = Array.isArray(parsed) ? parsed : parsed.tickets || parsed.results || [];
    for (const item of arr) {
      rawTickets.push({
        externalId: String(item.externalId || item.id || item.ticketId || item['Record ID'] || ''),
        subject: String(item.subject || item.name || item.hs_ticket_subject || item['Ticket Name'] || ''),
        content: String(item.content || item.description || item.body || item['Ticket description'] || ''),
        threadText: String(item.threadText || item.thread || item.emails || item.notes || ''),
        createdAt: String(item.createdAt || item.created_at || item.createDate || item['Create date'] || new Date().toISOString()),
        status: String(item.status || item['Ticket status'] || 'Closed'),
        customerName: String(item.customerName || item.contactName || item['Associated Contact'] || ''),
        customerEmail: String(item.customerEmail || item.email || ''),
        agentName: String(item.agentName || item.ownerName || item['Ticket owner'] || ''),
      });
    }
  } else {
    const records = parse(rawContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, unknown>[];

    for (const row of records) {
      const externalId = pickFirst(row, [
        'Record ID',
        'Ticket ID',
        'hs_object_id',
        'id',
        'ticket_id',
      ]);
      const subject = pickFirst(row, [
        'Ticket Name',
        'Subject',
        'hs_ticket_subject',
        'name',
        'Title',
      ]);
      const content = pickFirst(row, [
        'Ticket description',
        'Description',
        'Content',
        'hs_ticket_priority',
        'Body',
        'Issue',
        'Customer Question',
      ]);
      const threadText = pickFirst(row, [
        'Email thread',
        'Email Body',
        'Thread',
        'Resolution',
        'Close notes',
        'Agent Response',
        'Notes',
        'Last email body',
      ]);
      const createdAt = pickFirst(row, [
        'Create date',
        'Created Date',
        'createdate',
        'created_at',
        'Date',
      ]);
      const status = pickFirst(row, ['Ticket status', 'Status', 'hs_pipeline_stage']);
      const customerName = pickFirst(row, [
        'Associated Contact',
        'Contact Name',
        'Customer Name',
        'Requester',
      ]);
      const agentName = pickFirst(row, ['Ticket owner', 'Owner', 'Agent Name']);

      if (!subject && !content && !threadText) continue;

      rawTickets.push({
        externalId,
        subject: subject || content.slice(0, 80),
        content,
        threadText,
        createdAt: createdAt || new Date().toISOString(),
        status: status || 'Closed',
        customerName,
        agentName,
      });
    }
  }

  return normalizeAndScrubTickets(rawTickets, dateRangeStart, dateRangeEnd);
}

export async function fetchHubSpotTickets(options: {
  accessToken: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  maxTickets?: number;
}): Promise<ScrubbedTicket[]> {
  const { accessToken, dateRangeStart, dateRangeEnd, maxTickets = 200 } = options;
  if (!accessToken) {
    throw new Error('HubSpot Private App token is not configured.');
  }

  const filterGroups: unknown[] = [];
  const filters: unknown[] = [];
  if (dateRangeStart) {
    const startMs = new Date(dateRangeStart).setHours(0, 0, 0, 0);
    if (!isNaN(startMs)) {
      filters.push({
        propertyName: 'createdate',
        operator: 'GTE',
        value: String(startMs),
      });
    }
  }
  if (dateRangeEnd) {
    const endMs = new Date(dateRangeEnd).setHours(23, 59, 59, 999);
    if (!isNaN(endMs)) {
      filters.push({
        propertyName: 'createdate',
        operator: 'LTE',
        value: String(endMs),
      });
    }
  }
  if (filters.length > 0) {
    filterGroups.push({ filters });
  }

  const rawTickets: RawTicketInput[] = [];
  let after: string | undefined = undefined;

  while (rawTickets.length < maxTickets) {
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/tickets/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups,
        properties: [
          'subject',
          'content',
          'createdate',
          'hs_pipeline',
          'hs_pipeline_stage',
          'closed_date',
          'hs_resolution',
        ],
        limit: Math.min(100, maxTickets - rawTickets.length),
        after,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`HubSpot API error (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ id: string; properties?: Record<string, string | null> }>;
      paging?: { next?: { after?: string } };
    };

    const batch = data.results || [];
    for (const item of batch) {
      const props = item.properties || {};
      rawTickets.push({
        externalId: item.id,
        subject: props.subject || 'Support Ticket',
        content: props.content || '',
        threadText: props.hs_resolution || '',
        createdAt: props.createdate || new Date().toISOString(),
        status: props.hs_pipeline_stage || 'Open',
      });
    }

    after = data.paging?.next?.after;
    if (!after || batch.length === 0) break;
  }

  return normalizeAndScrubTickets(rawTickets, dateRangeStart, dateRangeEnd);
}

/**
 * Provides realistic PTZOptics support tickets (including raw PII before scrubbing)
 * so you can verify PII redaction and test the real Docusaurus repo immediately
 * even before your HubSpot token arrives.
 */
export function getSamplePTZOpticsTickets(): RawTicketInput[] {
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

  return [
    {
      externalId: 'HS-90411',
      subject: 'SuperJoy says "Configuration Failed" when adding Move 4K camera',
      customerName: 'Pastor David Miller',
      customerEmail: 'dmiller@calvarychapelav.org',
      agentName: 'Tyler Support',
      createdAt: daysAgo(1),
      status: 'Closed',
      content: `From: Pastor David Miller <dmiller@calvarychapelav.org>\nHi Support,\nWe bought a PT-SUPERJOY-G1 (S/N: SJG1998271) and two Move 4K cameras. Every time I try to add the camera on the SuperJoy web UI or on the controller LCD, it says "Configuration Failed". I looked at your docs page "Configuration Failed" under SuperJoy, and it's just a YouTube thumbnail image with zero written instructions! Our church firewall blocks YouTube on the booth PC. You can reach me at 484-555-0142.`,
      threadText: `Hi Pastor David Miller,\n"Configuration Failed" on the SuperJoy happens when either: (1) the SuperJoy and camera are on different subnets (your SuperJoy was on 192.168.1.x while the Move 4K was still on fallback 192.168.100.88), or (2) the VISCA over IP port on the SuperJoy (default 1259) doesn't match the camera. Once we changed the Move 4K subnet to 192.168.1.88 and set protocol to VISCA UDP port 1259, it paired right away.\nThanks,\nTyler Support`,
    },
    {
      externalId: 'HS-90412',
      subject: 'SuperJoy Configuration Failed error on LCD screen',
      customerName: 'Rachel Green',
      customerEmail: 'rgreen@metroevents.com',
      agentName: 'Tyler Support',
      createdAt: daysAgo(2),
      status: 'Closed',
      content: `Hi PTZOptics,\nI'm on site at 850 Industrial Parkway Suite 400 trying to pair a SuperJoy to 3 Move SE cameras. The LCD keeps flashing "Configuration Failed". The doc page on docs.ptzoptics.com only links to a video and doesn't list what port or credentials trigger Configuration Failed. Call me at (215) 555-0188.`,
      threadText: `Resolved by checking subnet mask and changing SuperJoy device entry from ONVIF (where admin password was mismatched) to VISCA over IP Port 1259.`,
    },
    {
      externalId: 'HS-90415',
      subject: 'Cannot find Move SE IP address on network - stuck on 192.168.100.88',
      customerName: 'Kevin Patterson',
      customerEmail: 'kpatterson@stlukesmedia.org',
      agentName: 'Sarah Support',
      createdAt: daysAgo(2),
      status: 'Closed',
      content: `Hello,\nWe plugged our new Move SE (S/N: MSE202500491) into our Ubiquiti switch. My Windows PC is on 192.168.1.25, and the camera shows up in the PTZ Control App at 192.168.100.88, but when I click it in Chrome it times out! How am I supposed to log into 192.168.100.88 when my router is 192.168.1.1?\nThanks,\nKevin Patterson`,
      threadText: `Hi Kevin Patterson,\nBecause 192.168.100.88 is on a different subnet (.100 vs .1), your browser cannot reach the Web UI directly until you either temporarily add a secondary IP (192.168.100.10) to your Windows Ethernet adapter or use the Device Management IP configuration tool to change it to 192.168.1.x with DHCP enabled.`,
    },
    {
      externalId: 'HS-90418',
      subject: 'New Move 4K camera shows 192.168.100.88 and Web UI will not load',
      customerName: 'Brian OConnor',
      customerEmail: 'boconnor@oakridgehigh.edu',
      agentName: 'Sarah Support',
      createdAt: daysAgo(3),
      status: 'Closed',
      content: `Hi Team,\nMy PC IP is 10.0.10.45 and the new Move 4K camera defaulted to 192.168.100.88. I followed the getting started guide and typed 192.168.100.88 into Edge, and it says ERR_CONNECTION_TIMED_OUT. Is the camera defective? My phone is 610-555-0173.`,
      threadText: `Walked Brian OConnor through calculating compatible subnet settings and setting a temporary static IP on his NIC so he could flip the camera from 192.168.100.88 to DHCP on the 10.0.10.x subnet.`,
    },
    {
      externalId: 'HS-90421',
      subject: 'Move SE NDI|HX stream not showing in OBS or Studio Monitor after firmware update',
      customerName: 'Marcus Vance',
      customerEmail: 'mvance@streamworkspro.tv',
      agentName: 'Alex Support',
      createdAt: daysAgo(3),
      status: 'Closed',
      content: `From: Marcus Vance <mvance@streamworkspro.tv>\nAfter updating our Move SE (MAC: D4:E5:F6:01:02:03) to the latest Gen 3 firmware, NDI Studio Monitor sees the camera name, but clicking it just gives a black screen. We searched the docs for Move SE NDI black screen and couldn't find what changed.`,
      threadText: `Hi Marcus Vance,\nAfter the Gen 3 firmware update, NDI|HX3 multicast/TCP mode and stream encoding settings in the Web UI under NDI Settings & Streaming Settings must have Stream 2 H.264 enabled and NDI toggled off/on + rebooted. Also verified Windows Firewall allows NDI runtime on private & domain networks.`,
    },
    {
      externalId: 'HS-90425',
      subject: 'VISCA over IP port number for Bitfocus Companion / OBS control on Move 4K',
      customerName: 'Hannah Abbott',
      customerEmail: 'habbott@firstbaptistlive.org',
      agentName: 'Tyler Support',
      createdAt: daysAgo(4),
      status: 'Closed',
      content: `Hi Support,\nWhat TCP and UDP port does the Move 4K use for VISCA over IP when connecting from Bitfocus Companion or OBS PTZ Dock? One place in the docs mentions 1259 and another mentions 5678, and my presets aren't recalling.`,
      threadText: `Hi Hannah Abbott,\nPTZOptics cameras use UDP port 1259 for standard PTZOptics VISCA over IP, and TCP port 5678 for Sony-style VISCA over IP. In Bitfocus Companion using the PTZOptics module, make sure you select UDP port 1259.`,
    },
    {
      externalId: 'HS-90429',
      subject: 'PT-JOY-G4 serial RS-232 / RS-485 daisy chain dip switch and baud rate settings',
      customerName: 'Carlos Rivera',
      customerEmail: 'crivera@citycouncilav.gov',
      agentName: 'Alex Support',
      createdAt: daysAgo(5),
      status: 'Closed',
      content: `Hello,\nWe are daisy-chaining 4 PT20X-SDI Gen 2 cameras over RS-485 to an HC-JOY-G4 serial joystick. Camera 1 moves, but Cameras 2, 3, and 4 don't respond at all. Where is the dip switch / camera address / Pelco vs VISCA baud rate chart in the docs?`,
      threadText: `Hi Carlos Rivera,\nSent the RS-485 termination and rotary/OSD address instructions: each camera in a VISCA chain needs a unique VISCA address (1, 2, 3, 4) set via the OSD menu or rotary dial, baud rate 9600 on all units, and RS-485 termination enabled ONLY on the last camera in the chain.`,
    },
    {
      externalId: 'HS-90433',
      subject: 'Requesting RMA repair & return shipping label for dropped PT20X-SDI',
      customerName: 'Greg Wallace',
      customerEmail: 'gwallace@eventrentals.com',
      agentName: 'Sarah Support',
      createdAt: daysAgo(5),
      status: 'Closed',
      content: `Hi,\nA tripod tipped over at 1200 Market Street and cracked the housing on our PT20X-SDI (S/N: PT20X883712). Can we get an RMA number and warranty repair quote? Call 302-555-0112.`,
      threadText: `Issued out-of-warranty RMA repair quote #RMA-4412 and emailed shipping label.`,
    },
  ];
}
