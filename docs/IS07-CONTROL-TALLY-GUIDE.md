# IS-07 Control & Tally Guide

## Overview

AMWA IS-07 Event & Tally provides a standardized way to transmit control commands and tally states over IP networks. This guide covers how to use the Node-RED NMOS IS-07 nodes for professional broadcast control and tally applications.

## What is IS-07?

IS-07 defines a mechanism for transporting event data, including tally information and control commands, using either MQTT or WebSocket protocols. It's part of the NMOS family of specifications and integrates with IS-04 (Discovery & Registration) and IS-05 (Connection Management).

### Key Concepts

- **Grains**: The fundamental data unit in IS-07, containing timestamped event data
- **Sources**: The origin of event streams
- **Flows**: Continuous streams of grains from a source
- **Senders**: Publish event grains over the network
- **Receivers**: Subscribe to and consume event grains
- **Transport**: MQTT or WebSocket protocols for data transmission

## Transport Types

### MQTT Transport

**Advantages:**
- Lightweight pub/sub protocol
- Built-in Quality of Service (QoS) levels
- Excellent for many-to-many communication
- Persistent connections with automatic reconnection
- Topic-based filtering and routing

**Best For:**
- Multi-camera tally systems
- Large-scale facility control
- Event distribution to many receivers
- Redundant systems

**Configuration:**
```
Broker: mqtt://broker.example.com:1883
QoS: 0 (at most once), 1 (at least once), or 2 (exactly once)
Topic Pattern: x-nmos/events/{source_id}
```

### WebSocket Transport

**Advantages:**
- Full-duplex communication
- Direct peer-to-peer connections
- Lower latency for point-to-point communication
- Easier firewall traversal (uses HTTP/HTTPS)

**Best For:**
- Direct panel-to-device control
- Low-latency applications
- Bidirectional control with feedback
- Simple point-to-point connections

**Configuration:**
```
Port: 3001-3010 (configurable)
URL: ws://device.example.com:3002/x-nmos/events
```

### Choosing a Transport

| Use Case | Recommended Transport | Reason |
|----------|----------------------|---------|
| Camera tally (1 to many) | MQTT | Efficient distribution to multiple cameras |
| Audio mixer control | WebSocket | Low latency for real-time adjustments |
| Panel integration | Both | MQTT for tally, WebSocket for control |
| GPIO control | MQTT | Simple topic-based routing |
| Large facility | MQTT | Scales well with many devices |

## Setting Up IS-07 Nodes

### Sender Node Configuration

1. **Add NMOS Config Node**
   - Configure your NMOS registry URL
   - Set API version (typically v1.3)

2. **Configure Sender Node**
   - Name: Descriptive name for the sender
   - Transport Type: MQTT, WebSocket, or Both
   - MQTT Broker: `mqtt://broker:1883` (for MQTT)
   - WebSocket Port: `3002` (for WebSocket)
   - Event Type: boolean, string, number, or object

3. **Connect Input**
   - Send event data as `msg.payload`
   - Format depends on event type

### Receiver Node Configuration

1. **Configure Receiver Node**
   - Name: Descriptive name for the receiver
   - Transport Type: Must match sender
   - MQTT Broker: Same as sender (for MQTT)
   - Subscription Filter: Topic pattern to subscribe to

2. **Process Output**
   - Received grains appear in `msg.payload`
   - Contains grain metadata and event data

## Tally Routing Workflows

### Basic Tally System

Simple one-sender, one-receiver tally:

```
[Input] → [IS-07 Sender] →→→ MQTT/WS →→→ [IS-07 Receiver] → [Output]
```

**Sender Payload:**
```javascript
msg.payload = {
    red: true,
    yellow: false,
    green: false
};
```

### Multi-Camera Tally

Distribute tally to multiple cameras:

