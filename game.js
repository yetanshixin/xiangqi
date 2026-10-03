/* ============================================================
 * 中国象棋 游戏流程 + 渲染 + 交互 + 音效 + 彩带 + 朗读 + 持久化 + 复盘
 * 依赖：rules.js (XQ)、ai.js (XQAI)、xqengine.js (XQEngine, 基于 xqwlight)
 * ============================================================ */
(function () {
  'use strict';

  const XQ = window.XQ;

  // DOM
  const boardCanvas = document.getElementById('board');
  const ctx = boardCanvas.getContext('2d');
  const confettiCanvas = document.getElementById('confetti');
  const confettiCtx = confettiCanvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const undoBtn = document.getElementById('undoBtn');
  const resignBtn = document.getElementById('resignBtn');
  const speakBtn = document.getElementById('speakBtn');
  const reviewPanel = document.getElementById('reviewPanel');
  const reviewInput = document.getElementById('reviewInput');
  const reviewStep = document.getElementById('reviewStep');
  const reviewHint = document.getElementById('reviewHint');
  const copyReviewBtn = document.getElementById('copyReviewBtn');
  const loadReviewBtn = document.getElementById('loadReviewBtn');
  const navStartBtn = document.getElementById('navStartBtn');
  const navPrevBtn = document.getElementById('navPrevBtn');
  const navNextBtn = document.getElementById('navNextBtn');
  const navEndBtn = document.getElementById('navEndBtn');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultTitle = document.getElementById('resultTitle');
  const reviewGameBtn = document.getElementById('reviewGameBtn');
  const againBtn = document.getElementById('againBtn');
  const copyHint = document.getElementById('copyHint');
  const aiComment = document.getElementById('aiComment');
  const aiCommentText = document.getElementById('aiCommentText');

  // 状态
  let board, mode, humanSide, current, over, winner, thinking, flipped, speakEnabled;
  let history = [];
  let selected = null, legalMoves = [], lastMove = null;
  let boardSizePx = 500, boardSizePy = 556;
  let reviewMoves = [], reviewIndex = 0;

  const SAVE_KEY = 'xiangqi_save_v1';

  /* ---------------- 状态辅助 ---------------- */
  function aiSide() { return XQ.oppSide(humanSide); }
  function sideName(s) { return s === XQ.RED ? '红方' : '黑方'; }

  function canHumanMove() {
    if (mode === 'review' || over) return false;
    if (mode === 'pve') return !thinking && current === humanSide;
    return true;
  }

  function updateStatus() {
    statusEl.classList.remove('turn-red', 'turn-black', 'turn-win', 'turn-review');
    if (mode === 'review') {
      statusEl.textContent = '复盘模式 · 第 ' + reviewIndex + ' / ' + reviewMoves.length + ' 步';
      statusEl.classList.add('turn-review');
    } else if (over) {
      statusEl.textContent = winner ? sideName(winner) + '获胜！' : '平局';
      statusEl.classList.add('turn-win');
    } else if (mode === 'pve' && thinking) {
      statusEl.textContent = '电脑思考中…';
      statusEl.classList.add(current === XQ.RED ? 'turn-red' : 'turn-black');
    } else {
      statusEl.textContent = '轮到' + sideName(current) + (mode === 'pve' && current === humanSide ? '（你）' : '');
      statusEl.classList.add(current === XQ.RED ? 'turn-red' : 'turn-black');
    }
  }

  function updateControlsVisibility() {
    const pve = mode === 'pve';
    const review = mode === 'review';
    document.getElementById('sideGroup').style.display = pve ? '' : 'none';
    reviewPanel.style.display = review ? '' : 'none';
    undoBtn.style.display = review ? 'none' : '';
    resignBtn.style.display = review ? 'none' : '';
    speakBtn.style.display = pve ? '' : 'none';
    aiComment.style.display = (pve || review) ? '' : 'none'; // 人机与复盘都显示解释气泡
  }

  /* ---------------- 走子 ---------------- */
  function performMove(move, side, comment) {
    const notation = XQ.moveNotation(board, move);
    const captured = board[move.tr][move.tc];
    board[move.tr][move.tc] = move.piece;
    board[move.fr][move.fc] = 0;
    history.push({ fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc, piece: move.piece, captured, side, notation, comment: comment || '' });
    lastMove = { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc };
    selected = null;
    legalMoves = [];

    const opp = XQ.oppSide(side);
    const check = XQ.isInCheck(board, opp);
    const noMoves = !XQ.hasLegalMove(board, opp);

    if (noMoves) {
      endGame(side, check);
      return;
    }

    if (captured) playCapture();
    else playPlace();
    if (check) playCheck();

    current = opp;
    updateStatus();
    render();
    saveState();
  }

  function endGame(wp, isMate) {
    over = true;
    winner = wp;
    thinking = false;
    const humanWin = (mode === 'pvp') ? true : (wp === humanSide);
    if (humanWin) { playWin(); launchConfetti(); }
    else { playLose(); }
    updateStatus();
    render();
    showResultOverlay(wp);
    saveState();
  }

  /* ---------------- 人类落子 ---------------- */
  function attemptMove(from, to) {
    if (!canHumanMove()) return;
    const mv = XQ.genMoves(board, current).find(m => m.fr === from.r && m.fc === from.c && m.tr === to.r && m.tc === to.c);
    if (!mv) return;
    performMove(mv, current, null);
    afterMove();
  }

  function afterMove() {
    if (over) return;
    if (mode === 'pve') maybeTriggerAI();
  }

  /* ---------------- AI ---------------- */
  function maybeTriggerAI() {
    if (mode !== 'pve' || over || current !== aiSide()) return;
    thinking = true;
    updateStatus();
    render();
    aiMove();
  }

  function aiMove() {
    if (mode !== 'pve' || over || current !== aiSide()) return;
    const side = aiSide();
    try {
      // 走子前评估（AI 视角）
      const beforeCp = XQEngine.evaluate(board, side);
      // 搜索最佳走法（同步，xqwlight 纯 JS）
      const mv = XQEngine.search(board, side, 16, 1500);
      if (!mv || !XQ.inBoard(mv.fr, mv.fc) || !XQ.inBoard(mv.tr, mv.tc) || board[mv.fr][mv.fc] === 0) {
        throw new Error('引擎未返回有效走法');
      }
      const move = { fr: mv.fr, fc: mv.fc, tr: mv.tr, tc: mv.tc, piece: board[mv.fr][mv.fc], captured: board[mv.tr][mv.tc] };

      // 走子后评估（转 AI 视角）
      const afterBoard = XQ.applyMove(board, move);
      const afterCp = -XQEngine.evaluate(afterBoard, XQ.oppSide(side));

      const comment = XQAI.explainMove(board, move, side, { beforeCp, afterCp });

      thinking = false;
      showAiComment(comment);
      speak(comment);
      performMove(move, side, comment);
      afterMove();
    } catch (e) {
      thinking = false;
      statusEl.textContent = '引擎出错：' + e.message;
      render();
    }
  }

  function showAiComment(text) {
    aiCommentText.textContent = text || '';
  }

  function refreshAiComment() {
    if (mode !== 'pve') return;
    let lastAi = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].side === aiSide()) { lastAi = history[i]; break; }
    }
    if (lastAi && lastAi.comment) showAiComment(lastAi.comment);
    else showAiComment('');
  }

  /* ---------------- 悔棋 / 重开 / 翻转 ---------------- */
  function undo() {
    if (thinking) return;
    let steps = 1;
    if (mode === 'pve') {
      // 若人类刚获胜，只悔人类一手；否则悔人类+电脑两手
      if (over && winner === humanSide) steps = 1;
      else steps = 2;
    }
    if (history.length < steps) return;
    for (let i = 0; i < steps; i++) {
      const m = history.pop();
      board[m.fr][m.fc] = m.piece;
      board[m.tr][m.tc] = m.captured;
    }
    over = false;
    winner = null;
    selected = null;
    legalMoves = [];
    lastMove = history.length ? history[history.length - 1] : null;
    current = history.length ? XQ.oppSide(history[history.length - 1].side) : XQ.RED;
    updateStatus();
    render();
    saveState();
    if (mode === 'pve') refreshAiComment();
  }

  function resetGame() {
    board = XQ.initBoard();
    history = [];
    current = XQ.RED;
    over = false;
    winner = null;
    thinking = false;
    selected = null;
    legalMoves = [];
    lastMove = null;
    reviewMoves = [];
    reviewIndex = 0;
    reviewInput.value = '';
    showAiComment('');
    updateControlsVisibility();
    updateStatus();
    render();
    saveState();
    maybeTriggerAI();
  }

  function resign() {
    if (mode === 'review' || over) return;
    endGame(XQ.oppSide(current)); // 当前回合方认输，对方获胜
  }

  /* ---------------- 渲染 ---------------- */
  function resizeCanvas() {
    const wrap = boardCanvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    boardSizePx = w; boardSizePy = h;
    boardCanvas.width = Math.round(w * dpr);
    boardCanvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function geom() {
    const m = 0.6;
    const cell = Math.min(boardSizePx / (8 + 2 * m), boardSizePy / (9 + 2 * m));
    const ox = (boardSizePx - 8 * cell) / 2;
    const oy = (boardSizePy - 9 * cell) / 2;
    return { cell, ox, oy };
  }

  function centerOf(r, c) {
    const { cell, ox, oy } = geom();
    return { x: ox + c * cell, y: oy + r * cell, cell };
  }

  function render() {
    const px = boardSizePx, py = boardSizePy;
    ctx.clearRect(0, 0, px, py);
    ctx.save();
    if (flipped) {
      ctx.translate(px / 2, py / 2);
      ctx.rotate(Math.PI);
      ctx.translate(-px / 2, -py / 2);
    }
    drawBackground();
    drawGrid();
    drawRiver();
    drawPalaces();
    drawMarks();
    drawLastMove();
    drawSelectionAndMoves();
    drawCheck();
    drawPieces();
    ctx.restore();
  }

  function drawBackground() {
    const { cell, ox, oy } = geom();
    const x0 = ox - cell, y0 = oy - cell, x1 = ox + 9 * cell, y1 = oy + 10 * cell;
    const g = ctx.createLinearGradient(0, 0, boardSizePx, boardSizePy);
    g.addColorStop(0, '#e6bd7d');
    g.addColorStop(1, '#c9924a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, boardSizePx, boardSizePy);
    // 木纹
    for (let i = 0; i < 16; i++) {
      ctx.strokeStyle = 'rgba(120,70,20,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const yy = (i / 16) * boardSizePy;
      ctx.moveTo(0, yy); ctx.lineTo(boardSizePx, yy + 10); ctx.stroke();
    }
  }

  function drawGrid() {
    const { cell, ox, oy } = geom();
    ctx.strokeStyle = 'rgba(70,40,15,0.8)';
    ctx.lineWidth = 1;
    // 横线 10 条
    for (let r = 0; r < 10; r++) {
      const y = oy + r * cell;
      ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + 8 * cell, y); ctx.stroke();
    }
    // 竖线：两侧(列0、8)贯通；中间(列1~7)断河
    for (let c = 0; c < 9; c++) {
      const x = ox + c * cell;
      if (c === 0 || c === 8) {
        ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + 9 * cell); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + 4 * cell); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, oy + 5 * cell); ctx.lineTo(x, oy + 9 * cell); ctx.stroke();
      }
    }
    // 边框
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, 8 * cell, 9 * cell);
  }

  function drawRiver() {
    const { cell, ox, oy } = geom();
    const y = oy + 4.5 * cell;
    ctx.fillStyle = 'rgba(90,55,20,0.85)';
    ctx.font = '600 ' + Math.round(cell * 0.72) + 'px "KaiTi","STKaiti","SimSun",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('楚 河', ox + 2 * cell, y);
    ctx.fillText('漢 界', ox + 6 * cell, y);
  }

  function drawPalaces() {
    const { cell, ox, oy } = geom();
    ctx.strokeStyle = 'rgba(70,40,15,0.8)';
    ctx.lineWidth = 1;
    const palaces = [[0, 3], [7, 3]];
    for (const [r0, c0] of palaces) {
      ctx.beginPath();
      ctx.moveTo(ox + c0 * cell, oy + r0 * cell);
      ctx.lineTo(ox + (c0 + 2) * cell, oy + (r0 + 2) * cell);
      ctx.moveTo(ox + (c0 + 2) * cell, oy + r0 * cell);
      ctx.lineTo(ox + c0 * cell, oy + (r0 + 2) * cell);
      ctx.stroke();
    }
  }

  // 炮位 / 兵卒位 标记
  function drawMarks() {
    const { cell, ox, oy } = geom();
    const marks = [
      [2, 1], [2, 7], [7, 1], [7, 7], // 炮
      [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], // 卒
      [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]  // 兵
    ];
    const d = cell * 0.14, s = cell * 0.16;
    ctx.strokeStyle = 'rgba(70,40,15,0.8)';
    ctx.lineWidth = 1;
    for (const [r, c] of marks) {
      const x = ox + c * cell, y = oy + r * cell;
      const corners = [
        [x - s, y - d, x - d, y - d], [x - s, y - d, x - s, y + d],
        [x + s, y - d, x + d, y - d], [x + s, y - d, x + s, y + d],
        [x - s, y + d, x - d, y + d], [x - s, y + d, x - s, y - d],
        [x + s, y + d, x + d, y + d], [x + s, y + d, x + s, y - d]
      ];
      for (const [ax, ay, bx, by] of corners) {
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
  }

  function drawLastMove() {
    if (!lastMove) return;
    const { cell } = geom();
    for (const [r, c] of [[lastMove.fr, lastMove.fc], [lastMove.tr, lastMove.tc]]) {
      if (board[r][c] === 0) continue;
      const { x, y } = centerOf(r, c);
      ctx.strokeStyle = 'rgba(255,90,60,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, cell * 0.47, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawSelectionAndMoves() {
    if (!selected) return;
    const { cell } = geom();
    const { x, y } = centerOf(selected.r, selected.c);
    ctx.fillStyle = 'rgba(255,160,0,0.35)';
    ctx.beginPath(); ctx.arc(x, y, cell * 0.47, 0, Math.PI * 2); ctx.fill();

    for (const m of legalMoves) {
      const { x: mx, y: my } = centerOf(m.tr, m.tc);
      if (board[m.tr][m.tc] !== 0) {
        // 吃子：红圈
        ctx.strokeStyle = 'rgba(255,60,60,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mx, my, cell * 0.46, 0, Math.PI * 2); ctx.stroke();
      } else {
        // 落点：圆点
        ctx.fillStyle = 'rgba(20,120,220,0.5)';
        ctx.beginPath(); ctx.arc(mx, my, cell * 0.12, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawCheck() {
    if (over) return;
    const k = XQ.findKing(board, current);
    if (!k || !XQ.isInCheck(board, current)) return;
    const { x, y, cell } = centerOf(k.r, k.c);
    ctx.strokeStyle = 'rgba(255,0,0,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, cell * 0.5, 0, Math.PI * 2); ctx.stroke();
  }

  function drawPieces() {
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 9; c++)
        if (board[r][c] !== 0) drawPiece(r, c, board[r][c]);
  }

  function drawPiece(r, c, piece) {
    const { x, y, cell } = centerOf(r, c);
    const R = cell * 0.44;
    const red = XQ.sideOf(piece) === XQ.RED;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
    g.addColorStop(0, '#f7e9c9');
    g.addColorStop(0.75, '#e9d4a6');
    g.addColorStop(1, '#d4b97f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.strokeStyle = red ? '#c0392b' : '#2b2b2b';
    ctx.lineWidth = Math.max(1.5, cell * 0.06);
    ctx.beginPath(); ctx.arc(x, y, R * 0.94, 0, Math.PI * 2); ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    if (!red) ctx.rotate(Math.PI);
    ctx.fillStyle = red ? '#c0392b' : '#1a1a1a';
    ctx.font = 'bold ' + Math.round(cell * 0.68) + 'px "KaiTi","STKaiti","SimSun",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(XQ.pieceName(XQ.sideOf(piece), XQ.typeOf(piece)), 0, 0);
    ctx.restore();
  }

  /* ---------------- 交互 ---------------- */
  function sqFromPoint(px, py) {
    let x = px, y = py;
    if (flipped) { x = boardSizePx - px; y = boardSizePy - py; }
    const { cell, ox, oy } = geom();
    const c = Math.round((x - ox) / cell);
    const r = Math.round((y - oy) / cell);
    if (r < 0 || r > 9 || c < 0 || c > 8) return null;
    const { x: cx, y: cy } = centerOf(r, c);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > (cell * 0.55) * (cell * 0.55)) return null;
    return { r, c };
  }

  function selectPiece(r, c) {
    selected = { r, c };
    legalMoves = XQ.genMoves(board, current).filter(m => m.fr === r && m.fc === c);
    render();
  }

  function onPointerDown(e) {
    e.preventDefault();
    ensureAudio();
    if (!canHumanMove()) return;
    const rect = boardCanvas.getBoundingClientRect();
    const sq = sqFromPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (!sq) return;

    // 若已选中，尝试走子
    if (selected) {
      const hit = legalMoves.find(m => m.tr === sq.r && m.tc === sq.c);
      if (hit) { attemptMove(selected, sq); return; }
    }
    // 选择己方棋子
    if (board[sq.r][sq.c] !== 0 && XQ.sideOf(board[sq.r][sq.c]) === current) {
      selectPiece(sq.r, sq.c);
    } else {
      selected = null; legalMoves = [];
      render();
    }
  }

  /* ---------------- 音效（Web Audio 合成） ---------------- */
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function tone(freq, start, dur, type, vol) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + start;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function playPlace() {
    ensureAudio();
    tone(520, 0, 0.09, 'triangle', 0.3);
    tone(780, 0, 0.05, 'sine', 0.12);
  }
  function playCapture() {
    ensureAudio();
    tone(320, 0, 0.1, 'square', 0.22);
    tone(240, 0.03, 0.12, 'triangle', 0.2);
  }
  function playCheck() {
    ensureAudio();
    tone(660, 0, 0.1, 'sine', 0.2);
    tone(880, 0.1, 0.12, 'sine', 0.2);
  }
  function playWin() {
    ensureAudio();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.13, 0.28, 'triangle', 0.3));
  }
  function playLose() {
    ensureAudio();
    [392, 311.13, 261.63].forEach((f, i) => tone(f, i * 0.17, 0.32, 'sawtooth', 0.16));
  }

  /* ---------------- 朗读 ---------------- */
  let zhVoice = null;
  function initSpeech() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      const vs = speechSynthesis.getVoices();
      zhVoice = vs.find(v => v.lang && v.lang.toLowerCase().indexOf('zh') === 0) || null;
    };
    load();
    if (typeof speechSynthesis.onvoiceschanged !== 'undefined') speechSynthesis.onvoiceschanged = load;
  }
  function updateSpeakBtn() {
    speakBtn.textContent = speakEnabled ? '🔊 朗读开' : '🔇 朗读关';
    speakBtn.classList.toggle('active', speakEnabled);
  }
  function speak(text) {
    if (!speakEnabled || !text || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (zhVoice) u.voice = zhVoice;
      u.rate = 1.0;
      speechSynthesis.speak(u);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 彩带 ---------------- */
  let confettiParts = [], confettiAnimId = null;
  function launchConfetti() {
    const w = window.innerWidth, h = window.innerHeight;
    confettiCanvas.width = w; confettiCanvas.height = h;
    confettiCanvas.style.width = w + 'px'; confettiCanvas.style.height = h + 'px';
    const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff9f45', '#c792ea', '#f472b6', '#22d3ee'];
    const n = Math.min(200, Math.max(80, Math.floor(w * h / 9000)));
    confettiParts = [];
    for (let i = 0; i < n; i++) {
      confettiParts.push({
        x: Math.random() * w, y: -30 - Math.random() * h * 0.4,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 7,
        color: colors[(Math.random() * colors.length) | 0],
        vx: (Math.random() - 0.5) * 2.5, vy: 2 + Math.random() * 3.5,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3,
        sway: Math.random() * Math.PI * 2, swaySpeed: 0.02 + Math.random() * 0.04
      });
    }
    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
    let last = performance.now();
    function tick(now) {
      const dt = Math.min(50, now - last); last = now;
      confettiCtx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of confettiParts) {
        p.sway += p.swaySpeed * dt;
        p.x += (p.vx + Math.sin(p.sway) * 0.6) * dt * 0.06;
        p.y += p.vy * dt * 0.06;
        p.rot += p.vr * dt * 0.06;
        if (p.y < h + 30) alive = true;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.globalAlpha = p.y > h - 40 ? Math.max(0, (h - p.y) / 40) : 1;
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        confettiCtx.restore();
      }
      if (alive) confettiAnimId = requestAnimationFrame(tick);
      else { confettiCtx.clearRect(0, 0, w, h); confettiAnimId = null; }
    }
    confettiAnimId = requestAnimationFrame(tick);
  }

  /* ---------------- 对局导出 / 复盘 ---------------- */
  function exportGame() {
    return history.map(m => XQ.sqToUci(m.fr, m.fc) + XQ.sqToUci(m.tr, m.tc)).join(' ');
  }

  function parseGame(text) {
    const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
    const moves = [];
    for (const tok of tokens) {
      if (tok.length !== 4) throw new Error('无效走法：' + tok);
      const from = XQ.uciToSq(tok.slice(0, 2));
      const to = XQ.uciToSq(tok.slice(2, 4));
      if (!XQ.inBoard(from.r, from.c) || !XQ.inBoard(to.r, to.c)) throw new Error('坐标越界：' + tok);
      moves.push({ fr: from.r, fc: from.c, tr: to.r, tc: to.c });
    }
    if (moves.length === 0) throw new Error('没有解析到任何走法');
    return moves;
  }

  function replayToIndex() {
    // 依据 reviewMoves[0..reviewIndex) 重建棋盘（并推导记谱）
    board = XQ.initBoard();
    for (let i = 0; i < reviewIndex; i++) {
      const m = reviewMoves[i];
      const piece = board[m.fr][m.fc];
      if (piece === 0) break;
      m.piece = m.piece || piece;
      m.captured = m.captured || board[m.tr][m.tc];
      m.side = m.side || XQ.sideOf(piece);
      m.notation = m.notation || XQ.moveNotation(board, m);
      board[m.tr][m.tc] = piece;
      board[m.fr][m.fc] = 0;
    }
    lastMove = reviewIndex > 0 ? reviewMoves[reviewIndex - 1] : null;
    selected = null;
    legalMoves = [];
    reviewStep.textContent = '第 ' + reviewIndex + ' / ' + reviewMoves.length + ' 步';
    // 显示当前步解释
    if (reviewIndex > 0 && reviewMoves[reviewIndex - 1].comment) {
      showAiComment(reviewMoves[reviewIndex - 1].comment);
    } else if (reviewIndex > 0) {
      showAiComment(reviewMoves[reviewIndex - 1].notation || '');
    } else {
      showAiComment('');
    }
    updateStatus();
    render();
  }

  function enterReview() {
    reviewMoves = [];
    reviewIndex = 0;
    // 把当前对局码填入输入框，供复制或「导入对局」解析（类似五子棋的对局码）
    reviewInput.value = history.length ? exportGame() : '';
    reviewHint.textContent = '';
    updateControlsVisibility();
    replayToIndex();
  }

  function loadReview(text) {
    try {
      reviewMoves = parseGame(text);
      reviewIndex = reviewMoves.length;
      reviewHint.textContent = '已导入 ' + reviewMoves.length + ' 步';
      replayToIndex();
    } catch (e) {
      reviewHint.textContent = e.message;
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '0'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function showHint(el, text) {
    el.textContent = text;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 2500);
  }

  function showResultOverlay(wp) {
    resultTitle.textContent = sideName(wp) + '获胜！';
    copyHint.textContent = '';
    resultOverlay.style.display = 'flex';
  }
  function hideResultOverlay() {
    resultOverlay.style.display = 'none';
  }

  /* ---------------- localStorage 持久化 ---------------- */
  function saveState() {
    try {
      const data = {
        mode, humanSide, current, over, winner, flipped, speakEnabled,
        history, reviewIndex, reviewMoves
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* 存储满或隐私模式 */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.history)) return false;
      mode = (d.mode === 'pvp' || d.mode === 'pve' || d.mode === 'review') ? d.mode : 'pve';
      humanSide = d.humanSide === XQ.BLACK ? XQ.BLACK : XQ.RED;
      flipped = (humanSide === XQ.BLACK); // 执黑则黑棋靠近我
      speakEnabled = !!d.speakEnabled;
      over = !!d.over;
      winner = d.winner === XQ.RED || d.winner === XQ.BLACK ? d.winner : null;
      board = XQ.initBoard();
      history = [];
      for (const h of d.history) {
        if (board[h.fr][h.fc] === 0) break; // 数据异常则截断
        history.push(h);
        board[h.tr][h.tc] = board[h.fr][h.fc];
        board[h.fr][h.fc] = 0;
      }
      current = (d.current === XQ.RED || d.current === XQ.BLACK) ? d.current : XQ.RED;
      reviewMoves = Array.isArray(d.reviewMoves) ? d.reviewMoves : [];
      reviewIndex = d.reviewIndex || 0;
      lastMove = history.length ? history[history.length - 1] : null;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 绑定 UI ---------------- */
  function bindUI() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        ensureAudio();
        selected = null; legalMoves = [];
        if (mode === 'review') {
          enterReview();
        } else {
          flipped = (mode === 'pve') ? (humanSide === XQ.BLACK) : false; // 人机按执方朝向，双人固定红在下
          updateControlsVisibility();
          updateStatus();
          render();
          saveState();
          if (mode === 'pve') maybeTriggerAI();
        }
      });
    });

    document.querySelectorAll('.side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        humanSide = btn.dataset.side === 'black' ? XQ.BLACK : XQ.RED;
        document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b === btn));
        flipped = (humanSide === XQ.BLACK); // 执黑则黑棋靠近我（翻转）
        ensureAudio();
        resetGame();
      });
    });

    undoBtn.addEventListener('click', () => { ensureAudio(); undo(); });
    resignBtn.addEventListener('click', () => { ensureAudio(); resign(); });

    loadReviewBtn.addEventListener('click', () => { ensureAudio(); loadReview(reviewInput.value); });
    copyReviewBtn.addEventListener('click', () => {
      const text = reviewInput.value.trim();
      if (!text) { showHint(reviewHint, '没有可复制的对局'); return; }
      copyText(text).then(() => showHint(reviewHint, '已复制到剪贴板 ✓'), () => showHint(reviewHint, '复制失败，请手动复制'));
    });
    navStartBtn.addEventListener('click', () => { reviewIndex = 0; replayToIndex(); });
    navPrevBtn.addEventListener('click', () => { reviewIndex = Math.max(0, reviewIndex - 1); replayToIndex(); });
    navNextBtn.addEventListener('click', () => { reviewIndex = Math.min(reviewMoves.length, reviewIndex + 1); replayToIndex(); });
    navEndBtn.addEventListener('click', () => { reviewIndex = reviewMoves.length; replayToIndex(); });

    reviewGameBtn.addEventListener('click', () => {
      mode = 'review';
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'review'));
      hideResultOverlay();
      enterReview();
      loadReview(exportGame()); // 自动加载刚结束的对局并回放到终局
      saveState();
    });
    againBtn.addEventListener('click', () => { ensureAudio(); hideResultOverlay(); resetGame(); });
    resultOverlay.addEventListener('click', (e) => { if (e.target === resultOverlay) hideResultOverlay(); });

    boardCanvas.addEventListener('pointerdown', onPointerDown);

    initSpeech();
    updateSpeakBtn();
    speakBtn.addEventListener('click', () => {
      speakEnabled = !speakEnabled;
      updateSpeakBtn();
      if (!speakEnabled && 'speechSynthesis' in window) speechSynthesis.cancel();
      saveState();
    });

    window.addEventListener('resize', resizeCanvas);
  }

  function exportGameFromReview() {
    return reviewMoves.map(m => XQ.sqToUci(m.fr, m.fc) + XQ.sqToUci(m.tr, m.tc)).join(' ');
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    speakEnabled = false;
    humanSide = XQ.RED;
    mode = 'pve';
    flipped = false;
    if (!loadState()) {
      board = XQ.initBoard();
      current = XQ.RED;
      over = false;
      winner = null;
      history = [];
      lastMove = null;
      reviewMoves = [];
      reviewIndex = 0;
    }
    selected = null;
    legalMoves = [];
    thinking = false;

    // 同步 UI 按钮激活态
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b.dataset.side === (humanSide === XQ.RED ? 'red' : 'black')));

    bindUI();
    updateSpeakBtn();
    updateControlsVisibility();
    updateStatus();
    resizeCanvas();

    // 复盘模式恢复进度
    if (mode === 'review') {
      if (reviewMoves.length) replayToIndex();
      else enterReview();
    } else {
      refreshAiComment();
    }
    maybeTriggerAI();
  }

  // 调试接口（只读）
  window.__xq = {
    getBoard: () => board.map(r => r.slice()),
    getCurrent: () => current,
    getMode: () => mode,
    getStatus: () => statusEl.textContent,
    getHistory: () => history.map(h => ({ ...h })),
    getSelected: () => selected,
    getLegalMoves: () => legalMoves.slice(),
    exportGame
  };

  init();
})();
