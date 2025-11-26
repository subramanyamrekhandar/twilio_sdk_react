import { useState, useRef, useEffect } from "react";
import { Device } from "@twilio/voice-sdk";

export default function VoiceClient() {
  const [backendUrl, setBackendUrl] = useState("https://namunahai.surextechnologies.com");
  const [identity, setIdentity] = useState("agent_web_01");
  const [dialTo, setDialTo] = useState("");
  const [status, setStatus] = useState("Device not initialized");
  const [statusType, setStatusType] = useState("info");
  const [device, setDevice] = useState(null);
  const [activeConnection, setActiveConnection] = useState(null);
  const logRef = useRef(null);

  function log(message, type = "info") {
    const timestamp = new Date().toISOString();
    const prefix =
      type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";
    if (logRef.current) {
      logRef.current.value = `${timestamp} ${prefix} ${message}\n${logRef.current.value}`;
    }
    console.log(`[VoiceClient] ${message}`);
  }

  function setStatusText(message, type = "info") {
    setStatus(message);
    setStatusType(type);
    log(message, type);
  }

  async function getToken() {
    const endpoint = `${backendUrl.replace(/\/$/, "")}/api/v1/telephony/access-token`;
    log(`Requesting token from ${endpoint}`);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity }),
    });
    if (!res.ok) throw new Error(`Token request failed: ${await res.text()}`);
    const data = await res.json();
    log(`Token received. Identity: ${data.identity}`, "success");
    return data.token;
  }

  // 🔧 FIX: Properly configure audio output devices
  function setupAudioOutput(deviceInstance, connection = null) {
    try {
      const audio = deviceInstance.audio;
      
      // Get available output devices
      const outputDevices = audio.availableOutputDevices;
      log(`Available output devices: ${outputDevices.size}`);
      
      // Try to set default speaker
      const defaultSpeaker = outputDevices.get("default");
      if (defaultSpeaker) {
        audio.speakerDevices.set(defaultSpeaker.deviceId);
        log(`🔊 Speaker set to: ${defaultSpeaker.deviceId}`, "success");
      } else {
        // Fallback: get first available device
        const devices = Array.from(outputDevices.values());
        if (devices.length > 0) {
          audio.speakerDevices.set(devices[0].deviceId);
          log(`🔊 Speaker set to first available: ${devices[0].deviceId}`, "success");
        } else {
          log("⚠️ No output devices available", "error");
        }
      }

      // 🔧 FIX: Ensure connection is not muted (with safety check)
      if (connection && typeof connection.mute === "function") {
        try {
          connection.mute(false);
          log("🔊 Connection unmuted", "success");
        } catch (muteErr) {
          log(`⚠️ Could not unmute in setupAudioOutput: ${muteErr.message}`, "error");
        }
      }

      // 🔧 FIX: Log audio state
      log(`Audio input devices: ${audio.availableInputDevices.size}`);
      log(`Audio output devices: ${audio.availableOutputDevices.size}`);
      log(`Is input device set: ${audio.inputDevice !== null}`);
      
      // Check if speaker devices are set (speakerDevices is a Set)
      const speakerDevicesSet = audio.speakerDevices;
      const isOutputSet = speakerDevicesSet && speakerDevicesSet.size > 0;
      log(`Is output device set: ${isOutputSet} (${speakerDevicesSet ? speakerDevicesSet.size : 0} devices)`);
      
      // Log which devices are actually set
      if (speakerDevicesSet && speakerDevicesSet.size > 0) {
        const deviceIds = Array.from(speakerDevicesSet);
        log(`Speaker device IDs: ${deviceIds.join(", ")}`);
      }
      
    } catch (err) {
      log(`Error setting up audio: ${err.message}`, "error");
    }
  }

  const initDevice = async () => {
    try {
      setStatusText("Requesting token...", "info");
      
      // 🔧 FIX: Request both audio input AND ensure audio context is active
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        log("✅ Microphone access granted", "success");
        // Stop the stream immediately - we just needed permission
        stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        log(`⚠️ Microphone permission denied: ${err.message}`, "error");
        throw new Error("Microphone access required");
      }

      const token = await getToken();

      const twilioDevice = new Device(token, {
        codecPreferences: ["opus", "pcmu"],
        fakeLocalDTMF: true,
        enableRingingState: true,
        enableIceRestart: true,
        // 🔧 FIX: Enable audio output explicitly
        allowIncomingWhileBusy: false,
      });

      // 🔧 FIX: Setup audio when device is ready
      twilioDevice.audio.on("ready", () => {
        log("Audio subsystem ready");
        setupAudioOutput(twilioDevice);
      });

      twilioDevice.audio.on("deviceChange", () => {
        log("Audio devices changed");
        setupAudioOutput(twilioDevice);
      });

      twilioDevice.on("registered", () => {
        setStatusText("Device registered & ready", "success");
        setDevice(twilioDevice);
        setupAudioOutput(twilioDevice);
      });

      twilioDevice.on("error", (err) => {
        setStatusText(`Device error: ${err.message}`, "error");
        log(`Device error details: ${JSON.stringify(err)}`, "error");
      });

      twilioDevice.on("ready", () => {
        setStatusText("Device ready", "success");
        setupAudioOutput(twilioDevice);
      });

      twilioDevice.on("incoming", (conn) => {
        log("📞 Incoming call - accepting...");
        conn.accept();
        setActiveConnection(conn);
        setupConnectionAudio(conn, twilioDevice);
      });

      twilioDevice.on("connect", (conn) => {
        setStatusText("Call connected", "success");
        setActiveConnection(conn);
        setupConnectionAudio(conn, twilioDevice);
      });

      twilioDevice.on("disconnect", () => {
        setStatusText("Call disconnected", "info");
        setActiveConnection(null);
      });

      setStatusText("Device initializing...", "info");
      await twilioDevice.register();

    } catch (err) {
      setStatusText(`Init failed: ${err.message}`, "error");
      log(`Init error: ${err.stack}`, "error");
    }
  };

  // 🔧 FIX: Dedicated function to setup connection audio
  function setupConnectionAudio(connection, deviceInstance) {
    try {
      // 🔧 FIX: Verify connection is valid and has required methods
      if (!connection) {
        log("⚠️ Connection is null, cannot setup audio", "error");
        return;
      }

      // Check if connection has mute method (might not be ready yet)
      if (typeof connection.mute !== "function") {
        log("⚠️ Connection not ready yet, will retry...", "info");
        // Retry after a short delay
        setTimeout(() => setupConnectionAudio(connection, deviceInstance), 200);
        return;
      }

      // Ensure unmuted
      try {
        connection.mute(false);
        log("🔊 Connection unmuted", "success");
      } catch (muteErr) {
        log(`⚠️ Could not unmute connection: ${muteErr.message}`, "error");
      }

      // Setup audio output
      setupAudioOutput(deviceInstance, connection);

      // 🔧 FIX: Monitor volume levels to verify audio is flowing
      if (typeof connection.on === "function") {
        connection.on("volume", (inputVolume, outputVolume) => {
          // Log only if there's significant volume (to avoid spam)
          if (inputVolume > 0.01 || outputVolume > 0.01) {
            log(`📊 Audio levels - Input: ${inputVolume.toFixed(2)}, Output: ${outputVolume.toFixed(2)}`);
          }
        });

        // 🔧 FIX: Monitor mute state changes
        connection.on("mute", (isMuted) => {
          log(`🔇 Mute state changed: ${isMuted ? "MUTED" : "UNMUTED"}`);
          if (isMuted) {
            log("⚠️ WARNING: Connection is muted! Audio will not play.", "error");
          }
        });
      }

      // 🔧 FIX: Log connection status (with safety check)
      try {
        const status = connection.status ? connection.status() : "unknown";
        const isMuted = connection.isMuted ? connection.isMuted() : "unknown";
        log(`Connection status: ${status}`);
        log(`Connection muted: ${isMuted}`);
      } catch (statusErr) {
        log(`⚠️ Could not get connection status: ${statusErr.message}`, "error");
      }
      
      // 🔧 FIX: Force unmute after a short delay (in case of race condition)
      setTimeout(() => {
        try {
          if (connection && connection.status && connection.status() === "open") {
            if (typeof connection.mute === "function") {
              connection.mute(false);
              log("🔊 Force unmuted connection (delayed)", "success");
            }
          }
        } catch (err) {
          log(`⚠️ Delayed unmute failed: ${err.message}`, "error");
        }
      }, 500);

    } catch (err) {
      log(`Error setting up connection audio: ${err.message}`, "error");
      log(`Error stack: ${err.stack}`, "error");
    }
  }

  const placeCall = () => {
    if (!device) return log("Device not initialized", "error");
    if (!dialTo) return log("Enter number / agent ID", "error");

    setStatusText(`Calling ${dialTo}...`);
    try {
      const conn = device.connect({ params: { To: dialTo, From: identity } });
      setActiveConnection(conn);
      
      // 🔧 FIX: Don't setup audio here - wait for 'connect' event
      // The 'connect' event handler will call setupConnectionAudio
      log("Call initiated, waiting for connection...");
    } catch (err) {
      log(`Error placing call: ${err.message}`, "error");
      setStatusText(`Call failed: ${err.message}`, "error");
    }
  };

  const hangupCall = () => {
    if (!activeConnection) return log("No active call");
    activeConnection.disconnect();
    setActiveConnection(null);
  };

  // 🔧 FIX: Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeConnection) {
        activeConnection.disconnect();
      }
      if (device) {
        device.destroy();
      }
    };
  }, [device, activeConnection]);

  return (
    <div className="max-w-xl mx-auto bg-white p-8 mt-10 rounded-xl shadow-lg space-y-6">
      <h1 className="text-2xl font-bold">🎤 Namunah AI Voice Client</h1>
      
      <div className="bg-yellow-100 border-l-4 border-yellow-500 p-4 text-sm rounded">
        <p className="font-semibold">Steps:</p>
        <p>1. Initialize device</p>
        <p>2. Enter phone / agent ID</p>
        <p>3. Call & Speak</p>
        <p className="mt-2 font-semibold text-red-600">⚠️ Make sure your browser volume is up and speakers are enabled!</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Backend URL:</label>
        <input
          className="w-full p-3 border mt-1 rounded"
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
          placeholder="https://your-backend.com"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Identity:</label>
        <input
          className="w-full p-3 border mt-1 rounded"
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          placeholder="agent_web_01"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Dial To (Phone Number or Agent ID):</label>
        <input
          className="w-full p-3 border mt-1 rounded"
          value={dialTo}
          onChange={(e) => setDialTo(e.target.value)}
          placeholder="+1234567890 or agent-uuid"
        />
      </div>

      <div
        className={`p-3 rounded font-semibold ${
          statusType === "error"
            ? "bg-red-100 text-red-700"
            : statusType === "success"
            ? "bg-green-100 text-green-700"
            : "bg-blue-100 text-blue-700"
        }`}
      >
        {status}
      </div>

      <div className="flex gap-3">
        <button className="bg-green-600 text-white px-4 py-2 rounded" onClick={initDevice}>
          Initialize
        </button>
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-40"
          onClick={placeCall}
          disabled={!device || activeConnection}
        >
          Call
        </button>
        <button
          className="bg-red-600 text-white px-4 py-2 rounded disabled:opacity-40"
          onClick={hangupCall}
          disabled={!activeConnection}
        >
          Hang Up
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Debug Logs:</label>
        <textarea
          ref={logRef}
          readOnly
          className="w-full h-60 border p-2 rounded font-mono text-xs"
          placeholder="Logs will appear here..."
        />
      </div>
    </div>
  );
}

