import { useState, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

export default function VoiceClient() {
  const [backendUrl] = useState("https://namunahai.surextechnologies.com");
  const [identity, setIdentity] = useState("agent_web_01");
  const [dialTo, setDialTo] = useState("");
  const [status, setStatus] = useState("Device not initialized");
  const [statusType, setStatusType] = useState("info");
  const [device, setDevice] = useState(null);
  const [activeConnection, setActiveConnection] = useState(null);

  const micStreamRef = useRef(null);       // Mic stream (persistent)
  const audioContextRef = useRef(null);    // Audio context to keep stream alive
  const logRef = useRef(null);

  function log(msg, type="info") {
    const timestamp = new Date().toISOString();
    const prefix = type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";
    logRef.current.value = `${timestamp} ${prefix} ${msg}\n${logRef.current.value}`;
    console.log("[VoiceClient]", msg);
  }

  async function getToken() {
    const r = await fetch(`${backendUrl}/api/v1/telephony/access-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity }),
    });
    const data = await r.json();
    return data.token;
  }

  const initDevice = async () => {
    try {
      setStatus("Requesting microphone...", "info");

      // 1️⃣ Get and lock microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      log("🎤 Microphone granted", "success");

      // 2️⃣ Prevent browser from stopping mic stream
      audioContextRef.current = new AudioContext();
      const src = audioContextRef.current.createMediaStreamSource(stream);
      const dst = audioContextRef.current.createGain();
      src.connect(dst);
      dst.connect(audioContextRef.current.destination);
      log("🔄 Microphone stream pinned alive", "success");

      // 3️⃣ Get Twilio token & create device
      const token = await getToken();
      const twilioDevice = new Device(token, {
        codecPreferences: ["opus", "pcmu"],
        enableRingingState: true,
      });

      // 4️⃣ Wait until audio devices ready, then bind output speaker
      twilioDevice.audio.on("ready", () => {
        const outputs = twilioDevice.audio.availableOutputDevices;
        const defaultOut = outputs.get("default");

        if (defaultOut) {
          twilioDevice.audio.speakerDevices.set(defaultOut.deviceId);
          log("🔊 Speaker set to default", "success");
        } else {
          log("⚠️ No speaker found", "error");
        }
      });

      twilioDevice.on("registered", () => {
        log("📡 Twilio registered", "success");
        setDevice(twilioDevice);
        setStatus("Device ready", "success");
      });

      twilioDevice.on("connect", conn => {
        log("📞 Call connected", "success");
        setActiveConnection(conn);

        // Unmute just in case
        conn.mute(false);

        conn.on("volume", (inV, outV) => {
          console.log("VOLUME", { inV, outV });
        });
      });

      twilioDevice.on("disconnect", () => {
        log("📴 Call disconnected");
        setActiveConnection(null);
      });

      await twilioDevice.register();

    } catch (e) {
      setStatus(`Init failed: ${e.message}`, "error");
      log(`Init failed: ${e.message}`, "error");
    }
  };

  const placeCall = () => {
    if (!device) return log("Device not initialized", "error");
    if (!dialTo) return log("Enter number", "error");

    const conn = device.connect({ params: { To: dialTo, From: identity } });
    setActiveConnection(conn);
  };

  const hangupCall = () => {
    if (!activeConnection) return;
    activeConnection.disconnect();
    setActiveConnection(null);
  };

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-xl font-bold">🎤 Namunah Voice Client</h1>

      <button className="bg-green-600 text-white px-4 py-2 rounded mt-3"
              onClick={initDevice}>
        Initialize
      </button>

      <input className="w-full p-3 border rounded mt-3"
             placeholder="Dial to..."
             value={dialTo}
             onChange={e => setDialTo(e.target.value)} />

      <div className="flex gap-3 mt-3">
        <button className="bg-blue-600 text-white px-4 py-2 rounded"
                onClick={placeCall}>
          Call
        </button>
        <button className="bg-red-600 text-white px-4 py-2 rounded"
                onClick={hangupCall}>
          Hang Up
        </button>
      </div>

      <textarea ref={logRef} className="w-full h-60 border p-2 mt-4 font-mono text-xs" />
    </div>
  );
}
