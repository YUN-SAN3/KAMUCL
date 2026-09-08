<template>
  <section class="creator-card" aria-label="启动器创作者">
    <div class="creator-heading">
      <span class="creator-eyebrow">创作者 <span aria-hidden="true">/ CREATOR</span></span>
      <span class="creator-pixels" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    </div>
    <p class="creator-intro">由人见人爱，花见花开的 UP 主</p>
    <p class="creator-signature"><strong>卡慕<span>SaMa</span></strong><span class="creator-made">制作</span></p>
    <a
      class="creator-link"
      href="https://space.bilibili.com/9596327"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="访问卡慕SaMa的哔哩哔哩主页（在浏览器中打开）"
    >
      <span class="creator-link-label">
        <svg class="bilibili-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m7 3 3 3m7-3-3 3" /><rect x="3" y="6" width="18" height="14" rx="4" />
          <path d="M8 11v3m8-3v3m-5 2 1 1 1-1M7 20v1m10-1v1" />
        </svg>
        <span>来 B 站找我</span>
      </span>
      <svg class="creator-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18 18 6M7 6h11v11" /></svg>
    </a>
  </section>
</template>

<style scoped>
/* 页面末行整条横卡：单行水平排布（眉题 → 介绍 → 签名靠右 → 链接），窄窗自动换行，高度紧凑不抢视觉 */
.creator-card {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-5);
  min-width: 0;
  padding: var(--space-4) var(--card-pad);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--accent-soft), transparent 65%), color-mix(in srgb, var(--card) 88%, transparent);
  color: var(--text);
  box-shadow: var(--shadow);
}
.creator-heading { display: flex; align-items: center; gap: var(--space-2); flex: none; }
.creator-eyebrow { color: var(--text-dim); font-size: var(--text-xs); font-weight: 600; letter-spacing: 1px; }
.creator-eyebrow span { margin-left: var(--space-1); letter-spacing: 1.4px; }
.creator-pixels { display: grid; grid-template-columns: repeat(2, 5px); gap: 3px; transform: rotate(-8deg); }
.creator-pixels i { width: 5px; height: 5px; border-radius: 1px; background: var(--accent-2); }
.creator-pixels i:nth-child(2) { opacity: 0.35; transform: translate(2px, -2px); }
.creator-pixels i:nth-child(3) { opacity: 0.55; }
.creator-intro { margin: 0; color: var(--text-dim); font-size: var(--text-xs); line-height: 1.7; text-wrap: pretty; }
.creator-signature { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 0 auto; }
.creator-signature strong { font-size: var(--text-lg); font-weight: 700; line-height: 1.3; letter-spacing: 0.2px; }
.creator-signature strong span { margin-left: var(--space-1); font-size: var(--text-md); font-weight: 600; letter-spacing: -0.6px; }
.creator-made { color: var(--text-dim); font-size: var(--text-xs); }
.creator-link { display: flex; flex: none; min-height: var(--ctl-h); align-items: center; justify-content: space-between; gap: var(--space-2); padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--card-2); color: var(--text); text-decoration: none; transition: background 180ms ease, border-color 180ms ease; }
.creator-link-label { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); font-weight: 600; }
.bilibili-icon { width: 22px; height: 22px; flex: none; color: var(--accent-2); }
.creator-arrow { width: 16px; height: 16px; flex: none; color: var(--text-dim); transition: transform 180ms ease; }
.creator-link:hover { background: var(--hover); border-color: var(--accent); }
.creator-link:hover .creator-arrow { transform: translate(1px, -1px); color: var(--text); }
.creator-link:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .creator-link, .creator-arrow { transition: none; }
  .creator-link:hover .creator-arrow { transform: none; }
}
</style>
