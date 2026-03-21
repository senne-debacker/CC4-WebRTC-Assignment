      /* ── DOM refs ── */
      const $otherCamera    = document.getElementById("otherCamera");
      const $connectionStatusIcon = document.getElementById("connectionStatusIcon");
      const $lobbyScreen    = document.getElementById("lobbyScreen");
      const $gameScreen     = document.getElementById("gameScreen");
      const $commandPrefix  = document.getElementById("commandPrefix");
      const $commandAction  = document.getElementById("commandAction");
      const $feedbackDisplay = document.getElementById("feedbackDisplay");
      const $gameScore      = document.getElementById("gameScore");
      const $gameRound      = document.getElementById("gameRound");
      const $pipCamera      = document.getElementById("pipCamera");
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

      /* ── Game State ── */
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

      let gameActive = false;
      let commandTimer = null;
      let roundTimer = null;
      let score = 0;
      let lives = 3;
      let round = 0;
      let currentCommand = null;
      let simonSays = false;
      let actionPerformed = false;
      let commandBag = [];

      const BASE_ACTION_MS = 3000;
      const BASE_GAP_MS = 2000;
      const SPEED_STEP_ROUNDS = 3;
      const ACTION_REDUCTION_PER_STEP = 250;
      const GAP_REDUCTION_PER_STEP = 150;
      const MIN_ACTION_MS = 1400;
      const MIN_GAP_MS = 900;

      const refillCommandBag = () => {
        // Fisher-Yates shuffle so every command appears once before repeats.
        commandBag = [...COMMANDS];
        for (let i = commandBag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [commandBag[i], commandBag[j]] = [commandBag[j], commandBag[i]];
        }
      };

      /* ── QR Code ── */
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
        generateQR();
        initSocket();
      };

      const setVideoStream = ($el, stream) => {
        if ($el) $el.srcObject = stream;
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

      const clearVideoStream = ($el) => {
        if ($el) $el.srcObject = null;
      };

      const updateLobbyByConnectionState = (state) => {
        const connected = state === "connected";
        const showTelemetry = connected && controllerActive;
        const showQr = !showTelemetry;

        if ($lobbyConnect) $lobbyConnect.classList.remove("hidden");
        if ($qrSection) $qrSection.classList.toggle("hidden", !showQr);
        if ($telemetryPanel) $telemetryPanel.classList.toggle("hidden", !showTelemetry);

        // Keep QR/url fallback toggles in sync for safety.
        if ($qrcode) $qrcode.classList.toggle("hidden", !showQr);
        if ($urlDisplay) $urlDisplay.classList.toggle("hidden", !showQr);

        // Swap instruction content.
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

      /* ── Socket.io ── */
      const initSocket = () => {
        socket = io.connect("/");

        socket.on("connect", () => {
          setConnectionState("connecting");
        });

        socket.on("disconnect", () => {
          setControllerActive(false);
          setConnectionState("disconnected");
        });

        socket.on("client-disconnect", (client) => {
          if (peer && peer.data && peer.data.id === client.id) {
            peer.destroy();
            peer = null;
            clearVideoStream($otherCamera);
            clearVideoStream($pipCamera);
            if (gameActive) stopGame();
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

        peer.on("stream", (stream) => {
          setVideoStream($otherCamera, stream);
          setVideoStream($pipCamera, stream);
        });

        peer.on("data", (raw) => {
          const msg = JSON.parse(raw);
          handlePeerMessage(msg);
        });

        peer.on("close", () => {
          peer.destroy();
          peer = null;
          clearVideoStream($otherCamera);
          clearVideoStream($pipCamera);
          if (gameActive) stopGame();
          setControllerActive(false);
          setConnectionState("disconnected");
        });

        peer.on("error", (err) => console.error("Peer error:", err));
      };

      /* ── Message handling ── */
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
        }
      };

      /* ── Game Logic ── */
      const startGame = () => {
        gameActive = true;
        score = 0;
        lives = 3;
        round = 0;
        refillCommandBag();
        $lobbyScreen.classList.add("hidden");
        $gameScreen.classList.add("active");
        $commandAction.textContent = "Get Ready…";
        $commandPrefix.textContent = "";
        $feedbackDisplay.textContent = "";
        $feedbackDisplay.className = "feedback-display";
        $gameScore.textContent = "Score: 0 | Lives: 3";
        $gameRound.textContent = "";

        commandTimer = setTimeout(nextCommand, 2000);
      };

      const nextCommand = () => {
        round++;
        actionPerformed = false;

        const speedStep = Math.floor((round - 1) / SPEED_STEP_ROUNDS);
        const actionMs = Math.max(MIN_ACTION_MS, BASE_ACTION_MS - (speedStep * ACTION_REDUCTION_PER_STEP));
        const gapMs = Math.max(MIN_GAP_MS, BASE_GAP_MS - (speedStep * GAP_REDUCTION_PER_STEP));

        if (commandBag.length === 0) refillCommandBag();
        const cmd = commandBag.pop();
        simonSays = Math.random() >= 0.5;
        currentCommand = cmd;

        // Tell the phone which gesture is expected so it can gate speech detection
        if (peer && peer.connected) {
          peer.send(JSON.stringify({
            type: "command",
            gesture: cmd.gesture,
            text: cmd.text,
            simon: simonSays,
          }));
        }

        $commandPrefix.textContent = simonSays ? "Simon says…" : "";
        $commandPrefix.className = simonSays
          ? "command-prefix simon" : "command-prefix";
        $commandAction.textContent = cmd.text;
        $gameRound.textContent = `Round ${round} • Speed ${speedStep + 1}`;
        $gameScore.textContent = `Score: ${score} | Lives: ${lives}`;
        $feedbackDisplay.textContent = "";
        $feedbackDisplay.className = "feedback-display";

        roundTimer = setTimeout(() => {
          if (!gameActive) return;
          if (simonSays && !actionPerformed) {
            loseLife("Too slow! 😴");
          } else if (!simonSays && !actionPerformed) {
            score++;
            showFeedback("Correct! You resisted! +1 ✓", "correct");
          }
          $gameScore.textContent = `Score: ${score} | Lives: ${lives}`;
          if (!gameActive) return;
          commandTimer = setTimeout(nextCommand, gapMs);
        }, actionMs);
      };

      const loseLife = (message) => {
        lives = Math.max(0, lives - 1);
        showFeedback(`${message}  Lives left: ${lives}`, "wrong");
        if (lives <= 0) {
          showFeedback("Game Over ☠️", "wrong");
          setTimeout(() => {
            if (gameActive) stopGame();
          }, 1200);
        }
      };

      const handleGameAction = (gesture) => {
        if (!gameActive || !currentCommand || actionPerformed) return;
        actionPerformed = true;

        // resolve human-friendly label for the performed gesture
        const performed = (COMMANDS.find(c => c.gesture === gesture) || { text: gesture }).text;

        if (gesture === currentCommand.gesture) {
          if (simonSays) {
            score++;
            showFeedback("Correct! +1 ✓", "correct");
          } else {
            score = Math.max(0, score - 1);
            loseLife("Simon didn't say! ✗");
          }
        } else {
          loseLife(`You did ${performed}, that's wrong!`);
        }
        $gameScore.textContent = `Score: ${score} | Lives: ${lives}`;
      };

      const showFeedback = (text, type) => {
        $feedbackDisplay.textContent = text;
        $feedbackDisplay.className = `feedback-display ${type}`;
      };

      const stopGame = () => {
        gameActive = false;
        clearTimeout(commandTimer);
        clearTimeout(roundTimer);
        // Reset the phone's speech gate
        if (peer && peer.connected) {
          peer.send(JSON.stringify({
            type: "command",
            gesture: null,
            text: null,
            simon: false,
          }));
        }
        $lobbyScreen.classList.remove("hidden");
        $gameScreen.classList.remove("active");
      };

      if ($otherCamera) $otherCamera.addEventListener("click", () => $otherCamera.play());
      if ($pipCamera) $pipCamera.addEventListener("click", () => $pipCamera.play());

      resetTelemetry();

      init();
