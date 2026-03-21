const $statusBar     = document.getElementById("statusBar");
const $senderWrap    = document.getElementById("senderWrap");
const $startBtn      = document.getElementById("startSensorsBtn");
const $disconnectBtn = document.getElementById("disconnectDeviceBtn");
const $peerInfo      = document.getElementById("peerInfo");
const $sensorInfo    = document.getElementById("sensorInfo");
const $tapBtnWrap    = document.getElementById("tapBtnWrap");
const $tapBtns       = document.querySelectorAll(".tap-btn-color");
const $startGameBtn  = document.getElementById("startGameBtn");
const $stopGameBtn   = document.getElementById("stopGameBtn");
const $deathActions  = document.getElementById("deathActions");
const $deathScoreValue = document.getElementById("deathScoreValue");
const $deathNameInput = document.getElementById("deathNameInput");
const $returnLobbyBtn = document.getElementById("returnLobbyBtn");
const $playAgainBtn = document.getElementById("playAgainBtn");
const $phoneCommandDisplay = document.getElementById("phoneCommandDisplay");
const $phoneCommandPrefix = document.getElementById("phoneCommandPrefix");
const $phoneCommandText = document.getElementById("phoneCommandText");

let socket, myStream, peer;
let sensorsActive = false;
let speechEnabled = false;
let gameStarted = false;
let activeCommandGesture = null;
let commandArmAt = 0;
let telemetryTimer = null;
let latestMicLevel = 0;
let tapCount = 0;
let tapPulseUntil = 0;
let lastTapColor = null;
let latestGyro = { alpha: 0, beta: 0, gamma: 0 };
let latestAccel = { x: 0, y: 0, z: 0 };
let activeDeathToken = null;
const COMMAND_ARM_DELAY = 350;
const PLAYER_NAME_STORAGE_KEY = "simonSaysPlayerNameV1";

const sendPeerMessage = (message) => {
  if (peer && peer.connected) {
    peer.send(JSON.stringify(message));
  }
};

const sendControllerState = (active) => {
  sendPeerMessage({ type: "controller-state", active: !!active });
};

const sendTelemetrySnapshot = () => {
  sendPeerMessage({
    type: "telemetry",
    mic: latestMicLevel,
    tap: {
      count: tapCount,
      active: Date.now() < tapPulseUntil,
      color: lastTapColor,
    },
    gyro: latestGyro,
    accel: latestAccel,
  });
};

const syncMicTrackEnabled = () => {
  const lobbyMicActive = sensorsActive && !gameStarted;
  const speechGateActive = activeCommandGesture === "speech" && Date.now() >= commandArmAt;
  speechEnabled = lobbyMicActive || speechGateActive;
  if (myStream) myStream.getAudioTracks().forEach(t => { t.enabled = speechEnabled; });
};

const updatePhoneUiByGameState = () => {
  const hideLobbyControls = gameStarted;
  if ($startBtn) $startBtn.classList.toggle("hide-during-game", hideLobbyControls);
  if ($disconnectBtn) $disconnectBtn.classList.toggle("hide-during-game", hideLobbyControls);
  if ($statusBar) $statusBar.classList.toggle("hide-during-game", hideLobbyControls);
  if ($peerInfo) $peerInfo.classList.toggle("hide-during-game", hideLobbyControls);
  if ($sensorInfo) $sensorInfo.classList.toggle("hide-during-game", hideLobbyControls);
};

const normalizePlayerName = (name) => {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ");
  return cleaned.slice(0, 20) || "Player";
};

const getScoreboardName = () => {
  if ($deathNameInput) return normalizePlayerName($deathNameInput.value);
  return "Player";
};

const storeScoreboardName = (name) => {
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, normalizePlayerName(name));
  } catch {
    // Ignore storage failures on mobile browsers.
  }
};

const loadStoredScoreboardName = () => {
  try {
    return normalizePlayerName(localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || "Player");
  } catch {
    return "Player";
  }
};

