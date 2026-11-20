import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ArrowLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type CmsPage = {
  slug: string;
  title: string;
  description: string | null;
  content: string;
  seo_title: string | null;
  seo_description: string | null;
};

async function getPublishedPage(slug: string): Promise<CmsPage | null> {
  if (!/^[a-zA-Z0-9а-яА-ЯёЁ-]{1,120}$/.test(slug)) return null;
  const { data, error } = await supabaseAdmin
    .from("cms_pages")
    .select("slug,title,description,content,seo_title,seo_description")
    .eq("slug", slug)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[cms/pages] public page lookup failed:", error.message);
    return null;
  }
  return data as CmsPage | null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return { title: "Страница не найдена" };
  return {
    title: page.seo_title || page.title,
    description: page.seo_description || page.description || undefined,
    alternates: { canonical: `/pages/${encodeURIComponent(page.slug)}` },
    robots: { index: true, follow: true },
  };
}

export default async function CmsPublicPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) notFound();

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-10 sm:py-16">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="h-4 w-4" />На главную
        </Link>
        <article className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-10 shadow-sm">
          <header className="mb-8 border-b border-border pb-6">
            <h1 className="font-display text-3xl sm:text-4xl font-bold leading-tight">{page.title}</h1>
            {page.description && <p className="mt-3 text-base text-muted-foreground">{page.description}</p>}
          </header>
          <div className="prose prose-neutral dark:prose-invert max-w-none prose-headings:font-display prose-a:text-primary prose-img:rounded-xl">
            <ReactMarkdown
              components={{
                a: ({ href, children }) => {
                  const safeHref = href && (href.startsWith("/") && !href.startsWith("//") || href.startsWith("https://") || href.startsWith("mailto:"));
                  return safeHref
                    ? <a href={href} className="text-primary underline underline-offset-4">{children}</a>
                    : <span>{children}</span>;
                },
              }}
            >
              {page.content}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </main>
  );
}
