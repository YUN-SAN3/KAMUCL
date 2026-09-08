<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import splashFace from '../assets/splash-face.png'

defineProps<{ leaving?: boolean }>()
const emit = defineEmits<{ done: [] }>()

// ---------------- 拼图参数（12×12 = 144 块，每块 24px，目标区 288×288） ----------------
const GRID = 12
const BOARD = 288
const TILE = BOARD / GRID // 24

// ---------------- 动画时间线（毫秒） ----------------
const T_SCATTER = 700 // ① 散布期：块散布屏幕四边外各自晃动
const T_STAGGER = 600 // ② 汇聚期：每块随机错开 0~600ms
const T_FLY = 900 //    ② 汇聚期：单块 transform 过渡时长
const T_SETTLE = T_SCATTER + T_STAGGER + T_FLY // ③ 定型期开始（2200ms）
const T_DONE = T_SETTLE + 500 // 容器弹跳结束后对外发 done

type Phase = 'scatter' | 'converge' | 'settle'
const phase = ref<Phase>('scatter')

interface Tile {
  col: number
  row: number
  dx: number // 散布期相对目标格子的 X 偏移
  dy: number // 散布期相对目标格子的 Y 偏移
  rot: number // 散布期随机旋转角
  delay: number // 汇聚期过渡延迟（随机顺序错开）
  wobble: 'a' | 'b' // 晃动动画变体（两个方向相反的 keyframes）
  wobbleDelay: number
  wobbleDuration: number
}

/** 屏幕随机一条边外的散布位置（相对拼图区中心的偏移量） */
function scatterOffset() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const m = BOARD / 2 + Math.random() * 160 // 边外余量
  const edge = Math.floor(Math.random() * 4)
  if (edge === 0) return { dx: (Math.random() - 0.5) * vw, dy: -(vh / 2 + m) } // 上
  if (edge === 1) return { dx: vw / 2 + m, dy: (Math.random() - 0.5) * vh } // 右
  if (edge === 2) return { dx: (Math.random() - 0.5) * vw, dy: vh / 2 + m } // 下
  return { dx: -(vw / 2 + m), dy: (Math.random() - 0.5) * vh } // 左
}

// 生成 144 块（静态数据，无需响应式）
const tiles: Tile[] = []
for (let row = 0; row < GRID; row++) {
  for (let col = 0; col < GRID; col++) {
    const { dx, dy } = scatterOffset()
    tiles.push({
      col,
      row,
      dx,
      dy,
      rot: (Math.random() - 0.5) * 240,
      delay: Math.random() * T_STAGGER,
      wobble: Math.random() < 0.5 ? 'a' : 'b',
      wobbleDelay: -Math.random() * 500,
      wobbleDuration: 420 + Math.random() * 180
    })
  }
}

/**
 * 每块样式：background-position 切片定位 + transform 散布/归位。
 * 散布期的 wobble 用 CSS 独立属性 translate/rotate 做 keyframes，
 * 与 transform 叠加；汇聚时移除动画，配合 transition 平滑回到 0。
 */
function tileStyle(t: Tile) {
  const base = {
    left: t.col * TILE + 'px',
    top: t.row * TILE + 'px',
    backgroundImage: `url(${splashFace})`,
    backgroundPosition: `${-t.col * TILE}px ${-t.row * TILE}px`
  }
  if (phase.value === 'scatter') {
    return {
      ...base,
      transform: `translate(${t.dx}px, ${t.dy}px) rotate(${t.rot}deg)`,
      animationName: `splash-wobble-${t.wobble}`,
      animationDuration: `${t.wobbleDuration}ms`,
      animationDelay: `${t.wobbleDelay}ms`
    }
  }
  return {
    ...base,
    transform: 'translate(0px, 0px) rotate(0deg)',
    transitionDelay: `${t.delay}ms`
  }
}

const timers: Array<ReturnType<typeof setTimeout>> = []
const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms))

onMounted(() => {
  // 减少动态偏好：跳过全部动画，直接显示完整图
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    phase.value = 'settle'
    later(() => emit('done'), 100)
    return
  }
  later(() => (phase.value = 'converge'), T_SCATTER)
  later(() => (phase.value = 'settle'), T_SETTLE)
  later(() => emit('done'), T_DONE)
})

onUnmounted(() => timers.forEach(clearTimeout))
</script>

<template>
  <div class="splash" :class="{ leaving }">
    <!-- 中央目标拼图区 -->
    <div class="board" :class="phase">
      <div v-for="(t, i) in tiles" :key="i" class="tile" :style="tileStyle(t)"></div>
    </div>

    <!-- Logo + 加载提示（定型期淡入） -->
    <div class="brand" :class="{ show: phase === 'settle' }">
      <div class="brand-name">KAMUCL</div>
      <div class="brand-hint">正在启动 KAMUCL…</div>
    </div>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 99999; /* 全应用最高层，遮盖一切内容 */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  background: var(--bg);
  opacity: 1;
  transition: opacity 400ms ease;
}
.splash.leaving {
  opacity: 0;
  pointer-events: none;
}

/* ---------------- 拼图区 ---------------- */
.board {
  position: relative;
  width: 288px;
  height: 288px;
  flex-shrink: 0;
}
/* ③ 定型期：整块轻微弹跳 1 → 1.06 → 1 */
.board.settle {
  animation: splash-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.tile {
  position: absolute;
  width: 24px;
  height: 24px;
  background-size: 288px 288px;
  background-repeat: no-repeat;
  image-rendering: pixelated; /* 保持像素风锐利 */
  will-change: transform;
  transition:
    transform 900ms cubic-bezier(0.6, 0.05, 0.2, 1),
    translate 900ms cubic-bezier(0.6, 0.05, 0.2, 1),
    rotate 900ms cubic-bezier(0.6, 0.05, 0.2, 1);
}
/* ① 散布期：wobble 微幅往返（名称/时长/延迟由 inline 按块随机） */
.board.scatter .tile {
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}

@keyframes splash-wobble-a {
  from {
    translate: -3px 2px;
    rotate: -5deg;
  }
  to {
    translate: 3px -2px;
    rotate: 5deg;
  }
}
@keyframes splash-wobble-b {
  from {
    translate: 2px 3px;
    rotate: 4deg;
  }
  to {
    translate: -2px -3px;
    rotate: -4deg;
  }
}
@keyframes splash-pop {
  0% {
    scale: 1;
  }
  40% {
    scale: 1.06;
  }
  100% {
    scale: 1;
  }
}

/* ---------------- Logo / 加载提示 ---------------- */
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.brand.show {
  opacity: 1;
  transform: translateY(0);
}
.brand-name {
  font-size: var(--text-2xl);
  font-weight: 800;
  letter-spacing: 7px;
  color: var(--text);
  text-indent: 7px; /* 补偿 letter-spacing 尾部空隙，视觉居中 */
}
.brand-hint {
  font-size: var(--text-xs);
  color: var(--text-dim);
}

/* 减少动态偏好：不做任何动画 */
@media (prefers-reduced-motion: reduce) {
  .board.settle {
    animation: none;
  }
  .tile {
    transition: none;
  }
  .brand {
    transition: none;
  }
}
</style>
