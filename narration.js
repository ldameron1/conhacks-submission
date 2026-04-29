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
  if (!apiKey) return null;

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

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  audioCache.set(cacheKey, url);
  return url;
}

/* ═══════════════ PLAYBACK ═══════════════ */

/**
 * Play narration for a specific hazard. Queues if something is already playing.
 */
export async function playHazard(hazard, index, total) {
  if (muted || !apiKey) return;

  const text = buildNarrationText(hazard, index, total);

  // Check cache first
  let audioUrl = audioCache.get(index);
  if (!audioUrl) {
    try {
      audioUrl = await generateAudio(text, index);
    } catch (e) {
      console.warn("[Narration] Live generation failed:", e.message);
      return;
    }
  }

  if (!audioUrl) return;

  queue.push(audioUrl);
  if (!isPlaying) {
    playNext();
  }
}

/**
 * Play a custom text narration (e.g., "Rehearsal complete").
 */
export async function playText(text) {
  if (muted || !apiKey) return;
  try {
    const url = await generateAudio(text, `custom_${text.slice(0, 20)}`);
    if (url) {
      queue.push(url);
      if (!isPlaying) playNext();
    }
  } catch (e) {
    console.warn("[Narration] Custom text failed:", e.message);
  }
}

function playNext() {
  if (queue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  const url = queue.shift();
  currentAudio = new Audio(url);
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
    // Autoplay blocked — user needs to interact first
    console.warn("[Narration] Autoplay blocked. Click anywhere to enable audio.");
    isPlaying = false;
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