```
[Director Panel]
      ↓
[IS-07 Sender (MQTT)]
      ↓
    MQTT Broker
      ↓
      ├→ [Receiver: Camera 1] → [GPIO Output]
      ├→ [Receiver: Camera 2] → [GPIO Output]
      ├→ [Receiver: Camera 3] → [GPIO Output]
      └→ [Receiver: Camera 4] → [GPIO Output]
```

Each receiver filters by camera ID in the subscription pattern.

### Tally Aggregation

Combine multiple tally sources with priority (using TallyAggregator):

```javascript
const TallyAggregator = require('./nodes/lib/tally-aggregator');
const aggregator = new TallyAggregator();

// Update from different sources
aggregator.update('director', { red: false, yellow: true, green: false });
aggregator.update('producer', { red: true, yellow: false, green: false });

// Get final state (red takes priority)
const state = aggregator.getAggregatedState();
// Result: { red: true, yellow: false, green: false }
```

**Priority Order:**
1. Red (highest - 3)
2. Yellow (medium - 2)
3. Green (lowest - 1)

## GPIO Integration

### Using the GPIO Mapper

The GPIO mapper translates IS-07 events to GPIO pin states:

```javascript
const GPIOMapper = require('./nodes/lib/gpio-mapper');

const mapper = new GPIOMapper({
    mapping: {
        '/tally/red': 17,
        '/tally/yellow': 27,
        '/tally/green': 22,
        '/button/1': 23
    }
});

// Map incoming event
const eventData = { path: '/tally/red', post: true };
const gpioEvents = mapper.mapEvent(eventData);
// Result: [{ pin: 17, value: true, timestamp: ... }]
```

### GPIO Control Flow

```
[IS-07 Receiver] → [Function: GPIO Mapper] → [GPIO Output Node]
```

**Function Node Code:**
```javascript
const GPIOMapper = global.get('gpioMapper');
if (!GPIOMapper) {
    const GPIOMapperClass = require('./nodes/lib/gpio-mapper');
    GPIOMapper = new GPIOMapperClass({
        mapping: {
            '/tally/red': 17,
            '/tally/yellow': 27,
            '/tally/green': 22
        }
    });
    global.set('gpioMapper', GPIOMapper);
}

const events = GPIOMapper.mapEvent(msg.payload);
if (events && events.length > 0) {
    return events.map(e => ({
        payload: e.value,
        topic: `gpio/${e.pin}`
    }));
}
```

## Smartpanel Integration

### Understanding Smartpanel Commands

Smartpanels (like Riedel smartpanels) send structured control commands:

```javascript
{
    "grain": {
        "data": [
            { "path": "/button/1", "post": 1 },
            { "path": "/tally/red", "post": true },
            { "path": "/fader/1", "post": 0.75 },
            { "path": "/gpio/5", "post": 1 }
        ]
    },
    "origin_timestamp": "1234567890:500000000"
}
```

### Parsing Smartpanel Commands

The receiver node includes a built-in parser:

```javascript
// This function is built into the receiver node
const parseSmartpanelCommand = (grain) => {
    // Returns array of parsed commands:
    // [
    //   { type: 'button', button: 1, pressed: true, timestamp: ... },
    //   { type: 'tally', color: 'red', state: true, timestamp: ... },
    //   { type: 'fader', fader: 1, value: 0.75, timestamp: ... },
    //   { type: 'gpio', pin: 5, state: true, timestamp: ... }
    // ]
};
```

### Smartpanel Workflow

```
[Smartpanel] → [IS-07 Sender] → MQTT → [IS-07 Receiver] → [Switch Node]
                                                                ↓
                        ┌───────────────────────────────────────┼───────┐
                        ↓                                       ↓       ↓
                   [Buttons]                               [Tally]  [Faders]
```

**Switch Node Configuration:**
- Property: `msg.payload.type`
- Rules:
  - `== button` → Output 1
  - `== tally` → Output 2
  - `== fader` → Output 3
  - `== gpio` → Output 4

## Connection Health Monitoring

