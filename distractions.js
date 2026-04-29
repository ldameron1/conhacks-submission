/**
 * Distraction Simulation Module — ElevenLabs TTS
 * 
 * Generates realistic passenger/environment distractions during drive mode
 * to train split-attention driving skills.
 * 
 * Difficulty tiers:
 *   🟢 Calm     — No distractions (default)
 *   🟡 Moderate — Occasional passenger comments, radio chatter
 *   🔴 Intense  — Bickering spouse, screaming kids, phone ringing, constant chatter
 */

const ELEVENLABS_API = "https://api.elevenlabs.io/v1/text-to-speech";

// Different voices for different "characters"
const VOICES = {
  passenger: "21m00Tcm4TlvDq8ikWAM",  // Rachel — calm adult
  child: "EXAVITQu4vr4xnSDxMaL",       // Bella — younger voice
  spouse: "MF3mGyEYCl7XYWbV9V6O",       // Elli — different adult
  radio: "TxGEqnHWrfWFTfGW9XjX",        // Josh — male announcer
};

// Pre-written distraction scripts per difficulty tier
const SCRIPTS = {
  moderate: [
    { voice: "passenger", text: "Hey, did you see that restaurant back there? We should go sometime.", delay: 15000 },
    { voice: "radio", text: "Traffic update: expect delays on the interstate near exit forty-two.", delay: 30000 },
    { voice: "passenger", text: "Oh! Can you change the song? I don't like this one.", delay: 45000 },
    { voice: "passenger", text: "Wait, was that our turn? No, never mind.", delay: 60000 },
    { voice: "radio", text: "And now for the weather. Expect scattered showers this afternoon with temperatures around sixty-five degrees.", delay: 80000 },
    { voice: "passenger", text: "My phone is dying. Do you have a charger?", delay: 100000 },
    { voice: "passenger", text: "Hey, you know what, I think there's a shortcut through that neighborhood.", delay: 120000 },
  ],
  intense: [
    { voice: "child", text: "Are we there yet? Are we there yet? I'm bored!", delay: 8000 },
    { voice: "spouse", text: "You should have turned left back there. I told you to turn left!", delay: 15000 },
    { voice: "child", text: "Mommy! He's touching me! Tell him to stop!", delay: 22000 },
    { voice: "spouse", text: "Why are you going this way? This doesn't look right at all.", delay: 30000 },
    { voice: "child", text: "I need to go to the bathroom! Like right now!", delay: 38000 },
    { voice: "passenger", text: "So anyway, as I was saying, my boss is completely unreasonable. He expects me to finish three reports by Friday, and I haven't even started the first one.", delay: 45000 },
    { voice: "spouse", text: "Watch out! There's a... oh never mind, it was nothing.", delay: 55000 },
    { voice: "child", text: "Can we get ice cream? Please please please please!", delay: 62000 },
    { voice: "spouse", text: "You're going too fast. Slow down. No wait, you're going too slow now.", delay: 70000 },
    { voice: "passenger", text: "Oh my God, look at that house! That's gorgeous! Do you see it? Look look look!", delay: 78000 },
    { voice: "child", text: "I dropped my toy! Can you get it? It's under the seat!", delay: 85000 },
    { voice: "spouse", text: "Did you remember to lock the front door? I think you forgot.", delay: 95000 },
    { voice: "child", text: "I'm hungry! When are we eating? You said we'd eat soon!", delay: 105000 },
    { voice: "spouse", text: "Your mother called, by the way. She wants to come visit next weekend. I said maybe.", delay: 115000 },
    { voice: "passenger", text: "And then Karen had the audacity to say that to my face. Can you believe that? I mean, who does she think she is?", delay: 125000 },
  ],
};

let apiKey = "";
let currentDifficulty = "calm";
let audioCache = new Map();
let scheduledTimeouts = [];
let activeAudio = null;
let isRunning = false;
let recognition = null;
let userSpokeCallback = null;
let cameraStream = null;

/* ═══════════════ INIT ═══════════════ */

export function init(key) {
  apiKey = key;
  stop();
}

export function onUserSpoke(cb) {
  userSpokeCallback = cb;
}

