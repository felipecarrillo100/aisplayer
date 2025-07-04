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
  -f, --file         Path to binary AIS file (default: ${DEFAULT_FILE})
  -b, --broker       Broker URL or host (mandatory unless --info):
                       MQTT example: ${EXAMPLE_MQTT_BROKER}
                       STOMP example: ${EXAMPLE_STOMP_BROKER}
  -u, --username     Broker username (optional)
  -p, --password     Broker password (optional)
  -t, --topic        Topic/Route prefix to send messages (default: ${DEFAULT_TOPIC})
                     (For STOMP, "/topic/" prefix will be added automatically)
  -s, --separator    STOMP topic separator character (default: "${DEFAULT_SEPARATOR}"; options: "/" or ".")
  -i, --info         Show statistics about AIS binary file and exit
  -h, --help         Show this help message
`);
}

const args = minimist(process.argv.slice(2), {
  string: ['file', 'broker', 'username', 'password', 'topic', 'separator'],
  boolean: ['help', 'info'],
  alias: {
    f: 'file',
    b: 'broker',
    u: 'username',
    p: 'password',
    t: 'topic',
    s: 'separator',
    i: 'info',
    h: 'help',
  },
  default: {
    file: DEFAULT_FILE,
    topic: DEFAULT_TOPIC,
    separator: DEFAULT_SEPARATOR,
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

function formatTimestamp(sec, usec) {
  return new Date((sec * 1000) + Math.floor(usec / 1000)).toISOString();
}

function printFileStats(packets) {
  if (packets.length === 0) {
    console.log('No packets found in the file.');
    return;
  }

  const startSec = packets[0].timestampSec + packets[0].timestampUsec / 1e6;
  const endSec = packets[packets.length - 1].timestampSec + packets[packets.length - 1].timestampUsec / 1e6;
  const duration = endSec - startSec;

  const mmsiSet = new Set();
  for (const pkt of packets) {
    const sentence = pkt.data.toString('utf-8').trim();
    if (!sentence.startsWith('!')) continue;
    const decoded = aisReceiver.extractSentenceRawFields(sentence, false);
    if (decoded?.mmsi) mmsiSet.add(decoded.mmsi);
  }

  console.log('=== AIS Binary File Statistics ===');
  console.log(`File: ${args.file}`);
  console.log(`Number of packets: ${packets.length}`);
  console.log(`Unique MMSIs (vessels): ${mmsiSet.size}`);
  console.log(`Start time (UTC): ${formatTimestamp(packets[0].timestampSec, packets[0].timestampUsec)}`);
  console.log(`End time   (UTC): ${formatTimestamp(packets[packets.length - 1].timestampSec, packets[packets.length - 1].timestampUsec)}`);
  console.log(`Duration (seconds): ${duration.toFixed(3)}`);
  console.log(`Duration (hours): ${(duration / 3600).toFixed(3)}`);
  console.log('==================================');
}

async function playPackets(packets, onSend) {
  if (packets.length === 0) {
    console.log('No packets to play');
    return;
  }

  const startTime = packets[0].timestampSec + packets[0].timestampUsec / 1e6;
  const playbackStart = Date.now() / 1000;

  for (const packet of packets) {
    const packetTime = packet.timestampSec + packet.timestampUsec / 1e6;
    const offset = packetTime - startTime;

    const now = Date.now() / 1000;
    const scheduledTime = playbackStart + offset;
    const waitTime = scheduledTime - now;

    if (waitTime > 0) {
      await new Promise((r) => setTimeout(r, waitTime * 1000));
    }

    const sentence = packet.data.toString('utf-8').trim();
    if (!sentence.startsWith('!')) continue;
    onSend(sentence);
  }
}

(async () => {
  try {
    const aisPackets = parseBinFile(args.file);

    if (args.info) {
      printFileStats(aisPackets);
      process.exit(0);
    }

    console.log(`Parsed ${aisPackets.length} AIS packets from file ${args.file}`);

    let producer;

    if (protocol === 'mqtt') {
      producer = new MessageProducerMQTT({
        brokerUrl: broker,
        username,
        password,
      });
    } else if (protocol === 'stomp') {
      const [host, portStr] = broker.split(':');
      const port = parseInt(portStr, 10) || DEFAULT_STOMP_PORT;

      producer = new MessageProducerSTOMP({
        relayhost: host,
        port,
        username,
        password,
        topicSeparator: separator,
      });

      // Clean trailing slashes to avoid issues
      topic = topic.replace(/\/+$/, '');
    } else {
      throw new Error('Unsupported protocol');
    }

    await producer.init();

    const onSend = (sentence) => {
      const decoded = aisReceiver.extractSentenceRawFields(sentence);
      if (!decoded?.mmsi) {
        console.log(`MMSI not found for ${sentence}`);
        return;
      }

      let destinationTopic;

      destinationTopic = `${topic}/${decoded.mmsi}`;

      producer.sendMessage(destinationTopic, sentence);
      console.log(`${protocol.toUpperCase()} sent to ${producer.createPath(destinationTopic)}: ${sentence}`);
    };

    await playPackets(aisPackets, onSend);

    console.log('Playback complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
