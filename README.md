# node-red-contrib-nmos-client

Complete NMOS implementation for Node-RED with IS-04, IS-05, IS-07, and IS-12 support.

[![npm version](https://badge.fury.io/js/node-red-contrib-nmos-client.svg)](https://www.npmjs.com/package/node-red-contrib-nmos-client)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-nmos-client
```

Or via Node-RED Palette Manager: Menu → Manage palette → Search for `node-red-contrib-nmos-client`

## Quick Start

1. Add `nmos-config` node to configure your NMOS registry
2. Use client nodes (`nmos-query`, `nmos-connection`, etc.) to interact with NMOS resources
3. For Dashboard routing, add `nmos-matrix-ui` with `@flowfuse/node-red-dashboard`

## Nodes

### Configuration
- **nmos-config** - NMOS registry connection (required by all nodes)

### Client Nodes
- **nmos-query** - Query resources (senders, receivers, devices, etc.)
- **nmos-get-one** - Get single resource by ID
- **nmos-connection** - Create/modify IS-05 connections
- **nmos-websocket** - Subscribe to registry changes

### Device Nodes
- **nmos-node** - Register as IS-05 routable receiver
- **nmos-is07-events** - Publish IS-07 events/tally via MQTT
- **nmos-is12-control** - IS-12 NCP control device via MQTT

### Dashboard
#### nmos-matrix-ui
Interactive routing matrix for Dashboard.

**Config:** Registry (required), Group (required), Width (12), Height (8)  
**Features:** Click crosspoints to route, search/filter, real-time updates  
**Output:** Routes to `nmos-connection` node  
**Requires:** `@flowfuse/node-red-dashboard`

## Features

- **IS-04** - Discovery & registration (v1.0-v1.3)
- **IS-05** - Connection management (v1.0-v1.1)
- **IS-07** - MQTT events & tally
- **IS-12** - NCP control protocol

## Requirements

- NMOS registry (BBC, Sony, Mellanox)
- MQTT broker for IS-07/IS-12 (Mosquitto, EMQX, HiveMQ)
- `@flowfuse/node-red-dashboard` for matrix-ui

## License

Apache-2.0

## Links

- [GitHub](https://github.com/DHPKE/node-red-contrib-nmos-client)
- [npm](https://www.npmjs.com/package/node-red-contrib-nmos-client)
- [AMWA NMOS](https://specs.amwa.tv/nmos/)
