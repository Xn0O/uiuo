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

// 网格渐进升级：缩略图先显示，滚动到附近再换原图（滚出视野外的不加载，省流量）
let tileUpgradeObserver = null;

function upgradeTile(img, fullUrl) {
  if (!fullUrl || img.dataset.upgraded === "1") return;
  img.dataset.upgraded = "1";
  const loader = new Image();
  loader.decoding = "async";
  loader.onload = () => {
    img.src = fullUrl;
    img.classList.add("is-sharp");
  };
  loader.src = fullUrl;
}

function observeTileUpgrade(img, fullUrl) {
  if (typeof IntersectionObserver !== "function") {
    upgradeTile(img, fullUrl);
    return;
  }
  if (!tileUpgradeObserver) {
    tileUpgradeObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          tileUpgradeObserver.unobserve(entry.target);
          upgradeTile(entry.target, entry.target.dataset.fullSrc);
        });
      },
      { rootMargin: "300px 0px" }
    );
  }
  tileUpgradeObserver.observe(img);
}

// 取一个图源：gallery.json 的 items 允许是字符串路径或 { src, thumb, title }
//   src   = 原图（点开大图时加载）
//   thumb = 小缩略图（网格先秒开，也用作大图的模糊占位）
function resolveItem(item) {
  if (typeof item === "string") {
    return { src: item.trim(), thumb: "", title: "" };
  }
  if (item && typeof item === "object") {
    const src = String(item.src || item.image || "").trim();
    const thumb = String(item.thumb || item.thumbnail || "").trim();
    const title = String(item.title || item.alt || "").trim();
    return { src, thumb, title };
  }
  return { src: "", thumb: "", title: "" };
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
    const { src, thumb, title } = resolveItem(entry);
    if (!src) return;

    const fullUrl = resolveAssetUrl(src, { config });
    if (!fullUrl) return;
    const thumbUrl = thumb ? resolveAssetUrl(thumb, { config }) : "";

    const img = document.createElement("img");
    img.draggable = false;
    // 网格先用缩略图秒开（没有缩略图时直接上原图）
    img.src = thumbUrl || fullUrl;
    // 供灯箱使用：大图加载原图，缩略图做模糊占位
    img.dataset.fullSrc = fullUrl;
    if (thumbUrl) img.dataset.thumbSrc = thumbUrl;
    img.alt = title || "画廊图片";
    if (!img.hasAttribute("aria-label")) {
      img.setAttribute("aria-label", `${img.alt}（点击查看大图）`);
    }
    grid.appendChild(img);

    // 缩略图只是占位：滚到附近时把原图换上，网格最终是清晰版
    if (thumbUrl && thumbUrl !== fullUrl) {
      observeTileUpgrade(img, fullUrl);
    }
  });

  setupImageLightbox(grid);
}

init();
