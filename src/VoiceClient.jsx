import { useState, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

export default function VoiceClient() {
  const [backendUrl, setBackendUrl] = useState("https://namunahai.surextechnologies.com");
  const [identity, setIdentity] = useState("");
  const [dialTo, setDialTo] = useState("");
  const [status, setStatus] = useState("Device not initialized");
  const [statusType, setStatusType] = useState("info");
  const [device, setDevice] = useState(null);
  const [activeConnection, setActiveConnection] = useState(null);

  const logRef = useRef(null);

  function log(message, type = "info") {
    const timestamp = new Date().toISOString();
    const prefix = type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";
    logRef.current.value = `${timestamp} ${prefix} ${message}\n${logRef.current.value}`;
  }

  function setStatusText(message, type = "info") {
    setStatus(message);
    setStatusType(type);
    log(message, type);
  }

  async function getToken() {
    const endpoint = `${backendUrl.replace(/\/$/, "")}/api/v1/telephony/access-token`;

    log(`Requesting token from ${endpoint}`);

    const body = identity ? JSON.stringify({ identity }) : "{}";

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
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

      const token = await getToken();

      // const twilioDevice = new Device(token, {
      //   codecPreferences: ["opus", "pcmu"],
      //   fakeLocalDTMF: true,
      //   enableRingingState: true,
      // });

      // twilioDevice.on("ready", () => {
      //   setStatusText(`Device ready`, "success");
      //   setDevice(twilioDevice);
      // });
      const twilioDevice = new Device(token, {
        codecPreferences: ["opus", "pcmu"],
        fakeLocalDTMF: true,
        enableRingingState: true,
      });
      
      // store device immediately
      setDevice(twilioDevice);
      twilioDevice.on("ready", () => {
        setStatusText(`Device ready`, "success");
      });


      twilioDevice.on("error", (err) => {
        setStatusText(`Device error: ${err.message}`, "error");
      });

      twilioDevice.on("incoming", (conn) => {
        log("Incoming call received - accepting automatically");
        conn.accept();
        setActiveConnection(conn);
      });

      twilioDevice.on("connect", (conn) => {
        setStatusText("Call connected", "success");
        setActiveConnection(conn);
      });

      twilioDevice.on("disconnect", () => {
        setStatusText("Call disconnected", "info");
        setActiveConnection(null);
      });

      setStatusText("Device initializing...", "info");
    } catch (err) {
      setStatusText(`Init failed: ${err.message}`, "error");
    }
  };

  const placeCall = () => {
    if (!device) return log("Device not initialized", "error");
    if (!dialTo) return log("Enter number/agent ID", "error");

    setStatusText(`Calling ${dialTo}...`);
    const conn = device.connect({ params: { To: dialTo } });
    setActiveConnection(conn);
  };

  const hangupCall = () => {
    if (!activeConnection) return log("No active call");
    activeConnection.disconnect();
    setActiveConnection(null);
  };

  return (
    <div className="max-w-xl mx-auto bg-white p-8 mt-10 rounded-xl shadow-lg space-y-6">
      <h1 className="text-2xl font-bold">🎤 Voice Agent WebRTC (React + Tailwind + Twilio)</h1>

      <div className="bg-yellow-100 border-l-4 border-yellow-500 p-4 text-sm rounded">
        <p className="font-semibold">Steps:</p>
        <p>1. Enter backend URL</p>
        <p>2. Initialize device</p>
        <p>3. Enter number/agent ID</p>
        <p>4. Place call</p>
      </div>

      <div>
        <label className="font-semibold">Backend URL</label>
        <input
          className="w-full p-3 border border-gray-300 rounded mt-1"
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
        />
      </div>

      <div>
        <label className="font-semibold">Identity (optional)</label>
        <input
          className="w-full p-3 border border-gray-300 rounded mt-1"
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
        />
      </div>

      <div>
        <label className="font-semibold">Dial To (Phone / Agent ID)</label>
        <input
          className="w-full p-3 border border-gray-300 rounded mt-1"
          value={dialTo}
          onChange={(e) => setDialTo(e.target.value)}
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
        <button
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
          onClick={initDevice}
        >
          Initialize
        </button>

        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-40"
          onClick={placeCall}
          disabled={!device || activeConnection}
        >
          Call
        </button>

        <button
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded disabled:opacity-40"
          onClick={hangupCall}
          disabled={!activeConnection}
        >
          Hang Up
        </button>
      </div>

      <div>
        <h3 className="text-lg font-semibold">📋 Logs</h3>
        <textarea
          ref={logRef}
          readOnly
          className="w-full h-40 border border-gray-300 p-2 rounded font-mono text-sm"
        />
      </div>
    </div>
  );
}