const setDeathMode = (active) => {
  if ($senderWrap) $senderWrap.classList.toggle("death-mode", !!active);
};

const sendScoreNameToReceiver = () => {
  if (!(peer && peer.connected) || !activeDeathToken) return;
  const playerName = getScoreboardName();
  storeScoreboardName(playerName);
  peer.send(JSON.stringify({
    type: "score-name",
    deathToken: activeDeathToken,
    name: playerName,
  }));
};

const hideDeathActions = () => {
  if ($deathActions) $deathActions.classList.add("hidden");
  if ($deathScoreValue) $deathScoreValue.textContent = "0";
  activeDeathToken = null;
  setDeathMode(false);
};

const showDeathActions = (finalScore, deathToken) => {
  if ($deathScoreValue) {
    $deathScoreValue.textContent = String(Number(finalScore) || 0);
  }
  activeDeathToken = deathToken ? String(deathToken) : null;
  if ($deathNameInput) {
    $deathNameInput.value = loadStoredScoreboardName();
  }
  if ($deathActions) $deathActions.classList.remove("hidden");
  setDeathMode(true);
  sendScoreNameToReceiver();
};

const beginGameFromPhone = () => {
  if (!(peer && peer.connected)) return;
  const playerName = getScoreboardName();
  storeScoreboardName(playerName);
  if (activeDeathToken) {
    peer.send(JSON.stringify({
      type: "score-name",
      deathToken: activeDeathToken,
      name: playerName,
    }));
  }
  gameStarted = true;
  updatePhoneUiByGameState();
  setDeathMode(false);
  if ($deathActions) $deathActions.classList.add("hidden");
  activeCommandGesture = null;
  commandArmAt = 0;
  syncMicTrackEnabled();
  peer.send(JSON.stringify({ type: "start-game", playerName, deathToken: activeDeathToken }));
  activeDeathToken = null;
  $startGameBtn.style.display = "none";
  $stopGameBtn.style.display = "";
};

const init = async () => {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: 1280, height: 720, facingMode: "environment" },
    });
    myStream.getAudioTracks().forEach(t => { t.enabled = false; });
  } catch (e) {
    console.error("Could not access camera:", e);
    $statusBar.textContent = "Warning: camera access denied — no video will be sent.";
  }
  initSocket();
};

const initSocket = () => {
  socket = io.connect("/");

  socket.on("connect", () => {
    $statusBar.textContent = `Connected — My ID: ${socket.id}`;
    $statusBar.className = "status connected";
    if ($disconnectBtn) $disconnectBtn.disabled = !peer;
  });

  socket.on("disconnect", () => {
    $statusBar.textContent = "Disconnected from server";
    $statusBar.className = "status disconnected";
    setPeerInfo(null);
    activeCommandGesture = null;
    commandArmAt = 0;
    gameStarted = false;
    speechEnabled = false;
    updatePhoneUiByGameState();
    hideDeathActions();
    if (telemetryTimer) {
      clearInterval(telemetryTimer);
      telemetryTimer = null;
    }
    if (myStream) myStream.getAudioTracks().forEach(t => { t.enabled = false; });
    if ($disconnectBtn) $disconnectBtn.disabled = true;
  });

  socket.on("clients", (clients) => {
    const others = Object.keys(clients).filter((id) => id !== socket.id);
    if (others.length > 0 && !peer) {
      connectToPeer(others[0]);
    } else if (others.length === 0 && !peer) {
      setPeerInfo(null);
    }
  });

  socket.on("client-disconnect", (client) => {
    if (peer && peer.data && peer.data.id === client.id) {
      peer.destroy();
      peer = null;
      setPeerInfo(null);
      $startBtn.disabled = true;
      $startBtn.textContent = "Start Controller Mode";
      $startBtn.classList.remove("active");
      $sensorInfo.classList.remove("visible");
      $startGameBtn.disabled = true;
      $startGameBtn.style.display = "";
      $stopGameBtn.style.display  = "none";
      activeCommandGesture = null;
      commandArmAt = 0;
      gameStarted = false;
      speechEnabled = false;
      updatePhoneUiByGameState();
      hideDeathActions();
      if (telemetryTimer) {
        clearInterval(telemetryTimer);
        telemetryTimer = null;
      }
      if (myStream) myStream.getAudioTracks().forEach(t => { t.enabled = false; });
      if ($disconnectBtn) $disconnectBtn.disabled = true;
    }
  });

  socket.on("signal", (myId, signal, peerId) => {
    if (peer) {
      peer.signal(signal);
    } else if (signal.type === "offer") {
      createPeer(false, peerId);
      peer.signal(signal);
    }
  });
};

