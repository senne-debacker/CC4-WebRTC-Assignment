/*
 * File: public/js/sender.js
 * Role: Phone-side controller logic for sensors, gestures, telemetry, and game/death actions.
 * Notes: Manages permissions, command arming, peer messaging, and save/discard score behavior.
 */
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
const $saveScoreBtn = document.getElementById("saveScoreBtn");
const $saveScoreHint = document.getElementById("saveScoreHint");
const $returnLobbyBtn = document.getElementById("returnLobbyBtn");
const $playAgainBtn = document.getElementById("playAgainBtn");
const $phoneCommandDisplay = document.getElementById("phoneCommandDisplay");
const $phoneCommandPrefix = document.getElementById("phoneCommandPrefix");
const $phoneCommandText = document.getElementById("phoneCommandText");

let socket, myStream, peer;
let sensorsActive = false;
let speechEnabled = false;
let gameStarted = false;
let activeCommandGestures = [];
let commandArmAt = 0;
let telemetryTimer = null;
let latestMicLevel = 0;
let tapCount = 0;
let tapPulseUntil = 0;
let lastTapColor = null;
let latestGyro = { alpha: 0, beta: 0, gamma: 0 };
let latestAccel = { x: 0, y: 0, z: 0 };
let activeDeathToken = null;
let deathScoreSaved = false;
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
  const speechGateActive = activeCommandGestures.includes("speech") && Date.now() >= commandArmAt;
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

const updateSaveButtonState = () => {
  const hasName = !!String($deathNameInput?.value || "").trim();
  if ($saveScoreBtn) $saveScoreBtn.disabled = !hasName || deathScoreSaved;
};

const hideDeathActions = () => {
  if ($deathActions) $deathActions.classList.add("hidden");
  if ($deathScoreValue) $deathScoreValue.textContent = "0";
  if ($deathNameInput) $deathNameInput.value = "";
  if ($saveScoreBtn) {
    $saveScoreBtn.disabled = true;
    $saveScoreBtn.textContent = "Save Score";
  }
  if ($saveScoreHint) {
    $saveScoreHint.classList.remove("saved");
    $saveScoreHint.textContent = "Enter a name, then tap Save Score.";
  }
  deathScoreSaved = false;
  activeDeathToken = null;
  setDeathMode(false);
};

const showDeathActions = (finalScore, deathToken) => {
  if ($deathScoreValue) {
    $deathScoreValue.textContent = String(Number(finalScore) || 0);
  }
  activeDeathToken = deathToken ? String(deathToken) : null;
  deathScoreSaved = false;
  if ($deathNameInput) {
    $deathNameInput.value = loadStoredScoreboardName();
  }
  if ($saveScoreBtn) $saveScoreBtn.textContent = "Save Score";
  if ($saveScoreHint) {
    $saveScoreHint.classList.remove("saved");
    $saveScoreHint.textContent = "Enter a name, then tap Save Score.";
  }
  updateSaveButtonState();
  if ($deathActions) $deathActions.classList.remove("hidden");
  setDeathMode(true);
};

const beginGameFromPhone = () => {
  if (!(peer && peer.connected)) return;
  if (activeDeathToken && !deathScoreSaved) {
    peer.send(JSON.stringify({ type: "discard-score", deathToken: activeDeathToken }));
  }
  gameStarted = true;
  updatePhoneUiByGameState();
  setDeathMode(false);
  if ($deathActions) $deathActions.classList.add("hidden");
  activeCommandGestures = [];
  commandArmAt = 0;
  syncMicTrackEnabled();
  peer.send(JSON.stringify({ type: "start-game" }));
  activeDeathToken = null;
  deathScoreSaved = false;
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
    activeCommandGestures = [];
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
      activeCommandGestures = [];
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

  peer.on("stream", () => {});

  peer.on("data", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === "command") {
      const nextGestures = Array.isArray(msg.gestures) && msg.gestures.length
        ? msg.gestures
        : (msg.gesture ? [msg.gesture] : []);
      activeCommandGestures = nextGestures.map((g) => String(g));
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
      activeCommandGestures = [];
      commandArmAt = 0;
      syncMicTrackEnabled();
      updatePhoneUiByGameState();
      hideDeathActions();
      $stopGameBtn.style.display  = "none";
      $startGameBtn.style.display = "";
    } else if (msg.type === "game-over") {
      gameStarted = false;
      activeCommandGestures = [];
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
    activeCommandGestures = [];
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
    activeCommandGestures = [];
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
    if (deathToken && !deathScoreSaved) {
      peer.send(JSON.stringify({ type: "discard-score", deathToken }));
    }
    gameStarted = false;
    updatePhoneUiByGameState();
    activeCommandGestures = [];
    commandArmAt = 0;
    syncMicTrackEnabled();
    hideDeathActions();
    peer.send(JSON.stringify({ type: "return-lobby", deathToken }));
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
    updateSaveButtonState();
  });
}

