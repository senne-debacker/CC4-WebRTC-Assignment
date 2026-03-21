/* Receiver client script extracted from inline module in receiver.html */
/* ── DOM refs ── */
const $otherCamera    = document.getElementById("otherCamera");
const $statusBar      = document.getElementById("statusBar");
const $lobbyScreen    = document.getElementById("lobbyScreen");
const $gameScreen     = document.getElementById("gameScreen");
const $commandPrefix  = document.getElementById("commandPrefix");
const $commandAction  = document.getElementById("commandAction");
const $feedbackDisplay = document.getElementById("feedbackDisplay");
const $gameScore      = document.getElementById("gameScore");
const $gameRound      = document.getElementById("gameRound");
const $pipCamera      = document.getElementById("pipCamera");
const $qrcodeElem     = document.getElementById("qrcode");
const $urlDisplayElem = document.getElementById("urlDisplay");

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
let blockedPeerId = null; // prevent immediate reconnection from same phone
let blockedPeerId = null; // prevent immediate reconnection from the same phone

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
    const $qrcode = document.getElementById("qrcode");
    const $urlDisplay = document.getElementById("urlDisplay");
    $urlDisplay.textContent = url;
    // clear any previous QR and render
    $qrcode.innerHTML = "";
    new QRCode($qrcode, {
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

/* ── Socket.io ── */
const initSocket = () => {
  socket = io.connect("/");

  socket.on("connect", () => {
    $statusBar.textContent = `Connected — My ID: ${socket.id}`;
    $statusBar.className = "status connected";
  });

  socket.on("disconnect", () => {
    $statusBar.textContent = "Disconnected from server";
    $statusBar.className = "status disconnected";
  });

  socket.on("client-disconnect", (client) => {
    if (peer && peer.data && peer.data.id === client.id) {
      peer.destroy();
      peer = null;
      $otherCamera.srcObject = null;
      $pipCamera.srcObject = null;
      if (gameActive) stopGame();
      // block reconnects from this client id
      blockedPeerId = client.id;
      // restore QR so a new phone can scan and join
      if ($qrcodeElem) $qrcodeElem.style.display = "block";
      if ($urlDisplayElem) $urlDisplayElem.style.display = "block";
      generateQR();
    }
  });

  socket.on("signal", (myId, signal, peerId) => {
    if (peer) {
      peer.signal(signal);
    } else if (signal.type === "offer") {
      // ignore offers from a recently disconnected client
      if (blockedPeerId && peerId === blockedPeerId) {
        console.log("Ignoring offer from blocked client:", peerId);
        return;
      }
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
    // Show a small connected banner in the QR area once a phone connected
    if ($qrcodeElem) $qrcodeElem.innerHTML = `<div class="connected-banner">Connected ✓</div>`;
    if ($urlDisplayElem) $urlDisplayElem.textContent = `Connected: ${peerId}`;
  });

  peer.on("stream", (stream) => {
    $otherCamera.srcObject = stream;
    $pipCamera.srcObject = stream;
  });

  peer.on("data", (raw) => {
    const msg = JSON.parse(raw);
    handlePeerMessage(msg);
  });

  peer.on("close", () => {
    peer.destroy();
    peer = null;
    $otherCamera.srcObject = null;
    $pipCamera.srcObject = null;
    if (gameActive) stopGame();
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
    // include human-friendly text and simon flag so the phone can display it
    peer.send(JSON.stringify({ type: "command", gesture: cmd.gesture, text: cmd.text, simon: simonSays }));
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

$otherCamera.addEventListener("click", () => $otherCamera.play());
$pipCamera.addEventListener("click", () => $pipCamera.play());

init();
