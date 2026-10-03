/* ============================================================
 * xqengine.js — xqwlight 引擎适配层
 * 封装 xqwlight（lib/position.js + lib/search.js）的搜索与评估，
 * 统一为项目内部坐标（row 0=上=黑, col 0=左）接口。
 * 依赖：rules.js（XQ.toFEN）、lib/position.js、lib/search.js
 * ============================================================ */
(function () {
  'use strict';

  const XQ = window.XQ;

  // xqwlight 内部 16×16 坐标 → 项目内部坐标
  // RANK_Y: 3(黑方底线)~12(红方底线) → row 0~9
  // FILE_X: 3(左)~11(右) → col 0~8
  function sqToCoord(sq) {
    return { r: RANK_Y(sq) - 3, c: FILE_X(sq) - 3 };
  }

  // 搜索最佳走法（side 走棋）。返回 {fr,fc,tr,tc} 或 null
  function search(board, side, depth, millis) {
    const pos = new Position();
    pos.fromFen(XQ.toFEN(board, side));
    const searcher = new Search(pos);
    const mv = searcher.searchMain(depth || 16, millis || 1500);
    if (!mv) return null;
    const src = sqToCoord(SRC(mv));
    const dst = sqToCoord(DST(mv));
    return { fr: src.r, fc: src.c, tr: dst.r, tc: dst.c };
  }

  // 评估局面（side 视角），返回分值（xqwlight 分值点：车≈256，兵≈20~30，MATE=10000）
  function evaluate(board, side) {
    const pos = new Position();
    pos.fromFen(XQ.toFEN(board, side));
    return pos.evaluate();
  }

  window.XQEngine = { search, evaluate };
})();
