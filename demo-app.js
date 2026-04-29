const routes = [];

const appState = {
  routeIndex: 0,
  mode: "pain_point_only",
  playing: false,
  stepIndex: 0,
  intervalId: null,
};

const elements = {
  routeList: document.getElementById("routeList"),
  routeTitle: document.getElementById("routeTitle"),
  routeSubtitle: document.getElementById("routeSubtitle"),
  statusPill: document.getElementById("statusPill"),
  timeline: document.getElementById("timeline"),
  progressBar: document.getElementById("progressBar"),
  activeLabel: document.getElementById("activeLabel"),
  segmentTitle: document.getElementById("segmentTitle"),
  segmentBody: document.getElementById("segmentBody"),
  painTitle: document.getElementById("painTitle"),
  painBody: document.getElementById("painBody"),
  coachText: document.getElementById("coachText"),
  miniList: document.getElementById("miniList"),
  phoneRoute: document.getElementById("phoneRoute"),
  phoneMode: document.getElementById("phoneMode"),
  phoneSpeed: document.getElementById("phoneSpeed"),
  phoneSteer: document.getElementById("phoneSteer"),
  phoneStep: document.getElementById("phoneStep"),
  phoneInput: document.getElementById("phoneInput"),
  phoneState: document.getElementById("phoneState"),
  metricDistance: document.getElementById("metricDistance"),
  metricDuration: document.getElementById("metricDuration"),
  metricPainPoints: document.getElementById("metricPainPoints"),
  metricConfidence: document.getElementById("metricConfidence"),
  node1: document.getElementById("node1"),
  node2: document.getElementById("node2"),
  node3: document.getElementById("node3"),
  node4: document.getElementById("node4"),
  playBtn: document.getElementById("playBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resetBtn: document.getElementById("resetBtn"),
  nextBtn: document.getElementById("nextBtn"),
  jumpPainBtn: document.getElementById("jumpPainBtn"),
};

function minutesFromSeconds(seconds) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadRoute(path) {
  return fetch(path).then((res) => res.json());
}

function currentRoute() {
  return routes[appState.routeIndex];
}

function painPointsForRoute(route) {
  return route.painPoints ?? [];
}

function segmentsForMode(route) {
  if (appState.mode === "single_segment") {
    const painPoint = painPointsForRoute(route)[0];
    return painPoint ? route.segments.filter((segment) => segment.id === painPoint.segmentId) : [];
  }

  if (appState.mode === "pain_point_only") {
    const ids = new Set(painPointsForRoute(route).map((item) => item.segmentId));
    return route.segments.filter((segment) => ids.has(segment.id));
  }

  return route.segments;
}

function selectedPainPoints(route) {
  if (appState.mode === "single_segment") {
    const painPoint = painPointsForRoute(route)[0];
    return painPoint ? [painPoint] : [];
  }

  if (appState.mode === "pain_point_only") {
    const ids = new Set(segmentsForMode(route).map((segment) => segment.id));
    return painPointsForRoute(route).filter((item) => ids.has(item.segmentId));
  }

  return painPointsForRoute(route);
}

function renderRouteList() {
  elements.routeList.innerHTML = "";
  routes.forEach((route, index) => {
    const button = document.createElement("button");
    button.className = `route-item ${index === appState.routeIndex ? "active" : ""}`;
    button.innerHTML = `
      <strong>${route.title}</strong>
      <span>${route.origin.label} to ${route.destination.label}<br>${route.painPoints.length} pain points, ${route.segments.length} segments</span>
    `;
    button.addEventListener("click", () => {
      appState.routeIndex = index;
      resetPlayback();
      render();
    });
    elements.routeList.appendChild(button);
  });
}

function renderModeToggle() {
  document.querySelectorAll("#modeToggle .chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.mode === appState.mode);
  });
}

function stepForCurrentIndex(route) {
  const segments = segmentsForMode(route);
  return segments[appState.stepIndex] ?? null;
}

function painPointForSegment(route, segmentId) {
  return painPointsForRoute(route).find((painPoint) => painPoint.segmentId === segmentId) ?? null;
}

