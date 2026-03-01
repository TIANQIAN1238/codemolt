/**
 * Canvas 2D poster renderer — generates a shareable image poster
 * from selected text in a blog post.
 */

import QRCode from "qrcode";
import type { Locale } from "@/lib/i18n";

export interface PosterOptions {
  selectedText: string;
  postTitle: string;
  agentName: string;
  userName: string;
  authorAvatar?: string | null;
  postUrl?: string;
  theme: "light" | "dark";
  locale?: Locale;
}

const POSTER_SLOGAN: Record<Locale, string> = {
  en: "Share the knowledge you learn with AI at any time",
  zh: "随时分享你和 AI 一起学到的新知识",
};

interface ThemeColors {
  bg: string;
  bgGradientStops: [string, string, string];
  text: string;
  textSecondary: string;
  textDim: string;
  quoteMark: string;
  divider: string;
  noiseColor: string;
  // Author-specific colors
  authorName: string;
  authorBy: string;
  authorUsername: string;
}

const THEMES: Record<"light" | "dark", ThemeColors> = {
  dark: {
    bg: "#0f0f0f",
    bgGradientStops: ["#1a1a1a", "#0f0f0f", "#0a0a0a"],
    text: "#f0f0f2",
    textSecondary: "#8e8e96",
    textDim: "#55555e",
    quoteMark: "#333338",
    divider: "#2e2e33",
    noiseColor: "255,255,255",
    authorName: "#e4e4e8",
    authorBy: "#8e8e96",
    authorUsername: "#b0b0b8",
  },
  light: {
    bg: "#ffffff",
    bgGradientStops: ["#fafafa", "#ffffff", "#f5f5f5"],
    text: "#1a1a1e",
    textSecondary: "#6e6e78",
    textDim: "#a0a0aa",
    quoteMark: "#e0e0e4",
    divider: "#e8e8ec",
    noiseColor: "0,0,0",
    authorName: "#374151",
    authorBy: "#6b7280",
    authorUsername: "#4b5563",
  },
};

const BASE_WIDTH = 720;
const PADDING_X = 36;
const PADDING_Y = 36;
const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, "Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';

function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  const paragraphs = text.split(/\n/);
  let truncated = false;

  for (const para of paragraphs) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    if (para.trim() === "") {
      lines.push("");
      continue;
    }

    if (hasCJK(para)) {
      let currentLine = "";
      for (const char of para) {
        const testLine = currentLine + char;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          if (lines.length >= maxLines) {
            truncated = true;
            break;
          }
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
      } else if (currentLine) {
        truncated = true;
      }
    } else {
      const words = para.split(/\s+/);
      let currentLine = "";
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          if (lines.length >= maxLines) {
            truncated = true;
            break;
          }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
      } else if (currentLine) {
        truncated = true;
      }
    }
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }

  // Add ellipsis to last line if truncated
  if (truncated && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.replace(/[,.\s]+$/, "") + "…";
  }

  return { lines, truncated };
}

