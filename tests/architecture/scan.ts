// A small TypeScript source scanner. It is not a parser: it tokenizes just enough to find
// module specifiers and string literals while skipping comments. ADR 026 keeps the
// TypeScript compiler API out of the toolchain, so this stays hand-written.

export type TokenKind = "ident" | "number" | "string" | "template" | "regex" | "punct";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  /** Template chunk that ends at `${`, so code follows. */
  open?: true;
}

const REGEX_AFTER_KEYWORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);
const IDENT = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;
const NUMBER = /(?:[0-9]|\.[0-9])[0-9a-zA-Z_.]*/y;

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  // One counter per open template substitution `${ ... }`: braces opened inside it.
  const substitutions: number[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;

  const regexAllowed = (): boolean => {
    const prev = out[out.length - 1];
    if (prev === undefined) return true;
    switch (prev.kind) {
      case "number":
      case "string":
      case "regex":
        return false;
      case "template":
        return prev.open === true;
      case "ident":
        return REGEX_AFTER_KEYWORD.has(prev.value);
      default:
        return prev.value !== ")" && prev.value !== "]" && prev.value !== "}";
    }
  };

  // Reads template text from `i` up to the closing backtick or the next `${`.
  const readTemplate = (first: boolean): void => {
    const startLine = line;
    let text = "";
    while (i < n) {
      const c = src[i]!;
      if (c === "\\") {
        if (src[i + 1] === "\n") line++;
        text += c + (src[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        out.push({ kind: first ? "string" : "template", value: text, line: startLine });
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        substitutions.push(0);
        out.push({ kind: "template", value: text, line: startLine, open: true });
        return;
      }
      if (c === "\n") line++;
      text += c;
      i++;
    }
    out.push({ kind: "template", value: text, line: startLine });
  };

  if (src.startsWith("#!")) while (i < n && src[i] !== "\n") i++;

  while (i < n) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === " " || c === "﻿") {
      i++;
      continue;
    }
    if (c === "/") {
      const d = src[i + 1];
      if (d === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (d === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end === -1 ? n : end + 2;
        for (let k = i; k < stop; k++) if (src[k] === "\n") line++;
        i = stop;
        continue;
      }
      if (regexAllowed()) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          const ch = src[j]!;
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) {
            j++;
            break;
          }
          j++;
        }
        while (j < n && /[A-Za-z]/.test(src[j]!)) j++;
        out.push({ kind: "regex", value: src.slice(i, j), line });
        i = j;
        continue;
      }
      out.push({ kind: "punct", value: "/", line });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const startLine = line;
      let text = "";
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") {
          if (src[i + 1] === "\n") line++;
          text += src[i]! + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        text += src[i];
        i++;
      }
      if (src[i] === c) i++;
      out.push({ kind: "string", value: text, line: startLine });
      continue;
    }
    if (c === "`") {
      i++;
      readTemplate(true);
      continue;
    }
    if (c === "{") {
      if (substitutions.length > 0) substitutions[substitutions.length - 1]!++;
      out.push({ kind: "punct", value: c, line });
      i++;
      continue;
    }
    if (c === "}") {
      const top = substitutions.length - 1;
      if (top >= 0 && substitutions[top] === 0) {
        substitutions.pop();
        i++;
        readTemplate(false);
        continue;
      }
      if (top >= 0) substitutions[top]!--;
      out.push({ kind: "punct", value: c, line });
      i++;
      continue;
    }
    IDENT.lastIndex = i;
    const ident = IDENT.exec(src);
    if (ident !== null) {
      out.push({ kind: "ident", value: ident[0], line });
      i += ident[0].length;
      continue;
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(src);
    if (num !== null) {
      out.push({ kind: "number", value: num[0], line });
      i += num[0].length;
      continue;
    }
    out.push({ kind: "punct", value: c, line });
    i++;
  }
  return out;
}

export interface ImportRef {
  specifier: string;
  line: number;
  /** `static`: import/export ... from or a side-effect import. */
  kind: "static" | "dynamic" | "require";
}

export interface UnresolvableImport {
  line: number;
  kind: "dynamic" | "require";
}

export interface StringLiteral {
  value: string;
  line: number;
}

export interface SourceScan {
  imports: ImportRef[];
  /** `import(...)` or `require(...)` whose argument is not one plain string literal. */
  unresolvable: UnresolvableImport[];
  /** String and template literal text, module specifiers excluded. Comments are skipped. */
  literals: StringLiteral[];
}

export function scanSource(src: string): SourceScan {
  const tokens = tokenize(src);
  const imports: ImportRef[] = [];
  const unresolvable: UnresolvableImport[] = [];
  const specifierTokens = new Set<Token>();

  const record = (spec: Token, kind: ImportRef["kind"]): void => {
    specifierTokens.add(spec);
    imports.push({ specifier: spec.value, line: spec.line, kind });
  };
  const isPunct = (t: Token | undefined, v: string): boolean => t?.kind === "punct" && t.value === v;

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.kind !== "ident") continue;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    if (isPunct(prev, ".")) continue;
    if (t.value === "from" && next?.kind === "string") {
      record(next, "static");
    } else if (t.value === "import" && next?.kind === "string") {
      record(next, "static");
    } else if ((t.value === "import" || t.value === "require") && isPunct(next, "(")) {
      const kind = t.value === "import" ? "dynamic" : "require";
      const arg = tokens[k + 2];
      const after = tokens[k + 3];
      if (arg?.kind === "string" && (isPunct(after, ")") || (t.value === "import" && isPunct(after, ",")))) {
        record(arg, kind);
      } else {
        unresolvable.push({ line: t.line, kind });
      }
    }
  }

  const literals: StringLiteral[] = [];
  for (const t of tokens) {
    if ((t.kind === "string" || t.kind === "template") && !specifierTokens.has(t)) {
      literals.push({ value: t.value, line: t.line });
    }
  }
  return { imports, unresolvable, literals };
}
