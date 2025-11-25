import { useState, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

export default function VoiceClient() {
  const [backendUrl] = useState("https://namunahai.surextechnologies.com");
  const [identity] = useState("agent_web_01");
  const [dialTo, setDialTo] = useState("");
  const [status, setStatus] = useState("Device not initialized");
  const [statusType, setStatusType] = useState("info");
  const [device, setDevice] = useState(null);
  const [activeConnection, setActiveConnection] = useState(null);
  const [muted, setMuted] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [callId, setCallId] = useState(null);

  const [transcripts, setTranscripts] = useState([]);
  const logRef = useRef(null);

  function log(message, type = "info") {
    const timestamp = new Date().toISOString();
    const prefix =
      type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";
    if (logRef.current) {
      logRef.current.value = `${timestamp} ${prefix} ${message}\n${logRef.current.value}`;
    }
  }

  function setStatusText(message, type = "info") {
    setStatus(message);
    setStatusType(type);
    log(message, type);
  }

  async function getToken() {
    const endpoint = `${backendUrl}/api/v1/telephony/access-token`;
    log(`Requesting token from ${endpoint}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity }),
    });

    if (!res.ok) {
      throw new Error(`Token request failed: ${await res.text()}`);
    }

    const data = await res.json();
    log(`Token received. Identity: ${data.identity}`, "success");
    return data.token;
  }

  /** Initialize Twilio Device **/
  const initDevice = async () => {
    try {
      setStatusText("Requesting token...");

      await navigator.mediaDevices.getUserMedia({ audio: true });

      const token = await getToken();

      const twilioDevice = new Device(token, {
        codecPreferences: ["opus", "pcmu"],
        enableRingingState: true,
      });

      twilioDevice.on("registered", () => {
        setStatusText("Device registered & ready", "success");
        setDevice(twilioDevice);
      });

      twilioDevice.on("incoming", (conn) => {
        log("Incoming call — auto accepted");
        conn.accept();
        handleConnection(conn);
      });

      twilioDevice.on("connect", handleConnection);

      twilioDevice.on("error", (err) =>
        setStatusText(`Device error: ${err.message}`, "error")
      );

      twilioDevice.on("disconnect", () => {
        setStatusText("Call ended");
        setActiveConnection(null);
        setInCall(false);
        setMuted(false);
        setVolumeLevel(0);
      });

      await twilioDevice.register();
    } catch (err) {
      setStatusText(`Init failed: ${err.message}`, "error");
    }
  };

  /** Handle active call **/
  const handleConnection = (conn) => {
    log("Call connected", "success");
    setActiveConnection(conn);
    setInCall(true);

    const params = conn.parameters || conn._parameters || {};
    if (params.CallSid) {
      log(`CallSid: ${params.CallSid}`, "success");
      setCallId(params.CallSid);
    }

    const audioEl = document.getElementById("twilio-audio");

    /** FIX: PLAY REMOTE AUDIO using sample event */
    conn.on("sample", (sample) => {
      if (audioEl) {
        audioEl.srcObject = sample.stream;
        audioEl
          .play()
          .catch((err) => log(`Audio play blocked: ${err}`, "error"));
      }
    });

    /** Waveform */
    conn.on("volume", (inputVolume, outputVolume) => {
      const v = Math.min(1, Math.max(0, outputVolume || 0));
      setVolumeLevel(v);
    });
  };

  const placeCall = () => {
    if (!device) return log("Device not initialized");
    if (!dialTo) return log("Enter number first");

    setStatusText(`Calling ${dialTo}...`);
    device.connect({ params: { To: dialTo, From: identity } });
  };

  const hangupCall = () => {
    if (!activeConnection) return;
    activeConnection.disconnect();
  };

  const toggleMute = () => {
    if (!activeConnection) return;
    const val = !muted;
    activeConnection.mute(val);
    setMuted(val);
    setStatusText(val ? "Muted" : "Unmuted");
  };

  const bars = [0.3, 0.6, 1, 0.6, 0.3];

  return (
    <div className="max-w-5xl mx-auto mt-10 p-6 bg-white rounded-2xl shadow-xl">
      <h1 className="text-3xl font-bold text-center text-indigo-600 mb-3">
        🎤 Namunah AI Voice Agent
      </h1>

      <audio id="twilio-audio" autoPlay playsInline />

      <div className={`p-3 rounded-xl font-semibold ${
          statusType === "error"
            ? "bg-red-100 text-red-700"
            : statusType === "success"
            ? "bg-green-100 text-green-700"
            : "bg-blue-100 text-blue-700"
        }`}>
        {status}
        {callId && <p className="text-xs mt-1">Call ID: {callId}</p>}
      </div>

      {!inCall && (
        <>
          <input
            value={dialTo}
            onChange={(e) => setDialTo(e.target.value)}
            placeholder="Enter Phone / Agent ID"
            className="mt-4 w-full p-3 border rounded"
          />

          <div className="flex gap-3 mt-4">
            <button onClick={initDevice}
              className="flex-1 bg-gray-800 text-white py-2 rounded">
              Initialize
            </button>
            <button onClick={placeCall}
              disabled={!device}
              className="flex-1 bg-indigo-600 text-white py-2 rounded">
              Call
            </button>
          </div>
        </>
      )}

      {inCall && (
        <div className="mt-6 bg-gray-100 p-6 rounded-2xl flex flex-col items-center">
          <div className="w-24 h-24 bg-indigo-200 rounded-full flex items-center
              justify-center text-3xl relative">
            🤖
            <div className="absolute inset-0 rounded-full border border-indigo-300 animate-ping"></div>
          </div>

          <div className="flex gap-1 mt-4 h-10 items-end">
            {bars.map((b, i) => (
              <div key={i}
                className="w-2 bg-indigo-500 rounded-full transition-all"
                style={{ height: 8 + 40 * b * (0.2 + volumeLevel * 0.8) }}
              />
            ))}
          </div>

          <div className="mt-4 flex gap-4">
            <button
              onClick={toggleMute}
              className="px-4 py-2 rounded-full bg-yellow-500 text-white font-semibold">
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={hangupCall}
              className="px-4 py-2 rounded-full bg-red-600 text-white font-semibold">
              End Call
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={logRef}
        readOnly
        className="w-full h-40 mt-6 border p-2 bg-gray-50 rounded text-xs font-mono"
      />
    </div>
  );
}
