"use client";

/**
 * Markdown WYSIWYG-редактор на базе @mdxeditor/editor.
 * Поддерживает: заголовки, жирный/курсив, списки, ссылки, изображения, цитаты, код.
 * Сохраняет контент в Markdown — совместимо с существующим CmsPage.content.
 */
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  frontmatterPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  UndoRedo,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  InsertCodeBlock,
  diffSourcePlugin,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import { useRef } from "react";
import "@mdxeditor/editor/style.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Введите текст...",
  minHeight = 300,
}: MarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);

  return (
    <div className="border rounded-md overflow-hidden">
      <MDXEditor
        ref={editorRef}
        markdown={value || ""}
        onChange={onChange}
        placeholder={placeholder}
        plugins={[
          // Базовые плагины
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          markdownShortcutPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          imagePlugin({
            imageUploadHandler: async () => {
              // В проде — загрузка в S3/MinIO через /api/cms/upload
              // Пока возвращаем placeholder
              return "https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=600";
            },
          }),
          tablePlugin(),
          codeBlockPlugin(),
          frontmatterPlugin(),
          diffSourcePlugin(),
          // Тулбар
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <BlockTypeSelect />
                <BoldItalicUnderlineToggles />
                <ListsToggle />
                <CreateLink />
                <InsertImage />
                <InsertTable />
                <InsertThematicBreak />
                <InsertCodeBlock />
              </>
            ),
          }),
        ]}
        contentEditableClassName="prose prose-sm max-w-none p-4 focus:outline-none"
        
      />
    </div>
  );
}
