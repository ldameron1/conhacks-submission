/**
 * Narration Module — ElevenLabs TTS for driving instructor voice
 * 
 * Generates and plays spoken guidance for hazards during route practice.
 * Uses a queue system to avoid overlapping narrations.
 */

/* ═══════════════ CONFIG ═══════════════ */
const ELEVENLABS_API = "https://api.elevenlabs.io/v1/text-to-speech";
// Rachel voice — calm, clear, instructor-like
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const MODEL_ID = "eleven_flash_v2_5"; // Low latency for real-time use

let apiKey = "";
let audioCache = new Map();  // hazard index → audio URL
let currentAudio = null;
let queue = [];
let isPlaying = false;
let muted = false;

/* ═══════════════ INIT ═══════════════ */

export function init(key) {
  apiKey = key;
  audioCache.clear();
  queue = [];
  isPlaying = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export function setMuted(val) {
  muted = val;
  if (muted && currentAudio) {
    currentAudio.pause();
  }
}

export function isMuted() {
  return muted;
}

/* ═══════════════ PRE-GENERATE ═══════════════ */

/**
 * Pre-generate narration audio for all hazards in the background.
 * Call this after route scan completes so audio is ready when needed.
 */
export async function pregenerate(hazards) {
  if (!apiKey) return;

  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const text = buildNarrationText(h, i, hazards.length);
    // Generate in background, don't await all at once
    generateAudio(text, i).catch(err => {
      console.warn(`[Narration] Failed to pre-generate hazard ${i}:`, err.message);
    });
  }
}

/**
 * Build instructor-style narration text for a hazard.
 */
function buildNarrationText(hazard, index, total) {
  const intro = index === 0 ? "Starting rehearsal. " : "";
  const position = `Hazard ${index + 1} of ${total}. `;

  let body = "";
  switch (hazard.severity) {
    case "high":
      body = `Careful here. ${hazard.description} `;
      break;
    case "medium":
      body = `Heads up. ${hazard.description} `;
      break;
    default:
      body = `Note: ${hazard.description} `;
  }

  const tip = hazard.tip ? `My advice: ${hazard.tip}` : "";
  const road = hazard.road ? ` on ${hazard.road}` : "";

  return `${intro}${position}${body}${tip}${road}`.trim();
}

/* ═══════════════ TTS API ═══════════════ */

async function generateAudio(text, cacheKey) {
  if (audioCache.has(cacheKey)) return audioCache.get(cacheKey);
  if (!apiKey) {
    return { type: "native", text };
  }

  try {
    const response = await fetch(`${ELEVENLABS_API}/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.7,
          style: 0.3,
        },
      }),
    });

    if (response.status === 402) {
      console.warn("[Narration] ElevenLabs credits exhausted. Falling back to native speech.");
      return { type: "native", text };
    }

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    audioCache.set(cacheKey, url);
    return url;
  } catch (e) {
    console.warn("[Narration] ElevenLabs fetch failed:", e.message);
    return { type: "native", text };
  }
}

/* ═══════════════ PLAYBACK ═══════════════ */

/**
 * Play narration for a specific hazard. Clears queue first to prevent desync.
 */
export async function playHazard(hazard, index, total) {
  if (muted) return;

  const text = buildNarrationText(hazard, index, total);

  // Clear any pending narrations so we don't lag behind the car position
  stop();

  // Check cache first
  let audioData = audioCache.get(index);
  if (!audioData) {
    audioData = await generateAudio(text, index);
  }

  // Only play ElevenLabs audio; skip if unavailable (native TTS is too slow and desyncs)
  if (!audioData || (typeof audioData === "object" && audioData.type === "native")) {
    console.warn("[Narration] Skipping hazard narration — ElevenLabs audio not available.");
    return;
  }

  queue.push(audioData);
  if (!isPlaying) {
    playNext();
  }
}

/**
 * Play a custom text narration (e.g., "Rehearsal complete").
 */
export async function playText(text) {
  if (muted) return;
  const audioData = await generateAudio(text, `custom_${text.slice(0, 20)}`);
  if (audioData) {
    queue.push(audioData);
    if (!isPlaying) playNext();
  }
}

function playNext() {
  if (queue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  const data = queue.shift();

  if (typeof data === "object" && data.type === "native") {
    // Native fallback
    const utter = new SpeechSynthesisUtterance(data.text);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.onend = () => {
      isPlaying = false;
      playNext();
    };
    utter.onerror = () => {
      isPlaying = false;
      playNext();
    };
    window.speechSynthesis.speak(utter);
    return;
  }

  // ElevenLabs playback
  currentAudio = new Audio(data);
  currentAudio.volume = 0.85;

  currentAudio.addEventListener("ended", () => {
    currentAudio = null;
    playNext();
  });

  currentAudio.addEventListener("error", () => {
    currentAudio = null;
    playNext();
  });

  currentAudio.play().catch(() => {
    console.warn("[Narration] Autoplay blocked.");
    isPlaying = false;
    playNext();
  });
}

/**
 * Stop all narration immediately.
 */
export function stop() {
  queue = [];
  isPlaying = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

/**
 * Clean up all cached audio URLs.
 */
export function destroy() {
  stop();
  audioCache.forEach(url => URL.revokeObjectURL(url));
  audioCache.clear();
}