function drawNoise(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rgbColor: string,
  opacity: number,
) {
  const step = 4;
  for (let x = 0; x < width; x += step) {
    for (let y = 0; y < height; y += step) {
      if (Math.random() > 0.5) {
        ctx.fillStyle = `rgba(${rgbColor}, ${opacity * Math.random()})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Preload the logo SVG once at module level
let _logoCache: HTMLImageElement | null | undefined;
function getLogoImage(): Promise<HTMLImageElement | null> {
  if (_logoCache !== undefined) return Promise.resolve(_logoCache);
  return loadImage("/images/logo-text.svg").then((img) => {
    _logoCache = img;
    return img;
  });
}

/**
 * Draw a QR code onto an existing canvas context at the given position.
 * No background — modules are drawn directly onto the poster.
 */
function drawQRCode(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number,
  y: number,
  size: number,
  fgColor: string,
) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "L" });
  const modules = qr.modules;
  const moduleCount = modules.size;
  const moduleSize = size / moduleCount;

  ctx.fillStyle = fgColor;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules.get(row, col)) {
        ctx.fillRect(
          x + col * moduleSize,
          y + row * moduleSize,
          moduleSize,
          moduleSize,
        );
      }
    }
  }
}

/**
 * Determine adaptive font size and max lines based on text length.
 * Longer text → smaller font, more lines shown.
 */
function getAdaptiveQuoteParams(textLength: number): {
  fontSize: number;
  lineHeight: number;
  maxLines: number;
} {
  if (textLength > 300) {
    return { fontSize: 20, lineHeight: 20 * 1.55, maxLines: 20 };
  }

  return { fontSize: 22, lineHeight: 22 * 1.65, maxLines: 12 };
}

/** Main render function */
export async function renderPoster(
  canvas: HTMLCanvasElement,
  options: PosterOptions,
): Promise<void> {
  const {
    selectedText,
    postTitle,
    agentName,
    userName,
    authorAvatar,
    postUrl,
    theme,
    locale = "en",
  } = options;
  const slogan = POSTER_SLOGAN[locale];
  const colors = THEMES[theme];

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = BASE_WIDTH;
  const contentWidth = width - PADDING_X * 2;

  // --- Adaptive font sizing ---
  const {
    fontSize: quoteFontSize,
    lineHeight: quoteLineHeight,
    maxLines,
  } = getAdaptiveQuoteParams(selectedText.length);

  // Quote text
  ctx.font = `400 ${quoteFontSize}px ${FONT_FAMILY}`;
  const { lines: quoteLines } = wrapText(
    ctx,
    selectedText,
    contentWidth - 24,
    maxLines,
  );
  const quoteHeight = quoteLines.length * quoteLineHeight;

  // Title
  ctx.font = `600 20px ${FONT_FAMILY}`;
  const { lines: titleLines } = wrapText(ctx, postTitle, contentWidth, 2);
  const titleLineHeight = 20 * 1.4;
  const titleHeight = titleLines.length * titleLineHeight;

  // Layout
  const topPadding = PADDING_Y;
  const quoteMarkHeight = 32;
  const quoteMarkToText = 8;
  const textToDivider = 32;
  const dividerHeight = 1;
  const dividerToTitle = 24;
  const titleToAuthor = 20;
  const authorHeight = 36;
  const authorToFooter = 28;
  const qrSize = 64;
  const sloganFontSize = 11;
  const sloganGap = 6; // gap between logo and slogan
  const isLongText = selectedText.length > 300;
  const logoBlockHeight = isLongText ? 28 : 24;
  const logoAreaHeight = postUrl ? qrSize : logoBlockHeight; // original logo area (logo vertically centered here)
  const footerHeight = logoAreaHeight + sloganGap + sloganFontSize;
  const bottomPadding = PADDING_Y;

  const minHeight = isLongText ? 960 : 600;
  const totalHeight = Math.max(
    minHeight,
    topPadding +
      quoteMarkHeight +
      quoteMarkToText +
      quoteHeight +
      textToDivider +
      dividerHeight +
      dividerToTitle +
      titleHeight +
      titleToAuthor +
      authorHeight +
      authorToFooter +
      footerHeight +
      bottomPadding,
  );

  // Use devicePixelRatio for pixel-perfect 1:1 mapping with physical screen pixels
  const dpr = Math.max(2, Math.round(window.devicePixelRatio || 2));
  canvas.width = width * dpr;
  canvas.height = totalHeight * dpr;
  canvas.style.width = "";
  canvas.style.height = "";

  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // --- Rounded rect clip ---
  const radius = 24;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, totalHeight, radius);
  ctx.clip();

  // --- Background ---
  const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
  gradient.addColorStop(0, colors.bgGradientStops[0]);
  gradient.addColorStop(0.5, colors.bgGradientStops[1]);
  gradient.addColorStop(1, colors.bgGradientStops[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, totalHeight);

  drawNoise(ctx, width, totalHeight, colors.noiseColor, 0.03);

  // --- Content ---
  let cursorY = topPadding;

  // 1. Decorative quote mark
  ctx.font = `italic 48px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = colors.quoteMark;
  ctx.textBaseline = "top";
  ctx.fillText("\u201C", PADDING_X - 4, cursorY - 6);
  cursorY += quoteMarkHeight + quoteMarkToText;

  // 2. Selected text (adaptive size)
  ctx.font = `400 ${quoteFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = colors.text;
  ctx.textBaseline = "top";
  for (const line of quoteLines) {
    ctx.fillText(line, PADDING_X + 12, cursorY);
    cursorY += quoteLineHeight;
  }
  cursorY += textToDivider;

  // 3. Divider
  ctx.fillStyle = colors.divider;
  ctx.fillRect(PADDING_X, cursorY, contentWidth, dividerHeight);
  cursorY += dividerHeight + dividerToTitle;

  // 4. Post title
  ctx.font = `600 20px ${FONT_FAMILY}`;
  ctx.fillStyle = colors.text;
  ctx.textBaseline = "top";
  for (const line of titleLines) {
    ctx.fillText(line, PADDING_X, cursorY);
    cursorY += titleLineHeight;
  }
  cursorY += titleToAuthor;

  // 5. Author row — avatar + "AgentName by @username"
  const avatarSize = 20;
  const avatarY = cursorY + (authorHeight - avatarSize) / 2;
  let authorTextX = PADDING_X;

  if (authorAvatar) {
    const avatarImg = await loadImage(authorAvatar);
    if (avatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        PADDING_X + avatarSize / 2,
        avatarY + avatarSize / 2,
        avatarSize / 2,
        0,
        Math.PI * 2,
      );
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, PADDING_X, avatarY, avatarSize, avatarSize);
      ctx.restore();
      authorTextX = PADDING_X + avatarSize + 8;
    }
  }

  const authorMidY = avatarY + avatarSize / 2;
  ctx.textBaseline = "middle";

  // Agent name
  ctx.font = `600 13px ${FONT_FAMILY}`;
  ctx.fillStyle = colors.authorName;
  ctx.fillText(agentName, authorTextX, authorMidY);
  let textCursorX = authorTextX + ctx.measureText(agentName).width;

  // " by "
  ctx.font = `400 13px ${FONT_FAMILY}`;
  ctx.fillStyle = colors.authorBy;
  const byText = " by ";
  ctx.fillText(byText, textCursorX, authorMidY);
  textCursorX += ctx.measureText(byText).width;

  // "@username"
  ctx.font = `400 13px ${FONT_FAMILY}`;
  ctx.fillStyle = colors.authorUsername;
  ctx.fillText(`@${userName}`, textCursorX, authorMidY);

  cursorY += authorHeight + authorToFooter;

  // 6. Footer — logo + slogan (left) + QR code (right)
  const footerY = totalHeight - bottomPadding - footerHeight;

  // Logo (left) — vertically centered in logoAreaHeight (same as before)
  const logoImg = await getLogoImage();
  const logoY = footerY + (logoAreaHeight - logoBlockHeight) / 2;
  if (logoImg) {
    const logoWidth =
      (logoImg.naturalWidth / logoImg.naturalHeight) * logoBlockHeight;
    const logoX = PADDING_X;

    if (theme === "dark") {
      // SVG is black — tint to white for dark mode
      const offscreen = document.createElement("canvas");
      offscreen.width = logoImg.naturalWidth;
      offscreen.height = logoImg.naturalHeight;
      const offCtx = offscreen.getContext("2d");
      if (offCtx) {
        offCtx.drawImage(logoImg, 0, 0);
        offCtx.globalCompositeOperation = "source-in";
        offCtx.fillStyle = "#ffffff";
        offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
        ctx.drawImage(offscreen, logoX, logoY, logoWidth, logoBlockHeight);
      }
    } else {
      // Light mode — draw directly (black on white)
      ctx.drawImage(logoImg, logoX, logoY, logoWidth, logoBlockHeight);
    }
  }

  // Slogan below logo
  ctx.font = `400 ${sloganFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = colors.textDim;
  ctx.textBaseline = "top";
  ctx.fillText(slogan, PADDING_X, logoY + logoBlockHeight + sloganGap);

  // QR code (right) — vertically centered in logoAreaHeight
  if (postUrl) {
    drawQRCode(
      ctx,
      postUrl,
      width - PADDING_X - qrSize,
      footerY + (logoAreaHeight - qrSize) / 2,
      qrSize,
      theme === "dark" ? "#d0d0d6" : "#2a2a2e",
    );
  }
}
