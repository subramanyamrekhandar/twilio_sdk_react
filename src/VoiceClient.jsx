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
  const [volumeLevel, setVolumeLevel] = useState(0); // 0..1
  const [callId, setCallId] = useState(null);

  // transcript items: { role: "user" | "agent", text: string, ts: string }
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

  function addTranscript(role, text) {
    if (!text) return;
    setTranscripts((prev) => [
      ...prev,
      { role, text, ts: new Date().toLocaleTimeString() },
    ]);
  }

  async function getToken() {
    const endpoint = `${backendUrl.replace(/\/$/, "")}/api/v1/telephony/access-token`;
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

  const initDevice = async () => {
    try {
      setStatusText("Requesting token...", "info");

      // mic permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const token = await getToken();

      const twilioDevice = new Device(token, {
        codecPreferences: ["opus", "pcmu"],
        fakeLocalDTMF: true,
        enableRingingState: true,
      });

      twilioDevice.on("registered", () => {
        setStatusText("Device registered & ready", "success");
        setDevice(twilioDevice);
      });

      twilioDevice.on("ready", () => {
        setStatusText("Device ready", "success");
      });

      twilioDevice.on("error", (err) => {
        setStatusText(`Device error: ${err.message}`, "error");
      });

      twilioDevice.on("incoming", (conn) => {
        log("Incoming call received - accepting automatically");
        conn.accept();
        handleConnection(conn);
      });

      twilioDevice.on("connect", (conn) => {
        handleConnection(conn);
      });

      twilioDevice.on("disconnect", () => {
        setStatusText("Call disconnected", "info");
        setActiveConnection(null);
        setMuted(false);
        setInCall(false);
        setVolumeLevel(0);
      });

      setStatusText("Device initializing...", "info");
      await twilioDevice.register();
    } catch (err) {
      setStatusText(`Init failed: ${err.message}`, "error");
    }
  };

  // Handle connection (shared for outgoing + incoming)
  const handleConnection = (conn) => {
    setStatusText("Call connected", "success");
    setActiveConnection(conn);
    setInCall(true);
    setMuted(false);
    setVolumeLevel(0);
    setTranscripts([]);

    // Try to get CallSid (for debugging)
    try {
      const params = conn.parameters || conn._parameters || {};
      if (params.CallSid) {
        setCallId(params.CallSid);
        log(`Call connected. CallSid=${params.CallSid}`, "success");
      }
    } catch {
      // ignore
    }

    const audioEl = document.getElementById("twilio-audio");

    // Attach remote tracks to audio element
    conn.on("trackAdded", () => {
      try {
        const stream = new MediaStream();
        conn.getRemoteTracks().forEach((track) => stream.addTrack(track));
        if (audioEl) {
          audioEl.srcObject = stream;
          audioEl
            .play()
            .catch((err) => log(`Audio play blocked: ${err}`, "error"));
        }
      } catch (e) {
        log(`trackAdded error: ${e}`, "error");
      }
    });

    // Use Twilio volume event to animate waveform (outputVolume: 0..1)
    conn.on("volume", (inputVolume, outputVolume) => {
      // clamp
      const v = Math.max(0, Math.min(1, outputVolume || 0));
      setVolumeLevel(v);
    });

    // OPTIONAL: if later you have transcript events from backend to frontend,
    // you can call addTranscript("user", text) or addTranscript("agent", text) here.
  };

  const placeCall = () => {
    if (!device) return log("Device not initialized", "error");
    if (!dialTo) return log("Enter number / agent ID", "error");

    setStatusText(`Calling ${dialTo}...`);
    const conn = device.connect({ params: { To: dialTo, From: identity } });
    // connect event handler will run handleConnection
  };

  const hangupCall = () => {
    if (!activeConnection) return log("No active call");
    activeConnection.disconnect();
  };

  const toggleMute = () => {
    if (!activeConnection) return;
    const newMuted = !muted;
    activeConnection.mute(newMuted);
    setMuted(newMuted);
    setStatusText(newMuted ? "Muted" : "Unmuted", "info");
  };

  const statusClass =
    statusType === "error"
      ? "bg-red-100 text-red-700"
      : statusType === "success"
      ? "bg-green-100 text-green-700"
      : "bg-blue-100 text-blue-700";

  // Simple 5-bar waveform based on volumeLevel (0..1)
  const bars = [0.3, 0.6, 1.0, 0.6, 0.3];

  return (
    <div className="max-w-5xl mx-auto mt-10 p-6 md:p-8 bg-white shadow-2xl rounded-2xl">
      <h1 className="text-3xl font-bold text-center text-indigo-600 mb-4">
        🎤 Namunah AI Voice Agent
      </h1>

      {/* Hidden audio element that actually plays Twilio media */}
      <audio id="twilio-audio" autoPlay />

      <div className="grid md:grid-cols-2 gap-8 mt-6">
        {/* LEFT SIDE: Controls + Call Panel */}
        <div className="space-y-4">
          <div className={`p-3 rounded-lg font-semibold ${statusClass}`}>
            {status}
            {callId && (
              <span className="block text-xs font-normal text-gray-700 mt-1">
                Call ID: {callId}
              </span>
            )}
          </div>

          {!inCall && (
            <>
              <div>
                <label className="font-semibold text-sm text-gray-700">
                  Identity
                </label>
                <input
                  className="w-full p-3 border border-gray-300 rounded mt-1 text-sm bg-gray-50"
                  value={identity}
                  readOnly
                />
              </div>

              <div>
                <label className="font-semibold text-sm text-gray-700">
                  Dial To (Agent ID or Phone)
                </label>
                <input
                  className="w-full p-3 border border-gray-300 rounded mt-1 text-sm"
                  placeholder="e.g. agent_123 or +15551234567"
                  value={dialTo}
                  onChange={(e) => setDialTo(e.target.value)}
                />
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-semibold"
                  onClick={initDevice}
                >
                  Initialize
                </button>

                <button
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm font-semibold disabled:opacity-40"
                  onClick={placeCall}
                  disabled={!device}
                >
                  Call
                </button>
              </div>
            </>
          )}

          {inCall && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 flex flex-col items-center space-y-4">
              {/* Circle avatar + waveform */}
              <div className="relative">
                <div className="w-24 h-24 rounded-full bg-indigo-100 flex items-center justify-center text-3xl">
                  🤖
                </div>
                {/* Pulsing ring */}
                <div className="absolute inset-0 rounded-full border border-indigo-300 animate-ping"></div>
              </div>

              <p className="text-base font-semibold text-gray-800">
                Talking to: <span className="text-indigo-600">{dialTo}</span>
              </p>
              <p className="text-xs text-gray-500">
                Say something like:{" "}
                <span className="italic">
                  &quot;Hi, I need help with my account&quot;
                </span>
              </p>

              {/* Waveform */}
              <div className="flex items-end gap-1 h-10 mt-2">
                {bars.map((base, idx) => {
                  const height = 8 + 40 * base * (0.2 + volumeLevel * 0.8); // px
                  return (
                    <div
                      key={idx}
                      className="w-2 rounded-full bg-indigo-500 transition-all duration-100"
                      style={{ height }}
                    />
                  );
                })}
              </div>

              {/* Call controls */}
              <div className="flex gap-4 justify-center mt-4">
                <button
                  onClick={toggleMute}
                  className={`px-4 py-2 rounded-full text-sm font-semibold shadow ${
                    muted
                      ? "bg-yellow-500 hover:bg-yellow-600 text-white"
                      : "bg-gray-200 hover:bg-gray-300 text-gray-800"
                  }`}
                >
                  {muted ? "Unmute" : "Mute"}
                </button>

                <button
                  onClick={hangupCall}
                  className="px-4 py-2 rounded-full text-sm font-semibold bg-red-600 hover:bg-red-700 text-white shadow"
                >
                  End Call
                </button>
              </div>
            </div>
          )}

          {/* Logs */}
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Logs</h3>
            <textarea
              ref={logRef}
              readOnly
              className="w-full h-40 border border-gray-300 p-2 rounded font-mono text-xs bg-gray-50"
            />
          </div>
        </div>

        {/* RIGHT SIDE: Transcript Panel */}
        <div className="flex flex-col h-full">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            🗣 Live Conversation Transcript
          </h2>
          <div className="flex-1 border border-gray-200 rounded-2xl bg-gray-50 p-3 overflow-y-auto max-h-[380px]">
            {transcripts.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                Transcript will appear here once you wire STT/LLM events to the
                frontend. For now, backend logs already show STT/LLM activity.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {transcripts.map((t, idx) => (
                  <li
                    key={idx}
                    className={`flex ${
                      t.role === "user" ? "justify-start" : "justify-end"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-xl shadow-sm ${
                        t.role === "user"
                          ? "bg-white text-gray-800"
                          : "bg-indigo-600 text-white"
                      }`}
                    >
                      <div className="text-[10px] opacity-60 mb-0.5">
                        {t.role === "user" ? "You" : "Agent"} · {t.ts}
                      </div>
                      <div>{t.text}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-2 text-[11px] text-gray-500">
            ℹ️ To feed real transcripts here, you can expose a WebSocket/SSE
            from your backend that emits STT &amp; LLM messages, and call{" "}
            <code className="bg-gray-200 px-1 rounded">addTranscript(role, text)</code>{" "}
            when events arrive.
          </p>
        </div>
      </div>
    </div>
  );
}
