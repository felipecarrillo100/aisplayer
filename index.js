#!/usr/bin/env node
'use strict';

const fs = require('fs');
const minimist = require('minimist');

const MessageProducerMQTT = require('./MessageProducerMQTT');
const MessageProducerSTOMP = require('./MessageProducerSTOMP');
const { AisReceiver } = require('ais-web');

const aisReceiver = new AisReceiver();

const DEFAULT_FILE = './DonneesBrutesAIS.bin';
const DEFAULT_STOMP_PORT = 61613;
const EXAMPLE_MQTT_BROKER = 'mqtt://localhost:1883';
const EXAMPLE_STOMP_BROKER = 'localhost:61613';
const DEFAULT_TOPIC = 'producers/ais/data';
const DEFAULT_SEPARATOR = '.';

function printHelp() {
  console.log(`
Usage: node aisPlayer.js [options]

Options:
  -f, --file         Path to AIS file (.bin or .nm4) (default: ${DEFAULT_FILE})
  -b, --broker       Broker URL or host (mandatory unless --info):
                       MQTT example: ${EXAMPLE_MQTT_BROKER}
                       STOMP example: ${EXAMPLE_STOMP_BROKER}
  -u, --username     Broker username (optional)
  -p, --password     Broker password (optional)
  -t, --topic        Topic/Route prefix to send messages (default: ${DEFAULT_TOPIC})
                     (For STOMP, "/topic/" prefix will be added automatically)
  -s, --separator    STOMP topic separator character (default: "${DEFAULT_SEPARATOR}"; options: "/" or ".")
  -r, --rate         Playback rate multiplier (default: 1, real-time)
  -i, --info         Show statistics about AIS file and exit
  -h, --help         Show this help message
`);
}

function replaceDataWithControl(path) {
  const parts = path.split('/');
  if (parts.length >= 3 && parts[0] === 'producers' && parts[2] === 'data') {
    parts[2] = 'control';
    return parts.join('/');
  }
  return path;
}

const args = minimist(process.argv.slice(2), {
  string: ['file', 'broker', 'username', 'password', 'topic', 'separator', 'rate'],
  boolean: ['help', 'info'],
  alias: {
    f: 'file',
    b: 'broker',
    u: 'username',
    p: 'password',
    t: 'topic',
    s: 'separator',
    r: 'rate',
    i: 'info',
    h: 'help',
  },
  default: {
    file: DEFAULT_FILE,
    topic: DEFAULT_TOPIC,
    separator: DEFAULT_SEPARATOR,
    rate: '1',
  },
});

if (args.help) {
  printHelp();
  process.exit(0);
}

if (!args.broker && !args.info) {
  console.error('Error: broker is mandatory unless --info is used.');
  printHelp();
  process.exit(1);
}

const playbackRate = Number(args.rate);
if (isNaN(playbackRate) || playbackRate <= 0) {
  console.error(`Invalid playback rate: ${args.rate}`);
  process.exit(1);
}

const username = args.username?.trim() || undefined;
const password = args.password?.trim() || undefined;

let broker = args.broker;
let protocol;

if (broker && broker.toLowerCase().includes('mqtt')) {
  protocol = 'mqtt';
} else {
  protocol = 'stomp';
  if (broker && !broker.includes(':')) {
    broker = `${broker}:${DEFAULT_STOMP_PORT}`;
  }
}

let topic = args.topic;
const separator = (args.separator === '.' || args.separator === '/') ? args.separator : DEFAULT_SEPARATOR;

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function parseBinFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  let offset = 0;
  const aisPackets = [];

  while (offset + 12 <= fileBuffer.length) {
    const timestampSec = readUInt32LE(fileBuffer, offset);
    const timestampUsec = readUInt32LE(fileBuffer, offset + 4);
    const packetSize = readUInt32LE(fileBuffer, offset + 8);
    offset += 12;

    if (offset + packetSize > fileBuffer.length) {
      console.warn('Incomplete packet at end of file');
      break;
    }

    const data = fileBuffer.slice(offset, offset + packetSize);
    offset += packetSize;

    aisPackets.push({ timestampSec, timestampUsec, data });
  }

  return aisPackets;
}

function parseNm4File(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const packets = [];

  for (const line of lines) {
    if (!line.startsWith('\\s:')) continue;

    const match = line.match(/c:(\d+)\*\w+\\(.*)/);
    if (!match) continue;

    const timestampSec = parseInt(match[1], 10);
    const sentence = match[2]?.trim();
    if (!sentence?.startsWith('!')) continue;

    packets.push({
      timestampSec,
      timestampUsec: 0,
      data: Buffer.from(sentence, 'utf-8'),
    });
  }

  return packets;
}

function formatTimestamp(sec, usec) {
  return new Date((sec * 1000) + Math.floor(usec / 1000)).toISOString();
}

