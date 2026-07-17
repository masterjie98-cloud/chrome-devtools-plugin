export interface TrustedKeyEventParams {
  type: "keyDown" | "keyUp" | "rawKeyDown";
  key: string;
  code?: string;
  text?: string;
  unmodifiedText?: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  modifiers?: number;
  commands?: string[];
}

interface TrustedKeySpec {
  key: string;
  code?: string;
  virtualKeyCode?: number;
  text?: string;
}

const SPECIAL_KEYS: Record<string, TrustedKeySpec> = {
  Enter: { key: "Enter", code: "Enter", virtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", virtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", virtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", virtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", virtualKeyCode: 46 },
  Insert: { key: "Insert", code: "Insert", virtualKeyCode: 45 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", virtualKeyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", virtualKeyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", virtualKeyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", virtualKeyCode: 40 },
  Home: { key: "Home", code: "Home", virtualKeyCode: 36 },
  End: { key: "End", code: "End", virtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", virtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", virtualKeyCode: 34 },
  Space: { key: " ", code: "Space", virtualKeyCode: 32, text: " " },
  Control: { key: "Control", code: "ControlLeft", virtualKeyCode: 17 },
  Shift: { key: "Shift", code: "ShiftLeft", virtualKeyCode: 16 },
  Alt: { key: "Alt", code: "AltLeft", virtualKeyCode: 18 },
  Meta: { key: "Meta", code: "MetaLeft", virtualKeyCode: 91 },
};

for (let index = 1; index <= 12; index += 1) {
  SPECIAL_KEYS[`F${index}`] = {
    key: `F${index}`,
    code: `F${index}`,
    virtualKeyCode: 111 + index,
  };
}

export function isSupportedTrustedKey(value: string): boolean {
  try {
    trustedKeyEvents(value);
    return true;
  } catch {
    return false;
  }
}

export function trustedKeyEvents(value: string): TrustedKeyEventParams[] {
  const spec = resolveKeySpec(value);
  const base = {
    key: spec.key,
    ...(spec.code ? { code: spec.code } : {}),
    ...(spec.virtualKeyCode !== undefined
      ? {
          windowsVirtualKeyCode: spec.virtualKeyCode,
          nativeVirtualKeyCode: spec.virtualKeyCode,
        }
      : {}),
  };
  return [
    {
      type: spec.text === undefined ? "rawKeyDown" : "keyDown",
      ...base,
      ...(spec.text !== undefined
        ? { text: spec.text, unmodifiedText: spec.text }
        : {}),
    },
    { type: "keyUp", ...base },
  ];
}

export function trustedReplaceSelectionEvents(): TrustedKeyEventParams[] {
  return [
    {
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      commands: ["selectAll"],
    },
    {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
    },
    ...trustedKeyEvents("Backspace"),
  ];
}

function resolveKeySpec(value: string): TrustedKeySpec {
  const normalized = value === " " ? "Space" : value.trim();
  const special = SPECIAL_KEYS[normalized];
  if (special) {
    return special;
  }

  const characters = Array.from(value);
  if (characters.length !== 1 || !characters[0]) {
    throw new Error(
      `TRUSTED_KEY_UNSUPPORTED: ${JSON.stringify(value)} is not a supported single key. Use one character, Enter, Tab, Escape, Backspace, Delete, Insert, an arrow/navigation key, Space, a modifier, or F1-F12.`,
    );
  }
  const character = characters[0];
  const upper = character.toUpperCase();
  const isAsciiLetter = /^[A-Za-z]$/.test(character);
  const isAsciiDigit = /^\d$/.test(character);
  return {
    key: character,
    ...(isAsciiLetter
      ? { code: `Key${upper}`, virtualKeyCode: upper.charCodeAt(0) }
      : isAsciiDigit
        ? { code: `Digit${character}`, virtualKeyCode: character.charCodeAt(0) }
        : {}),
    text: character,
  };
}
