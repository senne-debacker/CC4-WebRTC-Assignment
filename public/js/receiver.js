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
      const $instructionsDefault = document.getElementById("instructionsDefault");
      const $instructionsConnected = document.getElementById("instructionsConnected");

      let socket, peer;

      /* ── Game State ── */
      const COMMANDS = [
        { text: "Touch the screen!", gesture: "tap" },
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

      const clearVideoStream = ($el) => {
        if ($el) $el.srcObject = null;
      };

      const updateLobbyByConnectionState = (state) => {
        const connected = state === "connected";

        // Hide full connection panel while connected; show it otherwise.
        if ($lobbyConnect) $lobbyConnect.classList.toggle("hidden", connected);

        // Keep QR/url fallback toggles in sync for safety.
        if ($qrcode) $qrcode.classList.toggle("hidden", connected);
        if ($urlDisplay) $urlDisplay.classList.toggle("hidden", connected);

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
          setConnectionState("disconnected");
        });

        socket.on("client-disconnect", (client) => {
          if (peer && peer.data && peer.data.id === client.id) {
            peer.destroy();
            peer = null;
            clearVideoStream($otherCamera);
            clearVideoStream($pipCamera);
            if (gameActive) stopGame();
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
          setConnectionState("disconnected");
        });

        peer.on("error", (err) => console.error("Peer error:", err));
      };

      /* ── Message handling ── */
      const handlePeerMessage = (msg) => {
        if (msg.type === "button") {
          if (gameActive) handleGameAction("tap");
        } else if (msg.type === "gesture") {
          if (gameActive) handleGameAction(msg.gesture);
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
          peer.send(JSON.stringify({ type: "command", gesture: cmd.gesture }));
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
          peer.send(JSON.stringify({ type: "command", gesture: null }));
        }
        $lobbyScreen.classList.remove("hidden");
        $gameScreen.classList.remove("active");
      };

      if ($otherCamera) $otherCamera.addEventListener("click", () => $otherCamera.play());
      if ($pipCamera) $pipCamera.addEventListener("click", () => $pipCamera.play());

      init();
