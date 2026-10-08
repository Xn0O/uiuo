const INDEX_DATA = "./data/index.json";

const list = document.getElementById("log-list");

// 取一条：items 允许是字符串（当链接用）或 { title, href, desc }
function resolveItem(item) {
  if (typeof item === "string") {
    const href = item.trim();
    return { href, title: href, desc: "" };
  }
  if (item && typeof item === "object") {
    const href = String(item.href || item.url || "").trim();
    const title = String(item.title || item.name || "").trim();
    const desc = String(item.desc || item.summary || "").trim();
    return { href, title: title || href, desc };
  }
  return { href: "", title: "", desc: "" };
}

function renderItem(item) {
  const { href, title, desc } = resolveItem(item);
  if (!href) return null;

  const row = document.createElement("li");
  const link = document.createElement("a");
  link.href = href;
  link.textContent = title;
  row.appendChild(link);
  if (desc) {
    row.appendChild(document.createTextNode(" — " + desc));
  }
  return row;
}

async function init() {
  if (!list) return;

  let items = [];
  try {
    const url = new URL(INDEX_DATA, window.location.href);
    url.searchParams.set("_v", String(Date.now()));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("无法加载 index.json");
    const payload = await res.json();
    const raw = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
    items = raw.filter(Boolean);
  } catch (error) {
    console.error(error);
    list.textContent = "列表加载失败，请检查 data/index.json。";
    return;
  }

  const rows = items.map(renderItem).filter(Boolean);
  if (!rows.length) {
    list.textContent = "还没有条目。在 data/index.json 的 items 里加一条即可。";
    return;
  }
  rows.forEach((row) => list.appendChild(row));
}

init();
