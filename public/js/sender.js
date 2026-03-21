      const $statusBar     = document.getElementById("statusBar");
      const $startBtn      = document.getElementById("startSensorsBtn");
      const $peerInfo      = document.getElementById("peerInfo");
      const $sensorInfo    = document.getElementById("sensorInfo");
      const $tapBtnWrap    = document.getElementById("tapBtnWrap");
      const $tapBtn        = document.getElementById("tapBtn");
      const $startGameBtn  = document.getElementById("startGameBtn");
      const $stopGameBtn   = document.getElementById("stopGameBtn");
      const $phoneCommandDisplay = document.getElementById("phoneCommandDisplay");
      const $phoneCommandPrefix = document.getElementById("phoneCommandPrefix");
      const $phoneCommandText = document.getElementById("phoneCommandText");

      let socket, myStream, peer;
      let sensorsActive = false;
      let speechEnabled = false;   // true only when the current command is "Say something!"
      let gameStarted = false;
      let activeCommandGesture = null;
      let commandArmAt = 0;
      let telemetryTimer = null;
      let latestMicLevel = 0;
      let tapCount = 0;
      let tapPulseUntil = 0;
      let latestGyro = { alpha: 0, beta: 0, gamma: 0 };
      let latestAccel = { x: 0, y: 0, z: 0 };
      const COMMAND_ARM_DELAY = 350;

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

      const init = async () => {
        try {
          myStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { width: 1280, height: 720, facingMode: "environment" },
          });
           // Microphone starts muted; only unmuted during "Say something!" command
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
        });

        socket.on("disconnect", () => {
          $statusBar.textContent = "Disconnected from server";
          $statusBar.className = "status disconnected";
          setPeerInfo(null);
          activeCommandGesture = null;
          commandArmAt = 0;
          gameStarted = false;
          speechEnabled = false;
          if (telemetryTimer) {
            clearInterval(telemetryTimer);
            telemetryTimer = null;
          }
          if (myStream) myStream.getAudioTracks().forEach(t => { t.enabled = false; });
        });

        /* Auto-connect: pick the first available peer */
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
            if (telemetryTimer) {
              clearInterval(telemetryTimer);
              telemetryTimer = null;
            }
            if (myStream) myStream.getAudioTracks().forEach(t => { t.enabled = false; });
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
          $startGameBtn.disabled = false;
        });

        peer.on("stream", () => {/* Sender doesn't render remote stream */});

        // Receive command notifications from the receiver
        peer.on("data", (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === "command") {
            activeCommandGesture = msg.gesture || null;
            commandArmAt = Date.now() + COMMAND_ARM_DELAY;
            syncMicTrackEnabled();

            // Emoji map for nicer phone UI
            const EMOJI = {
              tap: '🤳', jump: '🦘', duck: '🦆', left: '⬅️', right: '➡️', spin: '🌀', shake: '📱', speech: '🗣️'
            };

            // show the command text and simon prefix on the phone UI
            if (msg.text) {
              const emoji = EMOJI[msg.gesture] || '';
              $phoneCommandPrefix.textContent = msg.simon ? "Simon says…" : "";
              $phoneCommandText.innerHTML = `${emoji} ${msg.text}`;
              $phoneCommandDisplay.classList.remove("hidden");
            } else {
              $phoneCommandDisplay.classList.add("hidden");
            }
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
            if (telemetryTimer) {
              clearInterval(telemetryTimer);
              telemetryTimer = null;
            }
            if (myStream) myStream.getAudioTracks().forEach(t => { t.enabled = false; });
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

      /* ── Controller / Sensor Button ── */
      $startBtn.addEventListener("click", async () => {
        if (sensorsActive) {
          sensorsActive = false;
          gameStarted = false;
          sendControllerState(false);
          if (telemetryTimer) {
            clearInterval(telemetryTimer);
            telemetryTimer = null;
          }
          $startBtn.textContent = "Start Controller Mode";
          $startBtn.classList.remove("active");
          $sensorInfo.classList.remove("visible");
          $tapBtnWrap.classList.remove("visible");
          syncMicTrackEnabled();
          return;
        }
        await requestSensorPermission();
      });

      $tapBtn.addEventListener("click", () => {
        if (peer && peer.connected) {
          tapCount += 1;
          tapPulseUntil = Date.now() + 300;
          peer.send(JSON.stringify({ type: "button" }));
          sendTelemetrySnapshot();
        }
      });

      $startGameBtn.addEventListener("click", () => {
        if (peer && peer.connected) {
          gameStarted = true;
          activeCommandGesture = null;
          commandArmAt = 0;
          syncMicTrackEnabled();
          peer.send(JSON.stringify({ type: "start-game" }));
          $startGameBtn.style.display = "none";
          $stopGameBtn.style.display  = "";
        }
      });

      $stopGameBtn.addEventListener("click", () => {
        if (peer && peer.connected) {
          gameStarted = false;
          activeCommandGesture = null;
          commandArmAt = 0;
          syncMicTrackEnabled();
          peer.send(JSON.stringify({ type: "stop-game" }));
          $stopGameBtn.style.display  = "none";
          $startGameBtn.style.display = "";
        }
      });

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
        sendControllerState(true);
        syncMicTrackEnabled();
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

        /* ─── Shake ───
           Require 4+ direction reversals in X or Y within a 1.2 s window.
           A reversal = acceleration crosses zero with magnitude > 6 on each side. */
        let shakeReversals = 0;
        let shakeWindowStart = 0;
        let shakeLastSign = 0; // −1 or +1
        const SHAKE_THRESH = 4;
        const SHAKE_REVERSALS_NEEDED = 4;
        const SHAKE_WINDOW = 1200; // ms

        /* ─── Jump & Duck (unified vertical motion) ───
           Uses total magnitude of accelerationIncludingGravity
           so it works regardless of how the phone is held.
           Rest ≈ 9.8 m/s².  Freefall → ~0.  Impact → 15+.

           Jump:  HIGH first (push-off) → LOW (freefall) → HIGH (land)
           Duck:  LOW first (body drops) → HIGH (stop at bottom)

           A single state machine so they can never conflict. */
        let verticalPhase = "idle";
        let verticalStart = 0;
        const VERTICAL_TIMEOUT = 1500;
        const VERT_HIGH = 10;  // magnitude threshold for impact / push-off
        const VERT_LOW  = 3; // magnitude threshold for freefall / drop

        /* ─── 360 Spin ───
           Accumulate ≥ 350° of alpha rotation within a 3 s window.
           Must be mostly in ONE direction (net, not just absolute). */
        let spinAccum = 0;
        let lastAlpha = null;
        let spinStart = 0;
        const SPIN_WINDOW = 3000;
        const SPIN_THRESHOLD = 350;

          /* ─── Move Left / Right (tilt) ───
            Use gamma tilt with hold time + hysteresis to avoid jitter false positives. */
          const TILT_TRIGGER = 15;
          const TILT_RELEASE = 6;
          const TILT_HOLD_MS = 100;
          let leftHoldStart = 0;
          let rightHoldStart = 0;
          let leftReady = true;
          let rightReady = true;

        /* ── Device Motion (acceleration) ── */
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
            return;
          }

          /* ── Shake detection ── */
          const linAccel = event.acceleration;
          if (linAccel && activeCommandGesture === "shake") {
            // Use whichever lateral axis has the biggest value
            const val = Math.abs(linAccel.x || 0) > Math.abs(linAccel.y || 0)
              ? (linAccel.x || 0) : (linAccel.y || 0);
            const sign = val > SHAKE_THRESH ? 1 : val < -SHAKE_THRESH ? -1 : 0;

            if (sign !== 0 && sign !== shakeLastSign) {
              const now = Date.now();
              if (shakeLastSign === 0 || now - shakeWindowStart > SHAKE_WINDOW) {
                // Start a new window
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
                  // High G first → jump push-off
                  verticalPhase = "jump-push";
                  verticalStart = now;
                } else if (activeCommandGesture === "duck" && mag < VERT_LOW) {
                  // Low G first → duck drop
                  verticalPhase = "duck-drop";
                  verticalStart = now;
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
              case "duck-drop":
                if (mag > VERT_HIGH) {
                  verticalPhase = "idle";
                  sendGesture("duck");
                }
                break;
            }
          }
        });

        /* ── Device Orientation (gyro + duck + spin) ── */
        window.addEventListener("deviceorientation", (event) => {
          if (!sensorsActive || !(peer && peer.connected)) return;

          latestGyro = {
            alpha: Number(event.alpha || 0),
            beta: Number(event.beta || 0),
            gamma: Number(event.gamma || 0),
          };

          const commandArmed = !!activeCommandGesture && Date.now() >= commandArmAt;
          if (!commandArmed) {
            spinAccum = 0;
            spinStart = Date.now();
            lastAlpha = null;
            leftHoldStart = 0;
            rightHoldStart = 0;
            leftReady = true;
            rightReady = true;
            return;
          }

          /* ── Move left / right via tilt (gamma) ── */
          const gamma = event.gamma ?? 0;
          if (activeCommandGesture === "left" || activeCommandGesture === "right") {
            const now = Date.now();

            if (activeCommandGesture === "left") {
              if (gamma <= -TILT_TRIGGER) {
                if (!leftHoldStart) leftHoldStart = now;
                if (leftReady && now - leftHoldStart >= TILT_HOLD_MS) {
                  sendGesture("left");
                  leftReady = false;
                }
              } else {
                leftHoldStart = 0;
                if (gamma > -TILT_RELEASE) leftReady = true;
              }
            }

            if (activeCommandGesture === "right") {
              if (gamma >= TILT_TRIGGER) {
                if (!rightHoldStart) rightHoldStart = now;
                if (rightReady && now - rightHoldStart >= TILT_HOLD_MS) {
                  sendGesture("right");
                  rightReady = false;
                }
              } else {
                rightHoldStart = 0;
                if (gamma < TILT_RELEASE) rightReady = true;
              }
            }

            // Keep spin detector inactive while handling tilt commands.
            spinAccum = 0;
            spinStart = now;
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
            // Net accumulation preserves direction
            spinAccum += delta;
            if (Math.abs(spinAccum) >= SPIN_THRESHOLD) {
              sendGesture("spin");
              spinAccum = 0;
              spinStart = now;
            }
          }
          lastAlpha = alpha;
        });

        /* ── Speech detection (RMS of waveform) ── */
        if (myStream) {
          (async () => {
            try {
              const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
              await audioCtx.resume();  // must await — iOS keeps it suspended otherwise

              // Keep speech detector aligned with the current command at all times.
              const syncSpeechGate = () => {
                syncMicTrackEnabled();
              };

              const source = audioCtx.createMediaStreamSource(myStream);
              const analyser = audioCtx.createAnalyser();
              analyser.fftSize = 2048;
              source.connect(analyser);

              // Force the audio graph active on iOS by routing through a silent gain node
              const silentGain = audioCtx.createGain();
              silentGain.gain.value = 0;
              analyser.connect(silentGain);
              silentGain.connect(audioCtx.destination);

              const buf = new Float32Array(analyser.fftSize);
              let speaking = false;

              const checkAudio = () => {
                if (!sensorsActive) return;
                syncSpeechGate();
                analyser.getFloatTimeDomainData(buf);
                // RMS (root-mean-square) — silence ≈ 0.001, speech ≈ 0.01–0.1
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