function printFileStats(packets) {
  if (packets.length === 0) {
    console.log('No packets found in the file.');
    return;
  }

  const isNm4 = packets.every(pkt => pkt.timestampUsec === 0);
  const typeLabel = isNm4 ? '.nm4 (text)' : '.bin (binary)';
  const start = packets[0].timestampSec + packets[0].timestampUsec / 1e6;
  const end = packets[packets.length - 1].timestampSec + packets[packets.length - 1].timestampUsec / 1e6;
  const duration = end - start;

  const mmsiSet = new Set();
  for (const pkt of packets) {
    const sentence = pkt.data.toString('utf-8').trim();
    if (!sentence.startsWith('!')) continue;
    const decoded = aisReceiver.extractSentenceRawFields(sentence, false);
    if (decoded?.mmsi) mmsiSet.add(decoded.mmsi);
  }

  console.log('=== AIS File Statistics ===');
  console.log(`File: ${args.file}`);
  console.log(`Type: ${typeLabel}`);
  console.log(`Number of packets: ${packets.length}`);
  console.log(`Unique MMSIs (vessels): ${mmsiSet.size}`);
  console.log(`Start time (UTC): ${formatTimestamp(packets[0].timestampSec, packets[0].timestampUsec)}`);
  console.log(`End time   (UTC): ${formatTimestamp(packets[packets.length - 1].timestampSec, packets[packets.length - 1].timestampUsec)}`);
  console.log(`Duration (seconds): ${duration.toFixed(3)}`);
  console.log(`Duration (hours): ${(duration / 3600).toFixed(3)}`);
  console.log('============================');
}

function formatTimeHMS(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

async function playPackets(packets, onSend) {
  if (packets.length === 0) {
    console.log('No packets to play');
    return;
  }

  const startTime = packets[0].timestampSec + packets[0].timestampUsec / 1e6;
  const endTime = packets[packets.length - 1].timestampSec + packets[packets.length - 1].timestampUsec / 1e6;
  const totalDuration = endTime - startTime;

  const playbackStart = Date.now() / 1000;
  let packetIndex = 0;
  let lastHeartbeatSimTime = startTime;
  const HEARTBEAT_SIM_INTERVAL = 5;

  while (packetIndex < packets.length) {
    const now = Date.now() / 1000;
    const elapsedReal = now - playbackStart;
    const simulatedTime = startTime + elapsedReal * playbackRate;

    if (simulatedTime - lastHeartbeatSimTime >= HEARTBEAT_SIM_INTERVAL) {
      lastHeartbeatSimTime = simulatedTime;
      const timestamp = new Date(simulatedTime * 1000);
      const formatted = timestamp.toISOString().replace(/T/, ' ').replace(/\..+/, '').replace(/-/g, '/');
      const percentPlayed = ((simulatedTime - startTime) / totalDuration * 100).toFixed(1);
      const timeRemainingHMS = formatTimeHMS(Math.max(0, endTime - simulatedTime));
      console.log(`[${formatted}] Waiting... (${percentPlayed}%, ${timeRemainingHMS} remaining)`);
    }

    while (
        packetIndex < packets.length &&
        (packets[packetIndex].timestampSec + packets[packetIndex].timestampUsec / 1e6) <= simulatedTime
        ) {
      const packet = packets[packetIndex++];
      const sentence = packet.data.toString('utf-8').trim();
      if (sentence.startsWith('!')) {
        onSend(packet.timestampSec + packet.timestampUsec / 1e6, sentence);
      }
    }

    await new Promise((r) => setTimeout(r, 50));
  }
}

(async () => {
  try {
    let aisPackets;

    if (args.file.endsWith('.nm4')) {
      aisPackets = parseNm4File(args.file);
    } else {
      aisPackets = parseBinFile(args.file);
    }

    if (args.info) {
      printFileStats(aisPackets);
      process.exit(0);
    }

    console.log(`Parsed ${aisPackets.length} AIS packets from file ${args.file}`);

    let producer;

    if (protocol === 'mqtt') {
      producer = new MessageProducerMQTT({ brokerUrl: broker, username, password });
    } else if (protocol === 'stomp') {
      const [host, portStr] = broker.split(':');
      const port = parseInt(portStr, 10) || DEFAULT_STOMP_PORT;

      producer = new MessageProducerSTOMP({ relayhost: host, port, username, password, topicSeparator: separator });

      topic = topic.replace(/\/+\$/, '');
    } else {
      throw new Error('Unsupported protocol');
    }

    await producer.init();
    const topicControl = replaceDataWithControl(topic);
    producer.sendMessage(topicControl, JSON.stringify({ action: "CLEAR" }));

    const onSend = (packetTime, sentence) => {
      try {
        const decoded = aisReceiver.extractSentenceRawFields(sentence);
        if (!decoded?.mmsi) {
          console.warn(`Skipping: no MMSI found for sentence: ${sentence}`);
          return;
        }

        const destinationTopic = `${topic}/${decoded.mmsi}`;
        producer.sendMessage(destinationTopic, sentence);

        const timestamp = new Date(packetTime * 1000);
        const formatted = timestamp.toISOString().replace(/T/, ' ').replace(/\..+/, '').replace(/-/g, '/');
        console.log(`[${formatted}] ${protocol.toUpperCase()} → ${producer.createPath(destinationTopic)}: ${sentence}`);
      } catch (err) {
        console.error(`Failed to send or parse sentence: ${sentence}`, err);
      }
    };

    await playPackets(aisPackets, onSend);

    console.log('Playback complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
