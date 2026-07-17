import type { Element } from "hast";
import type { ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={transformMarkdownUrl}
      >
        {normalizeStandaloneImageUrls(content)}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="chat-content">{children}</p>,
  h1: ({ children }) => <h2 className="chat-markdown-heading">{children}</h2>,
  h2: ({ children }) => <h3 className="chat-markdown-heading">{children}</h3>,
  h3: ({ children }) => <h4 className="chat-markdown-heading">{children}</h4>,
  h4: ({ children }) => <h5 className="chat-markdown-heading">{children}</h5>,
  h5: ({ children }) => <h6 className="chat-markdown-heading">{children}</h6>,
  h6: ({ children }) => <h6 className="chat-markdown-heading">{children}</h6>,
  ul: ({ children, className }) => (
    <ul className={joinClassNames("chat-markdown-list", className)}>{children}</ul>
  ),
  ol: ({ children, className }) => (
    <ol className={joinClassNames("chat-markdown-list", className)}>{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="chat-markdown-quote">{children}</blockquote>
  ),
  hr: () => <hr className="chat-markdown-divider" />,
  table: ({ children }) => (
    <div className="chat-markdown-table-wrap">
      <table className="chat-markdown-table">{children}</table>
    </div>
  ),
  a: ({ children, href }) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  pre: ({ node }) => renderCodeBlock(node),
  code: ({ children }) => <code className="chat-inline-code">{children}</code>,
  img: ({ alt, src }) => renderMarkdownImage(alt ?? "", src ?? ""),
};

function renderCodeBlock(node: Element | undefined): ReactNode {
  const codeNode = node?.children.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
  if (!codeNode || codeNode.type !== "element") {
    return <pre />;
  }

  const classNames = Array.isArray(codeNode.properties.className)
    ? codeNode.properties.className.map(String)
    : [];
  const language =
    classNames
      .find((className) => className.startsWith("language-"))
      ?.slice("language-".length) || "code";
  const code = codeNode.children
    .filter((child) => child.type === "text")
    .map((child) => child.value)
    .join("");

  return (
    <div className="message-code-block">
      <div className="message-code-header">
        <span>{language}</span>
        <button
          type="button"
          aria-label="复制代码"
          title="复制代码"
          onClick={() => void navigator.clipboard?.writeText(code)}
        >
          <span aria-hidden="true">⧉</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderMarkdownImage(alt: string, src: string): ReactNode {
  if (!isRenderableImageSrc(src)) {
    return <span>{`![${alt}](${src})`}</span>;
  }

  return (
    <div className="markdown-image-card">
      <img src={src} alt={alt || "image"} className="markdown-image" />
      <div className="markdown-image-meta">
        <span>{alt || "image"}</span>
        {src.startsWith("data:image/") ? (
          <button
            type="button"
            aria-label="下载图片"
            title="下载图片"
            onClick={() => downloadDataUrl(src, `${alt || "image"}.png`)}
          >
            <span aria-hidden="true">↓</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

const transformMarkdownUrl: UrlTransform = (url, key, node) => {
  if (key === "src" && node.tagName === "img" && isRenderableImageSrc(url)) {
    return url;
  }
  return defaultUrlTransform(url);
};

function normalizeStandaloneImageUrls(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(line.trim())
        ? `![](${line.trim()})`
        : line,
    )
    .join("\n");
}

function isRenderableImageSrc(src: string): boolean {
  return /^(data:image\/|https?:\/\/|blob:)/i.test(src);
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = sanitizeDownloadName(filename);
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function sanitizeDownloadName(filename: string): string {
  const trimmed = filename.trim() || "image.png";
  return trimmed.replace(/[<>:"|?*\x00-\x1f]/g, "-");
}
