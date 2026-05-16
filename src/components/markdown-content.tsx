"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div className="prose-skatehive space-y-3 text-sm text-foreground leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
              className="text-accent underline hover:text-lime-200"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-6 text-foreground-muted">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-6 text-foreground-muted">{children}</ol>,
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <pre className="overflow-x-auto rounded-lg border border-border bg-black/60 p-3 text-xs text-foreground">
                  <code>{children}</code>
                </pre>
              );
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
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
