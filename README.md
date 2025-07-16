# AIS Player

A Node.js command-line tool to parse AIS binary files and replay AIS sentences via MQTT or STOMP brokers.

---

## Features

- Reads AIS files containing timestamped AIS NMEA sentences from binary files or nm4.
- Supports sending AIS messages over MQTT or STOMP protocols.
- Allows filtering and formatting of topics with customizable separators.
- Provides file statistics such as number of packets, unique MMSIs, and duration.
- Supports authentication for brokers.
- Plays back AIS messages at the original recorded time intervals.

---

## Requirements

- Node.js (tested with v14+)
- npm packages:
    - `minimist` (CLI parser)
    - `ais-web` (Encoding decoding AIS sentences)
    - `mqtt` (for MQTT support)
    - `stompjs` (for STOMP support)

---

## Usage

```bash
node index.js [options]
```

### Options

| Flag           | Description                                                                                      | Default                        |
| -------------- |--------------------------------------------------------------------------------------------------| ------------------------------ |
| `-f, --file`   | Path to AIS file (.nm4 or .bin)                                                                  | `./DonneesBrutesAIS.bin`       |
| `-b, --broker` | Broker URL or host (mandatory unless `--info` is used)                                           | —                              |
| `-u, --username` | Broker username (optional)                                                                       | —                              |
| `-p, --password` | Broker password (optional)                                                                       | —                              |
| `-t, --topic`  | Topic/Route prefix to send messages (for STOMP, `/topic/` prefix is added automatically for STOMP) | `producers/ais/data`           |
| `-s, --separator` | STOMP topic separator character (`/` or `.`)                                                     | `.`                            |
| `-i, --info`   | Show statistics about the AIS file and exit                                               | —                              |
| `-h, --help`   | Show help message                                                                                | —                              |

---

## Examples

Send AIS data to an MQTT broker:

```bash
node index.js -b mqtt://localhost:1883 -f filename.bin
```

Send AIS data to a STOMP broker with dot separator:

```bash
node index.js -b localhost:61613 -f filename.bin 
```

Send AIS data to a STOMP broker to /topic/producers/ais/data with `.` as separator:

```bash
node index.js -b localhost:61613 -t producers/ais/data -s .
```

Show info about AIS binary file:
```bash
node index.js -f ./filename.bin -i
```

Show info about AIS nm4 file:
```bash
node index.js -f ./filename.nm4 -i
```

Show help about this program:
```bash
node index.js -h
```


## Notes
The tool parses a binary files or nm4 tex files containing AIS messages with timestamps .

* It respects original timing to replay AIS messages at the same intervals.
* For STOMP, the /topic/ prefix is automatically added.
* The topic separator can be customized for STOMP to either / or .
* Broker credentials are optional and can be provided if needed.
The AIS decoding uses the ais-web library's AisReceiver class.

## License
MIT License (or your preferred license)
