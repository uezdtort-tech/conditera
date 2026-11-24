"use client";

/**
 * cms-markdown-page.tsx — публичный рендер опубликованной CMS-страницы.
 *
 * Безопасность: react-markdown НЕ исполняет сырой HTML (без
 * rehype-raw плагина) — админский Markdown превращается в React-элементы,
 * XSS через контент страницы невозможен. Ссылки: внешние — target=_blank
 * rel=noopener, mailto/tel — как есть.
 */

import ReactMarkdown from "react-markdown";
import type { PublishedCmsPage } from "@/hooks/use-published-cms-page";

/** Внешняя ссылка (http/https/protocol-relative). */
function isExternalHref(href?: string): boolean {
  return !!href && /^(https?:)?\/\//i.test(href);
}

export function CmsMarkdownPageView({ page }: { page: PublishedCmsPage }) {
  return (
    <article className="container mx-auto px-4 py-10 max-w-4xl">
      <header className="mb-8">
        <h1 className="font-display text-3xl lg:text-4xl font-bold mb-3">{page.title}</h1>
        {page.description && (
          <p className="text-muted-foreground text-lg">{page.description}</p>
        )}
      </header>

      <div className="cms-markdown max-w-none">
        <ReactMarkdown
          components={{
            h1: (props) => (
              <h2 className="font-display text-2xl lg:text-3xl font-bold mt-10 mb-4" {...props} />
            ),
            h2: (props) => (
              <h2 className="font-display text-2xl font-bold mt-8 mb-3" {...props} />
            ),
            h3: (props) => (
              <h3 className="font-display text-xl font-semibold mt-6 mb-2" {...props} />
            ),
            h4: (props) => (
              <h4 className="font-semibold text-lg mt-5 mb-2" {...props} />
            ),
            p: (props) => <p className="text-foreground/90 leading-relaxed my-3" {...props} />,
            a: ({ href, children }) => {
              const external = isExternalHref(href);
              return (
                <a
                  href={href}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  {children}
                </a>
              );
            },
            ul: (props) => <ul className="list-disc pl-6 my-3 space-y-1.5" {...props} />,
            ol: (props) => <ol className="list-decimal pl-6 my-3 space-y-1.5" {...props} />,
            li: (props) => <li className="text-foreground/90 leading-relaxed" {...props} />,
            blockquote: (props) => (
              <blockquote
                className="border-l-4 border-primary/40 bg-primary/5 rounded-r-lg px-4 py-2 my-4 text-foreground/85"
                {...props}
              />
            ),
            hr: () => <hr className="border-border my-8" />,
            code: (props) => (
              <code
                className="bg-muted rounded px-1.5 py-0.5 text-[0.9em] font-mono"
                {...props}
              />
            ),
            pre: (props) => (
              <pre
                className="bg-muted rounded-lg p-4 overflow-x-auto text-sm my-4"
                {...props}
              />
            ),
            table: (props) => (
              <div className="overflow-x-auto my-4">
                <table
                  className="w-full border-collapse text-sm [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2"
                  {...props}
                />
              </div>
            ),
            img: ({ src, alt }) => (
              // eslint-disable-next-line @next/next/no-img-element -- URL из CMS (внешние домены недопустимы для next/image без конфига)
              <img
                src={typeof src === "string" ? src : undefined}
                alt={alt ?? ""}
                loading="lazy"
                decoding="async"
                className="rounded-xl max-w-full h-auto my-4 border border-border"
              />
            ),
          }}
        >
          {page.content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
