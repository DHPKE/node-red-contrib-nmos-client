# IS-07 Examples

This document provides detailed code examples for common IS-07 use cases with the Node-RED NMOS client nodes.

## Table of Contents

1. [Simple Tally System](#simple-tally-system)
2. [Multi-Camera Tally Aggregation](#multi-camera-tally-aggregation)
3. [Audio Mixer Control](#audio-mixer-control)
4. [GPIO Panel Integration](#gpio-panel-integration)
5. [Bidirectional Control](#bidirectional-control)

## Simple Tally System

A basic tally system with one sender and one receiver.

### Flow Description

A button panel sends tally states (red/yellow/green) to a camera tally light.

### Sender Configuration

**Node: IS-07 Sender**
- Name: `Tally Sender`
- Transport Type: `MQTT`
- MQTT Broker: `mqtt://localhost:1883`
- Event Type: `object`

### Function Node: Create Tally State

```javascript
// msg.topic contains the button pressed: "red", "yellow", "green", or "off"
const tallyState = {
    red: msg.topic === 'red',
    yellow: msg.topic === 'yellow',
    green: msg.topic === 'green'
};

return {
    payload: tallyState,
    topic: 'tally/camera-1'
};
```

### Receiver Configuration

**Node: IS-07 Receiver**
- Name: `Tally Receiver`
- Transport Type: `MQTT`
- MQTT Broker: `mqtt://localhost:1883`
- Subscription Filter: `x-nmos/events/+/tally/camera-1`

### Function Node: Display Tally

```javascript
// Extract tally state from grain
const grain = msg.payload;
if (grain && grain.grain && grain.grain.data) {
    const data = grain.grain.data[0];
    
    if (data.post.red) {
        msg.payload = "🔴 RED";
        msg.background = "red";
    } else if (data.post.yellow) {
        msg.payload = "🟡 YELLOW";
        msg.background = "yellow";
    } else if (data.post.green) {
        msg.payload = "🟢 GREEN";
        msg.background = "green";
    } else {
        msg.payload = "⚫ OFF";
        msg.background = "black";
    }
}

return msg;
```

### Complete Flow Structure

```
[Inject: Red] ──┐
[Inject: Yellow]─┼─→ [Function: Create Tally] → [IS-07 Sender]
[Inject: Green]──┤                                     ↓
[Inject: Off] ───┘                                 MQTT Broker
                                                        ↓
                                            [IS-07 Receiver]
                                                        ↓
                                            [Function: Display]
                                                        ↓
                                                   [Debug]
```

---

## Multi-Camera Tally Aggregation

Aggregate tally from multiple sources (director, producer, automation) for multiple cameras.

### Architecture

```
Director Panel ──→ [Sender 1] ──┐
Producer Panel ──→ [Sender 2] ──┼──→ MQTT Broker ──→ Aggregator ──→ Camera Outputs
Automation ──────→ [Sender 3] ──┘
```

### Function Node: Tally Aggregator

```javascript
// Initialize aggregator in global context
let aggregator = global.get('tallyAggregator');
if (!aggregator) {
    const TallyAggregator = require('./nodes/lib/tally-aggregator');
    aggregator = new TallyAggregator();
    global.set('tallyAggregator', aggregator);
}

// Update aggregator with incoming tally
const sourceId = msg.topic; // e.g., "director", "producer", "automation"
const cameraId = msg.camera || "camera-1";

// Extract tally state from grain
const grain = msg.payload;
if (grain && grain.grain && grain.grain.data) {
    const tallyState = grain.grain.data[0].post;
    
    // Update source
    aggregator.update(`${sourceId}-${cameraId}`, tallyState);
    
    // Get aggregated result
    const finalState = aggregator.getAggregatedState();
    
    return {
        payload: finalState,
        camera: cameraId,
        sources: Array.from(aggregator.sources.keys())
    };
}

return null;
```

### Function Node: Route to Cameras

```javascript
// Route aggregated tally to specific camera
const cameraId = msg.camera || "camera-1";
const tallyState = msg.payload;

// Create output messages for each camera
const cameras = ["camera-1", "camera-2", "camera-3", "camera-4"];
const outputs = new Array(cameras.length).fill(null);

const cameraIndex = cameras.indexOf(cameraId);
if (cameraIndex >= 0) {
    outputs[cameraIndex] = {
        payload: tallyState,
        camera: cameraId,
        timestamp: Date.now()
    };
}

return outputs;
```

### Switch Node Configuration

Route by camera ID:
- Property: `msg.camera`
- Rules:
  - `== camera-1` → Output 1
  - `== camera-2` → Output 2
  - `== camera-3` → Output 3
  - `== camera-4` → Output 4

---

## Audio Mixer Control

Control an audio mixer using WebSocket for low-latency feedback.

### Sender Configuration (Control Panel)

**Node: IS-07 Sender**
- Name: `Mixer Control Sender`
- Transport Type: `WebSocket`
- WebSocket Port: `3002`
- Event Type: `object`

### Function Node: Fader Control

```javascript
// msg.payload contains fader number and value
// e.g., { fader: 1, value: 0.75 }

const faderNum = msg.payload.fader || msg.topic;
const faderValue = msg.payload.value;

return {
    payload: {
        path: `/mixer/fader/${faderNum}`,
        value: faderValue,
        timestamp: Date.now()
    }
};
```

### Function Node: Mute Control

```javascript
// msg.payload contains channel number and mute state
// e.g., { channel: 1, muted: true }

const channel = msg.payload.channel || msg.topic;
const muted = msg.payload.muted;

return {
    payload: {
        path: `/mixer/channel/${channel}/mute`,
        value: muted,
        timestamp: Date.now()
    }
};
```

### Receiver Configuration (Mixer)

**Node: IS-07 Receiver**
- Name: `Mixer Control Receiver`
- Transport Type: `WebSocket`
- Subscription Filter: `*` (receive all)

### Function Node: Execute Mixer Command

```javascript
// Parse incoming control grain
const grain = msg.payload;
if (!grain || !grain.grain || !grain.grain.data) {
    return null;
}

const commands = [];
for (const item of grain.grain.data) {
    if (!item.path) continue;
    
    // Parse fader commands
    if (item.path.includes('/mixer/fader/')) {
        const match = item.path.match(/fader\/(\d+)/);
        if (match) {
            commands.push({
                type: 'fader',
                channel: parseInt(match[1]),
                value: item.value || item.post,
                output: 0  // First output
            });
        }
    }
    
    // Parse mute commands
    if (item.path.includes('/mixer/channel/') && item.path.includes('/mute')) {
        const match = item.path.match(/channel\/(\d+)/);
        if (match) {
            commands.push({
                type: 'mute',
                channel: parseInt(match[1]),
                value: item.value || item.post,
                output: 1  // Second output
            });
        }
    }
}

// Create outputs array
if (commands.length > 0) {
    const outputs = [null, null];
    commands.forEach(cmd => {
        outputs[cmd.output] = {
            payload: cmd,
            topic: cmd.type
        };
    });
    return outputs;
}

return null;
```

### Complete Flow Structure

```
[UI Fader] ──→ [Function: Fader Control] ──┐
[UI Mute] ──→ [Function: Mute Control] ────┼──→ [IS-07 Sender (WS)]
                                            │            ↓
                                            │      WebSocket
                                            │            ↓
                                            │  [IS-07 Receiver (WS)]
                                            │            ↓
                                            │  [Function: Execute]
                                            │      ↓          ↓
                                            └→ [Fader]    [Mute]
```

---

## GPIO Panel Integration

Map IS-07 events to GPIO pins for physical control panels.

### Receiver Configuration

**Node: IS-07 Receiver**
- Name: `GPIO Panel Receiver`
- Transport Type: `MQTT`
- MQTT Broker: `mqtt://localhost:1883`
- Subscription Filter: `x-nmos/events/+/gpio/#`

### Function Node: GPIO Mapper

```javascript
// Initialize GPIO mapper
let mapper = global.get('gpioMapper');
if (!mapper) {
    const GPIOMapper = require('./nodes/lib/gpio-mapper');
    mapper = new GPIOMapper({
        mapping: {
            '/tally/red': 17,
            '/tally/yellow': 27,
            '/tally/green': 22,
            '/button/1': 23,
            '/button/2': 24,
            '/button/3': 25,
            '/button/4': 8
        }
    });
    global.set('gpioMapper', mapper);
}

// Parse grain
const grain = msg.payload;
if (!grain || !grain.grain || !grain.grain.data) {
    return null;
}

const outputs = [];

for (const item of grain.grain.data) {
    const gpioEvents = mapper.mapEvent({
        path: item.path,
        post: item.post || item.value
    });
    
    // Add each GPIO event as a separate message
    gpioEvents.forEach(event => {
        outputs.push({
            payload: event.value ? 1 : 0,
            topic: `gpio/${event.pin}`,
            pin: event.pin
        });
    });
}

return outputs.length > 0 ? [outputs] : null;
```

### Function Node: Read GPIO Input

```javascript
// Reads GPIO input and creates IS-07 event
const pin = msg.payload.pin;
const state = msg.payload.state;

// Map GPIO pin back to event path
const pinMapping = {
    23: '/button/1',
    24: '/button/2',
    25: '/button/3',
    8: '/button/4'
};

const eventPath = pinMapping[pin];
if (eventPath) {
    return {
        payload: {
            path: eventPath,
            post: state === 1,
            timestamp: Date.now()
        }
    };
}

return null;
```

### Complete Flow Structure

```
[IS-07 Receiver] → [GPIO Mapper] → [Split] → [GPIO Output (Pin 17)]
                                           → [GPIO Output (Pin 27)]
                                           → [GPIO Output (Pin 22)]
                                           
[GPIO Input (Pin 23)] ─┐
[GPIO Input (Pin 24)] ─┼→ [Function: Map Input] → [IS-07 Sender]
[GPIO Input (Pin 25)] ─┤
[GPIO Input (Pin 8)]  ─┘
```

---

## Bidirectional Control

Implement bidirectional control with feedback (e.g., control a device and receive its state).

### Architecture

```
Control Panel ←→ [Sender/Receiver] ←→ MQTT ←→ [Receiver/Sender] ←→ Device
```

### Control Panel: Send Commands

```javascript
// Function node: Create control command
const command = msg.payload.command; // "start", "stop", "reset"
const deviceId = msg.payload.device || "device-1";

return {
    payload: {
        path: `/control/${deviceId}/${command}`,
        post: true,
        timestamp: Date.now()
    },
    topic: `control/${deviceId}`
};
```

### Device: Process and Respond

```javascript
// Function node: Process command and send status
const grain = msg.payload;
if (!grain || !grain.grain || !grain.grain.data) {
    return null;
}

const commands = [];
for (const item of grain.grain.data) {
    const match = item.path.match(/\/control\/([^\/]+)\/([^\/]+)/);
    if (match) {
        const deviceId = match[1];
        const command = match[2];
        
        // Execute command (this is where you'd interface with actual device)
        let status = executeCommand(deviceId, command);
        
        // Create response
        commands.push({
            payload: {
                path: `/status/${deviceId}`,
                post: {
                    command: command,
                    success: status.success,
                    state: status.state,
                    timestamp: Date.now()
                }
            },
            topic: `status/${deviceId}`
        });
    }
}

return commands.length > 0 ? commands : null;

// Simulated command execution
function executeCommand(deviceId, command) {
    // In real implementation, this would control actual hardware
    switch(command) {
        case 'start':
            return { success: true, state: 'running' };
        case 'stop':
            return { success: true, state: 'stopped' };
        case 'reset':
            return { success: true, state: 'idle' };
        default:
            return { success: false, state: 'error' };
    }
}
```

### Control Panel: Receive Feedback

```javascript
// Function node: Display device status
const grain = msg.payload;
if (!grain || !grain.grain || !grain.grain.data) {
    return null;
}

for (const item of grain.grain.data) {
    if (item.path.includes('/status/')) {
        const status = item.post;
        const deviceId = item.path.match(/\/status\/([^\/]+)/)[1];
        
        return {
            payload: {
                device: deviceId,
                command: status.command,
                success: status.success,
                state: status.state,
                display: `${deviceId}: ${status.state} (${status.success ? 'OK' : 'FAIL'})`
            }
        };
    }
}

return null;
```

### Complete Flow Structure

```
[UI: Start Button] ──┐
[UI: Stop Button] ───┼→ [Create Command] → [IS-07 Sender: Commands] → MQTT
[UI: Reset Button] ──┘                                                  ↓
                                                                        ↓
[Debug: Status] ← [Display Status] ← [IS-07 Receiver: Status] ← MQTT ← 
                                                                        ↓
                                                    [IS-07 Receiver: Commands]
                                                             ↓
                                                    [Process & Respond]
                                                             ↓
                                                [IS-07 Sender: Status] → MQTT
```

---

## Advanced Patterns

### State Persistence

Save and restore tally states across restarts:

```javascript
// On receiving new state
const currentState = msg.payload;
context.set('tallyState', currentState);
flow.set(`tally_${msg.camera}`, currentState);

// On startup (inject node with "inject once after 0.1 seconds")
const savedState = context.get('tallyState') || {
    red: false,
    yellow: false,
    green: false
};

return {
    payload: savedState
};
```

### Event Replay Buffer

Keep a buffer of recent events for debugging:

```javascript
// Get or create event buffer
let buffer = flow.get('eventBuffer') || [];

// Add new event
buffer.push({
    timestamp: Date.now(),
    event: msg.payload,
    source: msg.topic
});

// Keep only last 100 events
if (buffer.length > 100) {
    buffer = buffer.slice(-100);
}

flow.set('eventBuffer', buffer);

// Pass through
return msg;
```

### Watchdog Timer

Detect when events stop arriving:

```javascript
// Update last event time
flow.set('lastEventTime', Date.now());

// Watchdog function (separate inject node, repeat every 5 seconds)
const lastTime = flow.get('lastEventTime') || 0;
const now = Date.now();
const timeSince = now - lastTime;

if (timeSince > 10000) {  // 10 seconds without events
    return {
        payload: {
            alert: 'No events received',
            timeSince: timeSince / 1000
        }
    };
}

return null;
```

---

## Testing and Debugging

### Test Event Generator

```javascript
// Generate test tally events
const colors = ['red', 'yellow', 'green'];
const randomColor = colors[Math.floor(Math.random() * colors.length)];

return {
    payload: {
        red: randomColor === 'red',
        yellow: randomColor === 'yellow',
        green: randomColor === 'green'
    },
    topic: `test/camera-${Math.floor(Math.random() * 4) + 1}`
};
```

### Event Logger

```javascript
// Log all events with timestamps
const grain = msg.payload;
const timestamp = new Date().toISOString();

node.warn(`[${timestamp}] Event received from ${msg.topic}`);

if (grain && grain.grain) {
    node.warn(`  Origin: ${grain.origin_timestamp}`);
    node.warn(`  Data: ${JSON.stringify(grain.grain.data, null, 2)}`);
}

return msg;
```

### Performance Monitor

```javascript
// Track event rate
let stats = flow.get('eventStats') || { count: 0, start: Date.now() };

stats.count++;
const elapsed = Date.now() - stats.start;

if (elapsed > 60000) {  // Every minute
    const rate = (stats.count / elapsed * 1000).toFixed(2);
    node.warn(`Event rate: ${rate} events/second`);
    
    // Reset
    stats = { count: 0, start: Date.now() };
}

flow.set('eventStats', stats);
return msg;
```

---

## See Also

- [IS07-CONTROL-TALLY-GUIDE.md](./IS07-CONTROL-TALLY-GUIDE.md) - Comprehensive control and tally guide
- [is07-endpoint-quickstart.md](./is07-endpoint-quickstart.md) - Quick start guide for IS-07 endpoints
- Example flows in `/examples/` directory