if ($saveScoreBtn) {
  $saveScoreBtn.addEventListener("click", () => {
    if (!(peer && peer.connected) || !activeDeathToken) return;
    const playerName = String($deathNameInput?.value || "").trim();
    if (!playerName) {
      updateSaveButtonState();
      return;
    }
    const normalized = normalizePlayerName(playerName);
    storeScoreboardName(normalized);
    peer.send(JSON.stringify({
      type: "save-score",
      deathToken: activeDeathToken,
      name: normalized,
    }));
    deathScoreSaved = true;
    if ($saveScoreBtn) {
      $saveScoreBtn.disabled = true;
      $saveScoreBtn.textContent = "Saved";
    }
    if ($saveScoreHint) {
      $saveScoreHint.classList.add("saved");
      $saveScoreHint.textContent = "Score saved to leaderboard.";
    }
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

  
  let lastGestureTime = 0;
  const COOLDOWN = 1500;

  const sendGesture = (gesture) => {
    const now = Date.now();
    if (!activeCommandGestures.includes(gesture) || now < commandArmAt) return;
    if (now - lastGestureTime < COOLDOWN) return;
    lastGestureTime = now;
    if (peer && peer.connected) {
      peer.send(JSON.stringify({ type: "gesture", gesture }));
    }
  };

  
  let shakeReversals = 0;
  let shakeWindowStart = 0;
  let shakeLastSign = 0;
  const SHAKE_THRESH = 4;
  const SHAKE_REVERSALS_NEEDED = 4;
  const SHAKE_WINDOW = 1200;

  
  let verticalPhase = "idle";
  let verticalStart = 0;
  const VERTICAL_TIMEOUT = 1500;
  const VERT_HIGH = 16;  
  const VERT_LOW  = 6;   

  
  let spinAccum = 0;
  let lastAlpha = null;
  let spinStart = 0;
  const SPIN_WINDOW = 3000;
  const SPIN_THRESHOLD = 350;

  
  const MOVE_TRIGGER = 2;
  const MOVE_RELEASE = 0.8;
  const MOVE_HOLD_MS = 0;
  let leftHoldStart = 0;
  let rightHoldStart = 0;
  let leftReady = true;
  let rightReady = true;

  
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

    const commandArmed = activeCommandGestures.length > 0 && Date.now() >= commandArmAt;
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

    
    const linAccel = event.acceleration;
    if (linAccel && activeCommandGestures.includes("shake")) {
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

    
    const aig = event.accelerationIncludingGravity;
    if (aig && (activeCommandGestures.includes("jump") || activeCommandGestures.includes("duck"))) {
      const mag = Math.sqrt(
        (aig.x || 0) ** 2 + (aig.y || 0) ** 2 + (aig.z || 0) ** 2
      );
      const now = Date.now();

      if (verticalPhase !== "idle" && now - verticalStart > VERTICAL_TIMEOUT) {
        verticalPhase = "idle";
      }

      switch (verticalPhase) {
        case "idle":
          if (activeCommandGestures.includes("jump") && mag > VERT_HIGH) {
            verticalPhase = "jump-push";
            verticalStart = now;
          } else if (activeCommandGestures.includes("duck") && mag > VERT_HIGH) {
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

    
    if (activeCommandGestures.includes("left") || activeCommandGestures.includes("right")) {
      const now = Date.now();
      const lin = event.acceleration;
      const grav = event.accelerationIncludingGravity;
      const ax = Number(
        lin && lin.x != null
          ? lin.x
          : (grav && grav.x != null ? grav.x : 0)
      );

      if (activeCommandGestures.includes("left")) {
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

      if (activeCommandGestures.includes("right")) {
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
  }); 

  
  window.addEventListener("deviceorientation", (event) => {
    if (!sensorsActive || !(peer && peer.connected)) return;

    latestGyro = {
      alpha: Number(event.alpha || 0),
      beta:  Number(event.beta  || 0),
      gamma: Number(event.gamma || 0),
    };

    const commandArmed = activeCommandGestures.length > 0 && Date.now() >= commandArmAt;
    if (!commandArmed) {
      spinAccum = 0;
      spinStart = Date.now();
      lastAlpha = null;
      return;
    }

    if (!activeCommandGestures.includes("spin")) {
      spinAccum = 0;
      spinStart = Date.now();
      lastAlpha = null;
      return;
    }

    
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
  }); 

  
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
}; 

init();