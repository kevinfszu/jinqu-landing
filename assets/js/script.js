// 下载入口：安装包地址只写在 <body data-download-url=""> 一处。
// 留空时两处按钮保持 HTML 里的 #download 锚点（指向页尾下载区块），填上地址后自动换成真实安装包。
(function () {
  const url = (document.body.dataset.downloadUrl || "").trim();
  if (!url) return;

  document.querySelectorAll("[data-download]").forEach((link) => {
    link.href = url;
    link.setAttribute("download", "");
  });
})();

// 滚动淡入：进入视口 18% 时揭示，向上滚回来不再重复播放。
(function () {
  const items = Array.from(document.querySelectorAll(".reveal"));
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );

  items.forEach((el) => io.observe(el));
})();

// 三步连贯演示：每 2.8 秒推进一步，循环播放，可暂停。
(function () {
  const flow = document.querySelector("[data-flow]");
  if (!flow) return;

  const toggle = flow.querySelector("[data-flow-toggle]");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const INTERVAL = 2800;
  let stage = 0;
  let timer = null;
  let paused = false;

  const render = () => flow.setAttribute("data-stage", String(stage));
  const tick = () => {
    stage = (stage + 1) % 3;
    render();
  };
  const stop = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const play = () => {
    stop();
    timer = window.setInterval(tick, INTERVAL);
  };

  // 用户要求减少动效时，直接定格在第三步。
  if (reduce.matches) {
    stage = 2;
    render();
    if (toggle) toggle.hidden = true;
    return;
  }

  if (toggle) {
    toggle.addEventListener("click", () => {
      paused = !paused;
      toggle.textContent = paused ? "播放" : "暂停";
      toggle.setAttribute("aria-pressed", String(paused));
      if (paused) stop();
      else play();
    });
  }

  // 滚出视口就停住，回到视口再接着播，避免看不见时白跑。
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (!paused) play();
          } else {
            stop();
          }
        });
      },
      { threshold: 0.25 }
    );
    io.observe(flow);
  } else {
    play();
  }
})();