const connectToPeer = (peerId) => {
  $peerInfo.textContent = `Calling receiver…`;
  $peerInfo.className = "peer-info";
  createPeer(true, peerId);
};

const createPeer = (initiator, peerId) => {
  if (peer) { peer.destroy(); }
  peer = new SimplePeer({ initiator, stream: myStream });
  peer.data = { id: peerId };

  peer.on("signal", (data) => socket.emit("signal", peerId, data));

  peer.on("connect", () => {
    setPeerInfo(peerId);
    $startBtn.disabled = false;
    $startGameBtn.disabled = !sensorsActive;
    if ($disconnectBtn) $disconnectBtn.disabled = false;
    hideDeathActions();
  });

  peer.on("stream", () => {/* Sender doesn't render remote stream */});

  peer.on("data", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === "command") {
      activeCommandGesture = msg.gesture || null;
      commandArmAt = Date.now() + COMMAND_ARM_DELAY;
      syncMicTrackEnabled();

      if (msg.text) {
        $phoneCommandPrefix.textContent = msg.simon ? "Simon says…" : "";
        $phoneCommandText.textContent = msg.text;
        $phoneCommandDisplay.classList.remove("hidden");
      } else {
        $phoneCommandDisplay.classList.add("hidden");
      }
    } else if (msg.type === "game-ended") {
      gameStarted = false;
      activeCommandGesture = null;
      commandArmAt = 0;
      syncMicTrackEnabled();
      updatePhoneUiByGameState();
      hideDeathActions();
      $stopGameBtn.style.display  = "none";
      $startGameBtn.style.display = "";
    } else if (msg.type === "game-over") {
      gameStarted = false;
      activeCommandGesture = null;
      commandArmAt = 0;
      syncMicTrackEnabled();
      updatePhoneUiByGameState();
      $stopGameBtn.style.display  = "none";
      $startGameBtn.style.display = "";
      showDeathActions(msg.finalScore, msg.deathToken);
    }
  });

  peer.on("close", () => {
    peer.destroy();
    peer = null;
    setPeerInfo(null);
    $startBtn.disabled = true;
    $startBtn.textContent = "Start Controller Mode";
    $startBtn.classList.remove("active");
    $sensorInfo.classList.remove("visible");
    $tapBtnWrap.classList.remove("visible");
    $startGameBtn.disabled = true;
    $startGameBtn.style.display = "";
    $stopGameBtn.style.display  = "none";
    sensorsActive = false;
    activeCommandGesture = null;
    commandArmAt = 0;
    gameStarted = false;
    speechEnabled = false;
    updatePhoneUiByGameState();
    hideDeathActions();
    if (telemetryTimer) {
      clearInterval(telemetryTimer);
      telemetryTimer = null;
    }
    if (myStream) myStream.getAudioTracks().forEach(t => { t.enabled = false; });
    if ($disconnectBtn) $disconnectBtn.disabled = true;
  });

  peer.on("error", (err) => console.error("Peer error:", err));
};

const setPeerInfo = (peerId) => {
  if (peerId) {
    $peerInfo.textContent = `Connected to receiver ✓`;
    $peerInfo.className = "peer-info connected";
  } else {
    $peerInfo.textContent = "Looking for a receiver…";
    $peerInfo.className = "peer-info";
  }
};

