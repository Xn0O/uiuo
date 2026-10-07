
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


  if (entry.w && entry.h) {
    figure.style.aspectRatio = `${entry.w} / ${entry.h}`;
  }

  const thumb = String(entry.thumb || "").trim();
  if (thumb) {
    figure.style.setProperty("--ph", `url("${thumb}")`);
  }

  const img = document.createElement("img");
 
  img.draggable = false;
  img.setAttribute("draggable", "false");
  img.src = String(entry.src || "").trim();

  if (entry.w) img.width = entry.w;
  if (entry.h) img.height = entry.h;
  img.alt = `第 ${index + 1} 页`;
  img.decoding = "async";

  if (index === 0) {
    img.fetchPriority = "high";
  } else {
    img.loading = "lazy";
  }

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
    showTip("阅读页加载失败：找不到 data/noc.json。");
    return;
  }

  if (typeof data?.title === "string" && data.title.trim()) {
    document.title = data.title.trim();
  }


  const bg = String(data?.bg || "").trim();
  if (bg) {
    document.documentElement.style.setProperty("--reading-bg", bg);
  }

  const pages = (Array.isArray(data?.pages) ? data.pages : [])
    .filter((entry) => entry && typeof entry === "object" && String(entry.src || "").trim());
  if (!pages.length) {
    showTip("还没有页面。");
    return;
  }

  const frag = document.createDocumentFragment();
  pages.forEach((entry, index) => frag.appendChild(buildPage(entry, index)));
  reading.appendChild(frag);
}

init();
