import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  highlightActiveLineGutter,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { tags as t } from "@lezer/highlight";

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "#e4e4f2" },
    ".cm-content": { caretColor: "#ffb547", padding: "12px 0" },
    ".cm-cursor": { borderLeftColor: "#ffb547" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "#55556f",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.03)" },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#a5a5c0",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        backgroundColor: "rgb(255 181 71 / 0.22) !important",
      },
    ".cm-matchingBracket": {
      backgroundColor: "rgb(255 181 71 / 0.18)",
      outline: "none",
    },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: "#ff7eb0" },
  { tag: [t.string, t.special(t.string)], color: "#ffd479" },
  { tag: [t.number, t.bool, t.null], color: "#ffa45c" },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "#6b6b88",
    fontStyle: "italic",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "#7cc7ff",
  },
  { tag: [t.propertyName], color: "#b9b9ff" },
  { tag: [t.definition(t.variableName)], color: "#ffffff" },
  { tag: [t.operator, t.punctuation], color: "#9a9ab8" },
]);

export function CodeEditor({
  value,
  onChange,
  readOnly,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
          ]),
          javascript(),
          syntaxHighlighting(highlight),
          theme,
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // The editor is created once per readOnly mode; `value` changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={host} className={className} />;
}
