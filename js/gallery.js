const {
  loadSiteConfig,
  applyThemeConfig,
  initTheme,
  setupThemeToggle,
  applyHeaderImage,
  applySiteText,
  markActiveNav,
  createEmptyTip,
  resolveAssetUrl,
  setupImageLightbox,
} = window.SiteCommon;

const GALLERY_INDEX = "./data/gallery.json";

const grid = document.getElementById("gallery-grid");

// 取一个图源：gallery.json 的 items 允许是字符串路径或 { src, title }
function resolveItem(item) {
  if (typeof item === "string") {
    return { src: item.trim(), title: "" };
  }
  if (item && typeof item === "object") {
    const src = String(item.src || item.image || "").trim();
    const title = String(item.title || item.alt || "").trim();
    return { src, title };
  }
  return { src: "", title: "" };
}

async function init() {
  const config = await loadSiteConfig();
  applyThemeConfig(config);
  initTheme(config);
  setupThemeToggle();
  applyHeaderImage(config);
  applySiteText(config);
  markActiveNav();

  if (!grid) return;

  let items = [];
  try {
    const url = new URL(GALLERY_INDEX, window.location.href);
    url.searchParams.set("_v", String(Date.now()));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("无法加载 gallery.json");
    const payload = await res.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      if (typeof payload.title === "string" && payload.title.trim()) {
        document.title = `${payload.title.trim()} - Gamedev`;
      }
    }
    const raw = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
    items = raw.filter(Boolean);
  } catch (error) {
    console.error(error);
    grid.appendChild(createEmptyTip("画廊加载失败，请检查 data/gallery.json。"));
    return;
  }

  if (!items.length) {
    grid.appendChild(createEmptyTip(
      "还没有图片。把图片按「日期_序号」放进 assets/art/（如 20260910_01.png），\n" +
      "然后运行 python3 tools/gallery_build.py 生成清单即可。"
    ));
    return;
  }

  items.forEach((entry) => {
    const { src, title } = resolveItem(entry);
    if (!src) return;

    const resolved = resolveAssetUrl(src, { config });
    if (!resolved) return;

    const img = document.createElement("img");
    img.loading = "lazy";
    img.draggable = false;
    img.src = resolved;
    img.alt = title || "画廊图片";
    if (!img.hasAttribute("aria-label")) {
      img.setAttribute("aria-label", `${img.alt}（点击查看大图）`);
    }
    grid.appendChild(img);
  });

  setupImageLightbox(grid);
}

init();
