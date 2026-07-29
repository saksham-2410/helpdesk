"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { createArticle, updateArticle, type ActionState } from "./actions";
import type { KbArticleDetail, KbCategory } from "@/lib/kb/types";

/**
 * Tiptap owns bodyHtml/bodyText, but the surrounding form is a plain
 * server-action form — the editor's content is mirrored into two hidden
 * inputs on every keystroke rather than making the whole form controlled,
 * so a normal <form action> submit still carries the current document.
 */
export function ArticleEditor({
  mode,
  article,
  categories,
}: {
  mode: "create" | "edit";
  article?: KbArticleDetail;
  categories: KbCategory[];
}) {
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: article?.body_html ?? "",
    editorProps: {
      attributes: {
        class:
          "prose-kb min-h-[320px] rounded-b-md border border-t-0 border-border-default bg-surface px-4 py-3 text-sm leading-relaxed focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      if (htmlInputRef.current) htmlInputRef.current.value = editor.getHTML();
      if (textInputRef.current) textInputRef.current.value = editor.getText();
    },
  });

  const boundAction =
    mode === "create"
      ? async (_prev: ActionState, formData: FormData) => createArticle(formData)
      : async (_prev: ActionState, formData: FormData) => updateArticle(article!.id, formData);
  const [state, formAction] = useActionState<ActionState, FormData>(boundAction, {});

  return (
    <form action={formAction} className="mx-auto w-full max-w-2xl space-y-5 overflow-y-auto px-6 py-8">
      <Field label="Title" htmlFor="article-title">
        <Input id="article-title" name="title" defaultValue={article?.title} required maxLength={200} />
      </Field>

      <Field label="Category" htmlFor="article-category" hint="Optional">
        <Select id="article-category" name="categoryId" defaultValue={article?.category_id ?? ""}>
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Excerpt"
        htmlFor="article-excerpt"
        hint="Shown in search results and article lists. Optional — inferred from the body if left blank."
      >
        <Textarea id="article-excerpt" name="excerpt" defaultValue={article?.excerpt ?? ""} maxLength={280} />
      </Field>

      <div>
        <label className="mb-1.5 block text-[0.8125rem] font-medium text-secondary">Body</label>
        <EditorToolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>

      <input ref={htmlInputRef} type="hidden" name="bodyHtml" defaultValue={article?.body_html ?? ""} />
      <input ref={textInputRef} type="hidden" name="bodyText" defaultValue={editor?.getText() ?? ""} />

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton mode={mode} />
        {state.error && <p className="text-xs text-danger-500">{state.error}</p>}
      </div>
    </form>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending}>
      {pending ? "Saving…" : mode === "create" ? "Create article" : "Save changes"}
    </Button>
  );
}

const TOOLBAR_BUTTONS: Array<{
  label: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}> = [
  { label: "B", isActive: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { label: "I", isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: "S", isActive: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
  { label: "H1", isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "H2", isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "H3", isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "•list", isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "1.list", isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "quote", isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "code", isActive: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
];

function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="h-9 rounded-t-md border border-border-default bg-paper-100 dark:bg-paper-900" />;

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-border-default bg-paper-100 px-2 py-1.5 dark:bg-paper-900">
      {TOOLBAR_BUTTONS.map((btn) => (
        <button
          key={btn.label}
          type="button"
          onClick={() => btn.run(editor)}
          className={cn(
            "rounded-xs px-2 py-1 text-[0.75rem] font-medium transition-colors",
            btn.isActive(editor)
              ? "bg-accent text-accent-text"
              : "text-secondary hover:bg-paper-200 dark:hover:bg-paper-800",
          )}
        >
          {btn.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          const url = window.prompt("Link URL");
          if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          else editor.chain().focus().unsetLink().run();
        }}
        className={cn(
          "rounded-xs px-2 py-1 text-[0.75rem] font-medium transition-colors",
          editor.isActive("link")
            ? "bg-accent text-accent-text"
            : "text-secondary hover:bg-paper-200 dark:hover:bg-paper-800",
        )}
      >
        link
      </button>
    </div>
  );
}