$startBtn.addEventListener("click", async () => {
  if (sensorsActive) {
    sensorsActive = false;
    gameStarted = false;
    updatePhoneUiByGameState();
    sendControllerState(false);
    if (telemetryTimer) {
      clearInterval(telemetryTimer);
      telemetryTimer = null;
    }
    $startBtn.textContent = "Start Controller Mode";
    $startBtn.classList.remove("active");
    $sensorInfo.classList.remove("visible");
    $tapBtnWrap.classList.remove("visible");
    $startGameBtn.disabled = true;
    hideDeathActions();
    syncMicTrackEnabled();
    return;
  }
  await requestSensorPermission();
});

$disconnectBtn.addEventListener("click", () => {
  if (!peer) return;
  peer.destroy();
});

$tapBtns.forEach(($btn) => {
  $btn.addEventListener("click", () => {
    if (peer && peer.connected) {
      tapCount += 1;
      tapPulseUntil = Date.now() + 300;
      const color = $btn.dataset.color || "unknown";
      lastTapColor = color;
      peer.send(JSON.stringify({ type: "button", color }));
      sendTelemetrySnapshot();
    }
  });
});

$startGameBtn.addEventListener("click", () => {
  beginGameFromPhone();
});

$stopGameBtn.addEventListener("click", () => {
  if (peer && peer.connected) {
    gameStarted = false;
    updatePhoneUiByGameState();
    activeCommandGesture = null;
    commandArmAt = 0;
    syncMicTrackEnabled();
    hideDeathActions();
    peer.send(JSON.stringify({ type: "stop-game" }));
    $stopGameBtn.style.display  = "none";
    $startGameBtn.style.display = "";
  }
});

if ($returnLobbyBtn) {
  $returnLobbyBtn.addEventListener("click", () => {
    if (!(peer && peer.connected)) return;
    const deathToken = activeDeathToken;
    const playerName = getScoreboardName();
    storeScoreboardName(playerName);
    if (deathToken) {
      peer.send(JSON.stringify({
        type: "score-name",
        deathToken,
        name: playerName,
      }));
    }
    gameStarted = false;
    updatePhoneUiByGameState();
    activeCommandGesture = null;
    commandArmAt = 0;
    syncMicTrackEnabled();
    hideDeathActions();
    peer.send(JSON.stringify({ type: "return-lobby", playerName, deathToken }));
    $stopGameBtn.style.display  = "none";
    $startGameBtn.style.display = "";
  });
}

if ($playAgainBtn) {
  $playAgainBtn.addEventListener("click", () => {
    beginGameFromPhone();
  });
}

if ($deathNameInput) {
  $deathNameInput.addEventListener("input", () => {
    sendScoreNameToReceiver();
  });
}

const requestSensorPermission = async () => {
  try {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const p1 = await DeviceOrientationEvent.requestPermission();
      if (p1 !== "granted") return;
    }
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      const p2 = await DeviceMotionEvent.requestPermission();
      if (p2 !== "granted") return;
    }
    activateSensors();
  } catch (e) {
    console.error("Sensor permission error:", e);
    activateSensors();
  }
};

