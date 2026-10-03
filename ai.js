/* ============================================================
 * 中国象棋 走棋解释生成器（依赖 rules.js 的 XQ）
 * 输入：走子前的 board、走法 move、AI 方 side、引擎评估 ev
 * 输出：一段中文战略解释（客观属性分类模板 + 评估分变化）
 * ============================================================ */
(function () {
  'use strict';

  const XQ = window.XQ;

  /* ---------------- 评估分工具 ---------------- */
  // xqwlight 分值点 → 带符号整数（车≈256，兵≈20~30，MATE=10000）
  function fmt(v) {
    return (v >= 0 ? '+' : '') + Math.round(v);
  }

  // 从 AI 方视角的定性标签
  function label(v) {
    const x = v;
    if (x >= 9000) return '胜势（临近杀棋）';
    if (x >= 600) return '大优';
    if (x >= 300) return '优势';
    if (x >= 150) return '略优';
    if (x > -150) return '均势';
    if (x > -300) return '略差';
    if (x > -600) return '劣势';
    if (x > -9000) return '大劣';
    return '败势（临近被杀）';
  }

  function pieceDesc(p) {
    if (!p) return '';
    return XQ.pieceName(XQ.sideOf(p), XQ.typeOf(p));
  }

  /* ---------------- 防守 / 保子 分析 ---------------- */
  // 返回 { defense: piece|null, protect: piece|null }
  function threatAnalysis(board, after, move, side) {
    const opp = XQ.oppSide(side);
    let defense = null, protect = null;

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = after[r][c];
        if (p === 0 || XQ.sideOf(p) !== side) continue;
        if (XQ.typeOf(p) === XQ.KING) continue; // 王受攻归入将军/应将
        const attackedBefore = XQ.isAttacked(board, r, c, opp);
        const attackedAfter = XQ.isAttacked(after, r, c, opp);
        const defendedBefore = XQ.isAttacked(board, r, c, side);
        const defendedAfter = XQ.isAttacked(after, r, c, side);

        if (attackedBefore && !attackedAfter && !defense) {
          defense = { r, c, p };
        } else if (attackedBefore && attackedAfter && !defendedBefore && defendedAfter && !protect
                   && XQ.VALUE[XQ.typeOf(p)] >= 200) {
          // 只对高价值子（马/炮/车/仕/相等）算"保子"；保护兵卒属于发展/抢占要点的附带效果
          protect = { r, c, p };
        }
      }
    }
    return { defense, protect };
  }

  /* ---------------- 位置价值 / 要点 ---------------- */
  function positionalDesc(board, move, side) {
    const t = XQ.typeOf(move.piece);
    const dest = { r: move.tr, c: move.tc };
    const isCenter = dest.c === 4;
    const parts = [];
    switch (t) {
      case XQ.ROOK:
        if (isCenter) parts.push('车占中路，控制咽喉要道');
        else parts.push('车抢占要道，扩大活动范围');
        if (dest.r >= 5 && side === XQ.BLACK) parts.push('深入红方腹地');
        if (dest.r <= 4 && side === XQ.RED) parts.push('深入黑方腹地');
        break;
      case XQ.HORSE:
        parts.push('跳马出动，抢占河口控制点');
        if (isCenter) parts.push('控制中路');
        break;
      case XQ.CANNON:
        if (isCenter) parts.push('炮镇中路，压制对方中路防线');
        else parts.push('移动炮位，寻找炮架');
        break;
      case XQ.PAWN:
        if (XQ.pawnCrossed(dest.r, side)) parts.push('兵过河，威胁对方阵型');
        else parts.push('进兵推进，压制对方');
        break;
      case XQ.ELEPHANT:
        parts.push('飞相巩固防线，加强中路防守');
        break;
      case XQ.ADVISOR:
        parts.push('支仕调整，稳固九宫');
        break;
      case XQ.KING:
        parts.push('老将移动，调整安全位置');
        break;
      default:
        parts.push('调整阵型，抢占要点');
    }
    return parts.join('，') || '调整阵型';
  }

  /* ---------------- 主入口：生成解释 ---------------- */
  // ev: { beforeCp, beforeMate, afterCp, afterMate, depth }
  function explainMove(board, move, side, ev) {
    const opp = XQ.oppSide(side);
    const after = XQ.applyMove(board, move);
    const notation = XQ.moveNotation(board, move);

    const captured = move.captured;
    const givesCheck = XQ.isInCheck(after, opp);
    const wasInCheck = XQ.isInCheck(board, side);
    const oppNoMoves = !XQ.hasLegalMove(after, opp);
    const givesMate = givesCheck && oppNoMoves;

    let body = '';

    // ---- 1) 入局杀 / 绝杀 / 困毙 ----
    if (oppNoMoves) {
      if (givesCheck) {
        body = '绝杀！对方老将被将军且无子可挡、无路可逃，本局锁定胜局。';
      } else {
        body = '困毙！对方虽未被将军，但已无任何合法着法，按规则判负。';
      }
    }
    // ---- 2) 将军 ----
    else if (givesCheck) {
      const capNote = captured ? '同时吃掉对方' + pieceDesc(captured) + '，' : '';
      body = '将军！' + capNote + '逼对方老将应对，打乱其部署。';
      if (isCenter) body += ' 在中路直接施压，威胁尤重。';
    }
    // ---- 3) 应将 ----
    else if (wasInCheck) {
      if (captured) {
        body = '应将：直接吃掉将军的' + pieceDesc(captured) + '，化解危机。';
      } else if (XQ.typeOf(move.piece) === XQ.KING) {
        body = '应将：老将移动避将，脱离对方攻击线。';
      } else {
        body = '应将：走子化解对方的将军。';
      }
    }
    // ---- 4) 吃子 / 兑子 ----
    else if (captured) {
      const capVal = XQ.VALUE[XQ.typeOf(captured)];
      const myVal = XQ.VALUE[XQ.typeOf(move.piece)];
      const capName = pieceDesc(captured);
      if (capVal > myVal + 40) {
        body = '吃子得利：用' + pieceDesc(move.piece) + '白吃对方' + capName + '，净赚'
          + (capVal / 100).toFixed(1) + '个子力。';
      } else if (Math.abs(capVal - myVal) <= 40) {
        body = '兑子：' + pieceDesc(move.piece) + '换掉对方' + capName + '，等价交换，简化局面。';
      } else {
        body = '吃子：吃掉对方' + capName + '，虽以小吃大，但在此局面有战术价值。';
      }
      // 吃子后我方子是否陷入危险
      if (XQ.isAttacked(after, move.tr, move.tc, opp)) {
        body += ' 注意对方可能回吃，需看后续交换是否划算。';
      }
    } else {
      // ---- 5) 防守 / 6) 保子 ----
      const ta = threatAnalysis(board, after, move, side);
      if (ta.defense) {
        body = '防守：化解了对方对' + pieceDesc(ta.defense.p) + '的威胁，'
          + '这手让被攻击的子脱离险境。';
      } else if (ta.protect) {
        body = '保子：给受攻的' + pieceDesc(ta.protect.p) + '增加保护，'
          + '形成子力呼应，对方不敢贸然吃子。';
      }
      // ---- 7) 抢占要点 / 发展 ----
      else {
        body = positionalDesc(board, move, side) + '。';
      }
    }

    // ---- 叠加评估分变化 ----
    let evalStr = '';
    if (ev) {
      const beforeCp = ev.beforeCp || 0, afterCp = ev.afterCp || 0;
      const delta = afterCp - beforeCp;
      evalStr = '评估：' + label(beforeCp) + ' → ' + label(afterCp) + '（' + fmt(delta) + '）';
      if (delta >= 50) evalStr += '，局面朝我方有利方向转化。';
      else if (delta <= -50) evalStr += '，以局部代价换取更大的战略利益。';
      else evalStr += '，双方基本均衡。';
    }

    return notation + '：' + body + ' ' + evalStr;
  }

  window.XQAI = { explainMove };
})();
