// NOC TIDE 纯阅读页：把 data/noc.json 里的逐页渲染图纵向拼回原稿。
// 数据由 tools/pdf_build.py 生成，换 PDF 后重跑脚本即可，本文件不用动。
const MANIFEST = "./data/noc.json";

const reading = document.getElementById("reading");

function showTip(text) {
  if (!reading) return;
  const tip = document.createElement("p");
  tip.className = "tip";
  tip.textContent = text;
  reading.appendChild(tip);
}

function buildPage(entry, index) {
  const figure = document.createElement("figure");
  figure.className = "page";

  // 用清单里的真实宽高定这一页的比例，和原图严丝合缝，
  // 免得 16/9 那点误差在页与页之间压出一条亚像素细缝
  if (entry.w && entry.h) {
    figure.style.aspectRatio = `${entry.w} / ${entry.h}`;
  }

  // 缩略图铺满这一页的框：原图一条一条刷出来之前，先有个糊底，不会黑屏
  const thumb = String(entry.thumb || "").trim();
  if (thumb) {
    figure.style.setProperty("--ph", `url("${thumb}")`);
  }

  const img = document.createElement("img");
  // 双击/长按拖图会拖出残影，禁掉（CSS 那层管 WebKit，这个属性管其余浏览器）
  img.draggable = false;
  img.setAttribute("draggable", "false");
  img.src = String(entry.src || "").trim();
  // 写上宽高让浏览器提前算好这一页占多高，图还没到时页面也不会跳
  if (entry.w) img.width = entry.w;
  if (entry.h) img.height = entry.h;
  img.alt = `第 ${index + 1} 页`;
  img.decoding = "async";
  // 首屏那页立刻取，其余滑到附近再取
  if (index === 0) {
    img.fetchPriority = "high";
  } else {
    img.loading = "lazy";
  }

  // 原图下完就把糊底淡掉（没缩略图时这个类加不加都没关系）
  img.addEventListener("load", () => figure.classList.add("is-ready"));
  img.addEventListener("error", () => figure.classList.remove("is-ready"));

  figure.appendChild(img);
  return figure;
}

async function init() {
  if (!reading) return;

  let data = null;
  try {
    const url = new URL(MANIFEST, window.location.href);
    url.searchParams.set("_v", String(Date.now()));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (error) {
    console.error(error);
    showTip("阅读页加载失败：找不到 data/noc.json。\n请先运行 python3 tools/pdf_build.py 生成页面数据。");
    return;
  }

  if (typeof data?.title === "string" && data.title.trim()) {
    document.title = data.title.trim();
  }

  // 底色跟着封面走：四周留白和页与页之间的缝都不会露出格格不入的黑
  const bg = String(data?.bg || "").trim();
  if (bg) {
    document.documentElement.style.setProperty("--reading-bg", bg);
  }

  const pages = (Array.isArray(data?.pages) ? data.pages : [])
    .filter((entry) => entry && typeof entry === "object" && String(entry.src || "").trim());
  if (!pages.length) {
    showTip("还没有页面。把 noc.pdf 放到 gamedev/ 下，运行 python3 tools/pdf_build.py 生成即可。");
    return;
  }

  const frag = document.createDocumentFragment();
  pages.forEach((entry, index) => frag.appendChild(buildPage(entry, index)));
  reading.appendChild(frag);
}

init();
