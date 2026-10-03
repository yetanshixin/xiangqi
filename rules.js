/* ============================================================
 * 中国象棋规则引擎（纯逻辑，无 DOM 依赖）
 * 棋盘坐标：row 0~9（上→下，0=黑方底线，9=红方底线）
 *           col 0~8（左→右，红方视角）
 * 棋子编码：正整数 = 红方，负整数 = 黑方，|值| = 兵种
 *   1=帅/将 2=仕/士 3=相/象 4=马 5=车 6=炮 7=兵/卒
 * ============================================================ */
(function () {
  'use strict';

  const RED = 1, BLACK = 2;
  const KING = 1, ADVISOR = 2, ELEPHANT = 3, HORSE = 4, ROOK = 5, CANNON = 6, PAWN = 7;
  const ROWS = 10, COLS = 9;

  // 子力价值（用于解释与评估）
  const VALUE = { 1: 10000, 2: 200, 3: 200, 4: 400, 5: 900, 6: 450, 7: 100 };

  // 记谱用字
  const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const PIECE_CN = {
    [RED]: { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵' },
    [BLACK]: { 1: '将', 2: '士', 3: '象', 4: '马', 5: '车', 6: '炮', 7: '卒' }
  };
  const FEN_PIECE = { 1: 'k', 2: 'a', 3: 'b', 4: 'n', 5: 'r', 6: 'c', 7: 'p' };

  function sign(side) { return side === RED ? 1 : -1; }
  function sideOf(p) { return p > 0 ? RED : BLACK; }
  function typeOf(p) { return Math.abs(p); }
  function inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  function oppSide(side) { return side === RED ? BLACK : RED; }

  /* ---------------- 初始局面 ---------------- */
  function initBoard() {
    const b = [];
    for (let r = 0; r < ROWS; r++) b.push(new Array(COLS).fill(0));
    // 黑方（上半）
    b[0] = [-ROOK, -HORSE, -ELEPHANT, -ADVISOR, -KING, -ADVISOR, -ELEPHANT, -HORSE, -ROOK];
    b[2][1] = -CANNON; b[2][7] = -CANNON;
    for (let c = 0; c < COLS; c += 2) b[3][c] = -PAWN;
    // 红方（下半）
    b[9] = [ROOK, HORSE, ELEPHANT, ADVISOR, KING, ADVISOR, ELEPHANT, HORSE, ROOK];
    b[7][1] = CANNON; b[7][7] = CANNON;
    for (let c = 0; c < COLS; c += 2) b[6][c] = PAWN;
    return b;
  }

  function clone(b) { return b.map(row => row.slice()); }

  /* ---------------- 位置判定 ---------------- */
  function inPalace(r, c, side) {
    if (c < 3 || c > 5) return false;
    return side === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  }
  function inOwnHalf(r, side) {
    return side === RED ? (r >= 5 && r <= 9) : (r >= 0 && r <= 4);
  }
  function pawnCrossed(r, side) {
    return side === RED ? (r <= 4) : (r >= 5);
  }
  function findKing(b, side) {
    const k = sign(side) * KING;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (b[r][c] === k) return { r, c };
    return null;
  }

  /* ---------------- 攻击与将军判定 ---------------- */
  // 两将是否照面（同列且中间无子）——也属"被将军"的一种
  function kingsFacing(b) {
    const rk = findKing(b, RED), bk = findKing(b, BLACK);
    if (!rk || !bk || rk.c !== bk.c) return false;
    const lo = Math.min(rk.r, bk.r), hi = Math.max(rk.r, bk.r);
    for (let r = lo + 1; r < hi; r++) if (b[r][rk.c] !== 0) return false;
    return true;
  }

  // 判断 (r,c) 是否被 bySide 方攻击（不含照面，照面单独用 kingsFacing）
  function isAttacked(b, r, c, bySide) {
    const s = sign(bySide);

    // 1) 将/帅相邻一步
    const kingDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of kingDirs) {
      const nr = r + dr, nc = c + dc;
      if (inBoard(nr, nc) && b[nr][nc] === s * KING) return true;
    }

    // 2) 马（蹩马腿）
    const jumps = [
      [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
      [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]
    ];
    for (const [dr, dc, lr, lc] of jumps) {
      const nr = r + dr, nc = c + dc;
      if (inBoard(nr, nc) && b[nr][nc] === s * HORSE && b[r + lr][c + lc] === 0) return true;
    }

    // 3) 兵/卒（过河后可横攻）
    if (bySide === RED) {
      if (inBoard(r + 1, c) && b[r + 1][c] === PAWN) return true; // 正前
      if (r <= 4) {
        if (inBoard(r, c - 1) && b[r][c - 1] === PAWN) return true;
        if (inBoard(r, c + 1) && b[r][c + 1] === PAWN) return true;
      }
    } else {
      if (inBoard(r - 1, c) && b[r - 1][c] === -PAWN) return true;
      if (r >= 5) {
        if (inBoard(r, c - 1) && b[r][c - 1] === -PAWN) return true;
        if (inBoard(r, c + 1) && b[r][c + 1] === -PAWN) return true;
      }
    }

    // 4) 车 / 炮（直线）
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      const pieces = [];
      while (inBoard(nr, nc) && pieces.length < 2) {
        if (b[nr][nc] !== 0) pieces.push(b[nr][nc]);
        nr += dr; nc += dc;
      }
      if (pieces.length >= 1 && pieces[0] === s * ROOK) return true;
      if (pieces.length >= 2 && pieces[1] === s * CANNON) return true;
    }
    return false;
  }

  // 某方是否被将军（含照面）
  function isInCheck(b, side) {
    const k = findKing(b, side);
    if (!k) return true;
    if (isAttacked(b, k.r, k.c, oppSide(side))) return true;
    if (kingsFacing(b)) return true;
    return false;
  }

  /* ---------------- 走法生成 ---------------- */
  function genPseudoMoves(b, r, c) {
    const p = b[r][c], side = sideOf(p), t = typeOf(p);
    const moves = [];
    const push = (tr, tc) => {
      if (!inBoard(tr, tc)) return;
      const tgt = b[tr][tc];
      if (tgt !== 0 && sideOf(tgt) === side) return;
      moves.push({ fr: r, fc: c, tr: tr, tc: tc });
    };

    switch (t) {
      case KING:
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (inPalace(r + dr, c + dc, side)) push(r + dr, c + dc);
        }
        break;
      case ADVISOR:
        for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (inPalace(r + dr, c + dc, side)) push(r + dr, c + dc);
        }
        break;
      case ELEPHANT:
        for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || !inOwnHalf(nr, side)) continue;
          if (b[r + dr / 2][c + dc / 2] === 0) push(nr, nc); // 塞象眼
        }
        break;
      case HORSE: {
        const jumps = [
          [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
          [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]
        ];
        for (const [dr, dc, lr, lc] of jumps) {
          const nr = r + dr, nc = c + dc;
          if (inBoard(nr, nc) && b[r + lr][c + lc] === 0) push(nr, nc);
        }
        break;
      }
      case ROOK:
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let nr = r + dr, nc = c + dc;
          while (inBoard(nr, nc)) {
            const tgt = b[nr][nc];
            if (tgt === 0) push(nr, nc);
            else { if (sideOf(tgt) !== side) push(nr, nc); break; }
            nr += dr; nc += dc;
          }
        }
        break;
      case CANNON:
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let nr = r + dr, nc = c + dc, jumped = false;
          while (inBoard(nr, nc)) {
            const tgt = b[nr][nc];
            if (tgt === 0) {
              if (!jumped) push(nr, nc);
            } else {
              if (!jumped) jumped = true;
              else { if (sideOf(tgt) !== side) push(nr, nc); break; }
            }
            nr += dr; nc += dc;
          }
        }
        break;
      case PAWN: {
        const fwd = side === RED ? -1 : 1;
        push(r + fwd, c);
        if (pawnCrossed(r, side)) { push(r, c - 1); push(r, c + 1); }
        break;
      }
    }
    return moves;
  }

  // 某方全部合法走法（过滤"走完被将军 / 照面"）
  function genMoves(b, side) {
    const legal = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (b[r][c] === 0 || sideOf(b[r][c]) !== side) continue;
        for (const m of genPseudoMoves(b, r, c)) {
          const nb = clone(b);
          nb[m.tr][m.tc] = nb[m.fr][m.fc];
          nb[m.fr][m.fc] = 0;
          if (!isInCheck(nb, side)) {
            legal.push({ fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc, piece: b[r][c], captured: b[m.tr][m.tc] });
          }
        }
      }
    return legal;
  }

  // 是否有合法着法（区分"将死"与"困毙"）
  function hasLegalMove(b, side) {
    return genMoves(b, side).length > 0;
  }

  function applyMove(b, m) {
    const nb = clone(b);
    nb[m.tr][m.tc] = nb[m.fr][m.fc];
    nb[m.fr][m.fc] = 0;
    return nb;
  }

  /* ---------------- FEN ---------------- */
  function toFEN(b, side) {
    const parts = [];
    for (let r = 0; r < ROWS; r++) {
      let s = '', empty = 0;
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (p === 0) { empty++; }
        else {
          if (empty) { s += empty; empty = 0; }
          const ch = FEN_PIECE[Math.abs(p)];
          s += (p > 0) ? ch.toUpperCase() : ch;
        }
      }
      if (empty) s += empty;
      parts.push(s);
    }
    return parts.join('/') + ' ' + (side === RED ? 'w' : 'b') + ' - - 0 1';
  }

  /* ---------------- 记谱法 ---------------- */
  function fileNum(side, c) { return side === RED ? 9 - c : c + 1; }

  function moveNotation(b, m) {
    const side = sideOf(m.piece), t = typeOf(m.piece);
    const name = PIECE_CN[side][t];

    // 位置描述：同列同种≥2 用"前/后"，否则用纵线号
    let sameCol = 0;
    for (let r = 0; r < ROWS; r++) if (b[r][m.fc] === m.piece) sameCol++;
    let pos, frontBack = false;
    if (sameCol >= 2) {
      frontBack = true;
      let isFront;
      if (side === RED) {
        let minR = 99;
        for (let r = 0; r < ROWS; r++) if (b[r][m.fc] === m.piece) minR = Math.min(minR, r);
        isFront = (m.fr === minR);
      } else {
        let maxR = -1;
        for (let r = 0; r < ROWS; r++) if (b[r][m.fc] === m.piece) maxR = Math.max(maxR, r);
        isFront = (m.fr === maxR);
      }
      pos = isFront ? '前' : '后';
    } else {
      pos = side === RED ? CN_NUM[fileNum(side, m.fc)] : String(fileNum(side, m.fc));
    }

    // 移动类型 + 数字
    let mvType, num;
    const destFile = fileNum(side, m.tc);
    if (m.tr === m.fr) {
      mvType = '平';
      num = side === RED ? CN_NUM[destFile] : String(destFile);
    } else {
      const fwd = side === RED ? (m.tr < m.fr) : (m.tr > m.fr);
      mvType = fwd ? '进' : '退';
      if (t === KING || t === ROOK || t === CANNON || t === PAWN) {
        const steps = Math.abs(m.tr - m.fr);
        num = side === RED ? CN_NUM[steps] : String(steps);
      } else {
        num = side === RED ? CN_NUM[destFile] : String(destFile);
      }
    }

    return frontBack ? (pos + name + mvType + num) : (name + pos + mvType + num);
  }

  /* ---------------- 坐标 <-> UCI 记法 ---------------- */
  // 内部 (r,c) → 坐标串（file a~i, rank 0~9，用于导出/导入）
  function sqToUci(r, c) {
    return String.fromCharCode(97 + c) + r;
  }
  function uciToSq(s) {
    return { r: parseInt(s[1], 10), c: s.charCodeAt(0) - 97 };
  }

  // Pikafish 引擎 UCI 走法 → 内部坐标。
  // 引擎的 rank 0=红方底线(下)、9=黑方底线(上)，与内部 row(0=上=黑) 相反，需翻转。
  function engineToSq(s) {
    return { r: 9 - parseInt(s[1], 10), c: s.charCodeAt(0) - 97 };
  }

  // 对外暴露
  window.XQ = {
    RED, BLACK,
    KING, ADVISOR, ELEPHANT, HORSE, ROOK, CANNON, PAWN,
    ROWS, COLS, VALUE,
    sign, sideOf, typeOf, inBoard, oppSide,
    initBoard, clone,
    inPalace, inOwnHalf, pawnCrossed, findKing,
    kingsFacing, isAttacked, isInCheck,
    genPseudoMoves, genMoves, hasLegalMove, applyMove,
    toFEN, moveNotation, sqToUci, uciToSq, engineToSq,
    pieceName: (side, t) => PIECE_CN[side][t]
  };
})();
