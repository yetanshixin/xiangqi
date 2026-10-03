/* ============================================================
 * xqworker.js — Web Worker：加载 xqwlight 引擎并封装搜索
 * 搜索耗时约 1.5s，放到 Worker 里避免阻塞主线程 UI。
 * ============================================================ */
importScripts('lib/position.js', 'lib/search.js');

self.onmessage = function (e) {
  const d = e.data || {};
  if (d.cmd === 'search') {
    const pos = new Position();
    pos.fromFen(d.fen);
    const searcher = new Search(pos);
    const mv = searcher.searchMain(d.depth || 16, d.millis || 1500);
    self.postMessage({ id: d.id, mv: mv });
  }
};
