import type {
  AgentPointerAction,
  AgentPointerInput,
  AgentPointerResult,
} from "../shared/dom";

const POINTER_HOST_ID = "ai-devtools-agent-pointer-host";
const POINTER_RUNTIME_KEY = "__aiDevtoolsAgentPointerRuntime";
const POINTER_HIDE_DELAY_MS = 30_000;
const POINTER_FADE_DURATION_MS = 260;

interface PointerPoint {
  x: number;
  y: number;
}

export type NormalizedAgentPointerInput =
  | { action: "clear" }
  | {
      action: Exclude<AgentPointerAction, "drag" | "clear">;
      point: PointerPoint;
    }
  | {
      action: "drag";
      point: PointerPoint;
      endPoint: PointerPoint;
    };

interface AgentPointerRuntime {
  host: HTMLDivElement;
  stage: HTMLDivElement;
  positioned: boolean;
  point: PointerPoint;
  hideTimer?: number;
  effectTimer?: number;
}

type AgentPointerGlobal = typeof globalThis & {
  [POINTER_RUNTIME_KEY]?: AgentPointerRuntime;
};

export async function presentAgentPointer(
  input: AgentPointerInput,
): Promise<AgentPointerResult> {
  const normalized = normalizeAgentPointerInput(input, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  if (normalized.action === "clear") {
    clearAgentPointer();
    return { action: "clear", shown: false };
  }

  const runtime = getOrCreateRuntime();
  clearRuntimeTimers(runtime);
  runtime.host.style.setProperty("display", "block", "important");
  runtime.stage.dataset.action = normalized.action;

  await moveStage(runtime, normalized.point);
  showActionEffect(runtime, normalized);
  scheduleHide(runtime);
  return { action: normalized.action, shown: true };
}

export function clearAgentPointer(): void {
  const runtime = getRuntime();
  if (!runtime) {
    return;
  }
  clearRuntimeTimers(runtime);
  runtime.stage.className = "stage";
  runtime.host.style.setProperty("display", "none", "important");
}

export function isAgentPointerHost(element: Element): boolean {
  return getRuntime()?.host === element;
}

export function normalizeAgentPointerInput(
  input: AgentPointerInput,
  viewport: { width: number; height: number },
): NormalizedAgentPointerInput {
  if (input.action === "clear") {
    return { action: "clear" };
  }
  const point = normalizePoint(input.x, input.y, viewport);
  if (input.action !== "drag") {
    return { action: input.action, point };
  }
  return {
    action: "drag",
    point,
    endPoint: normalizePoint(input.endX, input.endY, viewport),
  };
}

function normalizePoint(
  x: number,
  y: number,
  viewport: { width: number; height: number },
): PointerPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("AGENT_POINTER_COORDINATES_INVALID: coordinates must be finite.");
  }
  const maxX = Math.max(0, Math.floor(viewport.width) - 1);
  const maxY = Math.max(0, Math.floor(viewport.height) - 1);
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  };
}

function getRuntime(): AgentPointerRuntime | undefined {
  return (globalThis as AgentPointerGlobal)[POINTER_RUNTIME_KEY];
}

