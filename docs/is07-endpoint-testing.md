# IS-07 Endpoint Testing Guide

This guide helps you test the nmos-is07-endpoint node without physical RIEDEL Smartpanel hardware.

## Test Environment Setup

### Option 1: Local MQTT Broker (Mosquitto)

Install Mosquitto MQTT broker:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install mosquitto mosquitto-clients
sudo systemctl start mosquitto
```

**macOS:**
```bash
brew install mosquitto
brew services start mosquitto
```

**Docker:**
```bash
docker run -d -p 1883:1883 -p 9001:9001 eclipse-mosquitto
```

### Option 2: Public MQTT Broker (Testing Only)

For quick testing, use a public broker:
- `mqtt://test.mosquitto.org:1883`
- `mqtt://broker.hivemq.com:1883`

⚠️ **Warning**: Never use public brokers for production!

## Test Tools

### 1. MQTT Explorer (GUI)

Download: [mqtt-explorer.com](http://mqtt-explorer.com/)

**Setup:**
1. Connect to your MQTT broker
2. Subscribe to `x-nmos/events/1.0/#`
3. Publish test messages to `x-nmos/events/1.0/test-source/boolean`

### 2. mosquitto_pub/sub (CLI)

**Subscribe to all IS-07 events:**
```bash
mosquitto_sub -h localhost -t "x-nmos/events/1.0/#" -v
```

**Publish test event:**
```bash
mosquitto_pub -h localhost \
  -t "x-nmos/events/1.0/test-source-id/boolean" \
  -m '{"grain_type":"event","source_id":"test-source-id","flow_id":"test-flow-id","origin_timestamp":"1705315800:123456789","sync_timestamp":"1705315800:123456789","creation_timestamp":"1705315800:123456789","rate":{"numerator":0,"denominator":1},"duration":{"numerator":0,"denominator":1},"grain":{"type":"urn:x-nmos:format:data.event","topic":"event","data":[{"path":"test/value","pre":false,"post":true}]}}'
```

### 3. Node-RED Test Flow

Create a simple publisher flow:

```json
[
  {
    "type": "inject",
    "name": "Send Test Event",
    "topic": "",
    "payload": "",
    "repeat": "",
    "once": false
  },
  {
    "type": "function",
    "name": "Build IS-07 Grain",
    "func": "msg.topic = 'x-nmos/events/1.0/test-source/boolean';\nmsg.payload = {\n  grain_type: 'event',\n  source_id: 'test-source-id',\n  flow_id: 'test-flow-id',\n  origin_timestamp: '1705315800:123456789',\n  sync_timestamp: '1705315800:123456789',\n  creation_timestamp: '1705315800:123456789',\n  rate: {numerator: 0, denominator: 1},\n  duration: {numerator: 0, denominator: 1},\n  grain: {\n    type: 'urn:x-nmos:format:data.event',\n    topic: 'event',\n    data: [{\n      path: 'button/1',\n      pre: false,\n      post: true\n    }]\n  }\n};\nreturn msg;"
  },
  {
    "type": "mqtt out",
    "name": "Publish to MQTT",
    "topic": "",
    "broker": ""
  }
]
```

## Test Cases

### Test 1: Basic Event Reception

**Objective**: Verify endpoint receives IS-07 events

**Steps:**
1. Deploy endpoint node with debug output
2. Send test event via mosquitto_pub or MQTT Explorer
3. Verify event appears in Node-RED debug panel

**Expected Result:**
```json
{
  "topic": "x-nmos/events/1.0/test-source-id/boolean",
  "payload": { /* IS-07 grain */ },
  "source_id": "test-source-id",
  "flow_id": "test-flow-id",
  "endpoint": {
    "device_id": "...",
    "receiver_id": "..."
  }
}
```

**Pass/Fail**: ✅ Event received | ❌ No event

---

### Test 2: Button Command Parsing

**Objective**: Verify Smartpanel button parsing

**Test Event:**
```json
{
  "grain_type": "event",
  "source_id": "smartpanel-id",
  "flow_id": "flow-id",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [
      {"path": "button/1", "pre": false, "post": true},
      {"path": "button/2", "pre": true, "post": false}
    ]
  }
}
```

**Expected Output:**
```json
{
  "smartpanel": {
    "commands": [
      {
        "type": "button",
        "button": 1,
        "pressed": true,
        "raw_path": "button/1",
        "raw_value": true
      },
      {
        "type": "button",
        "button": 2,
        "pressed": false,
        "raw_path": "button/2",
        "raw_value": false
      }
    ]
  }
}
```

**Pass/Fail**: ✅ Commands parsed correctly | ❌ Parsing failed

---

### Test 3: Tally Signal Parsing

**Objective**: Verify tally command parsing

**Test Events:**

```bash
# Red tally (program)
mosquitto_pub -h localhost -t "x-nmos/events/1.0/smartpanel/boolean" -m '{
  "grain_type": "event",
  "source_id": "smartpanel-id",
  "flow_id": "flow-id",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [{"path": "tally/red", "pre": false, "post": true}]
  }
}'

# Green tally (preview)
mosquitto_pub -h localhost -t "x-nmos/events/1.0/smartpanel/boolean" -m '{
  "grain_type": "event",
  "source_id": "smartpanel-id",
  "flow_id": "flow-id",
  "origin_timestamp": "1705315801:123456789",
  "sync_timestamp": "1705315801:123456789",
  "creation_timestamp": "1705315801:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [{"path": "tally/green", "pre": false, "post": true}]
  }
}'
```

**Expected Output:**
```json
{
  "smartpanel": {
    "commands": [
      {
        "type": "tally",
        "color": "red",  // or "green"
        "state": true,
        "raw_path": "tally/red",
        "raw_value": true
      }
    ]
  }
}
```

**Pass/Fail**: ✅ Tally parsed correctly | ❌ Parsing failed

---

### Test 4: Fader/Level Parsing

**Objective**: Verify fader command parsing

**Test Event:**
```json
{
  "grain_type": "event",
  "source_id": "smartpanel-id",
  "flow_id": "flow-id",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [{"path": "fader/1", "pre": 0.5, "post": 0.75}]
  }
}
```

**Expected Output:**
```json
{
  "smartpanel": {
    "commands": [{
      "type": "fader",
      "fader": 1,
      "value": 0.75,
      "raw_path": "fader/1",
      "raw_value": 0.75,
      "pre_value": 0.5
    }]
  }
}
```

**Pass/Fail**: ✅ Fader parsed correctly | ❌ Parsing failed

---

### Test 5: GPIO Parsing

**Objective**: Verify GPIO command parsing

**Test Event:**
```json
{
  "grain_type": "event",
  "source_id": "smartpanel-id",
  "flow_id": "flow-id",
  "origin_timestamp": "1705315800:123456789",
  "sync_timestamp": "1705315800:123456789",
  "creation_timestamp": "1705315800:123456789",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "event",
    "data": [
      {"path": "gpio/input/1", "pre": false, "post": true},
      {"path": "gpi/2", "pre": true, "post": false}
    ]
  }
}
```

**Expected Output:**
```json
{
  "smartpanel": {
    "commands": [
      {
        "type": "gpio",
        "gpio": 1,
        "state": true,
        "raw_path": "gpio/input/1",
        "raw_value": true
      },
      {
        "type": "gpio",
        "gpio": 2,
        "state": false,
        "raw_path": "gpi/2",
        "raw_value": false
      }
    ]
  }
}
```

**Pass/Fail**: ✅ GPIO parsed correctly | ❌ Parsing failed

---

### Test 6: Status Update (Bidirectional)

**Objective**: Verify endpoint can send status updates

**Setup:**
1. Enable "Send Status Updates" in endpoint config
2. Subscribe to status topic with mosquitto_sub:
   ```bash
   mosquitto_sub -h localhost -t "x-nmos/events/1.0/+/object" -v
   ```

**Test Action:**
Send message to endpoint node:
```javascript
msg.payload = {
    action: "send_status",
    path: "tally/red/confirmed",
    value: true
};
```

**Expected Result:**
Status grain published to MQTT with:
- Topic: `x-nmos/events/1.0/{status-source-id}/object`
- Grain data containing the status update

**Pass/Fail**: ✅ Status published | ❌ No status

---

### Test 7: Command History

**Objective**: Verify command history tracking

**Steps:**
1. Send several test events to endpoint
2. Send get history action:
   ```javascript
   msg.payload = { action: "get_command_history", limit: 5 };
   ```

**Expected Result:**
```json
{
  "history": [
    {
      "timestamp": "ISO-8601",
      "source_id": "source-uuid",
      "topic": "mqtt-topic",
      "grain_type": "event",
      "commands": [ /* parsed commands */ ]
    }
  ],
  "total": 5
}
```

**Pass/Fail**: ✅ History retrieved | ❌ History empty/error

---

### Test 8: State Management

**Objective**: Verify received state tracking

**Steps:**
1. Send multiple events with different paths and values
2. Query received states:
   ```javascript
   msg.payload = { action: "get_received_states" };
   ```

**Expected Result:**
```json
{
  "states": [
    {
      "source_id": "source-uuid",
      "path": "property/path",
      "value": current_value,
      "pre_value": previous_value,
      "timestamp": "TAI-timestamp"
    }
  ],
  "count": 10,
  "sources": ["source-1", "source-2"]
}
```

**Pass/Fail**: ✅ States tracked | ❌ States not tracked

---

### Test 9: Subscription Filtering

**Objective**: Verify topic filtering works

**Setup:**
Configure endpoint with filter: `x-nmos/events/1.0/specific-source-id/+`

**Test:**
1. Send event from `specific-source-id` → Should receive
2. Send event from `other-source-id` → Should NOT receive

**Pass/Fail**: ✅ Filter works | ❌ Receives all or none

---

### Test 10: IS-04 Registration

**Objective**: Verify endpoint registers with NMOS registry

**Prerequisites:**
- NMOS registry running and accessible
- nmos-config properly configured

**Steps:**
1. Deploy endpoint node
2. Check node status (should be green)
3. Query registry for receiver:
   ```bash
   curl http://registry-ip:8080/x-nmos/query/v1.3/receivers/{receiver-id}
   ```

**Expected Result:**
Receiver resource found with:
- Correct labels
- Transport type: `urn:x-nmos:transport:mqtt`
- Format: `urn:x-nmos:format:data`
- Tags indicating IS-07 endpoint

**Pass/Fail**: ✅ Registered | ❌ Not found in registry

---

## Automated Test Script

Create a Node-RED test flow that runs all tests automatically:

```javascript
// Function node: Run All Tests
const tests = [];

// Test 1: Send button event
tests.push({
    name: "Button Parsing",
    payload: buildGrain("button/1", false, true)
});

// Test 2: Send tally event
tests.push({
    name: "Tally Parsing",
    payload: buildGrain("tally/red", false, true)
});

// Test 3: Send fader event
tests.push({
    name: "Fader Parsing",
    payload: buildGrain("fader/1", 0.5, 0.75)
});

function buildGrain(path, pre, post) {
    return {
        grain_type: "event",
        source_id: "test-source",
        flow_id: "test-flow",
        origin_timestamp: getTAI(),
        sync_timestamp: getTAI(),
        creation_timestamp: getTAI(),
        rate: {numerator: 0, denominator: 1},
        duration: {numerator: 0, denominator: 1},
        grain: {
            type: "urn:x-nmos:format:data.event",
            topic: "event",
            data: [{path: path, pre: pre, post: post}]
        }
    };
}

function getTAI() {
    const now = Date.now() / 1000;
    return Math.floor(now + 37) + ":000000000";
}

// Store tests in flow context
flow.set("tests", tests);
flow.set("testIndex", 0);

return {payload: tests[0].payload, testName: tests[0].name};
```

## Performance Testing

### Load Test: Multiple Rapid Events

Send 100 events in quick succession:

```bash
for i in {1..100}; do
    mosquitto_pub -h localhost -t "x-nmos/events/1.0/test/boolean" -m "{...}"
done
```

**Monitor:**
- Node-RED memory usage
- Message processing latency
- MQTT broker load

### Stress Test: Multiple Concurrent Sources

Simulate 10 Smartpanels sending events simultaneously.

**Expected**: All events processed without loss.

## Troubleshooting Tests

If tests fail, check:

1. **MQTT Broker Connectivity**
   ```bash
   mosquitto_sub -h localhost -t "#" -v
   ```

2. **Node-RED Logs**
   ```bash
   node-red-log
   ```

3. **NMOS Registry**
   ```bash
   curl http://registry-ip:8080/x-nmos/query/v1.3/receivers
   ```

4. **Network Connectivity**
   ```bash
   ping registry-ip
   ping mqtt-broker-ip
   ```

## Test Results Template

| Test | Status | Notes |
|------|--------|-------|
| Basic Event Reception | ✅ Pass |  |
| Button Parsing | ✅ Pass |  |
| Tally Parsing | ✅ Pass |  |
| Fader Parsing | ✅ Pass |  |
| GPIO Parsing | ✅ Pass |  |
| Status Updates | ✅ Pass |  |
| Command History | ✅ Pass |  |
| State Management | ✅ Pass |  |
| Subscription Filter | ✅ Pass |  |
| IS-04 Registration | ✅ Pass |  |

## Conclusion

After completing these tests, you should have confidence that:
- Endpoint receives IS-07 events correctly
- Smartpanel commands are parsed accurately
- Bidirectional communication works
- State and history tracking functions properly
- IS-04 registration succeeds

Ready to deploy to production! 🚀