function startListening() {
  // Request video stream solely to turn on the physical camera light
  // to notify the user they are being actively listened to.
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => { cameraStream = stream; })
      .catch(e => console.warn("Camera light activation failed:", e));
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    
    recognition.onresult = (event) => {
      if (!isRunning) return;
      // If any speech is recognized, the user took the bait and talked back
      const transcript = event.results[event.results.length - 1][0].transcript;
      if (transcript.trim().length > 0 && userSpokeCallback) {
        userSpokeCallback(transcript);
      }
    };

    recognition.onerror = () => {}; // Ignore errors (e.g. no mic)
    recognition.onend = () => {
      // Auto-restart if still running
      if (isRunning) {
        try { recognition.start(); } catch(e) {}
      }
    };

    recognition.start();
  } catch (e) {
    console.warn("Speech recognition failed to start:", e);
  }
}

export function setDifficulty(level) {
  const wasRunning = isRunning;
  stop();
  currentDifficulty = level;
  if (wasRunning && level !== "calm") {
    start();
  }
}

export function getDifficulty() {
  return currentDifficulty;
}

/* ═══════════════ PRE-GENERATE ═══════════════ */

/**
 * Pre-generate all distraction audio clips in the background.
 * Call after route scan while the user is reviewing the report.
 */
export async function pregenerate() {
  if (!apiKey) return;

  const allScripts = [...(SCRIPTS.moderate || []), ...(SCRIPTS.intense || [])];
  
  for (const script of allScripts) {
    const cacheKey = `dist_${script.text.slice(0, 30)}`;
    if (audioCache.has(cacheKey)) continue;

    try {
      const voiceId = VOICES[script.voice] || VOICES.passenger;
      const response = await fetch(`${ELEVENLABS_API}/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: script.text,
          model_id: "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.4,        // More variable = more emotional
            similarity_boost: 0.6,
            style: 0.5,
          },
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        audioCache.set(cacheKey, URL.createObjectURL(blob));
      }
    } catch (e) {
      console.warn(`[Distractions] Pre-gen failed for "${script.text.slice(0, 20)}...":`, e.message);
    }
  }

  console.log(`[Distractions] Pre-generated ${audioCache.size} clips`);
}

/* ═══════════════ PLAYBACK ENGINE ═══════════════ */

export function start() {
  if (currentDifficulty === "calm" || !apiKey) return;
  isRunning = true;

  if (currentDifficulty === "intense") {
    startListening();
  }

  const scripts = SCRIPTS[currentDifficulty] || [];
  
  scripts.forEach((script, i) => {
    // Add some randomness to timing (±30%)
    const jitter = script.delay * (0.7 + Math.random() * 0.6);
    
    const timeout = setTimeout(() => {
      if (!isRunning) return;
      playDistraction(script);
    }, jitter);

    scheduledTimeouts.push(timeout);
  });
}

export function stop() {
  isRunning = false;
  if (recognition) {
    try { recognition.stop(); } catch(e) {}
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  scheduledTimeouts.forEach(clearTimeout);
  scheduledTimeouts = [];
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
}

async function playDistraction(script) {
  if (!isRunning) return;

  const cacheKey = `dist_${script.text.slice(0, 30)}`;
  let audioUrl = audioCache.get(cacheKey);

  // Generate on-the-fly if not cached
  if (!audioUrl) {
    try {
      const voiceId = VOICES[script.voice] || VOICES.passenger;
      const response = await fetch(`${ELEVENLABS_API}/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: script.text,
          model_id: "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.6,
            style: 0.5,
          },
        }),
      });

      if (!response.ok) return;
      const blob = await response.blob();
      audioUrl = URL.createObjectURL(blob);
      audioCache.set(cacheKey, audioUrl);
    } catch (e) {
      return;
    }
  }

  // Play at lower volume than hazard narration (that's the point — competing audio)
  activeAudio = new Audio(audioUrl);
  activeAudio.volume = 0.65;
  activeAudio.play().catch(() => {});
}

/* ═══════════════ CLEANUP ═══════════════ */

export function destroy() {
  stop();
  audioCache.forEach(url => URL.revokeObjectURL(url));
  audioCache.clear();
}
