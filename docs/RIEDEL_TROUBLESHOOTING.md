# RIEDEL Artist & SmartPanel Troubleshooting Guide

## Overview

This guide provides troubleshooting steps for common issues with the NMOS RIEDEL Artist node, particularly focusing on IS-04 registry connection issues and SmartPanel 1200 series configuration.

## Table of Contents

1. [IS-04 Registry Connection Issues](#is-04-registry-connection-issues)
2. [MQTT Connection Problems](#mqtt-connection-problems)
3. [SmartPanel LED Control Issues](#smartpanel-led-control-issues)
4. [Display Text Not Showing](#display-text-not-showing)
5. [Event Parsing Problems](#event-parsing-problems)
6. [Heartbeat and Re-registration](#heartbeat-and-re-registration)

---

## IS-04 Registry Connection Issues

### Symptom: Panel not registering with NMOS registry

**Check List:**

1. **Verify Registry URL**
   ```javascript
   // In nmos-config node, ensure URL is correct:
   // Example: http://192.168.1.100:8080
   ```

2. **Check Registry API Version**
   - Default: `v1.3`
   - Ensure your registry supports the configured version
   - Check registry documentation for supported versions

3. **Verify Network Connectivity**
   ```bash
   # Test registry connectivity
   curl http://your-registry-url:8080/x-nmos/registration/v1.3/health/nodes
   ```

4. **Check Node-RED Debug Log**
   - Look for registration messages in Node-RED debug window
   - Should see: "Starting RIEDEL Artist Registration"
   - Successful: "✓ RIEDEL ARTIST PANEL REGISTERED"
   - Failed: "Registration failed: [error message]"

5. **Verify Resource IDs**
   - Check that UUIDs are properly generated
   - Regenerate IDs if needed using "Regenerate All IDs" button

**Common Errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED` | Registry not reachable | Check registry URL and network |
| `HTTP 400` | Invalid payload format | Verify IS-04 spec compliance (should be automatic) |
| `HTTP 404` on resource | Wrong API version | Check registry API version in config |
| `HTTP 401/403` | Authentication required | Configure auth credentials in nmos-config |

### Registration Sequence

The node follows this IS-04 registration sequence:

1. **Node Resource** → Register first (300ms delay)
2. **Device Resource** → Register second (300ms delay)
3. **Sender Resource** → Register third (300ms delay)
4. **Receiver Resource** → Register last
5. **Heartbeat** → Starts every 5 seconds after successful registration

If any step fails, the entire registration fails. Check logs to see which step failed.

---

## MQTT Connection Problems

### Symptom: No MQTT messages received or sent

**Check List:**

1. **Verify MQTT Broker URL**
   ```javascript
   // Default: mqtt://localhost:1883
   // Format: mqtt://hostname:port
   // For TLS: mqtts://hostname:8883
   ```

2. **Test MQTT Broker**
   ```bash
   # Install mosquitto clients
   sudo apt-get install mosquitto-clients
   
   # Subscribe to test topic
   mosquitto_sub -h localhost -t 'x-nmos/events/1.0/+/+'
   
   # Publish test message
   mosquitto_pub -h localhost -t 'test/topic' -m 'test message'
   ```

3. **Check QoS Level**
   - Default: QoS 1 (at least once)
   - For critical messages: Use QoS 2 (exactly once)
   - For status updates: QoS 0 may be sufficient

4. **Verify MQTT Client ID**
   - Auto-generated: `nmos-riedel-artist-{deviceId}`
   - Check for conflicts if running multiple instances

**Common MQTT Errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `Connection refused` | Broker not running | Start MQTT broker service |
| `Not authorized` | Authentication required | Add username/password to broker URL |
| `Connection timeout` | Network/firewall | Check network connectivity and firewall rules |
| `No messages received` | Wrong subscription topic | Verify topic pattern: `x-nmos/events/1.0/+/+` |

---

## SmartPanel LED Control Issues

### Symptom: LED colors not changing

**Troubleshooting Steps:**

1. **Verify SmartPanel Preset Selected**
   - Edit RIEDEL Artist node
   - Check "SmartPanel Preset" dropdown
   - Select RSP-1216HL or RSP-1232HL as appropriate

2. **Check Key ID Range**
   - RSP-1216HL: Keys 1-16
   - RSP-1232HL: Keys 1-32
   - Invalid key IDs will be logged as warnings

3. **Verify Color Values**
   ```javascript
   // Valid colors only:
   msg.payload = {
       action: "set_led_color",
       keyId: 5,
       color: "red",      // red, green, amber, or off
       brightness: 100    // 0-100
   };
   ```

4. **Check MQTT Connection**
   - LED commands are sent via MQTT
   - Verify MQTT broker is connected (green dot on node)

5. **Test with Color Profiles**
   ```javascript
   // Try using predefined profiles first
   msg.payload = {
       action: "apply_color_profile",
       keyId: 1,
       profile: "active"  // idle, active, warning, off
   };
   ```

**LED Control Event Path:**

The node publishes LED commands as IS-07 grains with path `led/{keyId}/color`.

---

## Display Text Not Showing

### Symptom: OLED displays not showing text

**Troubleshooting Steps:**

1. **Verify Display ID**
   - Both RSP-1216HL and RSP-1232HL have 4 displays
   - Valid display IDs: 1, 2, 3, 4

2. **Check Text Length**
   ```javascript
   // Each display: 2 lines, 16 chars per line
   msg.payload = {
       action: "send_display_text",
       displayId: 1,
       text: "Line1 (16 max)\nLine2 (16 max)"
   };
   ```

3. **Use Line-by-Line Updates**
   ```javascript
   // Update individual lines
   msg.payload = {
       action: "send_display_line",
       displayId: 1,
       lineNumber: 1,
       text: "Camera 1"
   };
   ```

4. **Check Brightness**
   ```javascript
   // Ensure brightness is set
   msg.payload = {
       action: "send_display_text",
       displayId: 1,
       text: "Test",
       brightness: 100  // 0-100, default 100
   };
   ```

5. **Test Display Mapping**
   ```javascript
   // Get preset info to verify display configuration
   msg.payload = { action: "get_smartpanel_preset" };
   // Check returned config for display mappings
   ```

**Display Control Event Path:**

- Full display: `display/{displayId}/text`
- Single line: `display/{displayId}/line/{lineNumber}`

---

## Event Parsing Problems

### Symptom: SmartPanel events not being parsed

**Check Incoming Events:**

1. **Monitor Raw MQTT Messages**
   - Connect debug node to Artist node output
   - Check `msg.payload` for raw grain data
   - Verify `msg.artist.commands` for parsed events

2. **Verify Event Path Format**

   Valid SmartPanel event paths:
   ```
   button/N/press
   button/N/release
   leverkey/N/up
   leverkey/N/down
   rotary/N/left
   rotary/N/right
   rotary/N/push
   ```

3. **Check Command Type Detection**
   ```javascript
   // Output includes parsed command type
   if (msg.artist && msg.artist.commands) {
       for (const cmd of msg.artist.commands) {
           // cmd.type: button, leverkey, rotary, etc.
           console.log(cmd.type, cmd);
       }
   }
   ```

**Example Event Processing:**

```javascript
// Function node to filter SmartPanel events
if (msg.artist && msg.artist.commands) {
    const smartpanelEvents = msg.artist.commands.filter(cmd => 
        ['button', 'leverkey', 'rotary'].includes(cmd.type)
    );
    
    if (smartpanelEvents.length > 0) {
        msg.payload = smartpanelEvents;
        return msg;
    }
}
return null;
```

---

## Heartbeat and Re-registration

### Symptom: Panel keeps disconnecting from registry

**Understanding Heartbeat Mechanism:**

1. **Heartbeat Interval**
   - Sent every 5 seconds after successful registration
   - POST to `/health/nodes/{nodeId}`
   - Expected response: HTTP 200

2. **Auto Re-registration**
   - Triggered on HTTP 404 response
   - Indicates registry has lost node registration
   - Full re-registration sequence runs automatically

3. **Monitor Heartbeat Status**
   ```javascript
   // In Node-RED debug log, look for:
   "♥ Heartbeat OK"                    // Success
   "Registration lost (404), re-registering..."  // Re-registration triggered
   "Heartbeat error: [message]"        // Network/connectivity issue
   ```

**Troubleshooting Heartbeat Issues:**

1. **Check Registry Timeout Settings**
   - Default heartbeat timeout in IS-04: 12 seconds
   - Node sends heartbeat every 5 seconds (within timeout)

2. **Network Stability**
   - Heartbeat errors may indicate network issues
   - Check for intermittent connectivity
   - Monitor network latency to registry

3. **Registry Health**
   ```bash
   # Check registry health endpoint
   curl http://registry-url:8080/x-nmos/registration/v1.3/health/nodes/{nodeId}
   ```

4. **Force Re-registration**
   ```javascript
   // Send manual re-registration command
   msg.payload = { action: "re-register" };
   ```

**Heartbeat Flow:**

```
Every 5 seconds:
  ├─> POST /health/nodes/{nodeId}
  ├─> HTTP 200 → Continue
  ├─> HTTP 404 → Auto re-register
  └─> Error → Log warning, retry next interval
```

---

## Debugging Tips

### Enable Detailed Logging

1. **Node-RED Debug Window**
   - All registration and MQTT events are logged
   - Look for `✓` (success) or `✗` (error) indicators

2. **MQTT Traffic Monitoring**
   ```bash
   # Monitor all NMOS events
   mosquitto_sub -h localhost -t 'x-nmos/events/1.0/#' -v
   ```

3. **Check Network Inspector**
   - Use browser dev tools (F12) if using Node-RED dashboard
   - Check Network tab for HTTP requests to registry

### Common Configuration Checklist

```javascript
// RIEDEL Artist Node Configuration
{
    // Required
    registry: "nmos-config-node-id",
    mqttBroker: "mqtt://localhost:1883",
    
    // SmartPanel
    panelType: "smartpanel",
    smartpanelPreset: "RSP-1216HL",  // or RSP-1232HL
    
    // Features
    enableKeyControl: true,
    enableAudioRouting: true,
    
    // MQTT
    mqttQos: 1,  // 0, 1, or 2
    
    // Generated (don't modify unless regenerating)
    nodeId: "uuid",
    deviceId: "uuid",
    senderId: "uuid",
    receiverId: "uuid",
    matrixSourceId: "uuid"
}
```

---

## Getting Help

If issues persist after following this guide:

1. **Collect Information**
   - Node-RED version
   - Package version (`node-red-contrib-nmos-client`)
   - Registry software and version
   - MQTT broker software and version
   - SmartPanel model (if applicable)
   - Node-RED debug log output
   - Network configuration

2. **Check Example Flows**
   - Import and test example flows from `examples/` directory
   - Verify examples work before customizing

3. **Report Issues**
   - Open issue at: https://github.com/DHPKE/node-red-contrib-nmos-client/issues
   - Include collected information and debug logs
   - Describe expected vs actual behavior

---

## References

- **NMOS IS-04 Specification:** https://specs.amwa.tv/is-04/
- **NMOS IS-07 Specification:** https://specs.amwa.tv/is-07/
- **RIEDEL Artist:** https://www.riedel.net/products/intercom-and-radio/
- **RIEDEL 1200 Series SmartPanels:** https://www.riedel.net/en/products-solutions/intercom/smartpanels/1200-series
- **Node-RED Documentation:** https://nodered.org/docs/
- **MQTT Documentation:** https://mqtt.org/

---

Last updated: 2025-11-20