function getOrCreateRuntime(): AgentPointerRuntime {
  const existing = getRuntime();
  if (existing?.host.isConnected) {
    return existing;
  }

  document.getElementById(POINTER_HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = POINTER_HOST_ID;
  host.setAttribute("aria-hidden", "true");
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("width", "0", "important");
  host.style.setProperty("height", "0", "important");
  host.style.setProperty("pointer-events", "none", "important");
  host.style.setProperty("z-index", "2147483647", "important");

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = pointerStyles();
  const stage = document.createElement("div");
  stage.className = "stage";
  const glow = document.createElement("div");
  glow.className = "glow";
  const pointerShape = document.createElement("div");
  pointerShape.className = "pointer-shape";
  stage.append(glow, pointerShape);
  shadow.append(style, stage);
  document.documentElement.appendChild(host);

  const runtime: AgentPointerRuntime = {
    host,
    stage,
    positioned: false,
    point: { x: 0, y: 0 },
  };
  (globalThis as AgentPointerGlobal)[POINTER_RUNTIME_KEY] = runtime;
  return runtime;
}

async function moveStage(
  runtime: AgentPointerRuntime,
  point: PointerPoint,
): Promise<void> {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    .matches;
  const isFirstMove = !runtime.positioned;
  const startPoint = isFirstMove ? getIntroPoint(point) : runtime.point;
  const distance = Math.hypot(
    point.x - startPoint.x,
    point.y - startPoint.y,
  );
  const duration =
    reducedMotion || distance < 1
      ? 0
      : isFirstMove
        ? 320
        : Math.min(520, Math.max(160, Math.round(distance * 0.65)));
  if (isFirstMove) {
    runtime.stage.style.setProperty("--move-duration", "0ms");
    runtime.stage.style.transform = translate(startPoint);
    runtime.stage.classList.add("is-visible");
    void runtime.stage.offsetWidth;
  }
  runtime.stage.style.setProperty("--move-duration", `${duration}ms`);
  runtime.stage.style.transform = translate(point);
  runtime.stage.classList.add("is-visible");
  runtime.point = point;
  runtime.positioned = true;
  if (duration > 0) {
    await delay(duration);
  }
}

function getIntroPoint(point: PointerPoint): PointerPoint {
  const horizontalOffset = point.x + 48 < window.innerWidth ? 48 : -48;
  const verticalOffset = point.y + 32 < window.innerHeight ? 32 : -32;
  return {
    x: Math.min(
      Math.max(0, window.innerWidth - 1),
      Math.max(0, point.x + horizontalOffset),
    ),
    y: Math.min(
      Math.max(0, window.innerHeight - 1),
      Math.max(0, point.y + verticalOffset),
    ),
  };
}

function showActionEffect(
  runtime: AgentPointerRuntime,
  input: Exclude<NormalizedAgentPointerInput, { action: "clear" }>,
): void {
  runtime.stage.classList.remove(
    "is-clicking",
    "is-typing",
    "is-pressing",
    "is-scrolling",
    "is-dragging",
  );
  void runtime.stage.offsetWidth;

  if (input.action === "click" || input.action === "doubleClick" || input.action === "up") {
    runtime.stage.classList.add("is-clicking");
  } else if (input.action === "type" || input.action === "key" || input.action === "select") {
    runtime.stage.classList.add("is-typing");
  } else if (input.action === "down") {
    runtime.stage.classList.add("is-pressing");
  } else if (input.action === "wheel") {
    runtime.stage.classList.add("is-scrolling");
  } else if (input.action === "drag") {
    runtime.stage.classList.add("is-dragging");
    window.requestAnimationFrame(() => {
      runtime.stage.style.setProperty("--move-duration", "220ms");
      runtime.stage.style.transform = translate(input.endPoint);
      runtime.point = input.endPoint;
    });
  }

  runtime.effectTimer = window.setTimeout(() => {
    runtime.stage.classList.remove(
      "is-clicking",
      "is-typing",
      "is-pressing",
      "is-scrolling",
      "is-dragging",
    );
  }, input.action === "drag" ? 360 : 520);
}

function scheduleHide(runtime: AgentPointerRuntime): void {
  runtime.hideTimer = window.setTimeout(() => {
    runtime.stage.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!runtime.stage.classList.contains("is-visible")) {
        runtime.host.style.setProperty("display", "none", "important");
      }
    }, POINTER_FADE_DURATION_MS + 40);
  }, POINTER_HIDE_DELAY_MS);
}

function clearRuntimeTimers(runtime: AgentPointerRuntime): void {
  if (runtime.hideTimer !== undefined) {
    window.clearTimeout(runtime.hideTimer);
    runtime.hideTimer = undefined;
  }
  if (runtime.effectTimer !== undefined) {
    window.clearTimeout(runtime.effectTimer);
    runtime.effectTimer = undefined;
  }
}

function translate(point: PointerPoint): string {
  return `translate3d(${point.x}px, ${point.y}px, 0)`;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

function pointerStyles(): string {
  return `
    :host { all: initial; }
    .stage {
      --move-duration: 0ms;
      position: fixed;
      top: 0;
      left: 0;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
      transition:
        transform var(--move-duration) cubic-bezier(.22, 1, .36, 1),
        opacity ${POINTER_FADE_DURATION_MS}ms ease;
      will-change: transform;
    }
    .stage.is-visible { opacity: 1; }
    .glow {
      position: absolute;
      top: -21px;
      left: -21px;
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: radial-gradient(
        circle,
        rgba(75, 164, 255, .36) 0%,
        rgba(75, 164, 255, .2) 30%,
        rgba(75, 164, 255, .08) 50%,
        rgba(75, 164, 255, .025) 66%,
        transparent 78%
      );
      filter: blur(5px);
      opacity: .9;
      transform: scale(.98);
      transform-origin: 50% 50%;
    }
    .pointer-shape {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      width: 18px;
      height: 18px;
      clip-path: polygon(
        1% 2%,
        96% 28%,
        100% 40%,
        58% 55%,
        50% 100%,
        37% 92%,
        1% 14%
      );
      background: #080a0d;
      filter:
        drop-shadow(0 0 1px rgba(255, 255, 255, .98))
        drop-shadow(0 0 1px rgba(255, 255, 255, .92))
        drop-shadow(0 1px 1.5px rgba(8, 14, 24, .5));
    }
    .stage.is-clicking .glow,
    .stage.is-typing .glow,
    .stage.is-pressing .glow,
    .stage.is-scrolling .glow,
    .stage.is-dragging .glow {
      animation: agent-pointer-glow 180ms ease-out;
    }
    .stage.is-clicking .pointer-shape,
    .stage.is-pressing .pointer-shape {
      animation: agent-pointer-press 150ms ease-out;
    }
    @keyframes agent-pointer-glow {
      0%, 100% { opacity: .94; transform: scale(.98); }
      50% { opacity: 1; transform: scale(1.08); }
    }
    @keyframes agent-pointer-press {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(.92); }
    }
    @media (prefers-reduced-motion: reduce) {
      .stage { transition-duration: 0ms, 0ms; }
      .stage.is-clicking .glow,
      .stage.is-typing .glow,
      .stage.is-pressing .glow,
      .stage.is-scrolling .glow,
      .stage.is-dragging .glow,
      .stage.is-clicking .pointer-shape,
      .stage.is-pressing .pointer-shape { animation-duration: 1ms; }
    }
  `;
}
