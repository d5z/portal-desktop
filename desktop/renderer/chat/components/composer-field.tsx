import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type RefObject,
} from "react";
import { Markdown } from "../../shared/components/markdown";
import {
  composerTypographyStyle,
  composerTypographyVars,
} from "../composer-typography";

type ComposerFieldProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  "ref" | "className"
> & {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  className?: string;
  composing?: boolean;
};

export const ComposerField = memo(function ComposerField({
  textareaRef,
  className = "",
  composing = false,
  value = "",
  onScroll,
  style,
  ...textareaProps
}: ComposerFieldProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const text = typeof value === "string" ? value : String(value ?? "");

  const syncScroll = useCallback(() => {
    const field = textareaRef.current;
    const preview = previewRef.current;
    if (field && preview) preview.scrollTop = field.scrollTop;
  }, [textareaRef]);

  useLayoutEffect(() => {
    syncScroll();
  }, [text, syncScroll]);

  return (
    <div
      className={`composer-stack${composing ? " ime-composing" : ""}`}
      style={{ ...composerTypographyVars, ...style }}
    >
      <div
        ref={previewRef}
        className="composer-preview"
        aria-hidden="true"
      >
        {text && !composing ? (
          <Markdown
            content={text}
            chat
            composerPreview
            previewMarkdownCode={false}
            className="composer-preview-markdown"
          />
        ) : null}
      </div>
      <textarea
        ref={textareaRef}
        className={`composer-input${className ? ` ${className}` : ""}`}
        style={composerTypographyStyle}
        value={value}
        onScroll={(event) => {
          syncScroll();
          onScroll?.(event);
        }}
        {...textareaProps}
      />
    </div>
  );
});
