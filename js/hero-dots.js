/*
 * gamedev 首页头图：底部"静态噪点"溶解遮罩（运行时生成）。
 *
 * 上半约 68% 完全不透明（实底），下半 32% 用电视雪花式的随机噪点
 * 把图像"抖"进页面背景，并带平滑的透明度渐隐：
 *   - 每个小格是否保留由确定性随机数决定，保留概率从顶部≈1 线性
 *     降到底部≈0，越靠下剥落越多
 *   - 保留下的碎块还带行透明度 fill-opacity，同样从 1.0 线性降到≈0，
 *     于是整段是"雪花越来越透明地化进背景"，而不是硬边二值剥落
 *   - 随机值由格子的行列算出（不依赖 Math.random），同一尺寸下
 *     每次刷新图案一致，不会闪烁；没有规整棋盘，边缘毛毛糙糙
 * 遮罩按头图实际宽高生成 1:1 SVG（缩放系数为 1），任意设备 / 长宽比下
 * 颗粒都是正矩形、不会被拉伸。同行连续保留、同透明度的格子合并成一条 rect。
 *
 * 可调参数（改完刷新即可，无需重新生成任何图片）：
 *   BAND_TOP   溶解带起点（占头图高度的比例，0.68 = 上 68% 实底）
 *   NOISE_K    噪点基本格边长 = 头图高度 × NOISE_K（约 0.009 = 0.9%）
 *   MIN_CELL   噪点格最小边长（防止头图太矮时颗粒过密）
 */
(function () {
  var HERO = ".devlog-hero .hero-image";
  var BAND_TOP = 0.68;
  var NOISE_K = 0.009;
  var MIN_CELL = 3;

  /* 确定性伪随机（行 i、列 c 的格值，0..1），返回稳定、无外部状态 */
  function rnd(i, c) {
    var x = (i * 374761393) + (c * 668265263);
    x = (x ^ (x >> 13)) | 0;
    x = (Math.imul(x, 1274126177)) | 0;
    x = (x ^ (x >> 16)) >>> 0;
    return x / 4294967296;
  }

  function build(w, h) {
    var cell = Math.max(MIN_CELL, Math.round(h * NOISE_K));
    var yBand = h * BAND_TOP;
    var nRows = Math.floor((h - yBand) / cell); // 顶对齐向下铺排
    if (nRows < 1) return "";
    var parts = [
      '<rect width="' + w + '" height="' + yBand.toFixed(1) + '" fill="#000"/>',
    ];
    var x0 = (w % cell) / 2;
    var nCols = Math.ceil((w - x0) / cell);
    for (var i = 0; i < nRows; i++) {
      var fade = (nRows - i) / nRows; // 该行透明度 1→0（线性，顶≈1 / 底≈0）
      var y = yBand + i * cell;
      var runStart = -1;
      for (var c = 0; c <= nCols; c++) {
        var keep = c < nCols && rnd(i, c) < fade;
        if (keep && runStart < 0) {
          runStart = c;
        } else if (!keep && runStart >= 0) {
          parts.push(
            '<rect x="' + (x0 + runStart * cell).toFixed(1) +
            '" y="' + y.toFixed(1) +
            '" width="' + ((c - runStart) * cell).toFixed(1) +
            '" height="' + cell.toFixed(1) +
            '" fill="#000" fill-opacity="' + fade.toFixed(3) + '"/>'
          );
          runStart = -1;
        }
      }
    }
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w +
      '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
      parts.join("") + "</svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  var el, raf = 0, lastW = 0, lastH = 0;
  function apply() {
    if (!el) return;
    var rect = el.getBoundingClientRect();
    /* 优先用 offsetWidth/Height（布局尺寸，不受 transform/视觉视口影响） */
    var w = el.offsetWidth || Math.round(rect.width) || 0;
    var h = el.offsetHeight || Math.round(rect.height) || 0;
    if (w === lastW && h === lastH) return; // 尺寸没变就不重建
    lastW = w;
    lastH = h;
    var uri = build(w, h);
    if (!uri) return;
    el.style.webkitMaskImage = uri;
    el.style.maskImage = uri;
    el.style.webkitMaskSize = "100% 100%";
    el.style.maskSize = "100% 100%";
    el.style.webkitMaskRepeat = "no-repeat";
    el.style.maskRepeat = "no-repeat";
    el.style.webkitMaskPosition = "0 0";
    el.style.maskPosition = "0 0";
  }

  /* 拖拽窗口时 resize 事件每帧都触发，这里用 requestAnimationFrame 合帧，
     保证遮罩跟着头图最新尺寸每帧重画，而不是等停顿才追上。 */
  function scheduleApply() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      apply();
    });
  }

  function init() {
    el = document.querySelector(HERO);
    if (!el) return;
    function once() { apply(); }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", once);
    } else {
      once();
    }
    window.addEventListener("load", once);          // 布局彻底完成后校正一次
    window.addEventListener("resize", scheduleApply);
    window.addEventListener("orientationchange", scheduleApply);
    setTimeout(once, 300);                          // 兜底：等样式/布局稳定
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