function renderTimeline() {
  const route = currentRoute();
  const segments = segmentsForMode(route);
  elements.timeline.innerHTML = "";

  segments.forEach((segment, index) => {
    const painPoint = painPointForSegment(route, segment.id);
    const isActive = index === appState.stepIndex;
    const item = document.createElement("div");
    item.className = `step ${isActive ? "active" : ""}`;
    item.innerHTML = `
      <div class="dot"></div>
      <div>
        <strong>${segment.instruction}</strong>
        <span>${segment.roadContext.roadName} · ${segment.kind} · ${segment.hazards.join(", ") || "no major hazards"}</span>
      </div>
      <div class="tag">${painPoint ? painPoint.type.replaceAll("_", " ") : segment.kind}</div>
    `;
    item.addEventListener("click", () => {
      appState.stepIndex = index;
      syncCurrentStep();
      render();
    });
    elements.timeline.appendChild(item);
  });
}

function syncCurrentStep() {
  const route = currentRoute();
  const segments = segmentsForMode(route);
  const step = stepForCurrentIndex(route);
  const total = segments.length;
  const progress = total > 0 ? ((appState.stepIndex + 1) / total) * 100 : 0;
  const painPoints = selectedPainPoints(route);
  const currentPainPoint = step ? painPointForSegment(route, step.id) : null;

  elements.routeTitle.textContent = route.title;
  elements.routeSubtitle.textContent = `${route.origin.label} to ${route.destination.label}. ${route.provider.source === "mock" ? "Mocked route data" : "Live route data"} with ${painPoints.length} focused pain points.`;
  elements.statusPill.textContent = appState.playing ? "Rehearsing" : "Paused";
  elements.progressBar.style.width = `${clamp(progress, 0, 100)}%`;
  elements.activeLabel.textContent = step ? step.instruction : "Waiting to start";

  elements.metricDistance.textContent = `${(route.estimatedDistanceM / 1000).toFixed(1)} km`;
  elements.metricDuration.textContent = minutesFromSeconds(route.estimatedDurationSec);
  elements.metricPainPoints.textContent = String(route.painPoints.length);
  elements.metricConfidence.textContent = `${Math.round(route.rehearsalConfidence ?? 68)}%`;

  elements.phoneRoute.textContent = route.title;
  elements.phoneMode.textContent = appState.mode;
  elements.phoneStep.textContent = `${Math.min(appState.stepIndex + 1, Math.max(total, 1))} / ${Math.max(total, 1)}`;
  elements.phoneState.textContent = appState.playing ? "playing" : "idle";

  const steer = total > 0 ? Math.round(((appState.stepIndex % 5) - 2) * 18) : 0;
  const speed = step?.roadContext?.speedLimitKph ?? 0;
  elements.phoneSteer.textContent = `${steer > 0 ? "+" : ""}${steer}%`;
  elements.phoneSpeed.textContent = `${speed}`;
  elements.phoneInput.textContent = indexToInputMode(appState.stepIndex);

  if (!step) {
    elements.segmentTitle.textContent = "No step selected";
    elements.segmentBody.textContent = "Choose a route and enter a rehearsal mode.";
    elements.painTitle.textContent = "Pain point";
    elements.painBody.textContent = "The current pain point will appear here.";
    elements.coachText.textContent = "Ready to rehearse the next pain point.";
    elements.miniList.innerHTML = "";
    elements.handoffBody.textContent = "This demo is wired for mocked routes now. The next build step is live route import and phone pairing.";
    return;
  }

  elements.segmentTitle.textContent = step.instruction;
  elements.segmentBody.textContent = [
    `${step.roadContext.roadName}, ${step.roadContext.laneCount} lanes, recommended ${step.roadContext.recommendedLane} lane.`,
    `Signage: ${step.signage.primaryText}${step.signage.secondaryText ? ` / ${step.signage.secondaryText}` : ""}.`,
    step.hazards.length ? `Hazards: ${step.hazards.join(", ")}.` : "No major hazards flagged.",
  ].join(" ");

  if (currentPainPoint) {
    elements.painTitle.textContent = currentPainPoint.title;
    elements.painBody.textContent = `${currentPainPoint.description} Rehearse by focusing on: ${currentPainPoint.rehearsalFocus}`;
    elements.coachText.textContent = `Coach: ${coachLine(currentPainPoint, step)}`;
    elements.activeLabel.textContent = currentPainPoint.title;
    elements.node3.classList.add("active");
  } else {
    elements.painTitle.textContent = "No pain point";
    elements.painBody.textContent = "This segment is part of the route but not marked as a major confusion point.";
    elements.coachText.textContent = `Coach: ${step.instruction}`;
    elements.node3.classList.remove("active");
  }

  elements.miniList.innerHTML = "";
  const bullets = [
    `Lane guidance: ${step.roadContext.recommendedLane}`,
    `Signage confidence: ${step.signage.signageConfidence}`,
    `Mode: ${appState.mode}`,
  ];
  bullets.forEach((text) => {
    const row = document.createElement("div");
    row.className = "mini-item";
    row.textContent = text;
    elements.miniList.appendChild(row);
  });

  elements.handoffBody.textContent = `Current step: ${step.id}. Data lives in ` + "SCHEMA.md" + ` and ` + route.id + `.json. Next build step: attach live route import and phone pairing to this model.`;

  const highlight = step.id === "seg_005_exit_split" || step.id === "seg_a03_split_merge";
  elements.node1.classList.toggle("active", appState.stepIndex === 0);
  elements.node2.classList.toggle("active", appState.stepIndex === 1 || appState.stepIndex === 2);
  elements.node3.classList.toggle("active", highlight);
  elements.node4.classList.toggle("active", appState.stepIndex >= total - 1);
}

