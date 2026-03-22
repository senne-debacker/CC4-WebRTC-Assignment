          /*
           * File: public/js/receiver.js
           * Role: Host-side gameplay controller for signaling, state transitions, command timing, scoring, and leaderboards.
           * Notes: Handles lobby/game/death flows, telemetry rendering, and socket/peer message orchestration.
           */
            const $connectionStatusIcon = document.getElementById("connectionStatusIcon");
      const $lobbyScreen    = document.getElementById("lobbyScreen");
      const $gameScreen     = document.getElementById("gameScreen");
      const $deathScreen    = document.getElementById("deathScreen");
      const $commandPrefix  = document.getElementById("commandPrefix");
      const $commandAction  = document.getElementById("commandAction");
      const $feedbackDisplay = document.getElementById("feedbackDisplay");
      const $gameScore      = document.getElementById("gameScore");
      const $gameRound      = document.getElementById("gameRound");
      const $gameLives      = document.getElementById("gameLives");
      const $commandTimer   = document.getElementById("commandTimer");
      const $commandTimerFill = document.getElementById("commandTimerFill");
      const $startCountdown = document.getElementById("startCountdown");
      const $deathFinalScore = document.getElementById("deathFinalScore");
      const $deathScoreboard = document.getElementById("deathScoreboard");
      const $lobbyScoreboard = document.getElementById("lobbyScoreboard");
      const $qrcode         = document.getElementById("qrcode");
      const $urlDisplay     = document.getElementById("urlDisplay");
      const $lobbyConnect   = document.querySelector(".lobby-connect");
      const $qrSection      = document.getElementById("qrSection");
      const $telemetryPanel = document.getElementById("telemetryPanel");
      const $instructionsDefault = document.getElementById("instructionsDefault");
      const $instructionsConnected = document.getElementById("instructionsConnected");
      const $telemetryMicFill = document.getElementById("telemetryMicFill");
      const $telemetryMicValue = document.getElementById("telemetryMicValue");
      const $telemetryTapCard = document.getElementById("telemetryTapCard");
      const $telemetryTapDot = document.getElementById("telemetryTapDot");
      const $telemetryTapStatus = document.getElementById("telemetryTapStatus");
      const $telemetryTapCount = document.getElementById("telemetryTapCount");
      const $enableMusicToggle = document.getElementById("enableMusicToggle");
      const $musicToggleLabel = document.getElementById("musicToggleLabel");
      const $gyroAlphaMarker = document.getElementById("gyroAlphaMarker");
      const $gyroBetaMarker = document.getElementById("gyroBetaMarker");
      const $gyroGammaMarker = document.getElementById("gyroGammaMarker");
      const $gyroAlphaValue = document.getElementById("gyroAlphaValue");
      const $gyroBetaValue = document.getElementById("gyroBetaValue");
      const $gyroGammaValue = document.getElementById("gyroGammaValue");
      const $accelXMarker = document.getElementById("accelXMarker");
      const $accelYMarker = document.getElementById("accelYMarker");
      const $accelZMarker = document.getElementById("accelZMarker");
      const $accelXValue = document.getElementById("accelXValue");
      const $accelYValue = document.getElementById("accelYValue");
      const $accelZValue = document.getElementById("accelZValue");

      let socket, peer;
      let controllerActive = false;

      
      const COMMANDS = [
        { text: "Press the green button!", gesture: "tap-green" },
        { text: "Press the red button!", gesture: "tap-red" },
        { text: "Press the yellow button!", gesture: "tap-yellow" },
        { text: "Press the blue button!", gesture: "tap-blue" },
        { text: "Jump!", gesture: "jump" },
        { text: "Duck!", gesture: "duck" },
        { text: "Move left!", gesture: "left" },
        { text: "Move right!", gesture: "right" },
        { text: "Do a 360!", gesture: "spin" },
        { text: "Shake your phone!", gesture: "shake" },
        { text: "Say something!", gesture: "speech" },
      ];
      const COLOR_COMMANDS = COMMANDS.filter((c) => c.gesture.startsWith("tap-"));
      const MOVEMENT_COMMANDS = COMMANDS.filter((c) => [
        "jump", "duck", "left", "right", "spin", "shake"
      ].includes(c.gesture));
      const HARD_MODE_SCORE = 15;
      const SIMON_SAYS_CHANCE = 0.65;
      const MAX_NO_SIMON_STREAK = 2;

      let gameActive = false;
      let commandTimer = null;
      let roundTimer = null;
      let introTimers = [];
      let commandTimerDangerTimeout = null;
      let score = 0;
      let lives = 3;
      let round = 0;
      let currentCommand = null;
      let simonSays = false;
      let noSimonStreak = 0;
      let roundResolved = false;
      let performedGestures = new Set();
      let commandBag = [];
      const lobbyMusic = new Audio("/media/simon_says_lobby.mp3");
      lobbyMusic.loop = true;
      lobbyMusic.preload = "auto";
      const gameMusic = new Audio("/media/simon_says_ost.mp3");
      gameMusic.loop = true;
      gameMusic.preload = "auto";
      let musicEnabledByUser = false;

      const stopTrack = (track) => {
        track.pause();
        track.currentTime = 0;
      };

      const playTrack = async (track, logPrefix) => {
        try {
          await track.play();
        } catch (e) {
          console.warn(`${logPrefix} could not autoplay:`, e);
        }
      };

      const syncMusicByState = async () => {
        if (!musicEnabledByUser) {
          stopTrack(lobbyMusic);
          stopTrack(gameMusic);
          return;
        }

        if (gameActive) {
          stopTrack(lobbyMusic);
          await playTrack(gameMusic, "Game music");
          return;
        }

        stopTrack(gameMusic);
        await playTrack(lobbyMusic, "Lobby music");
      };

      const setMusicEnabled = async (enabled) => {
        musicEnabledByUser = !!enabled;

        if ($enableMusicToggle) {
          $enableMusicToggle.checked = musicEnabledByUser;
        }

        if ($musicToggleLabel) {
          $musicToggleLabel.textContent = `Music: ${musicEnabledByUser ? "On" : "Off"}`;
        }

        if (!musicEnabledByUser) {
          await syncMusicByState();
          return;
        }

        try {
          await lobbyMusic.play();
          lobbyMusic.pause();
          lobbyMusic.currentTime = 0;
          await gameMusic.play();
          gameMusic.pause();
          gameMusic.currentTime = 0;
        } catch (e) {
          console.warn("Music unlock interaction failed:", e);
        }

        await syncMusicByState();
      };

      const renderLives = () => {
        if (!$gameLives) return;
        const $icons = $gameLives.querySelectorAll(".life-icon");
        $icons.forEach(($icon, idx) => {
          $icon.classList.toggle("lost", idx >= lives);
        });
      };

      const resetStartCountdown = () => {
        if (!$startCountdown) return;
        $startCountdown.classList.add("hidden");
        $startCountdown.classList.remove("all-green");
        $startCountdown.querySelectorAll(".count-dot").forEach(($dot) => {
          $dot.classList.remove("red", "green");
        });
      };

      const clearIntroTimers = () => {
        introTimers.forEach((t) => clearTimeout(t));
        introTimers = [];
      };

      const startIntroAnimation = () => {
        clearIntroTimers();
        resetStartCountdown();
        $commandPrefix.textContent = "";
        $commandPrefix.className = "command-prefix";
        $commandAction.textContent = "Get Ready…";

        if (!$startCountdown) return;
        const $dots = Array.from($startCountdown.querySelectorAll(".count-dot"));

        introTimers.push(setTimeout(() => {
          if (!gameActive) return;
          $commandAction.textContent = "";
          $startCountdown.classList.remove("hidden");
        }, 4000));

        introTimers.push(setTimeout(() => {
          if (!gameActive || !$dots[0]) return;
          $dots[0].classList.add("red");
        }, 4800));

        introTimers.push(setTimeout(() => {
          if (!gameActive || !$dots[1]) return;
          $dots[1].classList.add("red");
        }, 5200));

        introTimers.push(setTimeout(() => {
          if (!gameActive || !$dots[2]) return;
          $dots[2].classList.add("red");
        }, 5600));

        introTimers.push(setTimeout(() => {
          if (!gameActive) return;
          $startCountdown.classList.add("all-green");
          $dots.forEach(($dot) => {
            $dot.classList.remove("red");
            $dot.classList.add("green");
          });
        }, 6000));

        introTimers.push(setTimeout(() => {
          if (!gameActive) return;
          resetStartCountdown();
          nextCommand();
        }, INTRO_TOTAL_MS));
      };

      const INTRO_TOTAL_MS = 6400;

      const BASE_ACTION_MS = 3000;
      const BASE_GAP_MS = 2000;
      const SPEED_STEP_ROUNDS = 4;
      const ACTION_REDUCTION_PER_STEP = 180;
      const GAP_REDUCTION_PER_STEP = 100;
      const MIN_ACTION_MS = 1500;
      const MIN_GAP_MS = 1000;
      const SCOREBOARD_STORAGE_KEY = "simonSaysScoreboardV1";
      const SCOREBOARD_LIMIT = 8;
      let activeDeathToken = null;
      let pendingDeathEntry = null;

      const refillCommandBag = () => {
        commandBag = [...COMMANDS];
        for (let i = commandBag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [commandBag[i], commandBag[j]] = [commandBag[j], commandBag[i]];
        }
      };

      const formatScoreTimestamp = (timestamp) => {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return "Unknown";
        return date.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      };

      const normalizePlayerName = (name) => {
        const cleaned = String(name || "").trim().replace(/\s+/g, " ");
        return cleaned.slice(0, 20) || "Player";
      };

      const loadScoreboard = () => {
        try {
          const raw = localStorage.getItem(SCOREBOARD_STORAGE_KEY);
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return [];
          return parsed
            .map((entry) => ({
              score: Number(entry.score) || 0,
              timestamp: Number(entry.timestamp) || Date.now(),
              name: normalizePlayerName(entry.name),
              token: String(entry.token || ""),
            }))
            .filter((entry) => !!entry.name)
            .slice(0, SCOREBOARD_LIMIT);
        } catch {
          return [];
        }
      };

      const saveScoreboard = (rows) => {
        try {
          localStorage.setItem(SCOREBOARD_STORAGE_KEY, JSON.stringify(rows));
        } catch {
        }
      };

      const recordScore = (finalScore, playerName = "Player", deathToken = `${Date.now()}-${Math.random()}`, timestamp = Date.now()) => {
        const rows = loadScoreboard();
        rows.push({
          score: Number(finalScore) || 0,
          timestamp: Number(timestamp) || Date.now(),
          name: normalizePlayerName(playerName),
          token: String(deathToken),
        });
        rows.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.timestamp - b.timestamp;
        });
        const trimmed = rows.slice(0, SCOREBOARD_LIMIT);
        saveScoreboard(trimmed);
        return trimmed;
      };

      const getDisplayScoreboard = () => {
        const rows = loadScoreboard();
        if (!pendingDeathEntry) return rows;
        const merged = [...rows, pendingDeathEntry];
        merged.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.timestamp - b.timestamp;
        });
        return merged.slice(0, SCOREBOARD_LIMIT);
      };

      const savePendingScore = (deathToken, name) => {
        const token = String(deathToken || "");
        const trimmedName = String(name || "").trim();
        if (!pendingDeathEntry || pendingDeathEntry.token !== token || !trimmedName) {
          return getDisplayScoreboard();
        }
        const savedRows = recordScore(
          pendingDeathEntry.score,
          normalizePlayerName(trimmedName),
          token,
          pendingDeathEntry.timestamp
        );
        pendingDeathEntry = null;
        activeDeathToken = null;
        renderLobbyScoreboard();
        return savedRows;
      };

      const discardPendingScore = (deathToken) => {
        const token = String(deathToken || "");
        if (pendingDeathEntry && pendingDeathEntry.token === token) {
          pendingDeathEntry = null;
          activeDeathToken = null;
        }
        renderLobbyScoreboard();
        return getDisplayScoreboard();
      };

      const renderScoreboard = (rows) => {
        if (!$deathScoreboard) return;
        $deathScoreboard.innerHTML = "";

        if (!rows.length) {
          const $empty = document.createElement("li");
          $empty.className = "death-scoreboard-empty";
          $empty.textContent = "No scores yet";
          $deathScoreboard.appendChild($empty);
          return;
        }

        rows.forEach((row, idx) => {
          const $li = document.createElement("li");
          $li.className = "death-score-row";

          const $rank = document.createElement("span");
          $rank.className = "death-score-rank";
          $rank.textContent = `#${idx + 1}`;

          const $meta = document.createElement("span");
          $meta.className = "death-score-meta";
          const label = row.pending
            ? "UNSAVED"
            : normalizePlayerName(row.name);
          $meta.textContent = `${label} • ${formatScoreTimestamp(row.timestamp)}`;

          const $value = document.createElement("span");
          $value.className = "death-score-value";
          $value.textContent = String(row.score);

          $li.appendChild($rank);
          $li.appendChild($meta);
          $li.appendChild($value);
          $deathScoreboard.appendChild($li);
        });
      };

      const renderLobbyScoreboard = () => {
        if (!$lobbyScoreboard) return;
        const rows = loadScoreboard();
        $lobbyScoreboard.innerHTML = "";

        if (!rows.length) {
          const $empty = document.createElement("li");
          $empty.className = "death-scoreboard-empty";
          $empty.textContent = "No saved scores yet";
          $lobbyScoreboard.appendChild($empty);
          return;
        }

        rows.forEach((row, idx) => {
          const $li = document.createElement("li");
          $li.className = "lobby-score-row";

          const $rank = document.createElement("span");
          $rank.className = "lobby-score-rank";
          $rank.textContent = `#${idx + 1}`;

          const $meta = document.createElement("span");
          $meta.className = "lobby-score-meta";
          $meta.textContent = `${normalizePlayerName(row.name)} • ${formatScoreTimestamp(row.timestamp)}`;

          const $value = document.createElement("span");
          $value.className = "lobby-score-value";
          $value.textContent = String(row.score);

          $li.appendChild($rank);
          $li.appendChild($meta);
          $li.appendChild($value);
          $lobbyScoreboard.appendChild($li);
        });
      };

      const showLobbyScreen = () => {
        pendingDeathEntry = null;
        activeDeathToken = null;
        if ($deathScreen) {
          $deathScreen.classList.remove("active");
          $deathScreen.classList.add("hidden");
        }
        $gameScreen.classList.remove("active");
        $lobbyScreen.classList.remove("hidden");
        renderLobbyScoreboard();
      };

      const showDeathScreen = (finalScore) => {
        const safeScore = Number(finalScore) || 0;
        activeDeathToken = `${Date.now()}-${Math.random()}`;
        pendingDeathEntry = {
          score: safeScore,
          timestamp: Date.now(),
          name: "",
          token: activeDeathToken,
          pending: true,
        };
        const scores = getDisplayScoreboard();
        if ($deathFinalScore) $deathFinalScore.textContent = String(safeScore);
        renderScoreboard(scores);
        $gameScreen.classList.remove("active");
        $lobbyScreen.classList.add("hidden");
        if ($deathScreen) {
          $deathScreen.classList.remove("hidden");
          $deathScreen.classList.add("active");
        }
        return scores;
      };

      
      const generateQR = async () => {
        try {
          const res  = await fetch("/api/ip");
          const data = await res.json();
          const url  = `${data.url}/sender.html`;
          document.getElementById("urlDisplay").textContent = url;
          new QRCode(document.getElementById("qrcode"), {
            text: url, width: 200, height: 200,
            colorDark: "#1a1a2e", colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H,
          });
        } catch (e) {
          console.error("Could not generate QR code:", e);
          document.getElementById("urlDisplay").textContent =
            window.location.origin + "/sender.html";
        }
      };

      const init = () => {
        renderLobbyScoreboard();
        showLobbyScreen();
        generateQR();
        initSocket();
      };
      const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

      const setAxisMarker = ($marker, rawValue, maxAbs) => {
        if (!$marker) return;
        const value = Number(rawValue) || 0;
        const pct = ((clamp(value, -maxAbs, maxAbs) + maxAbs) / (maxAbs * 2)) * 100;
        $marker.style.left = `${pct.toFixed(1)}%`;
      };

      const resetTelemetry = () => {
        if ($telemetryMicFill) $telemetryMicFill.style.width = "0%";
        if ($telemetryMicValue) $telemetryMicValue.textContent = "0%";
        if ($telemetryTapDot) $telemetryTapDot.classList.remove("active");
        if ($telemetryTapStatus) $telemetryTapStatus.textContent = "Idle";
        if ($telemetryTapCount) $telemetryTapCount.textContent = "Count: 0";

        setAxisMarker($gyroAlphaMarker, 0, 180);
        setAxisMarker($gyroBetaMarker, 0, 180);
        setAxisMarker($gyroGammaMarker, 0, 180);
        if ($gyroAlphaValue) $gyroAlphaValue.textContent = "0.0°";
        if ($gyroBetaValue) $gyroBetaValue.textContent = "0.0°";
        if ($gyroGammaValue) $gyroGammaValue.textContent = "0.0°";

        setAxisMarker($accelXMarker, 0, 20);
        setAxisMarker($accelYMarker, 0, 20);
        setAxisMarker($accelZMarker, 0, 20);
        if ($accelXValue) $accelXValue.textContent = "0.00";
        if ($accelYValue) $accelYValue.textContent = "0.00";
        if ($accelZValue) $accelZValue.textContent = "0.00";
      };

      const updateTelemetry = (payload) => {
        const mic = clamp(Number(payload.mic) || 0, 0, 1);
        const micPct = Math.round(mic * 100);
        if ($telemetryMicFill) $telemetryMicFill.style.width = `${micPct}%`;
        if ($telemetryMicValue) $telemetryMicValue.textContent = `${micPct}%`;

        const tap = payload.tap || {};
        if ($telemetryTapDot) $telemetryTapDot.classList.toggle("active", !!tap.active);
        if ($telemetryTapStatus) $telemetryTapStatus.textContent = tap.active ? "Tap!" : "Idle";
        const lastColor = tap.color ? String(tap.color).toUpperCase() : "-";
        if ($telemetryTapCount) {
          $telemetryTapCount.textContent = `Count: ${Number(tap.count) || 0} • Last: ${lastColor}`;
        }

        const gyro = payload.gyro || {};
        const alpha = Number(gyro.alpha) || 0;
        const beta = Number(gyro.beta) || 0;
        const gamma = Number(gyro.gamma) || 0;
        setAxisMarker($gyroAlphaMarker, alpha, 180);
        setAxisMarker($gyroBetaMarker, beta, 180);
        setAxisMarker($gyroGammaMarker, gamma, 180);
        if ($gyroAlphaValue) $gyroAlphaValue.textContent = `${alpha.toFixed(1)}°`;
        if ($gyroBetaValue) $gyroBetaValue.textContent = `${beta.toFixed(1)}°`;
        if ($gyroGammaValue) $gyroGammaValue.textContent = `${gamma.toFixed(1)}°`;

        const accel = payload.accel || {};
        const x = Number(accel.x) || 0;
        const y = Number(accel.y) || 0;
        const z = Number(accel.z) || 0;
        setAxisMarker($accelXMarker, x, 20);
        setAxisMarker($accelYMarker, y, 20);
        setAxisMarker($accelZMarker, z, 20);
        if ($accelXValue) $accelXValue.textContent = x.toFixed(2);
        if ($accelYValue) $accelYValue.textContent = y.toFixed(2);
        if ($accelZValue) $accelZValue.textContent = z.toFixed(2);
      };

      const setControllerActive = (active) => {
        controllerActive = !!active;
        if (!controllerActive) resetTelemetry();
        updateLobbyByConnectionState($connectionStatusIcon?.classList.contains("connected") ? "connected" : "connecting");
      };
      const updateLobbyByConnectionState = (state) => {
        const connected = state === "connected";
        const showTelemetry = connected && controllerActive;
        const showQr = !showTelemetry;

        if ($lobbyConnect) $lobbyConnect.classList.remove("hidden");
        if ($qrSection) $qrSection.classList.toggle("hidden", !showQr);
        if ($telemetryPanel) $telemetryPanel.classList.toggle("hidden", !showTelemetry);

        if ($qrcode) $qrcode.classList.toggle("hidden", !showQr);
        if ($urlDisplay) $urlDisplay.classList.toggle("hidden", !showQr);

        if ($instructionsDefault) $instructionsDefault.classList.toggle("hidden", connected);
        if ($instructionsConnected) $instructionsConnected.classList.toggle("hidden", !connected);
      };

      const setConnectionState = (state) => {
        if (!$connectionStatusIcon) return;
        $connectionStatusIcon.className = `connection-status-icon ${state}`;
        const labels = {
          disconnected: "Not connected",
          connecting: "Connecting",
          connected: "Connected"
        };
        $connectionStatusIcon.setAttribute("aria-label", labels[state] || "Connection status");
        updateLobbyByConnectionState(state);
      };

      
      const initSocket = () => {
        socket = io.connect("/");

        socket.on("connect", () => {
          setConnectionState("connecting");
        });

        socket.on("disconnect", () => {
          setControllerActive(false);
          showLobbyScreen();
          setConnectionState("disconnected");
        });

        socket.on("client-disconnect", (client) => {
          if (peer && peer.data && peer.data.id === client.id) {
            peer.destroy();
            peer = null;
            if (gameActive) stopGame();
            showLobbyScreen();
            setControllerActive(false);
            setConnectionState("disconnected");
          }
        });

        socket.on("signal", (myId, signal, peerId) => {
          if (peer) {
            peer.signal(signal);
          } else if (signal.type === "offer") {
            setConnectionState("connecting");
            createPeer(false, peerId);
            peer.signal(signal);
          }
        });
      };

      const createPeer = (initiator, peerId) => {
        if (peer) { peer.destroy(); }
        peer = new SimplePeer({ initiator });
        peer.data = { id: peerId };

        peer.on("signal", (data) => socket.emit("signal", peerId, data));

        peer.on("connect", () => {
          setConnectionState("connected");
        });
        peer.on("data", (raw) => {
          const msg = JSON.parse(raw);
          handlePeerMessage(msg);
        });

        peer.on("close", () => {
          peer.destroy();
          peer = null;
          if (gameActive) stopGame();
          setControllerActive(false);
          setConnectionState("disconnected");
        });

        peer.on("error", (err) => console.error("Peer error:", err));
      };

      
      const handlePeerMessage = (msg) => {
        if (msg.type === "button") {
          if (gameActive) handleGameAction(`tap-${msg.color || "unknown"}`);
        } else if (msg.type === "gesture") {
          if (gameActive) handleGameAction(msg.gesture);
        } else if (msg.type === "controller-state") {
          setControllerActive(!!msg.active);
        } else if (msg.type === "telemetry") {
          setControllerActive(true);
          updateTelemetry(msg);
        } else if (msg.type === "start-game") {
          if (!gameActive) startGame();
        } else if (msg.type === "stop-game") {
          if (gameActive) stopGame();
        } else if (msg.type === "return-lobby") {
          if (msg.deathToken) {
            const rows = discardPendingScore(msg.deathToken);
            if ($deathScreen && $deathScreen.classList.contains("active")) {
              renderScoreboard(rows);
            }
          }
          if (gameActive) {
            stopGame("lobby");
          } else {
            showLobbyScreen();
            if (peer && peer.connected) {
              peer.send(JSON.stringify({ type: "game-ended" }));
            }
          }
        } else if (msg.type === "save-score") {
          const rows = savePendingScore(msg.deathToken, msg.name);
          if ($deathScreen && $deathScreen.classList.contains("active")) {
            renderScoreboard(rows);
          }
        } else if (msg.type === "discard-score") {
          const rows = discardPendingScore(msg.deathToken);
          if ($deathScreen && $deathScreen.classList.contains("active")) {
            renderScoreboard(rows);
          }
        }
      };

      
      const startGame = () => {
        gameActive = true;
        score = 0;
        lives = 3;
        round = 0;
        noSimonStreak = 0;
        refillCommandBag();
        if ($deathScreen) {
          $deathScreen.classList.remove("active");
          $deathScreen.classList.add("hidden");
        }
        $lobbyScreen.classList.add("hidden");
        $gameScreen.classList.add("active");
        $feedbackDisplay.textContent = "";
        $feedbackDisplay.className = "feedback-display";
        $gameScore.textContent = "Score: 0";
        $gameRound.textContent = "";
        hideCommandTimerBar();
        resetCommandTimerBar();
        renderLives();
        syncMusicByState();
        startIntroAnimation();
      };

      const showCommandTimerBar = () => {
        if ($commandTimer) $commandTimer.classList.add("active");
      };

      const hideCommandTimerBar = () => {
        if ($commandTimer) $commandTimer.classList.remove("active");
      };

      const resetCommandTimerBar = () => {
        if (commandTimerDangerTimeout) {
          clearTimeout(commandTimerDangerTimeout);
          commandTimerDangerTimeout = null;
        }
        if (!$commandTimerFill) return;
        $commandTimerFill.style.transition = "none";
        $commandTimerFill.style.transform = "scaleX(1)";
        $commandTimerFill.classList.remove("danger");
      };

      const startCommandTimerBar = (durationMs) => {
        if (!$commandTimerFill || !durationMs || durationMs <= 0) return;
        resetCommandTimerBar();
        void $commandTimerFill.offsetWidth;
        $commandTimerFill.style.transition = `transform ${durationMs}ms linear`;
        $commandTimerFill.style.transform = "scaleX(0)";
        commandTimerDangerTimeout = setTimeout(() => {
          if ($commandTimerFill) $commandTimerFill.classList.add("danger");
        }, Math.floor(durationMs * 0.75));
      };

      const nextCommand = () => {
        round++;
        roundResolved = false;
        performedGestures.clear();

        const speedStep = Math.floor((round - 1) / SPEED_STEP_ROUNDS);
        const actionMs = Math.max(MIN_ACTION_MS, BASE_ACTION_MS - (speedStep * ACTION_REDUCTION_PER_STEP));
        const gapMs = Math.max(MIN_GAP_MS, BASE_GAP_MS - (speedStep * GAP_REDUCTION_PER_STEP));

        if (commandBag.length === 0) refillCommandBag();
        const cmd = commandBag.pop();
        if (noSimonStreak >= MAX_NO_SIMON_STREAK) {
          simonSays = true;
        } else {
          simonSays = Math.random() < SIMON_SAYS_CHANCE;
        }
        noSimonStreak = simonSays ? 0 : noSimonStreak + 1;
        const hardMode = score >= HARD_MODE_SCORE;
        if (hardMode) {
          const colorCmd = COLOR_COMMANDS[Math.floor(Math.random() * COLOR_COMMANDS.length)];
          const movementCmd = MOVEMENT_COMMANDS[Math.floor(Math.random() * MOVEMENT_COMMANDS.length)];
          currentCommand = {
            text: `${colorCmd.text} + ${movementCmd.text}`,
            gestures: [colorCmd.gesture, movementCmd.gesture],
          };
        } else {
          currentCommand = {
            text: cmd.text,
            gestures: [cmd.gesture],
          };
        }

        if (peer && peer.connected) {
          peer.send(JSON.stringify({
            type: "command",
            gesture: currentCommand.gestures[0],
            gestures: currentCommand.gestures,
            text: currentCommand.text,
            simon: simonSays,
          }));
        }

        $commandPrefix.textContent = simonSays ? "Simon says…" : "";
        $commandPrefix.className = simonSays
          ? "command-prefix simon" : "command-prefix";
        $commandAction.textContent = currentCommand.text;
        $gameRound.textContent = `Round ${round} • Speed ${speedStep + 1}`;
        $gameScore.textContent = `Score: ${score}`;
        $feedbackDisplay.textContent = "";
        $feedbackDisplay.className = "feedback-display";
        showCommandTimerBar();
        startCommandTimerBar(actionMs);

        roundTimer = setTimeout(() => {
          if (!gameActive) return;
          if (simonSays && !roundResolved) {
            loseLife("Too slow! 😴");
          } else if (!simonSays && !roundResolved) {
            score++;
            showFeedback("Correct! You resisted! +1 ✓", "correct");
          }
          $gameScore.textContent = `Score: ${score}`;
          if (!gameActive) return;
          commandTimer = setTimeout(nextCommand, gapMs);
        }, actionMs);
      };

      const loseLife = (message) => {
        lives = Math.max(0, lives - 1);
        renderLives();
        showFeedback(`${message}  Lives left: ${lives}`, "wrong");
        if (lives <= 0) {
          showFeedback("Game Over", "wrong");
          setTimeout(() => {
            if (gameActive) stopGame("death");
          }, 1200);
        }
      };

      const handleGameAction = (gesture) => {
        if (!gameActive || !currentCommand || roundResolved) return;
        const requiredGestures = Array.isArray(currentCommand.gestures)
          ? currentCommand.gestures
          : [currentCommand.gesture];

        const performed = (COMMANDS.find(c => c.gesture === gesture) || { text: gesture }).text;

        if (!requiredGestures.includes(gesture)) {
          roundResolved = true;
          loseLife(`You did ${performed}, that's wrong!`);
          $gameScore.textContent = `Score: ${score}`;
          return;
        }

        if (performedGestures.has(gesture)) return;

        if (!simonSays) {
          roundResolved = true;
          score = Math.max(0, score - 1);
          loseLife("Simon didn't say! ✗");
        } else {
          performedGestures.add(gesture);
          const remaining = requiredGestures.filter((g) => !performedGestures.has(g));
          if (remaining.length === 0) {
            roundResolved = true;
            score++;
            showFeedback(requiredGestures.length > 1 ? "Perfect combo! +1 ✓" : "Correct! +1 ✓", "correct");
          } else {
            showFeedback("Good! Do the second action!", "correct");
          }
        }
        $gameScore.textContent = `Score: ${score}`;
      };

      const showFeedback = (text, type) => {
        $feedbackDisplay.textContent = text;
        $feedbackDisplay.className = `feedback-display ${type}`;
      };

      const stopGame = (endMode = "lobby") => {
        gameActive = false;
        clearTimeout(commandTimer);
        clearTimeout(roundTimer);
        clearIntroTimers();
        resetStartCountdown();
        hideCommandTimerBar();
        resetCommandTimerBar();

        if (peer && peer.connected) {
          peer.send(JSON.stringify({
            type: "command",
            gesture: null,
            gestures: [],
            text: null,
            simon: false,
          }));
        }

        if (endMode === "death") {
          let scores = [];
          scores = showDeathScreen(score);
          if (peer && peer.connected) {
            peer.send(JSON.stringify({
              type: "game-over",
              finalScore: score,
              scoreboard: scores,
              deathToken: activeDeathToken,
            }));
          }
          syncMusicByState();
          return;
        }

        if (peer && peer.connected) {
          peer.send(JSON.stringify({ type: "game-ended" }));
        }

        syncMusicByState();
        showLobbyScreen();
      };
      if ($enableMusicToggle) {
        $enableMusicToggle.addEventListener("change", (e) => {
          setMusicEnabled(!!e.target.checked);
        });
      }

      resetTelemetry();
      setMusicEnabled(false);

      init();