Both sender and receiver nodes include connection health monitoring:

```javascript
healthStats = {
    messagesReceived: 150,
    messagesSent: 75,
    errors: 2,
    lastMessageTime: 1699999999999,
    connectionQuality: 'excellent'  // excellent, good, fair, or poor
}
```

**Quality Calculation:**
- **Excellent**: < 1% error rate
- **Good**: 1-5% error rate
- **Fair**: 5-10% error rate
- **Poor**: > 10% error rate

## Advanced Patterns

### Bidirectional Control with Feedback

```
[Control Panel]
      ↕
[IS-07 Sender/Receiver]
      ↕
    MQTT Broker
      ↕
[IS-07 Receiver/Sender]
      ↕
  [Device Control]
```

### Event Filtering

Use MQTT topic patterns to filter events:

```
x-nmos/events/camera-1/#      - All events from camera-1
x-nmos/events/+/tally         - Tally from all sources
x-nmos/events/studio-a/+      - All events from studio-a
```

### State Persistence

Store and restore tally states:

```javascript
// Save state
const currentState = msg.payload;
context.set('lastTallyState', currentState);

// Restore on startup
const savedState = context.get('lastTallyState') || { 
    red: false, yellow: false, green: false 
};
```

## Troubleshooting

### Common Issues

**Issue: Sender not registering**
- Check NMOS registry URL and credentials
- Verify network connectivity to registry
- Check registry API version compatibility

**Issue: No events received**
- Verify transport type matches between sender and receiver
- Check MQTT broker connectivity and topic subscription
- Ensure sender and receiver are on same network segment (for WebSocket)

**Issue: High latency**
- Consider switching from MQTT to WebSocket for point-to-point
- Reduce MQTT QoS level (0 is fastest)
- Check network congestion

**Issue: Missed events**
- Increase MQTT QoS level to 1 or 2
- Check for network packet loss
- Monitor connection quality metrics

### Debugging Tips

1. **Enable Debug Logging**
   - Check Node-RED debug panel
   - Look for registration and connection messages

2. **Monitor Health Stats**
   - Send health stats to debug output periodically
   - Watch for increasing error counts

3. **Test with Simple Flow**
   - Start with basic sender→receiver test
   - Add complexity incrementally

4. **Verify MQTT Topics**
   - Use MQTT.fx or similar tool to monitor broker
   - Check published topics match subscription patterns

## Best Practices

1. **Use MQTT for Tally Distribution**
   - More efficient for one-to-many scenarios
   - Better reliability with QoS settings

2. **Use WebSocket for Interactive Control**
   - Lower latency for real-time feedback
   - Simpler for point-to-point communication

3. **Implement Tally Aggregation**
   - Combine multiple sources safely
   - Respect priority levels (red > yellow > green)

4. **Monitor Connection Health**
   - Set up alerts for poor connection quality
   - Log errors for troubleshooting

5. **Use Descriptive Labels**
   - Name devices clearly (Camera-1-Tally, Mixer-1-Control)
   - Include location or purpose in labels

6. **Plan Your Network**
   - Use dedicated VLAN for NMOS traffic
   - Ensure adequate bandwidth for event streams
   - Consider redundant MQTT brokers

7. **Test Failover Scenarios**
   - What happens if MQTT broker fails?
   - Can receivers reconnect automatically?
   - Is there a fallback mechanism?

## Security Considerations

- Use TLS/SSL for MQTT (mqtts://)
- Use WSS (WebSocket Secure) for WebSocket transport
- Implement authentication on MQTT broker
- Restrict access to NMOS registry
- Use separate networks/VLANs for control traffic
- Monitor for unauthorized event sources

## Further Reading

- [AMWA IS-07 Specification](https://specs.amwa.tv/is-07/)
- [AMWA IS-04 Specification](https://specs.amwa.tv/is-04/)
- [MQTT Protocol](https://mqtt.org/)
- [WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