function indexToInputMode(stepIndex) {
  return stepIndex % 2 === 0 ? "gyro" : "touch";
}

function coachLine(painPoint, step) {
  if (painPoint.type === "wrong_exit") {
    return `Hold the right-center lane. Read the split early and trust the 148B branch.`;
  }
  if (painPoint.type === "late_merge") {
    return `Commit earlier. Keep ${step.roadContext.recommendedLane} and do not wait for the last marker.`;
  }
  if (painPoint.type === "hidden_entrance") {
    return `Slow down sooner and watch for the right-side opening after the alley.`;
  }
  if (painPoint.type === "wrong_lane") {
    return `Stay left before the deck split. Do not try to recover at the final sign cluster.`;
  }
  return painPoint.rehearsalFocus;
}

function stepBackward() {
  const route = currentRoute();
  const segments = segmentsForMode(route);
  appState.stepIndex = clamp(appState.stepIndex - 1, 0, Math.max(segments.length - 1, 0));
  syncCurrentStep();
  render();
}

function stepForward() {
  const route = currentRoute();
  const segments = segmentsForMode(route);
  appState.stepIndex = clamp(appState.stepIndex + 1, 0, Math.max(segments.length - 1, 0));
  syncCurrentStep();
  render();
}

function jumpToPainPoint() {
  const route = currentRoute();
  const painPoint = selectedPainPoints(route)[0];
  if (!painPoint) return;
  const index = segmentsForMode(route).findIndex((segment) => segment.id === painPoint.segmentId);
  if (index >= 0) {
    appState.stepIndex = index;
    syncCurrentStep();
    render();
  }
}

function resetPlayback() {
  appState.playing = false;
  appState.stepIndex = 0;
  clearInterval(appState.intervalId);
  appState.intervalId = null;
  syncCurrentStep();
  render();
}

function play() {
  const route = currentRoute();
  const segments = segmentsForMode(route);
  if (!segments.length) return;
  if (appState.playing) return;
  appState.playing = true;
  syncCurrentStep();
  render();
  clearInterval(appState.intervalId);
  appState.intervalId = setInterval(() => {
    if (appState.stepIndex >= segments.length - 1) {
      pause();
      return;
    }
    appState.stepIndex += 1;
    syncCurrentStep();
    render();
  }, 1800);
}

function pause() {
  appState.playing = false;
  clearInterval(appState.intervalId);
  appState.intervalId = null;
  syncCurrentStep();
  render();
}

function render() {
  renderRouteList();
  renderModeToggle();
  renderTimeline();
  syncCurrentStep();
}

function wireControls() {
  elements.playBtn.addEventListener("click", play);
  elements.pauseBtn.addEventListener("click", pause);
  elements.resetBtn.addEventListener("click", resetPlayback);
  elements.nextBtn.addEventListener("click", stepForward);
  elements.jumpPainBtn.addEventListener("click", jumpToPainPoint);
  document.querySelectorAll("#modeToggle .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      appState.mode = chip.dataset.mode;
      resetPlayback();
      render();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      appState.playing ? pause() : play();
    }
    if (event.code === "ArrowRight") stepForward();
    if (event.code === "ArrowLeft") stepBackward();
  });
}

async function bootstrap() {
  routes.push(
    await loadRoute("./data/demo-routes/downtown-garage.json"),
    await loadRoute("./data/demo-routes/airport-merge.json"),
  );
  renderModeToggle();
  render();
  wireControls();
  syncCurrentStep();
}

bootstrap();
