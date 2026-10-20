// ================================================================
//  PHASE 3: FINAL EXHIBITION VERSION - "Bloom Creature"
//
//  WEBCAM -> MediaPipe Pose Landmarker -> smoothed landmarks
//        -> INVISIBLE CONTROL SKELETON + GESTURES (jump / fast move / both arms up)
//        -> springs (delay + bounce) -> creature skeleton
//        -> layered flower/fur shapes with fake shading -> final picture
//        + floating flowers around the creature that react to the visitor
//
//  Keys:  D = development mode on/off (camera preview, skeleton, FPS, status text)
//         F = fullscreen on/off   (double-click also works)
//
//  EXHIBITION MODE (default): only the artwork. DEVELOPMENT MODE (press D): debug tools.
//
//  NOTE: MediaPipe is loaded from the CDN while the app starts (see loadMediaPipe),
//  so this file has NO npm imports and the project always compiles.
// ================================================================
/* =============================================================
   main.js — Gesture Canvas
   Free Draw (unchanged) + new Practice Mode.
 
   ARCHITECTURE NOTE ON PRACTICE MODE
   ------------------------------------------------------------
   Practice Mode intentionally does NOT introduce a new drawing
   pipeline. It reuses DrawEngine/EraserEngine/ParticlePool
   exactly as Free Draw does — the user's ink lands on the same
   drawCanvas/bloomCanvas via the same processHand() function.
   The only additions are:
     1. PracticeReference — draws a static, thin, dotted outline
        of the selected shape on its own layer BELOW the drawing
        canvas (purely visual, never touched by drawing logic).
     2. PracticeMode — records the raw fingertip points traced
        while in 'practice' mode (for evaluation only) and owns
        shape switching / clearing.
     3. ShapeEvaluator — a standalone, reusable scoring module.
        It knows nothing about hands, canvases, or MediaPipe; it
        only compares two point sets (user vs. reference) and
        returns an encouraging score + message. Future modes
        (Letter Practice, Number Practice, Connect the Dots) can
        call ShapeEvaluator.evaluate() directly with their own
        reference point sets.
   ============================================================= */
 
   import {
    HandLandmarker,
    FilesetResolver,
  } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
  
  /* =============================================================
     SECTION 1: DOM REFERENCES
     ============================================================= */
  const videoElement = document.getElementById('webcam');
  const appEl = document.getElementById('app');
  
  const overlayCanvas = document.getElementById('overlay');
  const overlayCtx = overlayCanvas.getContext('2d');
  
  const practiceStage = document.getElementById('practiceStage');
  const practiceCanvas = document.getElementById('practiceCanvas');
  const practiceCtx = practiceCanvas.getContext('2d');
  
  const bloomCanvas = document.getElementById('bloomCanvas');
  const bloomCtx = bloomCanvas.getContext('2d');
  
  const drawCanvas = document.getElementById('drawCanvas');
  const drawCtx = drawCanvas.getContext('2d');
  
  const particleCanvas = document.getElementById('particleCanvas');
  const particleCtx = particleCanvas.getContext('2d');
  
  const handCursorCanvas = document.getElementById('handCursorCanvas');
  const handCursorCtx = handCursorCanvas.getContext('2d');
  
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');
  const undoBtn = document.getElementById('undoBtn');
  const brushSizeSlider = document.getElementById('brushSize');
  const colorPicker = document.getElementById('colorPicker');
  const colorGroup = document.getElementById('colorGroup');
  const glowToggle = document.getElementById('glowToggle');
  const rainbowToggle = document.getElementById('rainbowToggle');
  const particleToggle = document.getElementById('particleToggle');
  const explosionToggle = document.getElementById('explosionToggle');
  const colorSwatches = Array.from(document.querySelectorAll('.color-swatch'));
  
  const modeFreeBtn = document.getElementById('modeFreeBtn');
  const modePracticeBtn = document.getElementById('modePracticeBtn');
  const practiceNavGroup = document.getElementById('practiceNavGroup');
  const shapeNameLabel = document.getElementById('shapeNameLabel');
  const shapePrevBtn = document.getElementById('shapePrevBtn');
  const shapeNextBtn = document.getElementById('shapeNextBtn');
  const checkDrawingBtn = document.getElementById('checkDrawingBtn');
  
  const onboardingCard = document.getElementById('onboardingCard');
  const onboardingGotIt = document.getElementById('onboardingGotIt');
  const miniReminder = document.getElementById('miniReminder');
  
  const practiceFeedbackCard = document.getElementById('practiceFeedbackCard');
  const feedbackPercent = document.getElementById('feedbackPercent');
  const feedbackMessage = document.getElementById('feedbackMessage');
  const practiceTryAgainBtn = document.getElementById('practiceTryAgainBtn');
  const practiceNextShapeBtn = document.getElementById('practiceNextShapeBtn');
  
  const ONBOARDING_SESSION_KEY = 'gestureCanvasOnboardingShown';
  
  /* =============================================================
     SECTION 2: GLOBAL APP STATE
     ============================================================= */
  const appState = {
    mode: 'free', // 'free' | 'practice'
    brushColor: '#00ffff',
    brushSize: 4,
    glowEnabled: false,
    rainbowEnabled: false,
    particlesEnabled: false,
    rainbowHue: 0,
  };
  
  let stageWidth = 0;
  let stageHeight = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  
  function currentBrushColor() {
    return appState.rainbowEnabled
      ? `hsl(${appState.rainbowHue}, 100%, 60%)`
      : appState.brushColor;
  }
  
  function advanceRainbowHue(dt) {
    if (appState.rainbowEnabled) {
      appState.rainbowHue = (appState.rainbowHue + dt * 0.06) % 360;
    }
  }
  
  function getEraserSize() {
    return appState.brushSize * 2.2;
  }
  
  /* =============================================================
     SECTION 3: ONBOARDING CARD
     ============================================================= */
  const OnboardingController = (() => {
    let autoHideTimer = null;
  
    function show() {
      const alreadyShown = sessionStorage.getItem(ONBOARDING_SESSION_KEY);
      if (alreadyShown) {
        MiniReminder.show();
        return;
      }
  
      sessionStorage.setItem(ONBOARDING_SESSION_KEY, '1');
      onboardingCard.classList.remove('hidden');
  
      autoHideTimer = setTimeout(hide, 6000);
    }
  
    function hide() {
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
      onboardingCard.classList.add('fade-out');
      setTimeout(() => {
        onboardingCard.classList.add('hidden');
        onboardingCard.classList.remove('fade-out');
        MiniReminder.show();
      }, 550);
    }
  
    onboardingGotIt.addEventListener('click', hide);
  
    return { show };
  })();
  
  /* =============================================================
     SECTION 4: FLOATING MINIMAL REMINDER
     ============================================================= */
  const MiniReminder = (() => {
    let visible = false;
  
    function show() {
      if (visible) return;
      visible = true;
      miniReminder.classList.remove('hidden');
      requestAnimationFrame(() => miniReminder.classList.add('visible'));
    }
  
    function setDrawingActive(isDrawing) {
      if (!visible) return;
      miniReminder.classList.toggle('drawing-active', isDrawing);
    }
  
    return { show, setDrawingActive };
  })();
  
  /* =============================================================
     SECTION 5: HAND SKELETON CONNECTIONS (overlay rendering)
     ============================================================= */
  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17],
  ];
  
  /* =============================================================
     SECTION 6: HAND INPUT STORE
     ============================================================= */
  /* -------------------------------------------------------------
     VIDEO -> STAGE MAPPING
     MediaPipe returns landmarks normalised (0..1) to the CAMERA
     FRAME. The stage (screen / projector) usually has a different
     aspect ratio than the camera, so the frame is mapped with the
     same "cover" rule the old <video object-fit: cover> used:
     uniform scale (no stretching), centred, overflow cropped.
     Previously x was mapped to the stage width and y to the stage
     height independently, which stretches the image whenever the
     aspect ratios differ and drifts most at the top/bottom edges.
     Returns the size the camera frame occupies on the stage plus
     its centring offset. Before the video reports its size, it
     falls back to a plain full-stage mapping.
     ------------------------------------------------------------- */
  function getVideoToStageMap(stageW, stageH) {
    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    if (!vw || !vh) {
      return { w: stageW, h: stageH, offX: 0, offY: 0 };
    }
    const scale = Math.max(stageW / vw, stageH / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { w, h, offX: (stageW - w) / 2, offY: (stageH - h) / 2 };
  }
  
  const HandInputStore = (() => {
    const MAX_MISSED_FRAMES = 3;
    const MAX_PREDICTED_STEP_PX = 40;
    const GESTURE_STABILITY_FRAMES = 2;
    const FINGER_MARGIN = 0.035;
  
    function createSlot() {
      return {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        gesture: 'idle',
        pendingGesture: 'idle',
        pendingCount: 0,
        t: 0,
        lastRealT: 0,
        missedFrames: 0,
        valid: false,
        predicted: false,
        landmarks: null,
      };
    }
  
    const slots = { Left: createSlot(), Right: createSlot() };
  
    function classifyGesture(landmarks) {
      const isUp = (tip, pip) => landmarks[tip].y < landmarks[pip].y - FINGER_MARGIN;
      const index = isUp(8, 6);
      const middle = isUp(12, 10);
      const ring = isUp(16, 14);
      const pinky = isUp(20, 18);
  
      if (index && middle && ring && pinky) return 'open';
      if (index && middle && !ring && !pinky) return 'erase';
      if (index && !middle && !ring && !pinky) return 'draw';
      return 'idle';
    }
  
    function updateGestureStability(slot, rawGesture) {
      if (rawGesture === slot.pendingGesture) {
        slot.pendingCount += 1;
      } else {
        slot.pendingGesture = rawGesture;
        slot.pendingCount = 1;
      }
      if (slot.pendingCount >= GESTURE_STABILITY_FRAMES) {
        slot.gesture = rawGesture;
      }
    }
  
    function ingest(result, width, height, now) {
      const seenLabels = new Set();
  
      if (result.landmarks && result.handedness) {
        result.landmarks.forEach((landmarks, i) => {
          const handedness = result.handedness[i]?.[0]?.categoryName;
          const label = handedness === 'Left' ? 'Left' : 'Right';
          seenLabels.add(label);
  
          const slot = slots[label];
          const map = getVideoToStageMap(width, height);
          // Mirror horizontally (the camera is a mirror view) about the stage centre.
          const newX = width - (landmarks[8].x * map.w + map.offX);
          const newY = landmarks[8].y * map.h + map.offY;
  
          const dt = Math.max(now - slot.lastRealT, 1);
          if (slot.lastRealT > 0) {
            slot.vx = (newX - slot.x) / dt;
            slot.vy = (newY - slot.y) / dt;
          }
  
          slot.x = newX;
          slot.y = newY;
          updateGestureStability(slot, classifyGesture(landmarks));
          slot.landmarks = landmarks;
          slot.t = now;
          slot.lastRealT = now;
          slot.missedFrames = 0;
          slot.valid = true;
          slot.predicted = false;
        });
      }
  
      for (const label of ['Left', 'Right']) {
        if (seenLabels.has(label)) continue;
        const slot = slots[label];
        if (!slot.valid) continue;
  
        slot.missedFrames += 1;
  
        if (slot.missedFrames <= MAX_MISSED_FRAMES) {
          const dt = Math.max(now - slot.t, 1);
          let dx = slot.vx * dt;
          let dy = slot.vy * dt;
  
          const stepDist = Math.hypot(dx, dy);
          if (stepDist > MAX_PREDICTED_STEP_PX) {
            const scale = MAX_PREDICTED_STEP_PX / stepDist;
            dx *= scale;
            dy *= scale;
          }
  
          slot.x += dx;
          slot.y += dy;
          slot.t = now;
          slot.predicted = true;
          slot.valid = true;
          slot.landmarks = null;
        } else {
          slot.valid = false;
          slot.predicted = false;
          slot.gesture = 'idle';
          slot.pendingGesture = 'idle';
          slot.pendingCount = 0;
          slot.landmarks = null;
        }
      }
    }
  
    function getSlot(label) {
      return slots[label];
    }
  
    return { ingest, getSlot };
  })();
  
  /* =============================================================
     SECTION 7: CATMULL-ROM STROKE INTERPOLATOR (Free Draw + Practice)
     ============================================================= */
  function catmullRom(p0, p1, p2, p3, t, out) {
    const t2 = t * t;
    const t3 = t2 * t;
  
    out.x =
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  
    out.y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  
    return out;
  }
  
  function adaptiveSteps(dist, minStep, maxSteps) {
    const steps = Math.ceil(dist / minStep);
    return Math.max(1, Math.min(steps, maxSteps));
  }
  
  /* =============================================================
     SECTION 8: PER-HAND RENDER STATE
     ============================================================= */
  function createHandRenderState() {
    return {
      history: [],
      lastProcessed: null,
      mode: 'idle',
      strokeActive: false,
      lastSampleT: 0,
      scratchPoint: { x: 0, y: 0 },
      action: null, // the undo action (stroke or erase) this hand is currently recording
    };
  }
  
  const handRenderStates = {
    Left: createHandRenderState(),
    Right: createHandRenderState(),
  };
  
  function resetHandRenderState(hs) {
    UndoManager.end(hs); // commit any stroke/erase that was in progress
    hs.history.length = 0;
    hs.lastProcessed = null;
    hs.mode = 'idle';
    hs.strokeActive = false;
    hs.lastSampleT = 0;
  }
  
  /* =============================================================
     SECTION 8B: UNDO MANAGER (stroke history + replay)
     ------------------------------------------------------------
     The canvases are raster layers, so a stroke cannot be "taken
     out" of them directly. Instead, every segment that DrawEngine
     paints and every stamp that EraserEngine erases is ALSO
     recorded here as a tiny op (coordinates + the exact style it
     was painted with: colour, size, glow flag, speed). Ops are
     grouped into "actions": one action = one stroke (draw gesture
     start -> end) or one erase gesture (erase start -> end).
 
     Undo = drop the newest completed action, then clear both
     canvases and replay the remaining actions through the SAME
     paint/erase code that drew them live. Because erases are
     recorded in order with the strokes, undoing a stroke never
     "restores" erased ink, and undoing an erase brings back
     exactly the ink it removed.
 
     To keep memory and replay time bounded, only the newest
     MAX_UNDO_STEPS actions stay undoable. Older actions are
     "baked" into a base bitmap (one canvas pair, created lazily)
     that is drawn first on every replay.
 
     Particles live on their own canvas, are short-lived sparks,
     and are not part of the artwork, so they are not recorded.
     ============================================================= */
  const UndoManager = (() => {
    const MAX_UNDO_STEPS = 40;
  
    let actions = []; // ordered by start time; the newest completed one is undone first
    // Geometry (vertices only, no pixels) of strokes that have been "baked" into the base
    // bitmap because they are older than MAX_UNDO_STEPS. Kept so that EVERYTHING on the
    // canvas can still become particles, not just the undoable part. Capped for memory.
    let bakedStrokes = []; // array of polylines, each [{x, y, c}]
    let bakedVerts = 0;
    const MAX_BAKED_VERTS = 40000;
    let baseDraw = null;
    let baseBloom = null;
    let baseDrawCtx = null;
    let baseBloomCtx = null;
  
    function makeBaseCanvas() {
      const c = document.createElement('canvas');
      c.width = stageWidth * DPR;
      c.height = stageHeight * DPR;
      const ctx = c.getContext('2d');
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      return { c, ctx };
    }
  
    function ensureBase() {
      if (baseDraw) return;
      const d = makeBaseCanvas();
      const b = makeBaseCanvas();
      baseDraw = d.c;
      baseDrawCtx = d.ctx;
      baseBloom = b.c;
      baseBloomCtx = b.ctx;
    }
  
    function hasUndoable() {
      for (const a of actions) if (!a.open) return true;
      return false;
    }
  
    function completedCount() {
      let n = 0;
      for (const a of actions) if (!a.open) n++;
      return n;
    }
  
    function updateButton() {
      undoBtn.disabled = !hasUndoable();
    }
  
    function applyOp(op, dCtx, bCtx) {
      if (op.k <= 1) DrawEngine.replayOp(op, dCtx, bCtx);
      else EraserEngine.replayOp(op, dCtx, bCtx);
    }
  
    function begin(hs, type) {
      if (hs.action) end(hs);
      const a = {
        type,
        ops: [],
        open: true,
        practicePts: [],
        t0: performance.now(),
        tEnd: 0,
      };
      hs.action = a;
      actions.push(a);
    }
  
    function end(hs) {
      const a = hs.action;
      if (!a) return;
      hs.action = null;
      a.open = false;
      a.tEnd = performance.now();
  
      const idx = actions.indexOf(a);
      if (idx < 0) return; // detached by reset()
  
      if (a.ops.length === 0) {
        actions.splice(idx, 1); // nothing was painted (e.g. a single-point tap)
        return;
      }
  
      while (completedCount() > MAX_UNDO_STEPS) bakeOldest();
      updateButton();
    }
  
    function record(hs, op) {
      if (!hs.action) begin(hs, op.k >= 2 ? 'erase' : 'stroke');
      hs.action.ops.push(op);
    }
  
    function attachPracticePoint(hs, pt) {
      if (hs.action && pt) hs.action.practicePts.push(pt);
    }
  
    function bakeOldest() {
      const i = actions.findIndex((a) => !a.open);
      if (i < 0) return;
      ensureBase();
      const [a] = actions.splice(i, 1);
      for (const op of a.ops) applyOp(op, baseDrawCtx, baseBloomCtx);
      rememberBaked(a);
    }
    
    function rememberBaked(a) {
      if (a.type === 'stroke') {
        const verts = strokeVertices(a);
        if (verts.length >= 2) {
          bakedStrokes.push(verts);
          bakedVerts += verts.length;
        }
      } else if (a.type === 'erase' && bakedStrokes.length) {
        // An old erase also removed part of the older baked strokes.
        const next = [];
        let n = 0;
        for (const poly of bakedStrokes) {
          for (const piece of splitByErasers(poly, a.ops)) {
            next.push(piece);
            n += piece.length;
          }
        }
        bakedStrokes = next;
        bakedVerts = n;
      }
      while (bakedVerts > MAX_BAKED_VERTS && bakedStrokes.length) bakedVerts -= bakedStrokes.shift().length;
    }
  
    function redraw() {
      drawCtx.clearRect(0, 0, stageWidth, stageHeight);
      bloomCtx.clearRect(0, 0, stageWidth, stageHeight);
  
      if (baseDraw) {
        for (const [ctx, src] of [[drawCtx, baseDraw], [bloomCtx, baseBloom]]) {
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(src, 0, 0, stageWidth, stageHeight);
          ctx.restore();
        }
      }
  
      for (const a of actions) {
        for (const op of a.ops) applyOp(op, drawCtx, bloomCtx);
      }
    }
  
    function undo() {
      let idx = -1;
      for (let i = actions.length - 1; i >= 0; i--) {
        if (!actions[i].open) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return false;
  
      const [removed] = actions.splice(idx, 1);
      if (removed.practicePts.length) PracticeMode.removePoints(removed.practicePts);
  
      redraw();
      updateButton();
      return true;
    }
  
    // Called whenever the artwork is wiped (Clear, Practice "Try Again" / "Next Shape").
    function reset() {
      actions = [];
      bakedStrokes = [];
      bakedVerts = 0;
      for (const hs of Object.values(handRenderStates)) hs.action = null;
      baseDraw = null;
      baseBloom = null;
      baseDrawCtx = null;
      baseBloomCtx = null;
      updateButton();
    }
  
    // The existing resize logic stretches the bitmap to the new stage size, so the
    // recorded coordinates (and the baked base bitmap) are stretched the same way.
    function handleResize(oldW, oldH) {
      if (!oldW || !oldH || (oldW === stageWidth && oldH === stageHeight)) return;
      const sx = stageWidth / oldW;
      const sy = stageHeight / oldH;
  
      for (const a of actions) {
        for (const op of a.ops) {
          const c = op.c;
          for (let i = 0; i < c.length; i += 2) {
            c[i] *= sx;
            c[i + 1] *= sy;
          }
        }
      }
  
      for (const poly of bakedStrokes) {
        for (const v of poly) {
          v.x *= sx;
          v.y *= sy;
        }
      }
  
      if (baseDraw) {
        const oldD = baseDraw;
        const oldB = baseBloom;
        const d = makeBaseCanvas();
        const b = makeBaseCanvas();
        d.ctx.drawImage(oldD, 0, 0, stageWidth, stageHeight);
        b.ctx.drawImage(oldB, 0, 0, stageWidth, stageHeight);
        baseDraw = d.c;
        baseDrawCtx = d.ctx;
        baseBloom = b.c;
        baseBloomCtx = b.ctx;
      }
    }
  
    /* ---- Particle Explosion support: geometry of EVERYTHING on the canvas ---- */
    
    // Polyline vertices [{x, y, c}] of one stroke action (c = the colour it was drawn in).
    function strokeVertices(a) {
      const verts = [];
      for (const op of a.ops) {
        if (op.k > 1) continue;
        const c = op.c;
        const color = op.s.color;
        if (verts.length === 0) {
          verts.push(op.k === 0 ? { x: c[0], y: c[1], c: color } : { x: c[2], y: c[3], c: color });
        }
        verts.push(op.k === 0 ? { x: c[2], y: c[3], c: color } : { x: c[4], y: c[5], c: color });
      }
      return verts;
    }
    
    function eraserHits(op, v) {
      const r = op.d / 2 + 2;
      const c = op.c;
      if (op.k === 3) return Math.hypot(v.x - c[0], v.y - c[1]) <= r;
      const dx = c[2] - c[0];
      const dy = c[3] - c[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((v.x - c[0]) * dx + (v.y - c[1]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(v.x - (c[0] + dx * t), v.y - (c[1] + dy * t)) <= r;
    }
    
    // Cut a polyline wherever an eraser passed over it; returns the surviving pieces.
    function splitByErasers(verts, erasers) {
      const pieces = [];
      let cur = [];
      for (const v of verts) {
        let erased = false;
        for (let e = 0; e < erasers.length; e++) {
          if (eraserHits(erasers[e], v)) {
            erased = true;
            break;
          }
        }
        if (erased) {
          if (cur.length >= 2) pieces.push(cur);
          cur = [];
        } else {
          cur.push(v);
        }
      }
      if (cur.length >= 2) pieces.push(cur);
      return pieces;
    }
    
    // Is there any finished ink on the canvas that could become particles?
    function hasStrokes() {
      if (bakedStrokes.length) return true;
      for (const a of actions) {
        if (a.type === 'stroke' && !a.open && a.ops.length > 0) return true;
      }
      return false;
    }
    
    // Collect ALL ink on the canvas as polylines (honouring every erase), REMOVE it from
    // the canvas (it becomes particles) and redraw. Returns [] and changes nothing when
    // the canvas has no ink.
    function takeAllStrokes() {
      if (!hasStrokes()) return [];
    
      const allErasers = [];
      for (const a of actions) {
        if (a.type === 'erase') for (const op of a.ops) allErasers.push(op);
      }
    
      const segments = [];
      // Older (baked) strokes: every live erase happened after them.
      for (const poly of bakedStrokes) {
        for (const piece of splitByErasers(poly, allErasers)) segments.push(piece);
      }
      // Live strokes: only erases that happened after a stroke affect it.
      for (let idx = 0; idx < actions.length; idx++) {
        const a = actions[idx];
        if (a.type !== 'stroke' || a.open || a.ops.length === 0) continue;
        const erasers = [];
        for (let j = idx + 1; j < actions.length; j++) {
          if (actions[j].type === 'erase') for (const op of actions[j].ops) erasers.push(op);
        }
        for (const piece of splitByErasers(strokeVertices(a), erasers)) segments.push(piece);
      }
    
      // The ink now lives on as particles: take it all off the canvas.
      actions = actions.filter((a) => a.open); // keep only a stroke/erase still in progress
      bakedStrokes = [];
      bakedVerts = 0;
      baseDraw = null;
      baseBloom = null;
      baseDrawCtx = null;
      baseBloomCtx = null;
      redraw();
      updateButton();
      return segments;
    }
    
    return {
      begin, end, record, attachPracticePoint, undo, reset, handleResize, updateButton,
      hasStrokes, takeAllStrokes,
    };
  })();
  
  /* =============================================================
     SECTION 9: DRAWING ENGINE — used by BOTH Free Draw and
     Practice Mode. Painting behaviour is unchanged; the paint
     step now takes an explicit style snapshot so the exact same
     code can be replayed by UndoManager.
     ============================================================= */
  const DrawEngine = (() => {
    const MIN_STEP_PX = 2;
    const MAX_STEPS = 28;
  
    // Reusable scratch objects for replaying recorded ops without allocating.
    const rp0 = { x: 0, y: 0 };
    const rp1 = { x: 0, y: 0 };
    const rp2 = { x: 0, y: 0 };
    const rp3 = { x: 0, y: 0 };
    const replayScratch = { x: 0, y: 0 };
  
    function makeStyle(speedPxMs) {
      return {
        color: currentBrushColor(),
        size: appState.brushSize,
        glow: appState.glowEnabled,
        speed: speedPxMs,
      };
    }
  
    function configureStyle(ctx, style, isBloom) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = style.color;
  
      if (isBloom) {
        ctx.lineWidth = style.size * 2.4;
        ctx.shadowBlur = 0;
      } else {
        ctx.lineWidth = style.size;
        if (style.glow) {
          ctx.shadowColor = style.color;
          ctx.shadowBlur = 15 + Math.min(style.speed * 10, 20);
        } else {
          ctx.shadowBlur = 0;
        }
      }
    }
  
    function paintLinear(dCtx, bCtx, a, b, style) {
      configureStyle(dCtx, style, false);
      dCtx.beginPath();
      dCtx.moveTo(a.x, a.y);
      dCtx.lineTo(b.x, b.y);
      dCtx.stroke();
  
      if (style.glow) {
        configureStyle(bCtx, style, true);
        bCtx.beginPath();
        bCtx.moveTo(a.x, a.y);
        bCtx.lineTo(b.x, b.y);
        bCtx.stroke();
      }
    }
  
    function paintCurve(dCtx, bCtx, p0, p1, p2, p3, style, scratch) {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const steps = adaptiveSteps(dist, MIN_STEP_PX, MAX_STEPS);
  
      configureStyle(dCtx, style, false);
      dCtx.beginPath();
      dCtx.moveTo(p1.x, p1.y);
  
      if (style.glow) {
        configureStyle(bCtx, style, true);
        bCtx.beginPath();
        bCtx.moveTo(p1.x, p1.y);
      }
  
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        catmullRom(p0, p1, p2, p3, t, scratch);
        dCtx.lineTo(scratch.x, scratch.y);
        if (style.glow) bCtx.lineTo(scratch.x, scratch.y);
      }
  
      dCtx.stroke();
      if (style.glow) bCtx.stroke();
    }
  
    function processDraw(hs, target, speed) {
      if (!hs.strokeActive || !hs.lastProcessed) {
        UndoManager.begin(hs, 'stroke');
        hs.strokeActive = true;
        hs.history.length = 0;
        hs.history.push({ x: target.x, y: target.y });
        hs.lastProcessed = { x: target.x, y: target.y };
        return;
      }
  
      const p1 = hs.lastProcessed;
      const style = makeStyle(speed);
  
      if (hs.history.length < 2) {
        paintLinear(drawCtx, bloomCtx, p1, target, style);
        UndoManager.record(hs, { k: 0, c: [p1.x, p1.y, target.x, target.y], s: style });
      } else {
        const p0 = hs.history[hs.history.length - 2];
        const p3 = {
          x: target.x + (target.x - p1.x),
          y: target.y + (target.y - p1.y),
        };
        paintCurve(drawCtx, bloomCtx, p0, p1, target, p3, style, hs.scratchPoint);
        UndoManager.record(hs, {
          k: 1,
          c: [p0.x, p0.y, p1.x, p1.y, target.x, target.y, p3.x, p3.y],
          s: style,
        });
      }
  
      hs.history.push({ x: target.x, y: target.y });
      if (hs.history.length > 4) hs.history.shift();
      hs.lastProcessed = { x: target.x, y: target.y };
    }
  
    function endStroke(hs) {
      UndoManager.end(hs); // commit the stroke/erase action (no-op if none is open)
      hs.strokeActive = false;
      hs.history.length = 0;
      hs.lastProcessed = null;
    }
  
    // Re-paint one recorded op onto any canvas pair (used by UndoManager).
    function replayOp(op, dCtx, bCtx) {
      const c = op.c;
      if (op.k === 0) {
        rp0.x = c[0]; rp0.y = c[1];
        rp1.x = c[2]; rp1.y = c[3];
        paintLinear(dCtx, bCtx, rp0, rp1, op.s);
      } else {
        rp0.x = c[0]; rp0.y = c[1];
        rp1.x = c[2]; rp1.y = c[3];
        rp2.x = c[4]; rp2.y = c[5];
        rp3.x = c[6]; rp3.y = c[7];
        paintCurve(dCtx, bCtx, rp0, rp1, rp2, rp3, op.s, replayScratch);
      }
    }
  
    return { processDraw, endStroke, replayOp };
  })();
  
  /* =============================================================
     SECTION 10: ERASER ENGINE — used by BOTH Free Draw and
     Practice Mode. Erasing behaviour is unchanged; each erase now
     also records its eraser diameter so UndoManager can replay it.
     ============================================================= */
  const EraserEngine = (() => {
    let stampCanvas = null;
    let stampSize = 0;
  
    function buildStamp(diameter) {
      const size = Math.ceil(diameter);
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const radius = size / 2;
  
      const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(0.7, 'rgba(0,0,0,0.85)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
  
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(radius, radius, radius, 0, Math.PI * 2);
      ctx.fill();
  
      stampCanvas = c;
      stampSize = size;
    }
  
    function getStamp(diameter) {
      if (!stampCanvas || Math.abs(stampSize - diameter) > 0.5) {
        buildStamp(diameter);
      }
      return stampCanvas;
    }
  
    function stampAt(ctx, x, y, diameter) {
      const stamp = getStamp(diameter);
      const half = stampSize / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.shadowBlur = 0;
      ctx.drawImage(stamp, x - half, y - half, stampSize, stampSize);
      ctx.restore();
    }
  
    function runSegment(dCtx, bCtx, x0, y0, x1, y1, diameter) {
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const radius = diameter / 2;
      const step = Math.max(radius * 0.35, 2);
      const steps = dist < 0.5 ? 1 : Math.ceil(dist / step);
  
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        stampAt(dCtx, x, y, diameter);
        stampAt(bCtx, x, y, diameter);
      }
    }
  
    function runSingle(dCtx, bCtx, x, y, diameter) {
      stampAt(dCtx, x, y, diameter);
      stampAt(bCtx, x, y, diameter);
    }
  
    function eraseSegment(x0, y0, x1, y1, hs) {
      const d = getEraserSize();
      runSegment(drawCtx, bloomCtx, x0, y0, x1, y1, d);
      UndoManager.record(hs, { k: 2, c: [x0, y0, x1, y1], d });
    }
  
    function eraseSingle(x, y, hs) {
      const d = getEraserSize();
      runSingle(drawCtx, bloomCtx, x, y, d);
      UndoManager.record(hs, { k: 3, c: [x, y], d });
    }
  
    // Re-apply one recorded erase op onto any canvas pair (used by UndoManager).
    function replayOp(op, dCtx, bCtx) {
      const c = op.c;
      if (op.k === 2) runSegment(dCtx, bCtx, c[0], c[1], c[2], c[3], op.d);
      else runSingle(dCtx, bCtx, c[0], c[1], op.d);
    }
  
    return { eraseSegment, eraseSingle, replayOp, getSize: getEraserSize };
  })();
  
  /* =============================================================
     SECTION 11: PARTICLE POOL — used by both modes, unchanged.
     ============================================================= */
  const ParticlePool = (() => {
    const CAPACITY = 500;
    const pool = new Array(CAPACITY);
    for (let i = 0; i < CAPACITY; i++) {
      pool[i] = { x: 0, y: 0, vx: 0, vy: 0, size: 0, life: 0, decay: 0, color: '#000' };
    }
    let activeCount = 0;
  
    function spawn(x, y, opts) {
      if (activeCount >= CAPACITY) return;
      const p = pool[activeCount++];
  
      const angle = opts.angle ?? Math.random() * Math.PI * 2;
      const speed = opts.speed ?? Math.random() * 1.5 + 0.5;
  
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.size = opts.size ?? Math.random() * 3 + 1;
      p.life = opts.life ?? 1;
      p.decay = opts.decay ?? Math.random() * 0.02 + 0.015;
      p.color = opts.color ?? currentBrushColor();
    }
  
    function spawnSparkles(x, y, color) {
      spawn(x, y, { speed: Math.random() * 0.6, size: Math.random() * 2 + 0.5, decay: 0.03, color });
      spawn(x, y, { speed: Math.random() * 0.6, size: Math.random() * 2 + 0.5, decay: 0.03, color });
    }
  
    function spawnExplosion(x, y, intensity, color) {
      const count = Math.min(18, Math.floor(intensity * 2));
      for (let i = 0; i < count; i++) {
        spawn(x, y, { speed: Math.random() * 4 + 2, size: Math.random() * 4 + 2, decay: 0.025, color });
      }
    }
  
    function updateAndDraw(ctx, dtScale) {
      ctx.save();
      for (let i = activeCount - 1; i >= 0; i--) {
        const p = pool[i];
  
        p.x += p.vx * dtScale;
        p.y += p.vy * dtScale;
        p.life -= p.decay * dtScale;
        p.vx *= 0.96;
        p.vy *= 0.96;
  
        if (p.life <= 0) {
          activeCount--;
          if (i !== activeCount) {
            const tmp = pool[i];
            pool[i] = pool[activeCount];
            pool[activeCount] = tmp;
          }
          continue;
        }
  
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  
    function clear() {
      activeCount = 0;
    }
  
    return { spawnSparkles, spawnExplosion, updateAndDraw, clear };
  })();
  
  /* =============================================================
     SECTION 11B: PARTICLE EXPLOSION — visual magic (opt-in mode)
     ------------------------------------------------------------
     Flow:
       1. User draws or writes ANYTHING normally (nothing changes).
       2. With Explosion mode ON, holding an OPEN PALM for ~0.2s
          converts ALL the ink on the canvas (any number of
          strokes, letters, words, shapes) into a particle cloud
          (the ink is removed from the canvas and re-born as
          particles at exactly the same positions and colours).
       3. Particles BURST outward from the drawing's shape with
          varied speeds and a little twist, slow down, drift
          gently, then fade out and the cloud clears itself.
       4. While the cloud is alive, the index fingertip (while
          drawing) ATTRACTS nearby particles (they orbit the
          fingertip). An open palm REPELS them when the canvas has
          no ink; if there is ink, the open palm explodes it.
 
     Reuses: the existing gesture classifier ('open' / 'draw'),
     the already-mapped fingertip coordinates, the single
     RenderEngine loop and the existing particleCanvas.
     It does NOT touch ParticlePool, drawing or erasing.
 
     Bounded by design: fixed typed arrays (MAX_PARTICLES), a small
     capped sprite cache, no timers, no extra animation loops, and
     a re-trigger re-uses the same arrays.
     ============================================================= */
  const ExplosionFX = (() => {
    const MAX_PARTICLES = 2000; // enough for a few words of handwriting
    const MIN_PARTICLES = 600;
    const HOLD_MS = 100; // open palm must be held this long to trigger (lower = faster)
    const RELEASE_MS = 300; // palm must be released this long before it can act again
    const GAP_TOLERANCE_MS = 150; // brief tracking flicker does not reset the hold
    const FADE_START_S = 3.5; // the cloud starts fading this long after the burst...
    const FADE_END_S = 7.0; // ...and is completely gone by here (raise both to linger longer)
    const MAX_SPRITES = 48;
    const SPRITE_PX = 64;
    const SPRITE_CORE = 6;
 
    const fxClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const fxLerp = (a, b, t) => a + (b - a) * t;
    const fxSmooth = (e0, e1, x) => {
      const t = fxClamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };
 
    // Per-particle state (typed arrays: allocated once, reused forever)
    const px = new Float32Array(MAX_PARTICLES);
    const py = new Float32Array(MAX_PARTICLES);
    const vx = new Float32Array(MAX_PARTICLES);
    const vy = new Float32Array(MAX_PARTICLES);
    const psize = new Float32Array(MAX_PARTICLES);
    const phase = new Float32Array(MAX_PARTICLES);
    const kVar = new Float32Array(MAX_PARTICLES);
    const alphaBase = new Float32Array(MAX_PARTICLES);
    const spriteIdx = new Uint8Array(MAX_PARTICLES);
 
    let enabled = false;
    let active = false;
    let count = 0;
    let age = 0; // seconds since the last explosion
    let life = 1; // 1 -> 0 while the cloud fades out
    let fade = 1; // extra fade used when the mode is switched off
    let fading = false;
    let lastNow = 0;
    let explosions = 0;
 
    /* ---------- glow sprites (pre-rendered; no shadowBlur per frame) ---------- */
    const sprites = [];
    const spriteKeys = new Map();
 
    function makeSprite(css) {
      const c = document.createElement('canvas');
      c.width = SPRITE_PX;
      c.height = SPRITE_PX;
      const g = c.getContext('2d');
      g.shadowColor = css;
      g.shadowBlur = 16;
      g.fillStyle = css;
      g.beginPath();
      g.arc(SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_CORE, 0, Math.PI * 2);
      g.fill();
      g.fill();
      g.shadowBlur = 0;
      g.globalAlpha = 0.9;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_CORE * 0.4, 0, Math.PI * 2);
      g.fill();
      return c;
    }
 
    function spriteFor(color) {
      if (sprites.length === 0) {
        sprites.push(makeSprite('#00ffff'));
        spriteKeys.set('#00ffff', 0);
      }
      let key = String(color || '#00ffff').toLowerCase();
      let css = key;
      const m = /^hsl\(\s*([\d.]+)/.exec(key);
      if (m) {
        // Rainbow colours change every frame: quantise the hue so the cache stays small.
        const h = (Math.round(parseFloat(m[1]) / 15) * 15) % 360;
        key = 'h' + h;
        css = `hsl(${h}, 100%, 60%)`;
      }
      const found = spriteKeys.get(key);
      if (found !== undefined) return found;
      if (sprites.length >= MAX_SPRITES) return 0;
      sprites.push(makeSprite(css));
      spriteKeys.set(key, sprites.length - 1);
      return sprites.length - 1;
    }
 
    /* ---------- per-hand input state ---------- */
    function makePalm() {
      return { openSince: 0, lastOpen: 0, armed: true, charge: 0, x: 0, y: 0, hasPos: false, repel: 0, shock: 0, wasRepel: false };
    }
    function makeFinger() {
      return { x: 0, y: 0, hasPos: false, engage: 0 };
    }
    const palms = { Left: makePalm(), Right: makePalm() };
    const fingers = { Left: makeFinger(), Right: makeFinger() };
 
    // Palm centre (middle-finger base, landmark 9) in stage coordinates.
    // Uses the SAME video->stage mapping + mirroring as the fingertip.
    function getPalmCenter(label) {
      const slot = HandInputStore.getSlot(label);
      if (!slot || !slot.valid || slot.predicted || !slot.landmarks) return null;
      const lm = slot.landmarks[9];
      if (!lm) return null;
      const map = getVideoToStageMap(stageWidth, stageHeight);
      return { x: stageWidth - (lm.x * map.w + map.offX), y: lm.y * map.h + map.offY };
    }
 
    /* ---------- creating the explosion ---------- */
    function explode(segments) {
      const S = Math.max(0.3, Math.min(stageWidth, stageHeight) / 1000);
 
      // Segment lengths
      let total = 0;
      const valid = [];
      for (const seg of segments) {
        const cum = [0];
        for (let i = 1; i < seg.length; i++) {
          cum.push(cum[i - 1] + Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y));
        }
        const L = cum[cum.length - 1];
        if (L >= 1) {
          valid.push({ seg, cum, L });
          total += L;
        }
      }
      if (!valid.length) return false;
 
      const want = fxClamp(Math.round(total / 3.5), MIN_PARTICLES, MAX_PARTICLES);
 
      // Resample the drawing evenly by arc length (keeps each point's colour)
      const sx = [];
      const sy = [];
      const sc = [];
      for (const v of valid) {
        const share = Math.max(2, Math.round((want * v.L) / total));
        let j = 1;
        for (let s = 0; s < share && sx.length < MAX_PARTICLES; s++) {
          const d = ((s + Math.random()) / share) * v.L;
          while (j < v.cum.length - 1 && v.cum[j] < d) j++;
          const span = v.cum[j] - v.cum[j - 1] || 1;
          const f = fxClamp((d - v.cum[j - 1]) / span, 0, 1);
          const a = v.seg[j - 1];
          const b = v.seg[j];
          sx.push(a.x + (b.x - a.x) * f);
          sy.push(a.y + (b.y - a.y) * f);
          sc.push(f < 0.5 ? a.c : b.c);
        }
      }
      // Short drawing: top up with jittered duplicates so the burst is dense enough.
      const base = sx.length;
      while (sx.length < MIN_PARTICLES) {
        const k = Math.floor(Math.random() * base);
        sx.push(sx[k] + (Math.random() - 0.5) * 8);
        sy.push(sy[k] + (Math.random() - 0.5) * 8);
        sc.push(sc[k]);
      }
 
      const n = Math.min(sx.length, MAX_PARTICLES);
      const prev = active ? count : 0; // an existing cloud is re-exploded, never duplicated
      const newCount = Math.max(n, prev);
 
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i++) {
        cx += sx[i];
        cy += sy[i];
      }
      cx /= n;
      cy /= n;
 
      for (let i = 0; i < n; i++) {
        px[i] = sx[i] + (Math.random() - 0.5) * 2;
        py[i] = sy[i] + (Math.random() - 0.5) * 2;
        spriteIdx[i] = spriteFor(sc[i]);
      }
 
      for (let i = 0; i < newCount; i++) {
        // Burst: outward from the drawing's centre, varied speeds, a little twist
        let ang = Math.atan2(py[i] - cy, px[i] - cx);
        if (Math.hypot(px[i] - cx, py[i] - cy) < 3) ang = Math.random() * Math.PI * 2;
        ang += (Math.random() - 0.5) * 1.0;
        const speed = S * (4 + Math.pow(Math.random(), 1.7) * 20);
        vx[i] = Math.cos(ang) * speed - Math.sin(ang) * speed * 0.4 * (Math.random() - 0.35);
        vy[i] = Math.sin(ang) * speed + Math.cos(ang) * speed * 0.4 * (Math.random() - 0.35);
 
        psize[i] = (1.2 + Math.random() * 1.6) * S;
        phase[i] = Math.random() * Math.PI * 2;
        kVar[i] = 0.7 + Math.random() * 0.6;
        alphaBase[i] = 0.6 + Math.random() * 0.4;
      }
 
      count = newCount;
      age = 0;
      life = 1;
      fade = 1;
      fading = false;
      active = true;
      explosions++;
      return true;
    }
 
    function explodeFromCanvas() {
      const segments = UndoManager.takeAllStrokes(); // everything on the canvas, any number of strokes
      if (!segments.length) return false;
      return explode(segments);
    }
 
    /* ---------- per-frame input handling ---------- */
    function updatePalm(label, t, nowMs, dtSec, freeMode) {
      const p = palms[label];
      const isOpen = enabled && freeMode && t.valid && !t.predicted && t.gesture === 'open';
 
      if (isOpen) {
        if (!p.openSince || nowMs - p.lastOpen > GAP_TOLERANCE_MS) p.openSince = nowMs;
        p.lastOpen = nowMs;
        const c = getPalmCenter(label);
        if (c) {
          if (!p.hasPos) {
            p.x = c.x;
            p.y = c.y;
            p.hasPos = true;
          } else {
            const a = 1 - Math.exp(-dtSec / 0.05); // low-pass: tracking jitter can't shake the field
            p.x += (c.x - p.x) * a;
            p.y += (c.y - p.y) * a;
          }
        }
      } else if (p.openSince && nowMs - p.lastOpen > GAP_TOLERANCE_MS) {
        p.openSince = 0;
        p.charge = 0;
      }
 
      // Re-arm only after the palm has been released for a while (no repeat triggering)
      if (nowMs - p.lastOpen > RELEASE_MS) p.armed = true;
 
      let wantRepel = false;
      if (isOpen && p.armed && p.openSince) {
        const held = nowMs - p.openSince;
        if (UndoManager.hasStrokes()) {
          p.charge = fxClamp(held / HOLD_MS, 0, 1);
          if (held >= HOLD_MS) {
            explodeFromCanvas();
            p.armed = false; // must release the palm before it can act again
            p.charge = 0;
            p.openSince = 0;
          }
        } else {
          p.charge = 0;
          if (active && held >= 120) wantRepel = true;
        }
      } else if (!isOpen) {
        p.charge = 0;
      }
 
      if (wantRepel && !p.wasRepel) p.shock = 1; // a quick push when the palm opens
      p.wasRepel = wantRepel;
      p.shock = Math.max(0, p.shock - dtSec / 0.25);
      const k = 1 - Math.exp(-dtSec / (wantRepel ? 0.08 : 0.18));
      p.repel += ((wantRepel ? 1 : 0) - p.repel) * k;
      if (!isOpen && p.repel < 0.01) p.hasPos = false;
    }
 
    function updateFinger(label, t, dtSec, freeMode) {
      const f = fingers[label];
      const drawing = enabled && freeMode && active && t.valid && !t.predicted && t.gesture === 'draw';
      if (drawing) {
        if (!f.hasPos) {
          f.x = t.x;
          f.y = t.y;
          f.hasPos = true;
        } else {
          const a = 1 - Math.exp(-dtSec / 0.045); // smoothing against jittery tracking
          f.x += (t.x - f.x) * a;
          f.y += (t.y - f.y) * a;
        }
      }
      const k = 1 - Math.exp(-dtSec / (drawing ? 0.12 : 0.25));
      f.engage += ((drawing ? 1 : 0) - f.engage) * k;
      if (!drawing && f.engage < 0.01) {
        f.engage = 0;
        f.hasPos = false;
      }
    }
 
    /* ---------- physics ---------- */
    function step(dtSec, dtScale) {
      const S = Math.max(0.3, Math.min(stageWidth, stageHeight) / 1000);
      age += dtSec;
      const T = age;
 
      // Fast burst that settles into a slow drift
      const drag = fxLerp(0.985, 0.955, fxSmooth(0.25, 1.5, T));
      const dragPow = Math.pow(drag, dtScale);
      const wander = 0.03 * S * fxSmooth(0.4, 1.2, T);
      const vmax = 45 * S;
 
      const RA = 300 * S; // attraction radius
      const RR = 380 * S; // repulsion radius
      const fingerList = [];
      for (const label of ['Left', 'Right']) {
        if (fingers[label].engage > 0.01 && fingers[label].hasPos) fingerList.push(fingers[label]);
      }
      const palmList = [];
      for (const label of ['Left', 'Right']) {
        if (palms[label].repel > 0.01 && palms[label].hasPos) palmList.push(palms[label]);
      }
 
      for (let i = 0; i < count; i++) {
        const x = px[i];
        const y = py[i];
 
        // Gentle individual drifting keeps the cloud alive after the burst
        let ax = Math.cos(age * 0.9 + phase[i] * 3) * wander * kVar[i];
        let ay = Math.sin(age * 1.1 + phase[i] * 2) * wander * kVar[i];
 
        // Finger attraction (particles orbit the fingertip)
        for (let q = 0; q < fingerList.length; q++) {
          const f = fingerList[q];
          const dx = f.x - x;
          const dy = f.y - y;
          const d = Math.hypot(dx, dy);
          if (d < RA) {
            const infl = 1 - d / RA;
            const w = infl * infl * f.engage;
            const ds = Math.max(d, 28 * S);
            const ux = dx / ds;
            const uy = dy / ds;
            ax += ux * 0.9 * S * w - uy * 0.45 * S * w;
            ay += uy * 0.9 * S * w + ux * 0.45 * S * w;
          }
        }
 
        // Palm repulsion
        for (let q = 0; q < palmList.length; q++) {
          const p = palmList[q];
          const dx = x - p.x;
          const dy = y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < RR) {
            const infl = 1 - d / RR;
            const w = Math.pow(infl, 1.5) * p.repel;
            const ds = Math.max(d, 20 * S);
            const push = 3.4 * S * w * (1 + 2.0 * p.shock);
            ax += (dx / ds) * push;
            ay += (dy / ds) * push;
          }
        }
 
        let nvx = (vx[i] + ax * dtScale) * dragPow;
        let nvy = (vy[i] + ay * dtScale) * dragPow;
        const sp = Math.hypot(nvx, nvy);
        if (sp > vmax) {
          nvx *= vmax / sp;
          nvy *= vmax / sp;
        }
        vx[i] = nvx;
        vy[i] = nvy;
 
        let nx = x + nvx * dtScale;
        let ny = y + nvy * dtScale;
        const m = 60;
        if (nx < -m) { nx = -m; vx[i] = Math.abs(vx[i]) * 0.4; }
        else if (nx > stageWidth + m) { nx = stageWidth + m; vx[i] = -Math.abs(vx[i]) * 0.4; }
        if (ny < -m) { ny = -m; vy[i] = Math.abs(vy[i]) * 0.4; }
        else if (ny > stageHeight + m) { ny = stageHeight + m; vy[i] = -Math.abs(vy[i]) * 0.4; }
        px[i] = nx;
        py[i] = ny;
      }
    }
 
    /* ---------- public: called once per frame by RenderEngine ---------- */
    function update(targets, now, dtScale) {
      const dtSec = lastNow ? fxClamp((now - lastNow) / 1000, 0, 0.05) : 0.016;
      lastNow = now;
 
      const freeMode = appState.mode === 'free';
      if (!freeMode && active) reset(); // Practice Mode never shows the cloud
 
      for (const label of ['Left', 'Right']) {
        const t = targets[label];
        if (!t) continue;
        updatePalm(label, t, now, dtSec, freeMode);
        updateFinger(label, t, dtSec, freeMode);
      }
 
      if (!active) return;
 
      if (fading) {
        fade -= dtSec / 0.5;
        if (fade <= 0) {
          reset();
          return;
        }
      }
 
      step(dtSec, dtScale);
 
      // The cloud dissolves on its own and then clears itself.
      life = 1 - fxSmooth(FADE_START_S, FADE_END_S, age);
      if (age >= FADE_END_S) reset();
    }
 
    function render(ctx) {
      if (!active || count === 0 || sprites.length === 0) return;
      const S = Math.max(0.3, Math.min(stageWidth, stageHeight) / 1000);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; // additive: glowing particles on pure black
      const k = SPRITE_PX / SPRITE_CORE; // sprite pixels per pixel of particle core radius
      const master = life * fade;
      for (let i = 0; i < count; i++) {
        const x = px[i];
        const y = py[i];
        if (x < -30 || y < -30 || x > stageWidth + 30 || y > stageHeight + 30) continue;
        const tw = 0.85 + 0.15 * Math.sin(age * 4 + phase[i]);
        const alpha = alphaBase[i] * tw * master;
        const dw = psize[i] * k;
        const sprite = sprites[spriteIdx[i]];
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, x - dw / 2, y - dw / 2, dw, dw);
 
        const sp = Math.hypot(vx[i], vy[i]);
        if (sp > 3 * S) {
          // faint motion trail on fast particles
          ctx.globalAlpha = alpha * 0.3;
          const tw2 = dw * 0.75;
          ctx.drawImage(sprite, x - vx[i] * 1.6 - tw2 / 2, y - vy[i] * 1.6 - tw2 / 2, tw2, tw2);
        }
      }
      ctx.restore();
    }
 
    // Progress ring around the palm while the open-palm hold is charging
    function renderCharge(ctx) {
      const S = Math.max(0.3, Math.min(stageWidth, stageHeight) / 1000);
      for (const label of ['Left', 'Right']) {
        const p = palms[label];
        if (p.charge < 0.03 || !p.hasPos) continue;
        ctx.save();
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 16;
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 56 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#00ffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 56 * S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.charge);
        ctx.stroke();
        ctx.restore();
      }
    }
 
    function reset() {
      active = false;
      count = 0;
      age = 0;
      life = 1;
      fade = 1;
      fading = false;
      for (const label of ['Left', 'Right']) {
        palms[label] = makePalm();
        fingers[label] = makeFinger();
      }
    }
 
    function setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        if (active) fading = true; // the cloud dissolves smoothly
        for (const label of ['Left', 'Right']) {
          palms[label].charge = 0;
          palms[label].openSince = 0;
        }
      }
    }
 
    // Window resized: carry the cloud along with the stretched canvas.
    function handleResize(oldW, oldH) {
      if (!active || !oldW || !oldH) return;
      const sx = stageWidth / oldW;
      const sy = stageHeight / oldH;
      for (let i = 0; i < count; i++) {
        px[i] *= sx;
        py[i] *= sy;
      }
    }
 
    return {
      update,
      render,
      renderCharge,
      reset,
      setEnabled,
      handleResize,
      isEnabled: () => enabled,
      isActive: () => active,
      getStats: () => ({ active, count, age, life, explosions, fade, fading }),
      // exposed for testing / debugging only
      _explode: explode,
      _positions: () => ({ px, py, vx, vy, count }),
    };
  })();
  
  /* =============================================================
     SECTION 12: SIMPLE FINGERTIP CURSOR
     ============================================================= */
  const CursorFX = (() => {
    const FOLLOW_RATE = 0.35;
    const SCALE_RATE = 0.2;
    const BASE_RADIUS = 9;
  
    function createState() {
      return {
        x: 0,
        y: 0,
        initialized: false,
        displayScale: 1,
        color: 'rgba(255,255,255,0.5)',
        visible: false,
      };
    }
  
    const states = { Left: createState(), Right: createState() };
  
    function update(label, target, mode) {
      const st = states[label];
  
      if (!target.valid) {
        st.initialized = false;
        st.visible = false;
        return st;
      }
  
      if (!st.initialized) {
        st.x = target.x;
        st.y = target.y;
        st.initialized = true;
      }
  
      st.x += (target.x - st.x) * FOLLOW_RATE;
      st.y += (target.y - st.y) * FOLLOW_RATE;
      st.visible = true;
  
      let targetScale = 1;
      let targetColor = 'rgba(255,255,255,0.5)';
  
      if (mode === 'erase') {
        targetScale = 1.7;
        targetColor = '#ffffff';
      } else if (mode === 'draw') {
        targetScale = 1.35;
        targetColor = currentBrushColor();
      }
  
      st.displayScale += (targetScale - st.displayScale) * SCALE_RATE;
      st.color = targetColor;
  
      return st;
    }
  
    function render(ctx, st) {
      if (!st.visible) return;
      const radius = BASE_RADIUS * st.displayScale;
  
      ctx.save();
      ctx.shadowColor = st.color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = st.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(st.x, st.y, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
  
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = st.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(st.x, st.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  
    return { update, render };
  })();
  
  /* =============================================================
     SECTION 13: SHAPE GEOMETRY LIBRARY
     ------------------------------------------------------------
     Pure geometry helpers, shared by the reference-outline renderer
     and the evaluator. No canvas/DOM dependencies.
     ============================================================= */
  const ShapeGeometry = (() => {
    const SHAPE_LIST = [
      { id: 'circle', name: 'Circle', icon: '⭕' },
      { id: 'square', name: 'Square', icon: '⬜' },
      { id: 'triangle', name: 'Triangle', icon: '🔺' },
      { id: 'pentagon', name: 'Pentagon', icon: '⬠' },
      { id: 'hexagon', name: 'Hexagon', icon: '⬡' },
      { id: 'star', name: 'Star', icon: '⭐' },
    ];
  
    function regularPolygonVertices(sides, cx, cy, radius) {
      const verts = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
        verts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
      }
      return verts;
    }
  
    function starVertices(spikes, cx, cy, outerR, innerR) {
      const verts = [];
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        verts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      return verts;
    }
  
    function squareVertices(cx, cy, radius) {
      const h = radius * 0.85;
      return [
        { x: cx - h, y: cy - h },
        { x: cx + h, y: cy - h },
        { x: cx + h, y: cy + h },
        { x: cx - h, y: cy + h },
      ];
    }
  
    // Subdivides a closed polyline into N evenly-spaced points by arc
    // length, so every shape gets consistent point density regardless
    // of vertex count or size.
    function densifyClosedPolyline(vertices, n) {
      const segLengths = [];
      let total = 0;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        segLengths.push(len);
        total += len;
      }
  
      const result = [];
      const step = total / n;
      let segIndex = 0;
      let segStart = 0;
  
      for (let i = 0; i < n; i++) {
        const targetDist = i * step;
        while (
          segIndex < segLengths.length - 1 &&
          segStart + segLengths[segIndex] < targetDist
        ) {
          segStart += segLengths[segIndex];
          segIndex++;
        }
        const a = vertices[segIndex];
        const b = vertices[(segIndex + 1) % vertices.length];
        const segLen = segLengths[segIndex] || 1;
        const t = segLen > 0 ? (targetDist - segStart) / segLen : 0;
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      return result;
    }
  
    function circlePoints(cx, cy, radius, n) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
      }
      return pts;
    }
  
    function buildPoints(id, cx, cy, radius, n) {
      switch (id) {
        case 'circle':
          return circlePoints(cx, cy, radius, n);
        case 'square':
          return densifyClosedPolyline(squareVertices(cx, cy, radius), n);
        case 'triangle':
          return densifyClosedPolyline(regularPolygonVertices(3, cx, cy, radius), n);
        case 'pentagon':
          return densifyClosedPolyline(regularPolygonVertices(5, cx, cy, radius), n);
        case 'hexagon':
          return densifyClosedPolyline(regularPolygonVertices(6, cx, cy, radius), n);
        case 'star':
          return densifyClosedPolyline(starVertices(5, cx, cy, radius, radius * 0.45), n);
        default:
          return circlePoints(cx, cy, radius, n);
      }
    }
  
    return { SHAPE_LIST, buildPoints };
  })();
  
  /* =============================================================
     SECTION 14: SHAPE EVALUATOR (reusable scoring module)
     ------------------------------------------------------------
     Pure function module: takes a user's traced points and a
     reference point set, returns an encouraging accuracy score.
     Has no knowledge of canvases, hands, or the app's mode system,
     so future practice-style modes (Letter Practice, Number
     Practice, Connect the Dots) can reuse it directly by supplying
     their own reference point sets.
     ============================================================= */
  const ShapeEvaluator = (() => {
    const MIN_POINTS_REQUIRED = 15;
  
    function boundingBox(points) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }
  
    function nearestDist(point, targetSet) {
      let best = Infinity;
      for (const t of targetSet) {
        const d = Math.hypot(point.x - t.x, point.y - t.y);
        if (d < best) best = d;
      }
      return best;
    }
  
    // Fraction of referencePoints that have a nearby user point
    // (did the user cover the whole outline?).
    function computeCompleteness(userPoints, referencePoints, tolerance) {
      let covered = 0;
      for (const r of referencePoints) {
        if (nearestDist(r, userPoints) <= tolerance) covered++;
      }
      return covered / referencePoints.length;
    }
  
    // Fraction of userPoints that landed near the reference outline
    // (penalizes wild scribbling far from the guide).
    function computePrecision(userPoints, referencePoints, tolerance) {
      let onTarget = 0;
      for (const u of userPoints) {
        if (nearestDist(u, referencePoints) <= tolerance) onTarget++;
      }
      return onTarget / userPoints.length;
    }
  
    // Compares the aspect ratio of the user's drawing bounding box
    // against the reference shape's bounding box.
    function computeProportionScore(userBox, refBox) {
      const userAspect = userBox.width / Math.max(userBox.height, 1);
      const refAspect = refBox.width / Math.max(refBox.height, 1);
      const diff = Math.abs(userAspect - refAspect) / Math.max(refAspect, 0.01);
      return Math.max(0, 1 - Math.min(diff, 1));
    }
  
    // Measures jitter via average turning-angle change between
    // consecutive points (subsampled for performance). Smoother
    // curves have smaller, more consistent turning angles.
    function computeSmoothnessScore(userPoints) {
      if (userPoints.length < 6) return 0.6; // not enough data — neutral score
      const step = Math.max(1, Math.floor(userPoints.length / 60));
      const sampled = userPoints.filter((_, i) => i % step === 0);
  
      let totalJitter = 0;
      let count = 0;
      for (let i = 2; i < sampled.length; i++) {
        const a = sampled[i - 2];
        const b = sampled[i - 1];
        const c = sampled[i];
        const v1 = { x: b.x - a.x, y: b.y - a.y };
        const v2 = { x: c.x - b.x, y: c.y - b.y };
        const len1 = Math.hypot(v1.x, v1.y);
        const len2 = Math.hypot(v2.x, v2.y);
        if (len1 < 0.5 || len2 < 0.5) continue;
  
        const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        totalJitter += angle;
        count++;
      }
  
      if (count === 0) return 0.6;
      const avgJitter = totalJitter / count; // radians, 0 = perfectly straight/smooth
      // Map avg jitter (0..~1.2 rad is a reasonable "shaky" range) to a 0..1 score.
      return Math.max(0, 1 - Math.min(avgJitter / 1.2, 1));
    }
  
    function pickMessage(percent) {
      if (percent >= 90) {
        return 'Excellent!';
      }
      if (percent >= 75) {
        return 'Great attempt! Try making the edges a little straighter.';
      }
      return 'Good start! Try following the guide a little more closely.';
    }
  
    // Main entry point. userPoints/referencePoints are arrays of
    // {x, y} in the same coordinate space (screen pixels).
    function evaluate(userPoints, referencePoints) {
      if (!userPoints || userPoints.length < MIN_POINTS_REQUIRED) {
        return { insufficient: true };
      }
  
      const refBox = boundingBox(referencePoints);
      const userBox = boundingBox(userPoints);
      const shapeRadius = Math.max(refBox.width, refBox.height) / 2 || 1;
      const tolerance = shapeRadius * 0.2; // forgiving hand-drawn tolerance
  
      const completeness = computeCompleteness(userPoints, referencePoints, tolerance);
      const precision = computePrecision(userPoints, referencePoints, tolerance * 1.3);
      const proportion = computeProportionScore(userBox, refBox);
      const smoothness = computeSmoothnessScore(userPoints);
  
      const rawScore =
        completeness * 0.4 + precision * 0.25 + proportion * 0.15 + smoothness * 0.2;
  
      // Floor-clamp so feedback always stays encouraging, per design spec.
      const percent = Math.round(Math.max(40, Math.min(99, rawScore * 100)));
  
      return {
        insufficient: false,
        percent,
        message: pickMessage(percent),
        breakdown: { completeness, precision, proportion, smoothness },
      };
    }
  
    return { evaluate };
  })();
  
  /* =============================================================
     SECTION 15: PRACTICE REFERENCE (static dotted outline layer)
     ------------------------------------------------------------
     Purely visual — renders a thin, semi-transparent dotted guide
     on practiceCanvas. It never reacts to drawing; it is redrawn
     only when the shape changes or the stage resizes.
     ============================================================= */
  const PracticeReference = (() => {
    const POINT_COUNT = 120;
    const DOT_SPACING = 3; // draw every Nth point as a visible dot
  
    let currentPoints = [];
  
    function build(shapeId, stageW, stageH) {
      const radius = Math.min(stageW, stageH) * 0.28;
      const cx = stageW / 2;
      const cy = stageH / 2;
      currentPoints = ShapeGeometry.buildPoints(shapeId, cx, cy, radius, POINT_COUNT);
      return currentPoints;
    }
  
    function render(ctx, stageW, stageH) {
      ctx.clearRect(0, 0, stageW, stageH);
      if (currentPoints.length === 0) return;
  
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.shadowColor = 'rgba(0, 255, 255, 0.6)';
      ctx.shadowBlur = 8;
  
      for (let i = 0; i < currentPoints.length; i += DOT_SPACING) {
        const p = currentPoints[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  
    function getPoints() {
      return currentPoints;
    }
  
    return { build, render, getPoints };
  })();
  
  /* =============================================================
     SECTION 16: PRACTICE MODE (orchestrates reference + evaluation)
     ------------------------------------------------------------
     Records the fingertip points traced while the app is in
     'practice' mode and drives shape switching / evaluation. Does
     NOT touch DrawEngine/EraserEngine — those are called from the
     same processHand() function used by Free Draw.
     ============================================================= */
  const PracticeMode = (() => {
    let currentIndex = 0;
    let userPoints = [];
    let callbacks = {};
  
    function init(cb) {
      callbacks = cb;
    }
  
    function currentShape() {
      return ShapeGeometry.SHAPE_LIST[currentIndex];
    }
  
    function updateLabel() {
      const shape = currentShape();
      if (callbacks.onLabelChange) callbacks.onLabelChange(`${shape.icon} ${shape.name}`);
    }
  
    function regenerate(stageW, stageH) {
      PracticeReference.build(currentShape().id, stageW, stageH);
    }
  
    function setActive(isActive, stageW, stageH) {
      if (isActive) {
        userPoints = [];
        regenerate(stageW, stageH);
        updateLabel();
        if (callbacks.onHideFeedback) callbacks.onHideFeedback();
      }
    }
  
    function resize(stageW, stageH) {
      regenerate(stageW, stageH);
    }
  
    function recordPoint(x, y) {
      const pt = { x, y };
      userPoints.push(pt);
      // Cap memory/perf for very long freehand sessions.
      if (userPoints.length > 4000) userPoints.shift();
      return pt;
    }
  
    // Used by Undo: forget the points that belonged to an undone stroke so
    // "Check My Drawing" only scores ink that is still on the canvas.
    function removePoints(points) {
      const dead = new Set(points);
      userPoints = userPoints.filter((p) => !dead.has(p));
    }
  
    function clearAttempt(stageW, stageH) {
      userPoints = [];
      if (callbacks.onHideFeedback) callbacks.onHideFeedback();
    }
  
    function switchShape(direction, stageW, stageH) {
      currentIndex = (currentIndex + direction + ShapeGeometry.SHAPE_LIST.length) % ShapeGeometry.SHAPE_LIST.length;
      userPoints = [];
      regenerate(stageW, stageH);
      updateLabel();
      if (callbacks.onHideFeedback) callbacks.onHideFeedback();
      if (callbacks.onShapeSwitch) callbacks.onShapeSwitch();
    }
  
    function next(stageW, stageH) {
      switchShape(1, stageW, stageH);
    }
  
    function prev(stageW, stageH) {
      switchShape(-1, stageW, stageH);
    }
  
    function checkDrawing() {
      const referencePoints = PracticeReference.getPoints();
      const result = ShapeEvaluator.evaluate(userPoints, referencePoints);
  
      if (result.insufficient) {
        if (callbacks.onInsufficientAttempt) callbacks.onInsufficientAttempt();
        return;
      }
  
      if (appState.particlesEnabled) {
        // Light celebratory sparkle burst along the reference outline.
        for (let i = 0; i < referencePoints.length; i += 8) {
          const p = referencePoints[i];
          ParticlePool.spawnSparkles(p.x, p.y, '#39ff14');
        }
      }
  
      if (callbacks.onResult) callbacks.onResult(result);
    }
  
    return {
      init,
      setActive,
      resize,
      recordPoint,
      removePoints,
      clearAttempt,
      next,
      prev,
      checkDrawing,
    };
  })();
  
  /* =============================================================
     SECTION 17: CANVAS SETUP / RESIZE (DPR-aware)
     ============================================================= */
  function setupCanvasDPR(canvas, ctx) {
    canvas.width = stageWidth * DPR;
    canvas.height = stageHeight * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  
  function resizeCanvases() {
    const prevStageW = stageWidth;
    const prevStageH = stageHeight;
    stageWidth = appEl.clientWidth;
    stageHeight = appEl.clientHeight;
  
    const prevDraw = drawCanvas.width > 0 ? drawCanvas.toDataURL() : null;
    const prevBloom = bloomCanvas.width > 0 ? bloomCanvas.toDataURL() : null;
  
    setupCanvasDPR(overlayCanvas, overlayCtx);
    setupCanvasDPR(particleCanvas, particleCtx);
    setupCanvasDPR(bloomCanvas, bloomCtx);
    setupCanvasDPR(drawCanvas, drawCtx);
    setupCanvasDPR(practiceCanvas, practiceCtx);
    setupCanvasDPR(handCursorCanvas, handCursorCtx);
  
    UndoManager.handleResize(prevStageW, prevStageH);
    ExplosionFX.handleResize(prevStageW, prevStageH);
  
    if (prevDraw) {
      const img = new Image();
      img.onload = () => drawCtx.drawImage(img, 0, 0, stageWidth, stageHeight);
      img.src = prevDraw;
    }
    if (prevBloom) {
      const img = new Image();
      img.onload = () => bloomCtx.drawImage(img, 0, 0, stageWidth, stageHeight);
      img.src = prevBloom;
    }
  
    if (appState.mode === 'practice') {
      PracticeMode.resize(stageWidth, stageHeight);
    }
  }
  
  function setBloomVisibility() {
    bloomCanvas.style.opacity = appState.glowEnabled ? '0.85' : '0';
  }
  
  setBloomVisibility();
  
  /* =============================================================
     SECTION 18: MODE SWITCHING (Free Draw <-> Practice Mode)
     ============================================================= */
  function applyModeVisibility() {
    const isPractice = appState.mode === 'practice';
  
    practiceStage.classList.toggle('visible', isPractice);
    practiceNavGroup.classList.toggle('hidden', !isPractice);
  
    modeFreeBtn.classList.toggle('active', !isPractice);
    modePracticeBtn.classList.toggle('active', isPractice);
  }
  
  function setMode(mode) {
    if (appState.mode === mode) return;
    appState.mode = mode;
  
    resetHandRenderState(handRenderStates.Left);
    resetHandRenderState(handRenderStates.Right);
  
    applyModeVisibility();
    PracticeMode.setActive(mode === 'practice', stageWidth, stageHeight);
  }
  
  PracticeMode.init({
    onLabelChange: (label) => {
      shapeNameLabel.classList.add('swapping');
      setTimeout(() => {
        shapeNameLabel.textContent = label;
        shapeNameLabel.classList.remove('swapping');
      }, 150);
    },
    onShapeSwitch: () => {
      practiceStage.classList.add('fading');
      setTimeout(() => practiceStage.classList.remove('fading'), 300);
    },
    onResult: (result) => {
      feedbackPercent.textContent = `${result.percent}%`;
      feedbackMessage.textContent = result.message;
      practiceFeedbackCard.classList.remove('hidden');
    },
    onHideFeedback: () => {
      practiceFeedbackCard.classList.add('hidden');
    },
    onInsufficientAttempt: () => {
      feedbackPercent.textContent = '✏️';
      feedbackMessage.textContent = 'Keep going! Trace a bit more of the outline before checking.';
      practiceFeedbackCard.classList.remove('hidden');
    },
  });
  
  modeFreeBtn.addEventListener('click', () => setMode('free'));
  modePracticeBtn.addEventListener('click', () => setMode('practice'));
  
  shapePrevBtn.addEventListener('click', () => PracticeMode.prev(stageWidth, stageHeight));
  shapeNextBtn.addEventListener('click', () => PracticeMode.next(stageWidth, stageHeight));
  checkDrawingBtn.addEventListener('click', () => PracticeMode.checkDrawing());
  
  practiceTryAgainBtn.addEventListener('click', () => {
    practiceFeedbackCard.classList.add('hidden');
    drawCtx.clearRect(0, 0, stageWidth, stageHeight);
    bloomCtx.clearRect(0, 0, stageWidth, stageHeight);
    UndoManager.reset();
    PracticeMode.clearAttempt(stageWidth, stageHeight);
  });
  
  practiceNextShapeBtn.addEventListener('click', () => {
    practiceFeedbackCard.classList.add('hidden');
    drawCtx.clearRect(0, 0, stageWidth, stageHeight);
    bloomCtx.clearRect(0, 0, stageWidth, stageHeight);
    UndoManager.reset();
    PracticeMode.next(stageWidth, stageHeight);
  });
  
  /* =============================================================
     SECTION 19: HAND LANDMARKER SETUP (Tasks Vision)
     ============================================================= */
  let handLandmarker = null;
  let latestLandmarkResult = null;
  let appIsActive = false;
  
  async function initHandTracking() {
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
  
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
  
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  
    startDetectionLoop();
  }
  
  function startDetectionLoop() {
    const useVideoFrameCallback = 'requestVideoFrameCallback' in videoElement;
  
    function detectFrame() {
      if (handLandmarker && videoElement.readyState >= 2) {
        const now = performance.now();
        const result = handLandmarker.detectForVideo(videoElement, now);
        latestLandmarkResult = result;
        HandInputStore.ingest(result, stageWidth, stageHeight, now);
      }
  
      if (appIsActive) {
        if (useVideoFrameCallback) {
          videoElement.requestVideoFrameCallback(detectFrame);
        } else {
          requestAnimationFrame(detectFrame);
        }
      }
    }
  
    if (useVideoFrameCallback) {
      videoElement.requestVideoFrameCallback(detectFrame);
    } else {
      requestAnimationFrame(detectFrame);
    }
  }
  
  /* =============================================================
     SECTION 20: LANDMARK OVERLAY RENDERING
     ============================================================= */
  function renderOverlay() {
    overlayCtx.clearRect(0, 0, stageWidth, stageHeight);
    if (!latestLandmarkResult || !latestLandmarkResult.landmarks) return;
  
    // The overlay canvas is mirrored by CSS (scaleX(-1)), so it uses the
    // un-mirrored mapping; the result lines up with the mirrored fingertip.
    const map = getVideoToStageMap(stageWidth, stageHeight);
    const mx = (p) => p.x * map.w + map.offX;
    const my = (p) => p.y * map.h + map.offY;
  
    for (const landmarks of latestLandmarkResult.landmarks) {
      overlayCtx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
      overlayCtx.lineWidth = 2;
      overlayCtx.shadowColor = '#00ffff';
      overlayCtx.shadowBlur = 8;
  
      for (const [a, b] of HAND_CONNECTIONS) {
        const start = landmarks[a];
        const end = landmarks[b];
        overlayCtx.beginPath();
        overlayCtx.moveTo(mx(start), my(start));
        overlayCtx.lineTo(mx(end), my(end));
        overlayCtx.stroke();
      }
  
      overlayCtx.fillStyle = '#00ffff';
      overlayCtx.shadowColor = '#00ffff';
      overlayCtx.shadowBlur = 15;
  
      for (const point of landmarks) {
        overlayCtx.beginPath();
        overlayCtx.arc(mx(point), my(point), 6, 0, Math.PI * 2);
        overlayCtx.fill();
      }
    }
    overlayCtx.shadowBlur = 0;
  }
  
  /* =============================================================
     SECTION 20B: DEBUG MARKER (press D to toggle, off by default)
     ------------------------------------------------------------
     Draws a red crosshair at the exact mapped fingertip position
     (before the cursor's visual smoothing), the raw normalised
     landmark values, and a green outline of the drawing canvas.
     Used to verify that the fingertip lands where it should,
     especially near the bottom edge.
     ============================================================= */
  const DebugMarker = (() => {
    let enabled = false;
  
    function toggle() {
      enabled = !enabled;
    }
  
    function render(ctx, targets) {
      if (!enabled) return;
  
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.font = '11px monospace';
  
      ctx.strokeStyle = 'rgba(57, 255, 20, 0.7)';
      ctx.strokeRect(0.5, 0.5, stageWidth - 1, stageHeight - 1);
  
      for (const label of ['Left', 'Right']) {
        const t = targets[label];
        if (!t || !t.valid) continue;
  
        ctx.strokeStyle = t.predicted ? 'rgba(255, 200, 0, 0.95)' : 'rgba(255, 60, 60, 0.95)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(t.x - 14, t.y);
        ctx.lineTo(t.x + 14, t.y);
        ctx.moveTo(t.x, t.y - 14);
        ctx.lineTo(t.x, t.y + 14);
        ctx.stroke();
  
        const lm = t.landmarks ? t.landmarks[8] : null;
        const text = lm
          ? `${label} lm(${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}) -> px(${Math.round(t.x)}, ${Math.round(t.y)})`
          : `${label} predicted px(${Math.round(t.x)}, ${Math.round(t.y)})`;
        const tx = Math.max(4, Math.min(t.x + 18, stageWidth - 330));
        const ty = Math.max(14, Math.min(t.y - 10, stageHeight - 8));
        ctx.fillText(text, tx, ty);
      }
  
      ctx.fillStyle = 'rgba(57, 255, 20, 0.9)';
      ctx.fillText(
        `video ${videoElement.videoWidth}x${videoElement.videoHeight} | stage ${stageWidth}x${stageHeight} | ` +
          `canvas ${drawCanvas.width}x${drawCanvas.height} | DPR ${DPR}`,
        8,
        stageHeight - 8
      );
      ctx.restore();
    }
  
    return { toggle, render };
  })();
  
  /* =============================================================
     SECTION 21: RENDER ENGINE (single rAF loop)
     ------------------------------------------------------------
     processHand() is IDENTICAL for Free Draw and Practice Mode —
     both call the same DrawEngine/EraserEngine. The only Practice
     Mode addition is one extra call to PracticeMode.recordPoint()
     when actively drawing in that mode, purely for evaluation data.
     ============================================================= */
  const RenderEngine = (() => {
    let lastFrameTime = performance.now();
    let rafId = null;
  
    function processHand(label) {
      const hs = handRenderStates[label];
      const target = HandInputStore.getSlot(label);
  
      if (!target.valid) {
        DrawEngine.endStroke(hs);
        hs.mode = 'idle';
        hs.lastSampleT = 0;
        return target;
      }
  
      const isNewSample = target.t !== hs.lastSampleT;
  
      if (target.gesture === 'erase') {
        if (hs.mode !== 'erase') {
          DrawEngine.endStroke(hs);
          UndoManager.begin(hs, 'erase');
          EraserEngine.eraseSingle(target.x, target.y, hs);
        } else if (isNewSample && hs.lastProcessed) {
          EraserEngine.eraseSegment(hs.lastProcessed.x, hs.lastProcessed.y, target.x, target.y, hs);
        }
        hs.mode = 'erase';
        hs.lastProcessed = { x: target.x, y: target.y };
        hs.lastSampleT = target.t;
        return target;
      }
  
      if (target.gesture === 'draw') {
        if (hs.mode !== 'draw') {
          DrawEngine.endStroke(hs);
        }
        if (isNewSample || hs.mode !== 'draw') {
          const speed = hs.lastProcessed
            ? Math.hypot(target.x - hs.lastProcessed.x, target.y - hs.lastProcessed.y) / 16
            : 0;
  
          DrawEngine.processDraw(hs, target, speed);
  
          if (appState.mode === 'practice' && !target.predicted) {
            const pt = PracticeMode.recordPoint(target.x, target.y);
            UndoManager.attachPracticePoint(hs, pt);
          }
  
          if (appState.particlesEnabled && !target.predicted) {
            ParticlePool.spawnSparkles(target.x, target.y, currentBrushColor());
            if (speed > 1.0) ParticlePool.spawnExplosion(target.x, target.y, speed * 6, currentBrushColor());
          }
        }
        hs.mode = 'draw';
        hs.lastSampleT = target.t;
        return target;
      }
  
      // 'idle' or 'open' -> stop
      DrawEngine.endStroke(hs);
      hs.mode = 'idle';
      hs.lastSampleT = target.t;
      return target;
    }
  
    function tick(now) {
      if (!appIsActive) return;
  
      const dt = now - lastFrameTime;
      lastFrameTime = now;
      const dtScale = Math.min(dt / 16.6667, 3);
  
      advanceRainbowHue(dt);
  
      const targets = {
        Left: processHand('Left'),
        Right: processHand('Right'),
      };
  
      const cursorStates = {
        Left: CursorFX.update('Left', targets.Left, handRenderStates.Left.mode),
        Right: CursorFX.update('Right', targets.Right, handRenderStates.Right.mode),
      };
  
      const anyDrawing =
        handRenderStates.Left.mode === 'draw' || handRenderStates.Right.mode === 'draw';
      MiniReminder.setDrawingActive(anyDrawing);
  
      particleCtx.clearRect(0, 0, stageWidth, stageHeight);
      ParticlePool.updateAndDraw(particleCtx, dtScale);
      ExplosionFX.update(targets, now, dtScale);
      ExplosionFX.render(particleCtx);
  
      renderOverlay();
  
      if (appState.mode === 'practice') {
        PracticeReference.render(practiceCtx, stageWidth, stageHeight);
      }
  
      handCursorCtx.clearRect(0, 0, stageWidth, stageHeight);
      CursorFX.render(handCursorCtx, cursorStates.Left);
      CursorFX.render(handCursorCtx, cursorStates.Right);
      ExplosionFX.renderCharge(handCursorCtx);
      DebugMarker.render(handCursorCtx, targets);
  
      rafId = requestAnimationFrame(tick);
    }
  
    function start() {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  
    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
    }
  
    return { start, stop };
  })();
  
  /* =============================================================
     SECTION 22: UI CONTROLS (Clear / Save / Sliders / Toggles)
     ============================================================= */
  function clearCanvas() {
    drawCtx.clearRect(0, 0, stageWidth, stageHeight);
    bloomCtx.clearRect(0, 0, stageWidth, stageHeight);
    ParticlePool.clear();
    ExplosionFX.reset();
    resetHandRenderState(handRenderStates.Left);
    resetHandRenderState(handRenderStates.Right);
    UndoManager.reset();
  
    if (appState.mode === 'practice') {
      PracticeMode.clearAttempt(stageWidth, stageHeight);
    }
  }
  
  function saveArtwork() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = stageWidth;
    exportCanvas.height = stageHeight;
    const exportCtx = exportCanvas.getContext('2d');
  
    exportCtx.fillStyle = '#000';
    exportCtx.fillRect(0, 0, stageWidth, stageHeight);
  
    if (appState.glowEnabled) {
      exportCtx.globalAlpha = 0.85;
      exportCtx.filter = 'blur(10px) brightness(1.3)';
      exportCtx.drawImage(bloomCanvas, 0, 0, stageWidth, stageHeight);
      exportCtx.filter = 'none';
      exportCtx.globalAlpha = 1;
    }
  
    exportCtx.drawImage(drawCanvas, 0, 0, stageWidth, stageHeight);
  
    const link = document.createElement('a');
    link.download = `neon-artwork-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }
  
  function toggleGlow() {
    appState.glowEnabled = !appState.glowEnabled;
    glowToggle.classList.toggle('active', appState.glowEnabled);
    setBloomVisibility();
  }
  
  function toggleRainbow() {
    appState.rainbowEnabled = !appState.rainbowEnabled;
    rainbowToggle.classList.toggle('active', appState.rainbowEnabled);
  }
  
  function toggleParticles() {
    appState.particlesEnabled = !appState.particlesEnabled;
    particleToggle.classList.toggle('active', appState.particlesEnabled);
    if (!appState.particlesEnabled) ParticlePool.clear();
  }
  
  clearBtn.addEventListener('click', clearCanvas);
  undoBtn.addEventListener('click', () => UndoManager.undo());
  saveBtn.addEventListener('click', saveArtwork);
  glowToggle.addEventListener('click', toggleGlow);
  rainbowToggle.addEventListener('click', toggleRainbow);
  particleToggle.addEventListener('click', toggleParticles);
  
  /* -------------------------------------------------------------
     PARTICLE EXPLOSION toggle (off by default; see ExplosionFX)
     ------------------------------------------------------------- */
  function toggleExplosion() {
    const on = !ExplosionFX.isEnabled();
    ExplosionFX.setEnabled(on);
    explosionToggle.classList.toggle('active', on);
  }
  
  explosionToggle.addEventListener('click', toggleExplosion);
  
  brushSizeSlider.addEventListener('input', (e) => {
    appState.brushSize = parseInt(e.target.value, 10);
  });
  
  colorPicker.addEventListener('input', (e) => {
    appState.brushColor = e.target.value;
  });
  
  colorSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color;
      appState.brushColor = color;
      colorPicker.value = color;
    });
  });
  
  window.addEventListener('keydown', (e) => {
    if (!appIsActive) return;
    const key = e.key.toLowerCase();
    if (key === 'c') clearCanvas();
    if (key === 's') saveArtwork();
    if (key === 'z') {
      e.preventDefault();
      UndoManager.undo();
    }
    if (key === 'd') DebugMarker.toggle();
    if (key === 'e') toggleExplosion();
  });
  
  /* =============================================================
     SECTION 23: WEBCAM BOOTSTRAP
     ============================================================= */
  async function startWebcam() {
    let stream;
  
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user',
        },
        audio: false,
      });
    } catch (error) {
      console.error('[Gesture Canvas] Webcam permission/access error:', error);
      alert(
        'Could not access your webcam. Please check that camera permission is granted for this site and that no other application is using the camera.'
      );
      return;
    }
  
    videoElement.srcObject = stream;
  
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => resolve();
    });
  
    try {
      appIsActive = true;
      await initHandTracking();
      RenderEngine.start();
      OnboardingController.show();
    } catch (error) {
      console.error('[Gesture Canvas] Hand-tracking initialization error:', error);
      appIsActive = false;
      alert(
        'Your webcam is working, but hand tracking failed to load (unrelated to camera permissions). Check the browser console for details, and try refreshing the page.'
      );
    }
  }
  
  /* =============================================================
     SECTION 24: INIT
     ============================================================= */
  startWebcam();