const activateSensors = () => {
  sensorsActive = true;
  gameStarted = false;
  hideDeathActions();
  updatePhoneUiByGameState();
  sendControllerState(true);
  syncMicTrackEnabled();
  $startGameBtn.disabled = !(peer && peer.connected);
  $startBtn.textContent = "Stop Controller Mode";
  $startBtn.classList.add("active");
  $sensorInfo.classList.add("visible");
  $tapBtnWrap.classList.add("visible");

  if (telemetryTimer) clearInterval(telemetryTimer);
  telemetryTimer = setInterval(() => {
    if (!sensorsActive) return;
    sendTelemetrySnapshot();
  }, 120);

  /* ── Gesture detection state ── */
  let lastGestureTime = 0;
  const COOLDOWN = 1500;

  const sendGesture = (gesture) => {
    const now = Date.now();
    if (gesture !== activeCommandGesture || now < commandArmAt) return;
    if (now - lastGestureTime < COOLDOWN) return;
    lastGestureTime = now;
    if (peer && peer.connected) {
      peer.send(JSON.stringify({ type: "gesture", gesture }));
    }
  };

  /* ── Shake state ── */
  let shakeReversals = 0;
  let shakeWindowStart = 0;
  let shakeLastSign = 0;
  const SHAKE_THRESH = 4;
  const SHAKE_REVERSALS_NEEDED = 4;
  const SHAKE_WINDOW = 1200;

  /* ── Jump / Duck state ── */
  let verticalPhase = "idle";
  let verticalStart = 0;
  const VERTICAL_TIMEOUT = 1500;
  const VERT_HIGH = 16;  // sharp impact / push-off — well above resting gravity (~9.8)
  const VERT_LOW  = 6;   // freefall threshold — raised slightly to reduce false triggers

  /* ── Spin state ── */
  let spinAccum = 0;
  let lastAlpha = null;
  let spinStart = 0;
  const SPIN_WINDOW = 3000;
  const SPIN_THRESHOLD = 350;

  /* ── Move left / right state ── */
  const MOVE_TRIGGER = 2;
  const MOVE_RELEASE = 0.8;
  const MOVE_HOLD_MS = 0;
  let leftHoldStart = 0;
  let rightHoldStart = 0;
  let leftReady = true;
  let rightReady = true;

  /* ── Device Motion ── */
  window.addEventListener("devicemotion", (event) => {
    if (!sensorsActive) return;

    const a = event.acceleration || event.accelerationIncludingGravity;
    if (a) {
      latestAccel = {
        x: Number(a.x || 0),
        y: Number(a.y || 0),
        z: Number(a.z || 0),
      };
    }

    const commandArmed = !!activeCommandGesture && Date.now() >= commandArmAt;
    if (!commandArmed) {
      shakeReversals = 0;
      shakeLastSign = 0;
      verticalPhase = "idle";
      leftHoldStart = 0;
      rightHoldStart = 0;
      leftReady = true;
      rightReady = true;
      return;
    }

    /* ── Shake detection ── */
    const linAccel = event.acceleration;
    if (linAccel && activeCommandGesture === "shake") {
      const val = Math.abs(linAccel.x || 0) > Math.abs(linAccel.y || 0)
        ? (linAccel.x || 0) : (linAccel.y || 0);
      const sign = val > SHAKE_THRESH ? 1 : val < -SHAKE_THRESH ? -1 : 0;

      if (sign !== 0 && sign !== shakeLastSign) {
        const now = Date.now();
        if (shakeLastSign === 0 || now - shakeWindowStart > SHAKE_WINDOW) {
          shakeReversals = 1;
          shakeWindowStart = now;
        } else {
          shakeReversals++;
        }
        shakeLastSign = sign;

        if (shakeReversals >= SHAKE_REVERSALS_NEEDED) {
          sendGesture("shake");
          shakeReversals = 0;
          shakeLastSign = 0;
        }
      }
    }

    /* ── Jump / Duck (unified magnitude detector) ── */
    const aig = event.accelerationIncludingGravity;
    if (aig && (activeCommandGesture === "jump" || activeCommandGesture === "duck")) {
      const mag = Math.sqrt(
        (aig.x || 0) ** 2 + (aig.y || 0) ** 2 + (aig.z || 0) ** 2
      );
      const now = Date.now();

      // Timeout → reset
      if (verticalPhase !== "idle" && now - verticalStart > VERTICAL_TIMEOUT) {
        verticalPhase = "idle";
      }

      switch (verticalPhase) {
        case "idle":
          if (activeCommandGesture === "jump" && mag > VERT_HIGH) {
            verticalPhase = "jump-push";
            verticalStart = now;
          } else if (activeCommandGesture === "duck" && mag > VERT_HIGH) {
            // Duck = sudden crouch impact spike — single phase, fires immediately
            verticalPhase = "idle";
            sendGesture("duck");
          }
          break;
        case "jump-push":
          if (mag < VERT_LOW) verticalPhase = "jump-freefall";
          break;
        case "jump-freefall":
          if (mag > VERT_HIGH) {
            verticalPhase = "idle";
            sendGesture("jump");
          }
          break;
      }
    }

    /* ── Move left / right via linear acceleration ── */
    if (activeCommandGesture === "left" || activeCommandGesture === "right") {
      const now = Date.now();
      const lin = event.acceleration;
      const grav = event.accelerationIncludingGravity;
      const ax = Number(
        lin && lin.x != null
          ? lin.x
          : (grav && grav.x != null ? grav.x : 0)
      );

      if (activeCommandGesture === "left") {
        if (ax >= MOVE_TRIGGER) {
          if (!leftHoldStart) leftHoldStart = now;
          if (leftReady && now - leftHoldStart >= MOVE_HOLD_MS) {
            sendGesture("left");
            leftReady = false;
          }
        } else {
          leftHoldStart = 0;
          if (ax < MOVE_RELEASE) leftReady = true;
        }
      }

      if (activeCommandGesture === "right") {
        if (ax <= -MOVE_TRIGGER) {
          if (!rightHoldStart) rightHoldStart = now;
          if (rightReady && now - rightHoldStart >= MOVE_HOLD_MS) {
            sendGesture("right");
            rightReady = false;
          }
        } else {
          rightHoldStart = 0;
          if (ax > -MOVE_RELEASE) rightReady = true;
        }
      }
    }
  }); // end devicemotion

  /* ── Device Orientation (spin) ── */
  window.addEventListener("deviceorientation", (event) => {
    if (!sensorsActive || !(peer && peer.connected)) return;

    latestGyro = {
      alpha: Number(event.alpha || 0),
      beta:  Number(event.beta  || 0),
      gamma: Number(event.gamma || 0),
    };

    const commandArmed = !!activeCommandGesture && Date.now() >= commandArmAt;
    if (!commandArmed) {
      spinAccum = 0;
      spinStart = Date.now();
      lastAlpha = null;
      return;
    }

    if (activeCommandGesture !== "spin") {
      spinAccum = 0;
      spinStart = Date.now();
      lastAlpha = null;
      return;
    }

    /* ── 360 Spin (directional accumulation) ── */
    const alpha = event.alpha ?? 0;
    if (lastAlpha !== null) {
      let delta = alpha - lastAlpha;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const now = Date.now();
      if (now - spinStart > SPIN_WINDOW) {
        spinAccum = 0;
        spinStart = now;
      }
      spinAccum += delta;
      if (Math.abs(spinAccum) >= SPIN_THRESHOLD) {
        sendGesture("spin");
        spinAccum = 0;
        spinStart = now;
      }
    }
    lastAlpha = alpha;
  }); // end deviceorientation

  /* ── Speech detection (RMS of waveform) ── */
  if (myStream) {
    (async () => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();

        const source = audioCtx.createMediaStreamSource(myStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        analyser.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        const buf = new Float32Array(analyser.fftSize);
        let speaking = false;

        const checkAudio = () => {
          if (!sensorsActive) return;
          syncMicTrackEnabled();
          analyser.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          const rms = Math.sqrt(sumSq / buf.length);
          latestMicLevel = Math.min(1, rms / 0.12);
          if (rms > 0.05 && !speaking && speechEnabled) {
            speaking = true;
            sendGesture("speech");
            setTimeout(() => { speaking = false; }, 2000);
          }
          requestAnimationFrame(checkAudio);
        };
        checkAudio();
      } catch (e) {
        console.error("Audio detection setup failed:", e);
      }
    })();
  }
}; // end activateSensors

init();