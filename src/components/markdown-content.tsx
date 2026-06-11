"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

// remark-gfm: tables, task lists, strikethrough, autolinks.
// rehype-raw: render inline HTML embedded in the markdown source.
// rehype-sanitize: clean the (now HTML-inclusive) tree before render.
// rehype-highlight: syntax-highlight fenced code blocks (adds hljs classes,
//   styled by the github-dark theme above — code blocks use a dark surface in
//   both light and dark mode, so the dark theme reads correctly either way).
// Order matters: raw → sanitize → highlight (highlight runs after sanitize so
// its added classes survive).
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize, rehypeHighlight];

function linkPullRequests(markdown: string, githubRepo?: string): string {
  if (!githubRepo) return markdown;
  const pullUrl = (n: string) => `https://github.com/${githubRepo}/pull/${n}`;
  return markdown
    .replace(/`#(\d+)`/g, (_, n: string) => `[#${n}](${pullUrl(n)})`)
    .replace(/(^|[\s(])PR #(\d+)\b/g, (_, prefix: string, n: string) => `${prefix}PR [#${n}](${pullUrl(n)})`)
    .replace(/(^|[\s(])#(\d+)\b/g, (_, prefix: string, n: string) => `${prefix}[#${n}](${pullUrl(n)})`);
}

export function MarkdownContent({ markdown, githubRepo }: { markdown: string; githubRepo?: string }) {
  const linkedMarkdown = linkPullRequests(markdown, githubRepo);
  return (
    <div className="prose-skatehive space-y-3 text-sm text-foreground leading-7">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 text-2xl font-bold text-foreground">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 text-xl font-semibold text-foreground">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 text-base font-semibold text-foreground">{children}</h3>
          ),
          p: ({ children }) => <p className="text-foreground-muted">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline hover:text-accent/80"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-6 text-foreground-muted">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-6 text-foreground-muted">{children}</ol>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-surface-elevated px-2 py-1 text-left font-semibold text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 text-foreground-muted">{children}</td>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-border bg-black/60 p-3 text-xs">
              {children}
            </pre>
          ),
          code: ({ children, className }) => {
            // Fenced blocks carry a className (language-*/hljs from rehype-highlight);
            // inline code has none.
            if (className) {
              return <code className={`${className} font-mono`}>{children}</code>;
            }
            return (
              <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-accent">
                {children}
              </code>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent-border pl-3 text-foreground-muted italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {linkedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
